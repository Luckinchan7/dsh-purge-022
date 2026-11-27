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

// ── 5b. 每条补丁都要在面板里说出自己是谁 ──────────────────────
{
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  const lines = clientSrc.split("\n");
  const zh = new Map();
  const en = new Map();
  let block = 0;
  for (const line of lines) {
    if (/"patch\.1":/.test(line)) block += 1;
    const m = line.match(/"patch\.(\d+)":\s*"(.*)",\s*$/);
    if (!m) continue;
    if (block === 1) zh.set(Number(m[1]), m[2]);
    else if (block === 2) en.set(Number(m[1]), m[2]);
  }
  ok("i18n 两个语言块都在", block === 2, `找到 ${block} 个`);
  const LIMIT_IDS = LIMIT_PATCHES.map((p) => p.id).sort((a, b) => a - b);
  const missZh = LIMIT_IDS.filter((id) => !zh.has(id));
  const missEn = LIMIT_IDS.filter((id) => !en.has(id));
  ok("限额补丁中文标签无缺失", missZh.length === 0, missZh.length ? `缺 ${missZh.join(",")}` : `${LIMIT_IDS.length} 条`);
  ok("限额补丁英文标签无缺失", missEn.length === 0, missEn.length ? `缺 ${missEn.join(",")}` : `${LIMIT_IDS.length} 条`);
  // 全表也要覆盖，不只限额那批
  const ALL_IDS = core.ALL_PATCHES.map((p) => p.id);
  const allMiss = ALL_IDS.filter((id) => !zh.has(id) && !en.has(id));
  ok("所有补丁至少有一种语言标签", allMiss.length === 0, allMiss.length ? `裸奔 ${allMiss.join(",")}` : `共 ${ALL_IDS.length} 条`);
  // 不能再出现 patch.NN 这种原始键名直接露出来的情况
  const rawKeys = ALL_IDS.filter((id) => !zh.has(id) && !en.has(id));
  ok("面板不会渲染出 patch.<id> 原始键", rawKeys.length === 0);
  ok("client 用 patch_names 兜底", /state\.patch_names/.test(clientSrc));
  ok("client 用 patch_descs 兜底", /state\.patch_descs/.test(clientSrc));
  ok("status 载荷带 patch_names", /patch_names,/.test(fs.readFileSync(path.join(root, "lib", "index.js"), "utf8")));
  ok("status 载荷带 patch_descs", /patch_descs,/.test(fs.readFileSync(path.join(root, "lib", "index.js"), "utf8")));
}

// ── 5c. 界面入口开关要走 tuning，不能是硬编码 ─────────────────
{
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  const tuningSrc = fs.readFileSync(path.join(root, "lib", "tuning.js"), "utf8");
  const indexSrc = fs.readFileSync(path.join(root, "lib", "index.js"), "utf8");
  ok("tuning 有 launcher 开关", /launcher: true/.test(tuningSrc));
  ok("tuning 有 chips 开关", /chips: true/.test(tuningSrc));
  ok("status 载荷带 tuning", /tuning: \(\(\) => \{ try \{ return readTuning/.test(indexSrc));
  ok("client 有 useEntries 钩子", /function useEntries\(\)/.test(clientSrc));
  ok("PurgeLauncher 读 launcher 开关", /const entries = useEntries\(\);\s*\n\s*if \(entries\.launcher === false\) return null;/.test(clientSrc));
  ok("Hero mount 读 chips 开关", /const entries = useEntries\(\);[\s\S]{0,400}entries\.chips === false/.test(clientSrc));
  ok("TabRow mount 读 chips 开关", /function TabRowPurgeMount[\s\S]{0,400}entries\.chips === false/.test(clientSrc));
  ok("关掉后会把已挂的节点摘掉", /unmountFloatChip\("dshp-hero-chip"\)/.test(clientSrc) && /unmountFloatChip\("dshp-tab-chip"\)/.test(clientSrc));
  ok("面板有 UiEntrySection", /function UiEntrySection/.test(clientSrc) && /h\(UiEntrySection, \{ onSaved: loadAll \}\)/.test(clientSrc));
  ok("保存后派发刷新事件", /dsh-purge:entries/.test(clientSrc));
}

// ── 5d. 预设里的插件名必须等于包名（改名漏改会让整份预设挂不上） ──
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const presetSrc = fs.readFileSync(path.join(root, "presets", "redteam", "agent.cordis.yml"), "utf8");
  const names = [...presetSrc.matchAll(/^\s*name:\s*(.+)$/gm)]
    .map((m) => m[1].trim().replace(/^["']|["']$/g, ""))
    .filter((n) => n && n !== "cordis:group" && n !== "cordis:isolate" && !n.startsWith("@deepseek-ai/") && !n.startsWith("."));
  ok("预设里没有裸 dsh-purge/ 前缀", !/\bdsh-purge\/redteam/.test(presetSrc), names.join(", "));
  ok("persona 行用当前包名", presetSrc.includes(`name: '${pkg.name}/redteam/persona'`), pkg.name);
  ok("tools 行用当前包名", presetSrc.includes(`name: ${pkg.name}/redteam/tools`), pkg.name);
  ok("renderToolsPackage 从 package.json 读名字", /function selfPackageName\(\)/.test(fs.readFileSync(path.join(root, "lib", "redteam", "index.js"), "utf8")));
}

// ── 5e. 插话链路不能被改成排队 ────────────────────────────────
{
  const pick = (id) => core.ALL_PATCHES.find((p) => p.id === id);
  const repsOf = (p) => (p.replacements || []).map((r) => String(r.replace || "")).join("\n");
  const patOf = (p) => (p.replacements || []).map((r) => String(r.pattern || "")).join("\n");

  const p85 = pick(85);
  const p86 = pick(86);
  const p89 = pick(89);

  ok("#85 存在", Boolean(p85));
  ok("#86 存在", Boolean(p86));
  ok("#89 存在", Boolean(p89));

  // 用户报「插话发不出去」的根因就是这两条把 steer 换成了 followup。
  ok("#85 不把 prompt 的 steer 改成排队", !/agent\.followup\(message\); *\/\/ *\[dsh-purge-85\] user prompt always next-turn/.test(repsOf(p85)));
  ok("#85 保留 steer 分支", /agent\.steer\(message\)/.test(repsOf(p85)));
  ok("#85 带 running 守卫", /agent\.status === "running"/.test(repsOf(p85)));
  ok("#85 把旧形态列进 forbid", (p85.forbid || []).some((f) => f.includes("user prompt always next-turn")));
  ok("#85 能识别旧形态并改回来", /followup\(message\); *\/\/ *\[dsh-purge-85\] user prompt always next-turn/.test(patOf(p85)));

  ok("#86 不把队列 steer 改成排队", !/agent\.followup\(message\); *\/\/ *\[dsh-purge-86\] queue steer/.test(repsOf(p86)));
  ok("#86 保留 steer 分支", /agent\.steer\(message\)/.test(repsOf(p86)));
  ok("#86 带 running 守卫", /agent\.status === "running"/.test(repsOf(p86)));
  ok("#86 把旧形态列进 forbid", (p86.forbid || []).some((f) => f.includes("queue steer")));
  ok("#86 仍保证 agent-loop 的 steer() 是 next-step", /this\.send\(input, "next-step", true\)/.test(repsOf(p86)));

  // 反问不能压到 1 秒（1.2.10 之前那条等于没人答得完）。
  ok("#89 不再把 timeout 写死成 1", !/const timeout = 1;/.test(repsOf(p89)));
  ok("#89 有上限钳制", /Math\.min\(/.test(repsOf(p89)));
  ok("#89 处理 -1 无限等", /=== -1/.test(repsOf(p89)));
  ok("#89 把 1 秒形态列进 forbid", (p89.forbid || []).some((f) => f.includes("const timeout = 1;")));

  // 标签也要跟着改，不能还写着「一律新 turn」。
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  ok("i18n 里 #85 不再写「一律新 turn」", !/"patch\.85": "[^"]*一律新 turn/.test(clientSrc));
  ok("i18n 里 #89 不再写「等 1 秒」", !/"patch\.89": "[^"]*等 1 秒/.test(clientSrc));
}

// ── 5f. 浮动挂件不能往宿主的 React 子树里插节点 ──────────────
{
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  ok("有 mountFloatChip", /function mountFloatChip\(/.test(clientSrc));
  ok("有 unmountFloatChip", /function unmountFloatChip\(/.test(clientSrc));
  // 关键：不能再对宿主行做 appendChild —— 那会让 React 的 diff 对不上，
  // 用户看到的就是「选了工作区又弹回去」。
  ok("不往宿主行 appendChild", !/row\.appendChild\(/.test(clientSrc));
  ok("容器挂到 document.body", /document\.body\.appendChild\(el\)/.test(clientSrc));
  ok("容器用 fixed 定位", /\.dshp-float-chip\{[^}]*position:fixed/.test(clientSrc));
  ok("有滚动/缩放重排", /addEventListener\("scroll"/.test(clientSrc) && /addEventListener\("resize"/.test(clientSrc));
  ok("两处都走 mountFloatChip", (clientSrc.match(/mountFloatChip\(/g) || []).length >= 3 && (clientSrc.match(/mountFloatChip\((row|anchorEl),/g) || []).length === 2);
  ok("卸载时清掉浮动节点", (clientSrc.match(/unmountFloatChip\("dshp-/g) || []).length >= 4);
}

// ── 5g. 关掉悬浮按钮之后还得有别的入口 ──────────────────────
{
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  ok("有 PurgeSettingsSection 组件", /function PurgeSettingsSection\(/.test(clientSrc));
  ok("注册到 settings.section", /slots\.inject\("settings\.section"/.test(clientSrc));
  ok("settings.section 带 label", /name: "settings\.section"[\s\S]{0,200}label:/.test(clientSrc));
  ok("settings.section 用 i18n 标签", /label: \(\) => t\("settings\.nav"\)/.test(clientSrc));
  ok("i18n 两个块都有 settings.nav", (clientSrc.match(/"settings\.nav":/g) || []).length === 2);
  ok("settings 段复用 SettingsRoot", /function PurgeSettingsSection[\s\S]{0,400}h\(SettingsRoot, \{ t \}\)/.test(clientSrc));
}

// ── 5h. 浮动挂件不能压住行尾的「…」按钮 ────────────────────
{
  const clientSrc = fs.readFileSync(path.join(root, "client.js"), "utf8");
  ok("mountFloatChip 支持 afterSelector", /function mountFloatChip\(anchor, className, testId, opts\)/.test(clientSrc));
  ok("afterSelector 取父容器里的兄弟", /anchor\.parentElement \|\| document/.test(clientSrc));
  ok("afterSelector 校验同一行", /Math\.abs\(ar\.top - r\.top\)/.test(clientSrc));
  ok("基准取 max(锚点右, 按钮右)", /baseRight = Math\.max\(baseRight, ar\.right\)/.test(clientSrc));
  ok("挤不下时隐藏而不是左移", /left \+ w > window\.innerWidth - 8[\s\S]{0,80}visibility = "hidden"/.test(clientSrc));
  ok("TabRow 传 afterSelector", /afterSelector: "\[aria-haspopup='menu'\]"/.test(clientSrc));
  ok("TabRow 锚点优先 tablist", /row\.querySelector\("\[role='tablist'\]"\) \|\| row/.test(clientSrc));
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
