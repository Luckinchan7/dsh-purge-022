/**
 * 本地重锚覆盖。
 *
 * 宿主升级把某条补丁的锚点改坏时（上游改了缩进、抽了函数、换了句子），
 * 允许把那条 pattern 换成「从当前宿主里取出来的真实片段」，而不必改插件源码、
 * 也不必等下一次发布。清掉覆盖文件即恢复出厂锚点。
 *
 * 文件：$DSH_HOME/dsh-purge/anchor-overrides.json
 *   {
 *     "24": { "0": { "pattern": "……", "at": "2026-11-16T06:00:00.000Z", "host": "0.2.2-rc.3" } }
 *   }
 * 键是补丁 id（字符串），二级键是 replacements 里的下标（字符串）。
 *
 * 故意不 import core：core 会 import 本模块，形成循环依赖。
 * 这里只需要「数据目录」，用同样的解析顺序即可。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const OVERRIDES_FILE = "anchor-overrides.json";

function resolveHome(explicit) {
  const given = String(explicit || "").trim();
  if (given) return given;
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".dsh");
}

export function overridesPath(dshHome) {
  const home = resolveHome(dshHome);
  if (!home) return "";
  return path.join(home, "dsh-purge", OVERRIDES_FILE);
}

export function readOverrides(dshHome) {
  const fp = overridesPath(dshHome);
  if (!fp) return {};
  try {
    const data = JSON.parse(fs.readFileSync(fp, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function writeOverride(dshHome, patchId, index, pattern, extra = {}) {
  const fp = overridesPath(dshHome);
  if (!fp) throw new Error("未定位 DSH 数据目录，无法写重锚覆盖");
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new Error("pattern 必须是非空字符串");
  }
  const all = readOverrides(dshHome);
  const key = String(patchId);
  all[key] = all[key] || {};
  all[key][String(index)] = { pattern, at: new Date().toISOString(), ...extra };
  fs.mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fp, JSON.stringify(all, null, 2), { mode: 0o600 });
  return all;
}

export function clearOverride(dshHome, patchId, index) {
  const fp = overridesPath(dshHome);
  const all = readOverrides(dshHome);
  const key = String(patchId);
  if (!all[key]) return all;
  if (index === undefined) delete all[key];
  else delete all[key][String(index)];
  if (all[key] && Object.keys(all[key]).length === 0) delete all[key];
  if (fp) {
    try { fs.writeFileSync(fp, JSON.stringify(all, null, 2), { mode: 0o600 }); } catch { /* ignore */ }
  }
  return all;
}

/** 把覆盖叠到一条补丁的 replacements 上；不改原对象，无覆盖时原样返回。 */
export function applyOverrides(patch, overrides) {
  const all = overrides || {};
  const mine = all[String(patch && patch.id)];
  if (!mine || typeof mine !== "object") return patch;
  const list = Array.isArray(patch.replacements)
    ? patch.replacements.slice()
    : (patch.patterns ?? []).map((pat) => ({ pattern: pat, replace: patch.replace }));
  let changed = false;
  for (const [index, entry] of Object.entries(mine)) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= list.length) continue;
    if (!entry || typeof entry.pattern !== "string" || entry.pattern.length === 0) continue;
    list[i] = { ...list[i], pattern: entry.pattern };
    changed = true;
  }
  return changed ? { ...patch, replacements: list, overridden: true } : patch;
}

/** 整表叠加。DEFAULT 导出被 core 用来包 ALL_PATCHES。 */
export function withOverrides(patches, dshHome) {
  const all = readOverrides(dshHome);
  if (!all || Object.keys(all).length === 0) return patches;
  return patches.map((p) => applyOverrides(p, all));
}
