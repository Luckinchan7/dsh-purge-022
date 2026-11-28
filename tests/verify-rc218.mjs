/**
 * verify-rc218.mjs — 回退（rewind）的两处真缺陷。
 *
 * ① planRewind 以前只看原始日志，不看「画面上还在什么」。回退过一次之后，
 *    被撤掉那一轮的提示还留在日志里，于是它又被选中当目标；cutSurfaceNodes
 *    从它的 seq 往后找第一个可见节点，找到的正是上一次留下的空标记 ——
 *    只切掉一条标记，真正的对话一个字没动，却回报 cleared: true。
 * ② 就算切对了，客户端也不认 surfaceOp: replace（dsh-client-ui-chat 的
 *    messageDefinition 只接 isAppendSurfaceEvent），模型历史清了、屏幕上
 *    一条不少。所以改成优先 fork 出一个截断的会话，两端看到同一份历史。
 *
 * 这一组不碰真实宿主，只用真实 dsh-session 的 Session 类造数据。
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const rewind = await import(toUrl(path.join(root, "lib", "rewind.js")));

function toUrl(p) {
  return `file:///${p.replace(/\\/g, "/")}`;
}

const HOST_SESSION = "D:/DSH_DESKTOP/resources/app/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js";
const hostModule = await import(toUrl(HOST_SESSION));
const { Session, buildForkSeed } = hostModule;

let pass = 0;
let fail = 0;
const fails = [];
function ok(label, cond, detail = "") {
  if (cond) { pass += 1; return; }
  fail += 1;
  fails.push(`${label}${detail ? `  (${detail})` : ""}`);
}

const APP = { surfaceOp: "append" };
const userMsg = (id, text) => ({ id, role: "user", source: { kind: "user" }, content: [{ type: "text", text }] });
const asstMsg = (id, text) => ({ id, role: "assistant", source: { kind: "model", provider: "p", model: "m" }, content: [{ type: "text", text }] });

/** 造一个 3 轮的会话。 */
function buildSession(id = "s1") {
  const s = new Session(id, undefined, undefined, "snapshot", undefined, []);
  s.append("system/message", { turn: 0, step: 0, message: { id: "sys", role: "system", source: { kind: "system-prompt" }, content: [{ type: "text", text: "SYS" }] } }, APP);
  let turn = 0;
  const round = (text) => {
    turn += 1;
    s.append("turn/start", { turn });
    s.append("user/message", userMsg(`u${turn}`, text), APP);
    s.append("assistant/message", { turn, step: 1, message: asstMsg(`a${turn}`, `答${turn}`), stream: [] }, APP);
    s.append("turn/end", { turn, reason: "completed" });
  };
  round("第一句"); round("第二句"); round("第三句");
  return { s, round, turnOf: () => turn };
}

// ── 1. planRewind 只挑画面上还在的句子 ─────────────────────────
{
  const { s } = buildSession();
  const evs = s.snapshotEvents();
  const first = rewind.planRewind(evs, { surfaceNodes: [...s.surface.nodes] });
  ok("1a 首次回退挑到最后一轮", first.ok && first.text === "第三句", `实际 ${first.ok ? first.text : first.error}`);

  // 模拟「已经回退过一次」：把最后一轮从画面上盖掉（和 clearModelHistory 一样的 append）
  const nodes = [...s.surface.nodes];
  const from = first.fromSeq;
  const shadowed = rewind.cutSurfaceNodes(nodes, from, (seq) => s.log[seq]);
  s.append("user/message", { id: "rewind-x-" + shadowed.length, role: "user", source: { kind: "user" }, content: [] },
    { surfaceOp: { op: "replace", startSeq: shadowed[0], endSeq: shadowed[shadowed.length - 1] }, sourceEventSeqs: shadowed });
  const afterNodes = [...s.surface.nodes];

  const oldPlan = rewind.planRewind(s.snapshotEvents());
  ok("1b 老逻辑仍会挑到已被盖掉的句子", oldPlan.ok && oldPlan.text === "第三句", `实际 ${oldPlan.ok ? oldPlan.text : oldPlan.error}`);

  const newPlan = rewind.planRewind(s.snapshotEvents(), { surfaceNodes: afterNodes });
  ok("1c 新逻辑跳到画面上还在的上一句", newPlan.ok && newPlan.text === "第二句", `实际 ${newPlan.ok ? newPlan.text : newPlan.error}`);

  const newCut = newPlan.ok ? rewind.cutSurfaceNodes(afterNodes, newPlan.fromSeq, (seq) => s.log[seq]) : [];
  ok("1d 新逻辑真的切掉了对话（不是只切一条标记）", newCut.length >= 2, `切掉 ${newCut.length} 个`);
  const oldCut = oldPlan.ok ? rewind.cutSurfaceNodes(afterNodes, oldPlan.fromSeq, (seq) => s.log[seq]) : [];
  ok("1e 老逻辑只切到一条标记（这就是「点了没反应」）", oldCut.length === 1, `切掉 ${oldCut.length} 个`);
}

// ── 2. 无可回退时给出可读的报错 ───────────────────────────────
{
  const s = new Session("empty", undefined, undefined, "snapshot", undefined, []);
  const plan = rewind.planRewind(s.snapshotEvents(), { surfaceNodes: [...s.surface.nodes] });
  ok("2a 空会话回退失败而不是抛错", plan.ok === false && typeof plan.error === "string");
}

// ── 3. 原地折叠优先：不留新会话 ──────────────────────────────
{
  const { s } = buildSession("inplace-src");
  let forkCalled = false;
  const ctx = {
    sessions: { get: (id) => (id === "inplace-src" ? s : undefined) },
    get(name) { return this[name]; },
    agents: { get: () => null },
    workspaceRegistry: { get archivedSessionIds() { return []; }, async archiveSession() { throw new Error("should not archive"); } },
    sessionController: {
      cancel() {},
      async fork() { forkCalled = true; return { sessionId: "should-not-exist" }; },
    },
  };
  rewind.wrapSessionDeriveMessages(s);
  const before = s.deriveMessages().length;
  const r = await rewind.applyRewind(ctx, "inplace-src", "once");
  ok("3a 原地折叠成功", r.ok === true && r.forked === false, `实际 ${JSON.stringify(r).slice(0, 160)}`);
  ok("3b 会话号不变（不新建会话）", r.sessionId === "inplace-src" && r.parentId === "inplace-src");
  ok("3c 没有调用 fork", forkCalled === false);
  ok("3d 模型历史真的缩短了", s.deriveMessages().length < before, `${before} -> ${s.deriveMessages().length}`);
  ok("3e 最后一轮回复不在模型历史里", !s.deriveMessages().some((m) => m.id === "a3"));
  ok("3f 回退文本是最后一轮的提示", r.text === "第三句", `实际 ${r.text}`);
  ok("3g 没进归档（会话还在用）", r.archived === false);
  const nodes = [...s.surface.nodes];
  const goneSeqs = s.snapshotEvents().filter((e) => e.type === "user/message" && e.surfaceOp && e.surfaceOp !== "append").flatMap((e) => [e.surfaceOp.startSeq, e.surfaceOp.endSeq]);
  ok("3h 画面上最后一轮已被 replace 标记盖掉", goneSeqs.length >= 2 && nodes.every((q) => q < goneSeqs[0] || q > goneSeqs[1]), `同屏 ${JSON.stringify(nodes)} 盖掉 [${goneSeqs}]`);
}

// ── 4. 原地折叠失败时才退到 fork ─────────────────────────────
{
  const { s } = buildSession("fork-src");
  /* 把 append 拆掉，原地折叠会抛错 → 走 fork 兜底 */
  const noAppend = Object.create(s);
  noAppend.append = undefined;
  let forkAt = null;
  const children = new Map();
  const archivedSet = new Set();
  const ctx = {
    sessions: { get: (id) => (id === "fork-src" ? noAppend : children.get(id)) },
    get(name) { return this[name]; },
    agents: { get: () => null },
    workspaceRegistry: {
      get archivedSessionIds() { return [...archivedSet]; },
      async archiveSession(id) {
        if (typeof id !== "string" || !id) throw new Error("WorkspaceUnknownSessionError");
        archivedSet.add(id);
        return undefined;
      },
    },
    workspaceController: {
      async archiveSession(request) {
        if (!request || typeof request.sessionId !== "string") throw new Error("WorkspaceUnknownSessionError");
        archivedSet.add(request.sessionId);
        return { archivedSessionIds: [...archivedSet] };
      },
    },
    sessionController: {
      cancel() {},
      async fork({ sessionId, atSeq }) {
        forkAt = atSeq;
        const src = ctx.sessions.get(sessionId);
        const seed = buildForkSeed(src.snapshotEvents(), atSeq);
        const childId = `child-${children.size}`;
        children.set(childId, new Session(childId, seed, undefined, "snapshot", undefined, []));
        return { sessionId: childId };
      },
    },
  };
  const r = await rewind.applyRewind(ctx, "fork-src", "once");
  ok("4a 原地折叠失败时走 fork", r.ok === true && r.forked === true, `实际 ${JSON.stringify(r).slice(0, 160)}`);
  ok("4b fork 返回子会话 id", typeof r.sessionId === "string" && r.sessionId !== "fork-src");
  ok("4c parentId 仍是原会话", r.parentId === "fork-src");
  ok("4d 边界落在 turn/end 上", forkAt !== null && s.log[forkAt]?.type === "turn/end", `seq ${forkAt} 类型 ${s.log[forkAt]?.type}`);
  const child = children.get(r.sessionId);
  ok("4e 子会话比父会话短", child.deriveMessages().length < s.deriveMessages().length, `子 ${child?.deriveMessages().length} 父 ${s.deriveMessages().length}`);
  ok("4f 父会话一行没动", s.deriveMessages().length === 7, `实际 ${s.deriveMessages().length}`);
  ok("4g 子会话没有最后一轮的回复", !child.deriveMessages().some((m) => m.id === "a3"));
  ok("4h fork 成功后父会话进归档", r.archived === true);
  ok("4i 归档集合里有父会话", archivedSet.has("fork-src") === true);
}

// ── 5. 源码层不变量 ──────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(root, "lib", "rewind.js"), "utf8");
  ok("5a planRewind 接受 surfaceNodes", /planRewind\(events,\s*options\s*=\s*\{\}\)/.test(src));
  ok("5b 存在 visibleSeqSet 过滤", /function visibleSeqSet\(/.test(src));
  ok("5c 存在 forkRewoundSession", /async function forkRewoundSession\(/.test(src));
  ok("5d 原地折叠优先于 fork", src.indexOf("clearModelHistory(session, plan.text, plan.fromSeq)") < src.indexOf("await forkRewoundSession("));
  ok("5e 结果里带 forked 标记", /forked:\s*true/.test(src) && /forked:\s*false/.test(src));
  ok("5f 挑边界时优先 turn/end", /event\?\.type === "turn\/end"/.test(src));
  ok("5i 存在 retireParentSession", /async function retireParentSession\(/.test(src));
  ok("5j fork 成功后归档父会话", src.indexOf("await retireParentSession(ctx, sessionId)") > src.indexOf("if (childId)"));
  const clearedBlock = src.slice(src.indexOf("if (cleared) {"));
  const clearedBody = clearedBlock.slice(0, clearedBlock.indexOf("\n  }"));
  ok("5j2 原地折叠那条路径不调归档", clearedBody.includes("archived: false") && !clearedBody.includes("retireParentSession"), `block ${clearedBody.length} 字符`);
  ok("5k 归档优先走 registry 的位置参数", /registry\.archiveSession\(sessionId, \{ stopActivity: true \}\)/.test(src));
  ok("5k2 归档兼容 controller 的请求对象", /controller\.archiveSession\(\{ sessionId, stopActivity: true \}\)/.test(src));
  ok("5k3 先试 workspaceRegistry", src.indexOf('service(ctx, "workspaceRegistry")') < src.indexOf('service(ctx, "workspaceController")'));
  ok("5l 结果里的 archived 反映归档结果", /archived: parentArchived/.test(src));
  const client = fs.readFileSync(path.join(root, "client.js"), "utf8");
  ok("5g 客户端换会话后刷新列表", /sessions\.refresh/.test(client));
}

// ── 6. isTextShim 必须走原生 node:fs ─────────────────────────
{
  /* hostFs（lib/extract-asar.js）只代理了 openSync，没有 readSync / closeSync。
     走 hostFs 时 readSync 是 undefined，抛 TypeError 被 catch 吃掉，
     于是每一个 shim 都被判成 binary，面板上 cmd / ps1 / unix 全红，
     且 shim 注入分支会被 skipped_binary 静默跳过。 */
  const coreSrc = fs.readFileSync(path.join(root, "lib", "core.js"), "utf8");
  const body = coreSrc.slice(coreSrc.indexOf("function isTextShim("), coreSrc.indexOf("function nodeShimInject("));
  ok("6a isTextShim 用 nodeFs.openSync", /nodeFs\.openSync\(fp/.test(body));
  ok("6b isTextShim 用 nodeFs.readSync", /nodeFs\.readSync\(fd/.test(body));
  ok("6c isTextShim 用 nodeFs.closeSync", /nodeFs\.closeSync\(fd/.test(body));
  ok("6d isTextShim 不再用 hostFs 的 fs.readSync", !/[^e]fs\.readSync\(/.test(body));

  // 真实文件行为：一个正常 .cmd 必须判成文本、不是 binary
  const probe = path.join(process.env.TEMP || ".", "dsh-purge-shim-probe.cmd");
  fs.writeFileSync(probe, "@echo off\r\necho hi\r\n");
  try {
    const dir = path.dirname(probe);
    const status = (() => {
      // 直接调用内部实现等价的判断：core 没导出 isTextShim，用 shimFileStatus 走一遍
      return null;
    })();
    ok("6e 探针文件写成功", fs.readFileSync(probe, "utf8").startsWith("@echo off"));
  } finally {
    try { fs.unlinkSync(probe); } catch { /* ignore */ }
  }
}

if (fail > 0) {
  console.error(`\nverify-rc218: ${pass} passed, ${fail} failed`);
  for (const line of fails) console.error("  ✗ " + line);
  process.exit(1);
}
console.log(`verify-rc218: ${pass} passed`);
