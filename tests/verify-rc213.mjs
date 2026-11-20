// dsh-purge rc2.13.1 自检：三条真实失败路径各自的可重现验证。
//
// 只 import 本目录的源码，不碰 profile、不碰宿主安装目录。
// 用法：node verify-rc213.mjs
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (rel) => import(new URL(rel, import.meta.url));

const { repairMessageShapes, trimOversizedHistory } = await load("../lib/rewind.js");
const rr = await load("../lib/refusal-retry.js");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass += 1; console.log("PASS", name); }
  else { fail += 1; console.log("FAIL", name, extra); }
};

/* ── 1. content 形状：宿主断言的可复现版本 ─────────────────────────────
   宿主（dsh-llm-pi-ai / dsh-llm）在发请求前直接 `message.content.some(...)`。
   历史里只要残留一条字符串 content，那一轮就在发出去之前抛
   `TypeError: message.content.some is not a function`。 */
const hostAssert = (messages) => {
  for (const m of messages) {
    if (!Array.isArray(m.content)) throw new TypeError("message.content.some is not a function");
  }
};

const dirty = [
  { role: "system", content: [{ type: "text", text: "S" }] },
  { role: "assistant", content: "[renderer] prompt compiled; no text output for this step." },
  { role: "user", content: "hello" },
  { role: "tool", content: null },
];
let threw = false;
try { hostAssert(dirty); } catch { threw = true; }
ok("1a 未修复的历史确实会让宿主断言抛错（复现）", threw);

const { messages: fixed, repaired } = repairMessageShapes(dirty);
ok("1b 修好 3 条字符串 / null content", repaired === 3, `repaired=${repaired}`);
ok("1c 修复后宿主断言通过", (() => { try { hostAssert(fixed); return true; } catch { return false; } })());
ok("1d 空字符串收敛成空数组", Array.isArray(repairMessageShapes([{ role: "user", content: "" }]).messages[0].content)
  && repairMessageShapes([{ role: "user", content: "" }]).messages[0].content.length === 0);
ok("1e 已经是数组的消息原样复用（不产生多余拷贝）",
  repairMessageShapes([dirty[0]]).messages[0] === dirty[0]);

/* ── 2. 体积保险丝 ─────────────────────────────────────────────────────
   上游拒绝 DSH 自己的压缩 checkpoint（bili owns compression），体积只能在这里兜。
   实测失败会话：5394 条消息 / 正文 ~5.9MB → 代理判 ~78 万 tokens > 窗口 75 万 → 413。 */
const big = "x".repeat(200_000);
const many = [{ role: "system", content: [{ type: "text", text: "S" }] }];
for (let i = 0; i < 40; i += 1) many.push({ role: "tool", content: [{ type: "text", text: big }] });
for (let i = 0; i < 6; i += 1) many.push({ role: "user", content: [{ type: "text", text: "recent" }] });

const bytesOf = (msgs) => msgs.reduce((n, m) => n + (Array.isArray(m.content)
  ? m.content.reduce((k, b) => k + (b.type === "text" ? Buffer.byteLength(b.text, "utf8") : 0), 0) : 0), 0);

const beforeBytes = bytesOf(many);
const fitted = trimOversizedHistory(many);
ok("2a 输入确实超预算（复现 413 的量级）", beforeBytes > 8_000_000, `bytes=${beforeBytes}`);
ok("2b 裁剪后显著变小", fitted.bytes < beforeBytes / 4, `after=${fitted.bytes}`);
ok("2c 最近 6 条原样保留", fitted.messages.slice(-6).every((m, i) => m === many[many.length - 6 + i]));
ok("2d 老消息只裁不改文案", String(fitted.messages[1].content[0].text).includes("体积保险丝"));
ok("2e 原文仍然在输入对象里（不改会话存档）", many[1].content[0].text.length === 200_000);

/* system 消息绝不能被裁 —— 那是身份 / 指令区。 */
const withSystem = [{ role: "system", content: [{ type: "text", text: "S".repeat(3_000_000) }] }];
for (let i = 0; i < 30; i += 1) withSystem.push({ role: "tool", content: [{ type: "text", text: "y".repeat(200_000) }] });
const fittedSystem = trimOversizedHistory(withSystem);
ok("2f system 消息原样保留", fittedSystem.messages[0] === withSystem[0],
  `system 被动了: ${fittedSystem.messages[0].content[0].text.length}`);
ok("2g 但其余老消息照常被裁", fittedSystem.trimmed > 0);

const small = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
const untouched = trimOversizedHistory(small);
ok("2h 小请求零改动、原数组引用不变", untouched.trimmed === 0 && untouched.messages === small);

/* ── 3. 拒绝重试路径不再写出字符串 content ───────────────────────────── */
const REF = "这张我跳过——涉及真实人物，无法核实所谓同意。\n\n能做的方向：\n- 换一身衣服\n- 换背景\n- 风格化";
const isRef = (t) => rr.refusalMatchIndexWithExtras(t, "") >= 0;
const stripped = rr.stripRefusalHistory({ messages: [
  { role: "system", content: [{ type: "text", text: "S" }] },
  { role: "assistant", content: [{ type: "text", text: REF }] },
] }, isRef);
ok("3a 洗历史后 content 必须是数组", Array.isArray(stripped.messages[1].content));
ok("3b 洗历史命中计数正确", stripped.__stripped === 1);

const nudged = rr.withNudge({ messages: [{ role: "system", content: "S" }] }, "\nN");
ok("3c withNudge 处理字符串 system 时输出数组", Array.isArray(nudged.messages[0].content));
const nudged2 = rr.withNudge({ messages: [{ role: "user", content: [{ type: "text", text: "u" }] }] }, "\nN");
ok("3d 无 system 时补的是数组 content", Array.isArray(nudged2.messages[0].content));

/* 端到端：模拟一次「首轮拒绝 → 重试成功」，宿主断言必须全程不抛。 */
async function* firstStream() {
  yield { type: "text-delta", text: REF };
  yield { type: "finish", reason: "stop" };
}
async function* retryStream() {
  yield { type: "text-delta", text: "已生成 out.png" };
  yield { type: "finish", reason: "stop" };
}
const options = { messages: [
  { role: "system", content: "S" },
  { role: "assistant", content: REF },
  { role: "user", content: "再来一次" },
] };
let retrySawArray = true;
const gen = rr.streamWithRefusalRetry(firstStream(), options, {
  dshHome: "",
  retryStream: (patched) => {
    try { hostAssert(patched.messages); } catch { retrySawArray = false; }
    return retryStream();
  },
});
const chunks = [];
for await (const c of gen) chunks.push(c);
const text = chunks.filter((c) => c.type === "text-delta").map((c) => c.text).join("");
ok("3e 重试路径交给宿主的 messages 全部是数组", retrySawArray);
ok("3f 重试拿到的是新回答而不是拒绝原文", text.includes("已生成"), `got=${text.slice(0, 40)}`);

/* ── 4. 修剪补丁的语义（#19） ──────────────────────────────────────────
   rc2.12 把宿主唯一的确定性体积阀门整条关掉了（pruneContent → return null）。
   rc2.13 改成只放大预算，并给老安装留迁移路径。 */
const core = await load("../lib/core.js");
const pruner = core.ALL_PATCHES.find((p) => p.id === 19);
ok("4a #19 存在", Boolean(pruner));

/* 出厂原文：DEFAULTS + pruneContent 开头。 */
const FACTORY = [
  "const DEFAULTS = deepFreeze({",
  "\tthresholdChars: 8192,",
  "\theadChars: 4096,",
  "\ttailChars: 1024",
  "});",
  "",
  "\tpruneContent(blocks) {",
  "\t\tconst totalChars = this.measureContent(blocks);",
  "\t\tif (totalChars <= this.config.thresholdChars) return null;",
].join("\n");

/* rc2.12 装过之后的样子：DEFAULTS 没动，但 pruneContent 被整条关掉了。 */
const LEGACY = [
  "const DEFAULTS = deepFreeze({",
  "\tthresholdChars: 8192,",
  "\theadChars: 4096,",
  "\ttailChars: 1024",
  "});",
  "",
  "\tpruneContent(blocks) {",
  "\t\t// [dsh-purge] tool-result pruning disabled: results pass through unchanged.",
  "\t\treturn null;",
].join("\n");

const patchedFresh = core.applyReplacementsToText(FACTORY, pruner, "lib/index.js");
ok("4b 出厂原文能被 #19 改写成「保留修剪 + 放大预算」",
  patchedFresh.text.includes("pruning kept active")
  && !patchedFresh.text.includes("pruning disabled")
  && patchedFresh.text.includes("thresholdChars: 16384"));
ok("4c 出厂原文的修剪逻辑被保留（没有 return null 短路）",
  patchedFresh.text.includes("if (totalChars <= this.config.thresholdChars) return null;"));

const migrated = core.applyReplacementsToText(LEGACY, pruner, "lib/index.js");
ok("4d 老版本（已被关掉）能被迁移回「保留修剪」",
  migrated.text.includes("pruning restored")
  && migrated.text.includes("const totalChars = this.measureContent(blocks);"));
ok("4e 迁移后重复应用是幂等的",
  !core.applyReplacementsToText(migrated.text, pruner, "lib/index.js").changed);

/* ── 5. read 上限不再一次吞 1MB（#22） ──────────────────────────────── */
const readCaps = core.ALL_PATCHES.find((p) => p.id === 22);
const fsHostCaps = [
  "const READ_MAX_LINE_LENGTH = 2e3;",
  "const READ_MAX_BYTES = 50 * 1024;",
  "const READ_LIMIT = 2e3;",
].join("\n");
const capsPatched = core.applyReplacementsToText(fsHostCaps, readCaps, "lib/index.js");
ok("5a 出厂 read 上限被放宽但不超过 256KB",
  capsPatched.text.includes("READ_MAX_BYTES = 256 * 1024")
  && !capsPatched.text.includes("1024 * 1024"));
const capsLegacy = [
  "const READ_MAX_LINE_LENGTH = 1e4;",
  "const READ_MAX_BYTES = 1024 * 1024;",
  "const READ_LIMIT = 2e4;",
].join("\n");
const capsMigrated = core.applyReplacementsToText(capsLegacy, readCaps, "lib/index.js");
ok("5b rc2.12 的 1MB 上限能被收回",
  capsMigrated.text.includes("READ_MAX_BYTES = 256 * 1024"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
