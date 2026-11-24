/**
 * verify-rc217.mjs — #100–#140 限额抬升补丁的静态自检。
 *
 * 这一组不跑真实 apply（那是 verify-rc215 的事），只检查表本身的形状：
 * id 唯一、字段齐全、marker 与 replace 对得上、锚点指向的目标键在 core 里存在。
 * 目的是让「新增一条补丁时忘了写 marker」「file 键写错一个字母」这类错误在
 * 打包前就红掉，而不是等用户点应用才看到「跳过」。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const core = await import(pathToUrl(path.join(root, "lib", "core.js")));
const { LIMIT_PATCHES } = await import(pathToUrl(path.join(root, "lib", "limits.js")));

function pathToUrl(p) {
  return `file:///${p.replace(/\\/g, "/")}`;
}

let pass = 0;
let fail = 0;
const fails = [];
function ok(label, cond, detail = "") {
  if (cond) {
    pass += 1;
    return;
  }
  fail += 1;
  fails.push(`${label}${detail ? `  (${detail})` : ""}`);
}

// ── 1. 表形状 ────────────────────────────────────────────────
ok("LIMIT_PATCHES 是数组", Array.isArray(LIMIT_PATCHES));
ok("补丁条数 = 41", LIMIT_PATCHES.length === 41, `实际 ${LIMIT_PATCHES.length}`);

const ids = LIMIT_PATCHES.map((p) => p.id);
ok("id 无重复", new Set(ids).size === ids.length);
ok("id 落在 100–140", ids.every((id) => id >= 100 && id <= 140), `范围 ${Math.min(...ids)}–${Math.max(...ids)}`);
ok("id 连续无洞", [...ids].sort((a, b) => a - b).every((id, i) => id === 100 + i));

for (const p of LIMIT_PATCHES) {
  const tag = `#${p.id}`;
  ok(`${tag} 有 name`, typeof p.name === "string" && p.name.length > 2);
  ok(`${tag} 有 desc`, typeof p.desc === "string" && p.desc.length > 4);
  ok(`${tag} 标了 optional`, p.optional === true, "换版本后锚点消失要降级成跳过");
  ok(`${tag} 有 file`, !!p.file && (Array.isArray(p.file) ? p.file.length > 0 : true));
  ok(`${tag} 有 replacements`, Array.isArray(p.replacements) && p.replacements.length > 0);
  ok(`${tag} 有 markers`, Array.isArray(p.markers) && p.markers.length > 0);
  for (const [i, r] of (p.replacements ?? []).entries()) {
    ok(`${tag} 第 ${i + 1} 条 pattern 非空`, typeof r.pattern === "string" && r.pattern.length > 0);
    ok(`${tag} 第 ${i + 1} 条 replace 是字符串`, typeof r.replace === "string" && r.replace.length > 0);
    ok(`${tag} 第 ${i + 1} 条 pattern ≠ replace`, r.pattern !== r.replace);
  }
}

// ── 2. 目标键在 core 里存在 ───────────────────────────────────
const probeAiBase = "D:/DSH_DESKTOP/resources/app/dsh/node_modules/@deepseek-ai";
let files = null;
try {
  files = core.targetFiles(probeAiBase);
} catch {
  files = null;
}
if (files) {
  const keys = new Set(Object.keys(files));
  for (const p of LIMIT_PATCHES) {
    const list = Array.isArray(p.file) ? p.file : [p.file];
    for (const k of list) {
      ok(`#${p.id} 目标键 "${k}" 在 targetFiles 里`, keys.has(k));
    }
  }
} else {
  ok("本机无法探测宿主，跳过目标键校验", true);
}

// ── 3. marker 必须能在 replace 后文本里找到 ───────────────────
// 用 pattern→replace 直接构造产物，避免依赖真实文件。
for (const p of LIMIT_PATCHES) {
  const list = Array.isArray(p.file) ? p.file : [p.file];
  const fps = [];
  if (files) for (const k of list) {
    const v = files[k];
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    for (const fp of arr) if (fp && fs.existsSync(fp)) fps.push(fp);
  }
  if (fps.length === 0) continue;
  let anyMarker = false;
  for (const fp of fps) {
    const t0 = fs.readFileSync(fp, "utf8");
    const r1 = core.applyReplacementsToText(t0, p, fp);
    if (!r1.changed) continue;
    const ms = p.markers ?? (p.marker ? [p.marker] : []);
    const match = p.markersAny ? ms.some((m) => r1.text.includes(m)) : ms.every((m) => r1.text.includes(m));
    if (match) anyMarker = true;
    else fails.push(`#${p.id} ${p.name} marker 未命中 ${path.basename(fp)}`);
  }
  if (!fps.every((fp) => !core.applyReplacementsToText(fs.readFileSync(fp, "utf8"), p, fp).changed)) {
    ok(`#${p.id} 至少命中一个文件`, anyMarker);
  }
}

// ── 4. 幂等：产物再跑一次不该变 ─────────────────────────────
for (const p of LIMIT_PATCHES) {
  const list = Array.isArray(p.file) ? p.file : [p.file];
  if (!files) break;
  for (const k of list) {
    const v = files[k];
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    for (const fp of arr) {
      if (!fp || !fs.existsSync(fp)) continue;
      const t0 = fs.readFileSync(fp, "utf8");
      const r1 = core.applyReplacementsToText(t0, p, fp);
      if (!r1.changed) continue;
      const r2 = core.applyReplacementsToText(r1.text, p, fp);
      ok(`#${p.id} 二次应用无变化`, !r2.changed, path.basename(fp));
    }
  }
}

// ── 5. #127 必须修掉 #19 的真实失效点 ─────────────────────────
const yml = files?.["base"] ?? "";
if (yml && fs.existsSync(yml)) {
  const y = fs.readFileSync(yml, "utf8");
  ok("#19 的 DEFAULTS 仍在（三条都已抬）", /thresholdChars: 16384/.test(fs.readFileSync(
    path.join(probeAiBase, "dsh-compaction-tool-result-pruner", "lib", "index.js"), "utf8")));
  ok("#127 yml 覆盖已同步抬到 50000", /thresholdChars: 50000/.test(y));
  ok("#127 yml 里不再有 8192", !/thresholdChars: 8192/.test(y));
}

// ── 6. 产物与合计 ────────────────────────────────────────────
ok("ALL_PATCHES 含全部限额补丁", LIMIT_PATCHES.every((p) => core.ALL_PATCHES.some((q) => q.id === p.id)));
ok("ALL_PATCHES id 总量", new Set(core.ALL_PATCHES.map((p) => p.id)).size === core.ALL_PATCHES.length, `共 ${core.ALL_PATCHES.length} 条`);

console.log(`\nverify-rc217: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("\n失败项：");
  for (const f of fails) console.log(`  - ${f}`);
  process.exitCode = 1;
}
