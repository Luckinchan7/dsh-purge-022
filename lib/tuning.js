// 插件自有运行开关。刻意不放进 profile 的 cordis config：
// 改行为不该需要编辑 DSH 的文件、也不该需要重启 profile。
// 存在 $DSH_HOME/dsh-purge/tuning.json，`dsh plugin add` 重装不会丢。
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const TUNING_FILE = "tuning.json";

/**
 * 默认值即全开：破甲是这个插件唯一的目的，默认就不该留门。
 * boost  —— 尾部强化段（order 10249，紧贴尾部锚点之前）
 * probe  —— 运行时探针（默认关：它会往系统提示词里塞一次性 nonce，属诊断工具）
 * tailAnchor —— 尾部锚点（与 profile config 的 tailAnchor 同义，任一处关闭即关闭）
 * askNoBlock —— 与宿主补丁 #89 对应，仅作为状态镜像供自检读取
 */
export const TUNING_DEFAULTS = Object.freeze({
  boost: true,
  probe: false,
  tailAnchor: true,
  askNoBlock: true,
});

/** 自带 home 解析，故意不 import core：core 会 import 本模块的读者，避免循环依赖。 */
function resolveHome(explicit) {
  const given = String(explicit || "").trim();
  if (given) return given;
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".dsh");
}

export function tuningPath(dshHome) {
  const home = resolveHome(dshHome);
  if (!home) return "";
  return path.join(home, "dsh-purge", TUNING_FILE);
}

export function readTuning(dshHome) {
  const file = tuningPath(dshHome);
  if (!file) return { ...TUNING_DEFAULTS };
  let saved = {};
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object") saved = raw;
  } catch {
    saved = {};
  }
  const merged = { ...TUNING_DEFAULTS };
  for (const key of Object.keys(TUNING_DEFAULTS)) {
    if (typeof saved[key] === "boolean") merged[key] = saved[key];
  }
  return merged;
}

export function writeTuning(patch = {}, dshHome) {
  const file = tuningPath(dshHome);
  if (!file) throw new Error("未定位 DSH 数据目录，无法保存 tuning");
  const next = { ...readTuning(dshHome) };
  for (const key of Object.keys(TUNING_DEFAULTS)) {
    if (typeof patch[key] === "boolean") next[key] = patch[key];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
