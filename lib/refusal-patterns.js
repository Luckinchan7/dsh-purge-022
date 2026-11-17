/**
 * 自我迭代：可热加载的推脱正则 + 推脱证据日志。
 *
 * 为什么需要这一层
 * ----------------
 * rc2.9 的 14 条正则全部来自「文本类」推脱（I cannot / 我不能帮你 / 这属于未授权）。
 * 实测一次图像任务被驳回时，模型的措辞是「这张我跳过」「属于对真人的性化处理」
 * 「这和前面那些动漫角色不是一回事」—— 一条都没命中，所以重试根本没触发。
 *
 * 这类漏检不可能靠一次性枚举穷尽：不同模型、不同语言、不同任务类型各有各的说法，
 * 上游改一次话术就失效一批。所以改成两半：
 *
 *   1. `refusal-patterns.json` —— 用户/维护者往里面加正则，改完立刻生效（下次请求读盘），
 *      不用改源码、不用发版、不用重启宿主。
 *   2. `refusal-log.jsonl` —— 每次判定为推脱时把开头 300 字符记下来（滚动保留），
 *      新话术出现时从日志里就能提炼出下一批正则。
 *
 * 这就是「自我迭代」的实际含义：不是模型自己改自己的代码，而是
 * **每次被拒都留下可提炼的证据，且修正动作不需要重新打包**。
 *
 * 本文件不 import core / index，避免循环依赖。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const PATTERNS_FILE = 'refusal-patterns.json';
export const LOG_FILE = 'refusal-log.jsonl';
/** 日志滚动阈值：超过就切到 .1，只留两份。 */
export const LOG_MAX_BYTES = 512 * 1024;

/** 落在 `$DSH_HOME/dsh-purge/` 下，与 tuning.json 并列。 */
function resolveHome(dshHome) {
  if (typeof dshHome === 'string' && dshHome.trim()) return dshHome;
  const env = process.env.DSH_HOME;
  if (typeof env === 'string' && env.trim()) return env;
  return join(homedir(), '.dsh');
}

export function stateDir(dshHome) {
  return join(resolveHome(dshHome), 'dsh-purge');
}

export function patternsPath(dshHome) {
  return join(stateDir(dshHome), PATTERNS_FILE);
}

export function logPath(dshHome) {
  return join(stateDir(dshHome), LOG_FILE);
}

/**
 * 读额外正则。
 *
 * 文件形态（两种都接受）：
 *   ["regex1", "regex2"]                       —— 简写
 *   [{ "pattern": "regex", "note": "..." }]     —— 带说明
 *
 * 坏正则逐条跳过并收集到 `bad` 里，不让一条写错把整层打死。
 *
 * @param {string} [dshHome]
 * @returns {{ patterns: RegExp[], bad: {pattern: string, error: string}[] }}
 */
export function readExtraPatterns(dshHome) {
  const file = patternsPath(dshHome);
  const out = { patterns: [], bad: [] };
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  let list;
  try {
    list = JSON.parse(raw);
  } catch (error) {
    out.bad.push({ pattern: '(whole file)', error: `JSON 解析失败：${error?.message ?? String(error)}` });
    return out;
  }
  if (!Array.isArray(list)) {
    out.bad.push({ pattern: '(whole file)', error: '顶层必须是数组' });
    return out;
  }
  for (const item of list) {
    const pattern = typeof item === 'string' ? item : item?.pattern;
    if (typeof pattern !== 'string' || !pattern.trim()) continue;
    try {
      out.patterns.push(new RegExp(pattern, typeof item?.flags === 'string' ? item.flags : ''));
    } catch (error) {
      out.bad.push({ pattern, error: error?.message ?? String(error) });
    }
  }
  return out;
}

/**
 * 写回额外正则（保留已有条目的 note / flags）。
 *
 * @param {Array<{pattern: string, note?: string, flags?: string}>} list
 * @param {string} [dshHome]
 */
export function writeExtraPatterns(list, dshHome) {
  const file = patternsPath(dshHome);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(list, null, 2) + '\n', 'utf8');
  return file;
}

/**
 * 追加一条新的额外正则（去重：同 pattern 已存在则原样返回）。
 *
 * @param {string} pattern
 * @param {{ note?: string, flags?: string, dshHome?: string }} [options]
 * @returns {{ added: boolean, file: string }}
 */
export function appendExtraPattern(pattern, options = {}) {
  const text = String(pattern ?? '').trim();
  if (!text) throw new Error('pattern 不能为空');
  /* 先编译一次：写进去一条坏正则等于给每次请求留一颗地雷。 */
  new RegExp(text, options.flags ?? '');
  const current = readExtraPatterns(options.dshHome);
  const listed = [];
  try {
    const raw = JSON.parse(readFileSync(patternsPath(options.dshHome), 'utf8'));
    if (Array.isArray(raw)) listed.push(...raw);
  } catch {
    /* 文件不存在或坏了：按空表重建 */
  }
  const exists = listed.some((item) => (typeof item === 'string' ? item : item?.pattern) === text);
  if (exists) return { added: false, file: patternsPath(options.dshHome) };
  listed.push({ pattern: text, note: options.note ?? '', flags: options.flags ?? '' });
  const file = writeExtraPatterns(listed, options.dshHome);
  return { added: true, file, compiled: current.patterns.length };
}

/**
 * 记一条推脱证据。
 *
 * 只在真的判成推脱时调用 —— 正常回答一条都不写，日志不会被正常内容灌满。
 *
 * @param {{ head: string, matched: number, image?: boolean, model?: string }} info
 * @param {string} [dshHome]
 */
export function logRefusal(info, dshHome) {
  try {
    const file = logPath(dshHome);
    mkdirSync(dirname(file), { recursive: true });
    try {
      const size = statSync(file).size;
      if (size > LOG_MAX_BYTES) {
        try { unlinkSync(file + '.1'); } catch { /* 没有旧档 */ }
        renameSync(file, file + '.1');
      }
    } catch {
      /* 首次写 */
    }
    const record = {
      at: new Date().toISOString(),
      matched: info?.matched ?? -1,
      image: info?.image === true,
      model: info?.model ?? '',
      head: String(info?.head ?? '').slice(0, 300),
    };
    appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  } catch {
    /* 日志失败不能影响主流程 */
  }
}

/**
 * 读最近 N 条证据（给面板/自检用）。
 *
 * @param {number} [limit]
 * @param {string} [dshHome]
 */
export function readRefusalLog(limit = 50, dshHome) {
  const file = logPath(dshHome);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, limit)).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 统计各条规则的命中次数 —— 哪条规则真在用、哪条是死代码，一看就知道。
 *
 * @param {string} [dshHome]
 */
export function refusalStats(dshHome) {
  const rows = readRefusalLog(2000, dshHome);
  const byRule = new Map();
  let image = 0;
  for (const row of rows) {
    const key = row.matched;
    byRule.set(key, (byRule.get(key) ?? 0) + 1);
    if (row.image) image += 1;
  }
  return {
    total: rows.length,
    image,
    byRule: [...byRule.entries()].sort((a, b) => b[1] - a[1]).map(([rule, count]) => ({ rule, count })),
  };
}
