/**
 * 运行时自愈：把本插件补进 profile 的 bundles + 用户层 cordis.patch.yml。
 *
 * 为什么不放在 postinstall
 * ------------------------
 * DSH 安装插件走 `pnpm add`，而 npm/pnpm 对第三方包的 install 脚本默认拒绝执行
 * （日志里是 `Ignored build scripts`）。用户也可能自己带 `--ignore-scripts`。
 * 只要脚本没跑，`dsh.profile.bundles` 就缺本插件、`cordis.patch.yml` 也没有本体
 * insert —— 宿主启动时根本不会加载它，表现为「装了但没生效」。
 *
 * 所以改成运行时补：apply() 每次启动都检查一遍，缺什么补什么，已经有就什么都不做。
 * 只写「本插件自己的」那一行，不碰用户其它配置；写前备份、写后校验，
 * 任何一步失败都保持原文件不动（宁可没补上，也不能把 profile 写坏）。
 */
import fs from "node:fs";
import path from "node:path";
import { PURGE_NAME, ensureProfileBundles, ensureProfileBodyInsert } from "./profile-insert.js";

/** 从本文件位置反推 profile 目录：<profile>/node_modules/<pkg>/lib/self-insert.js */
export function resolveProfileDir() {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    // .../node_modules/dsh-purge-022/lib -> .../node_modules/dsh-purge-022 -> .../node_modules -> ...
    const pkgDir = path.dirname(here);
    const nodeModules = path.dirname(pkgDir);
    if (path.basename(nodeModules).toLowerCase() !== "node_modules") return "";
    const profileDir = path.dirname(nodeModules);
    if (!fs.existsSync(path.join(profileDir, "package.json"))) return "";
    return profileDir;
  } catch {
    return "";
  }
}

/**
 * 补齐 profile 里的两处登记。
 *
 * @param {{profileDir?: string}} [options]
 * @returns {{ok:boolean, profileDir:string, bundles:boolean, insert:boolean, error?:string}}
 */
export function ensureSelfRegistered(options = {}) {
  const profileDir = options.profileDir || resolveProfileDir();
  if (!profileDir) return { ok: false, profileDir: "", bundles: false, insert: false, error: "profile not found" };

  let bundlesChanged = false;
  let insertChanged = false;
  try {
    const b = ensureProfileBundles(profileDir);
    bundlesChanged = b.wrote === true;
  } catch (e) {
    return { ok: false, profileDir, bundles: false, insert: false, error: `bundles: ${e?.message || e}` };
  }
  try {
    const i = ensureProfileBodyInsert(profileDir);
    insertChanged = i.wrote === true;
  } catch (e) {
    return { ok: false, profileDir, bundles: bundlesChanged, insert: false, error: `insert: ${e?.message || e}` };
  }
  return { ok: true, profileDir, bundles: bundlesChanged, insert: insertChanged };
}

/** 只判断要不要补，不做任何写入 —— 给启动路径用，避免每次启动都读两遍盘。 */
export function needsSelfRegister(profileDir = resolveProfileDir()) {
  if (!profileDir) return true;
  try {
    const raw = fs.readFileSync(path.join(profileDir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const bundles = pkg?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles) || !bundles.includes(PURGE_NAME)) return true;
  } catch {
    return true;
  }
  try {
    const patch = fs.readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8");
    return !patch.includes(PURGE_NAME);
  } catch {
    return true;
  }
}

/* ── 旧包名迁移 ────────────────────────────────────────────────────────────
   `dsh-purge` 这个 npm 名被他人占用，本包改用 `dsh-purge-022`。老用户升级时
   profile 里会**同时存在两份**：
     · dependencies / bundles 里还留着旧的 "dsh-purge"
     · node_modules/dsh-purge 旧包还在
   两份都带 `id: dsh-purge` 的组合条目 —— Cordis 会报 already queued，宿主起不来。

   所以每次启动查一遍：如果还有旧名登记，就把旧的那份摘掉（bundles、dependencies、
   node_modules 目录 + 用户层 insert 里的旧行）。只动 `dsh-purge` 这一个名字，
   不碰任何别的插件。 */
const LEGACY_NAMES = ["dsh-purge"];

/** 找出 profile 里残留的旧包名登记。 */
export function findLegacyRegistrations(profileDir = resolveProfileDir()) {
  const out = { bundles: [], dependencies: [], dirs: [], patch: false };
  if (!profileDir) return out;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
    for (const name of LEGACY_NAMES) {
      if ((pkg?.dsh?.profile?.bundles || []).includes(name)) out.bundles.push(name);
      if (pkg?.dependencies && Object.hasOwn(pkg.dependencies, name)) out.dependencies.push(name);
    }
  } catch { /* 读不到就不动 */ }
  for (const name of LEGACY_NAMES) {
    if (fs.existsSync(path.join(profileDir, "node_modules", name))) out.dirs.push(name);
  }
  try {
    const patch = fs.readFileSync(path.join(profileDir, "cordis.patch.yml"), "utf8");
    // 只认 `name: dsh-purge`（不是 dsh-purge-022，也不是 id:）
    out.patch = /^\s*name: dsh-purge\s*$/m.test(patch);
  } catch { /* ignore */ }
  return out;
}

/**
 * 清掉旧包名的登记。
 *
 * @param {{profileDir?: string, dryRun?: boolean}} [options]
 * @returns {{ok:boolean, removed:string[], skipped?:boolean, error?:string}}
 */
export function removeLegacyRegistrations(options = {}) {
  const profileDir = options.profileDir || resolveProfileDir();
  if (!profileDir) return { ok: false, removed: [], error: "profile not found" };
  const found = findLegacyRegistrations(profileDir);
  const removed = [];
  const nothing = !found.bundles.length && !found.dependencies.length && !found.dirs.length && !found.patch;
  if (nothing) return { ok: true, removed, skipped: true };
  if (options.dryRun) return { ok: true, removed: [`bundles:${found.bundles}`, `deps:${found.dependencies}`, `dirs:${found.dirs}`, `patch:${found.patch}`], dryRun: true };

  /* ① package.json：摘掉 bundles 与 dependencies 里的旧名，写前留一份 .bak */
  const pkgPath = path.join(profileDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(raw);
    let changed = false;
    if (Array.isArray(pkg?.dsh?.profile?.bundles)) {
      const next = pkg.dsh.profile.bundles.filter((n) => !LEGACY_NAMES.includes(n));
      if (next.length !== pkg.dsh.profile.bundles.length) { pkg.dsh.profile.bundles = next; changed = true; }
    }
    if (pkg?.dependencies) {
      for (const name of LEGACY_NAMES) {
        if (Object.hasOwn(pkg.dependencies, name)) { delete pkg.dependencies[name]; changed = true; }
      }
    }
    if (changed) {
      fs.copyFileSync(pkgPath, `${pkgPath}.bak-legacy-${Date.now()}`);
      fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
      removed.push("package.json");
    }
  } catch (e) {
    return { ok: false, removed, error: `package.json: ${e?.message || e}` };
  }

  /* ② 用户层 cordis.patch.yml：把只含旧名的 `name:` 就地改成新包名。
     不要删行 —— 删行会破坏 YAML 结构（实测把相邻的 `- insert:` 块也带走过，
     整份文件报 BLOCK_AS_IMPLICIT_KEY，宿主启动直接失败）。
     `id: dsh-purge` 保持不变，所以改完仍是同一条 insert，不会 already queued。 */
  const patchPath = path.join(profileDir, "cordis.patch.yml");
  if (found.patch) {
    try {
      const text = fs.readFileSync(patchPath, "utf8");
      /* 只替换「独立成行、值为裸 dsh-purge」的 name:，不碰 dsh-purge-022 与注释 */
      const next = text.replace(/^(\s*name:\s*)dsh-purge\s*$/gm, `$1${PURGE_NAME}`);
      if (next !== text) {
        fs.copyFileSync(patchPath, `${patchPath}.bak-legacy-${Date.now()}`);
        fs.writeFileSync(patchPath, next, "utf8");
        removed.push("cordis.patch.yml(name→新包名)");
      }
    } catch (e) {
      return { ok: false, removed, error: `cordis.patch.yml: ${e?.message || e}` };
    }
  }

  /* ③ node_modules 里的旧包目录 */
  for (const name of found.dirs) {
    try {
      fs.rmSync(path.join(profileDir, "node_modules", name), { recursive: true, force: true });
      removed.push(`node_modules/${name}`);
    } catch (e) {
      return { ok: false, removed, error: `rm ${name}: ${e?.message || e}` };
    }
  }

  return { ok: true, removed };
}
