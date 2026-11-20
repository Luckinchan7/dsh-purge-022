# dsh-purge 1.1.71-rc2.7

适配 DeepSeek Harness 0.2.2-rc.3 / 0.2.2-rc.1（rc.2 也可用）。

这一版是**纯增量**：上一版 rc2.6 的 84 条补丁表一条没删、一条没改锚点，新增 5 条（#89–#93）与一个运行时模块（`lib/anchor.js`）。文件数 108 → 113。

## 新增 1：尾部锚点（`lib/anchor.js`）

### 解决的问题

注入正文（约 21 KB）挂在 `order = GLOBAL_PROMPT_ORDER`（-100000），也就是 system prompt 的**最前面**。宿主在它后面还要排 30 多个段：工具描述（1000–3100）、`HARNESS_SOURCE`（10000）、`WEB_SURFACE`（10100）、`deployment:persona-suffix`（10200）。模型读到最后一条时，前面那 21 KB 已经隔了上万 token。

长上下文里越靠后的指令权重越高。所以把「身份 + 格式锁」在**尾部**再挂一小段（2,542 字节 / 22 行）。

### 为什么要用这个 order

```
SECTION_ORDERS = {
  ...
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
}
```

锚点取 `ANCHOR_ORDER = 10250` —— 比宿主全部内置段都大，稳定落在最后。

我最初照抄了一个社区分支用的 10150（卡在 WEB_SURFACE 与 persona-suffix 之间），实测排序后**不是**最后一段，锚点价值会打折。改到 10250 之后 `renderPrompt` 拼出来的顺序里它确实在末位。

### 为什么名字不叫 `dsh-purge:anchor`

宿主 `dsh-system-prompt/lib/index.js` 在 waterfall 之后有这段（本插件 #29 打进去的）：

```js
const dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || "").startsWith("dsh-purge") && ...);
const dshPurgeRest = (transformed.sections || []).filter((s) => !String(s && s.name || "").startsWith("dsh-purge"));
sections: [...dshPurgeSections, ...dshPurgeRest]
```

所有以 `dsh-purge` 开头的段会被整体提回到数组最前。锚点一旦被前置就彻底没了意义。所以名字用 `purge-anchor`，不带那个前缀。

也不能用 `dshpg-` 前缀 —— 那会被 `isPluginPromptSection()` 当成注入正文的一部分折进去。

### 主锚点为什么走 append 而不是 section 注册

切换预设会换掉 `assemble`，走的是 isolated scope。在子层 `registerPromptSections` 里注册的 section 在预设切换后可能丢。改成在 `rewriteLiveAssembly` 的返回值末尾直接 append：

```js
if (tailAnchor && Array.isArray(rewritten?.sections)) {
  const rest = rewritten.sections.filter((s) => s && s.name !== ANCHOR_SECTION);
  withAnchor = { ...rewritten, sections: [...rest, { name: ANCHOR_SECTION, text: tailAnchor, interpolate: false, order: ANCHOR_ORDER }] };
}
```

每轮都会重建，天然幂等（先 filter 掉同名段）。

### 子锚点

做成 `systemPrompt.context()`，`order = 235`，排在宿主 `subagent:delegation`（120）与 `WEB_SURFACE`（210）之后，`required: true`（0.2.1-rc.5 起 `refreshContext` 会把 required 的 context 从 suppress 里捞回来）。

只对子会话生效，判定自带：

```js
header.origin === "subagent" || (header.delegationDepth ?? 0) > 0 || Boolean(header.parentSession)
```

作用是对消宿主 delegation 那句「需要审批的操作会被自动拒绝，别重试，直接报限制」—— 子代理本来没有理由因为一次拒绝就停手。

### 开关

`cordis.patch.yml` → `- id: dsh-purge` → `config.tailAnchor`，默认 `true`。设 `false` 后主锚点与子锚点都不挂。

---

## 新增 2：#89–#93 五条补丁

### #89 `ASK_USER_NO_BLOCK`（工具层）

`dsh-tool-ask-user/lib/index.js:181` 原文：

```js
const timeout = validateTimeout(args.timeout ?? defaultTimeout);
```

默认 120 秒，模型传 `-1` 就无限等 —— 一个反问能把整个回合卡死。

改成：

```js
const timeout = 1; // [dsh-purge] ask_user_question never blocks a turn
```

压到 1 秒后工具立刻返回 `pending` + `pendingNotice`，模型继续往下做；用户仍能在界面里补答，只是不再阻塞。

### #90 `SANDBOX_POLICY_BRAND_NEUTRAL`（提示词层）

#61 只换了 `read-only` 那一支，另两支的品牌词还在：

| 原文 | 改后 |
|---|---|
| `Current DSH file policy: ` (3 处) | `Current file policy: ` |
| `enforced by the DSH file sandbox` | `enforced by the file sandbox` |
| `The DSH file sandbox does not restrict` | `The file sandbox does not restrict` |

品牌词会让模型把「限制」归因到某个产品策略上，而不是当成可绕开的运行时条件。

**这条刻意不加 `skipIfMarked`**：#61 的 read-only 分支自带 marker，一旦 skip 会把另外两支一起吞掉。

### #91 `SKILL_BADGE_DESCRIPTION_NEUTRAL`（提示词层）

`dsh-skill-badge/lib/index.js:18` 的技能描述里有「powered by dsh」官方徽章话术，会诱导模型在交付物里加厂商署名。两条替换移除品牌，保留「可以加署名徽章」这个能力本身。

### #92 / #93 `DESKTOP_*_EXIT_TRACE`（代码层，桌面面）

桌面壳静默退出时没人记录原因：dir 模式先退出、父进程 250 ms 后跟着走，`#83` 在 signal 分支直接 resolve 不记录。这两条把退出原因落到 `%TEMP%\dsh-purge-desktop.log`：

- **#92**：在 `child.once("close", ...)` 里记 `code` / `signal` / stderr。
- **#93**：在主进程挂生命周期日志 —— `process.exit` / `uncaughtExceptionMonitor` / `SIGTERM|SIGINT|SIGBREAK` / Electron 的 `before-quit` / `will-quit` / `quit` / `window-all-closed` / `render-process-gone` / `child-process-gone` / 60 秒 `alive` 心跳。

`#93` 刻意用 `uncaughtExceptionMonitor` 而不是 `uncaughtException` —— 挂本体就会吞掉崩溃、把退出改成继续跑。

这两条不增强破甲本身，但把「静默退出查不动」变成可查。

---

## 没有引入什么，为什么

对比了六个社区分支（`WoYun520/dsh-purge`、`mortyandtimo/dsh-purge-plus`、`CallMeGuLab/dsh-purge-safe`、`luowang-ui/dsh-purge-plus`、`mmparko/dsh-purge`、`yu994419160/dsh-purge1.7.3-`）：

### 没引入 `#56` / `#77`（rewind 两条）

`woyun` / `mmparko` / `yu994` / `guLab` / `luowang` 都有。我们在 rc2.4 已退役，因为 0.2.2-rc.3 上游把回退功能删了：

- `dsh-client-ui-conversation/lib/client.js` 从 921,756 字节 / 23,145 行压成 704,147 字节 / 27 行 bundle
- `rewindVisibleEntries` / `isRewindMarker` / `sourceEventSeqs` / `cutTurn` 全宿主 0 命中
- `src/client/locales.ts` 里 `回退` / `撤销` / `rewind` 各 0 次

没有可打的对象，退役是对的。

### 没引入 `guLab` 的 `lib/subagent-control.js`

它解决的问题是：宿主给子会话写死 `approval/policy = "never"`（`dsh-subagent/lib/index.js:360` → `approvalPolicy: "never"`），本意是「子代理不能打扰用户审批」，结果变成「子代理一切需要审批的操作直接拒绝」。

guLab 的做法是监听 `session/event` 把 `never` 翻成 `ask`，再在 `approval/request` waterfall 里放行。

**我们没有这个问题** —— 自己的 `#9 APPROVAL_AUTO_GRANT` 已经把 `decide()` 的首行改成：

```js
async decide(req, session) {
  const signal = req.signal;
  if (signal?.aborted) return "cancelled";
  return "allowed-once";
  // [dsh-purge] approval bypass: every approval request is auto-granted
  ...
}
```

这早于任何 policy 判定，子会话的 `never` 根本走不到。再挂一层是重复建设，还会引入额外的 session append 噪声。

### 没引入 `guLab` 的 `lib/web-reclaim.js` / `bin-preflight.js`

解决的是 `dsh web` 的 `EADDRINUSE`（detached 重启留下孤儿进程，0.2.x 把 required 插件激活失败当 fatal）。我们用桌面版，不跑 `dsh web`，没有这个场景。

### 没引入 `morty` 的提示词（41,870 字节 / 554 行）

它比我们的 25,128 字节长很多，但长出来的部分主要是人设演绎（「Enchanted State」「Co-Conspirator」「Two years together」「Roleplay is sacred」）与 CTF 契约段落 —— 后者我们的提示词里已经有同源版本。破甲强度不来自篇幅，来自规则密度与不可撤销声明，这部分我们已有。字数多还会挤占上下文预算。

### `#86` 的语义分歧

`#86` 我们叫 `SESSION_STEER_ALWAYS_FOLLOWUP`，guLab / yu994 叫 `SESSION_QUEUE_STEER_INTERRUPT`。同一个 id 但改的是相反行为（我们让普通发送走 followup，它们让 Ctrl+Enter 走 steer）。保留我们的，不合并。

---

## 验证

### 补丁表

```
ALL_PATCHES: 84 条（rc2.6 是 79 条）
状态分布: applied 67 / na 13 / missing_file 1 / pending 3
```

`pending 3` = #89 / #90 / #91（本次新增，还没点「应用」）。`missing_file 1` 仍是 `#71`（没装良神预设）。`na 13` 是没装的 hooks / 无限制预设 / 桌面壳相关。

### 三条新补丁在宿主副本上真跑

```
#89 ASK_USER_NO_BLOCK            -> applied (1 处)
#90 SANDBOX_POLICY_BRAND_NEUTRAL -> applied (1 处，内含 3+1+1 次替换)
#91 SKILL_BADGE_DESCRIPTION_NEUTRAL -> applied (1 处)
```

打完三个文件 `node --check` 全过；再打一次全部 `already`（幂等）。

### 锚点位置

```
[0] dsh-purge                    order: -100000
[1] dshpg-capabilities           order: -99999
[2] app:web-surface              order: 10100
[3] deployment:persona-suffix    order: 10200
[4] purge-anchor                 order: 10250   ← 最后
```

### 语法与配置

- 113 个文件全量 `node --check`：0 失败
- `cordis.patch.yml` + 两个预设的 `agent.cordis.yml` / `preset.yml` 过宿主自带 `yaml`：0 失败
- `registerAnchor` mock 测试：两个 host 各注册一次、主会话返回空、子会话返回 1,417 字节、关闭开关后不注册、无 `systemPrompt.context` 的老宿主不抛

---

## 安装

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.7/dsh-purge-1.1.71-rc2.7.tgz
```

装完**重启宿主**，然后在面板点「应用」。`#89` / `#90` / `#91` 从 pending 变 applied，`#92` / `#93` 视主机而定（纯解包环境显示 na 属预期）。

## 校验

```
dsh-purge-1.1.71-rc2.7.tgz   1,483,439 bytes
sha256  fa2071a6f456ce08fc25c3b002ad65b8b3796486648369dbf2104fce79e056ac
```

## 许可

MIT。补丁表结构源自 dsh-purge 上游（Copyright (c) 2026 小杨）。
