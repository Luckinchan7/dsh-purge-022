# dsh-purge-022 v1.2.14

**回退能用了。** 之前它点了有菜单、有请求、有成功提示，历史一个字不变。

## 你看到的

点「回退一次」→ 菜单正常弹出 → 点下去 → 提示闪一下 → 输入框里那句没回来，对话也没变。

## 两个叠加的缺陷

### 一、挑错了要撤的那句

`lib/rewind.js` 的 `planRewind` 只在原始事件日志里找「最近一条人类提示」：

```js
let candidates = ordered.filter((row) => isRoundPromptEvent(row.event));
const last = candidates.at(-1);
const fromSeq = bounds.startSeq >= 0 ? bounds.startSeq : last.seq;
```

回退过一次之后，上一轮那句提示**还在日志里**，但已经被更早那条 `rewind-` 空标记从画面上盖掉了。于是它又被选为目标。

`cutSurfaceNodes` 从它的 seq 往后找第一个「还在画面上」的节点 —— 找到的正是那条空标记本身：

```
旧 plan：fromSeq 815 → 只切掉 1 个节点（1335:user/message，content 为空）
```

真正的对话一个节点没动，函数却回报 `cleared: true`。

改法：`planRewind(events, { surfaceNodes })` 用当前画面节点集合过滤候选。`doRewindOneSession` 与 `applyRewind` 的 round 分支都传 `liveSurfaceNodes(ctx, sessionId)`。整轮都被盖掉时不再一律报失败，退到「画面上最后一个可见句子」。

修后同一份日志：

```
新 plan：fromSeq 598 → 切 66 个节点（598:user/message … 809:assistant/message）
```

### 二、清掉的是模型历史，不是屏幕

就算切对了，客户端也不认 `surfaceOp: { op: "replace" }`：

| 位置 | 事实 |
|---|---|
| `dsh-client-ui-chat/lib/client.js` | `messageDefinition.match` 只接 `isAppendSurfaceEvent(event)`，replace 返回 `null` |
| `dsh-client-ui-conversation/lib/client.js` | `ConversationNodeAssembler` 里 `shadowed` 出现 **0 次**；只有 `inspectSystemPrompt` 处理 replace 范围 |

所以原地打标记的结果是：**模型看不见那几轮了，界面上一条不少**。

改法：优先走宿主的 `sessionController.fork({ sessionId, atSeq })`，在边界处切出一个真截断的子会话。这是两端都实现了的路径（`buildForkSeed` → `Session` 重建），父会话原样保留。

边界尽量停在 `turn/end` 上，避免子会话带着半个 `tool/call` 起步。宿主没有 `fork` 时退回原地折叠，至少清掉模型历史。

真机日志实测（`session-fbf9232f`，1336 事件 / 174 个可见节点）：

```
fork 边界 seq 593（turn/end）
父 derived 172    子 derived 107
```

## 行为变化

| 之前 | 现在 |
|---|---|
| 原地打 replace 标记 | 从上一轮结束处 fork 一个子会话 |
| 界面毫无变化 | 界面切到子会话，历史真的短了 |
| 原会话被改成「有标记」状态 | 原会话一行不动，随时能切回去 |

菜单文案也改成了「从上一轮结束处开一个新会话（原来那条留着）」。

## 安装

```bash
dsh plugin install ./dsh-purge-022-1.2.14.tgz
```

或把 tgz 放到 `~/.dsh/profiles/desktop/.local-packages/`，在 profile 的 `package.json` 里指向 `file:./.local-packages/dsh-purge-022-1.2.14.tgz`。

**同版本号但 tarball 变过时**，`pnpm install --offline` 不会换文件，要先：

```bash
rm -rf node_modules/dsh-purge-022
pnpm install --offline --force
```

## 自检

10 组 **843 项 0 失败**：migration-yaml 8 / migration 21 / rc120 22 / rc213 26 / rc214 6 / rc2142 9 / rc215 64 / rc216 64 / rc217 586 / **rc218 23（新增）**。

`verify-rc218` 抓的就是这两个缺陷：老逻辑必须复现「只切一条标记」、新逻辑必须真的切掉对话、fork 边界必须是 `turn/end`、父会话必须一行不动、无 `fork` 时兜底仍然生效。

## 回滚

```bash
dsh plugin install ./dsh-purge-022-1.2.13.tgz
```

回退功能会回到「点了没反应」的状态，其余功能不受影响。
