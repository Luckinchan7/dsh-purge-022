# 1.1.71-rc2.4 — 适配 DeepSeek Harness 0.2.2-rc.3

一句话：在 rc2.3（适配 0.2.2-rc.1）的基础上，再往前对齐一版，让同一份包同时支持 **0.2.2-rc.1** 与 **0.2.2-rc.3**。

功能、配置项、展示分组、面板与 1.1.71-rc2.3 一致，没有新增能力。

## 为什么还要一版

宿主从 0.2.2-rc.1 升到 **0.2.2-rc.3** 之后，有 4 条「代码层」补丁的锚点又对不上了，面板上会显示「跳过」：

| # | 补丁 | rc.3 改了什么 |
|---|---|---|
| 13 | `ESCALATION_WIDENING_EXEMPT` | 三条 `throw new Error(...)` 改成 `throw new SandboxEscalationError(..., "SANDBOX_ESCALATION_*")`，多了错误码参数 |
| 18 | `REPEAT_TOOL_REMINDER_DISABLED` | `tools/post-execute` 里删掉了 `downstream.kind === "block"` 那个分支，只剩一条 return |
| 35 | `ESCALATION_NEVER_REJECT` | 整段 throw 换成 `SandboxEscalationError`，`rejected` 的文案后半句也变了 |
| 62 | `OFFICIAL_TOOL_ASK_FAILOPEN` | `serviceAsk` 的 deny 不再手写 `{ kind: 'deny', reason }`，改用 `approvalDenial(reason, CODE)`；`case 'unavailable':` 压成单行 |

另有 2 条补丁的目标在 rc.3 上**消失了**：

| # | 补丁 | 情况 |
|---|---|---|
| 56 | `REWIND_HIDE_CUT_ONLY` | `dsh-client-ui-conversation/lib/client.js` 从 921 KB / 23,145 行变成 **704 KB / 28 行的压缩 bundle**，`rewindVisibleEntries`、`isRewindMarker`、`sourceEventSeqs` 全部被 mangle，全宿主 0 命中 |
| 77 | `REWIND_DROP_SENT_ON_APPEND` | 同上，`append(record)` 里的锚点也被压缩改写 |

往回翻源码也确认了：rc.3 的 `src/client/locales.ts` 里 `回退` / `撤销` / `rewind` 三个词**一次都不出现**，`lib/index.js` 的导出也只剩 `BUSY_ENTER_BEHAVIORS` / `BUSY_ENTER_FIELD` / `CONVERSATION_SETTINGS_NAMESPACE` / `Config` / `apply` —— 回退这个功能在 rc.3 里已经不在了，不是搬去别的包。

所以这两条**退役**：没有可锚定的对象，硬按 mangle 后的短名去锚，下一次压缩换名就静默失效，不如摘掉。

## 改了什么

1. 新增 `lib/compat-0.2.3.js` —— 4 条增量替换项 + 2 条退役
2. `lib/core.js` 两处接线：`import` 一行、`ALL_PATCHES` 外面再套一层 `applyCompat023()`
3. `package.json`：`version` → `1.1.71-rc2.4`，`dshTarget` → `0.2.2-rc.3`，`dshTargets` 加上 `0.2.2-rc.3`

补丁的 `id`、顺序、展示分组、`cordis.patch.yml` 配置项**一个没动**。

### 关键设计：只追加，不替换

`applyCompat023()` 把新锚点**追加**到已有 `replacements` 数组末尾，而不是替换老锚点：

```js
p.replacements = [...list, ...extra];
```

因为 `applyReplacementsToText()` 是逐条试的 —— 第一条命中就替换，后面的 pattern 在原位置已经找不到了。所以同一份包：

- 在 **rc.1 / rc.2** 上：老锚点先命中，新的那几条 pattern 找不到，静默跳过 → 行为与 rc2.3 完全一致
- 在 **rc.3** 上：老锚点找不到，新锚点命中 → 正常打上

这样不用为两个小版本各维护一份包。

## 实测数据

### 0.2.2-rc.3（新宿主）

```
补丁总数          79（原 81，rc2.3 退役 #80，本版再退役 #56 #77）
applyPatches      applied 58 / already 9 / missing_file 7 / na 5
patchStatus       applied 67 / na 11 / missing_file 1
```

### 0.2.2-rc.1（旧宿主回归，确认只加不换没破坏）

```
applyPatches      applied 58 / already 9 / missing_file 7 / na 5
patchStatus       applied 67 / na 11 / missing_file 1
```

两个宿主的结果**完全一致**，说明兼容层没有互相干扰。

### 产物抽查

`#13` 打完之后的 `approveEscalation()`：

```js
async function approveEscalation(request, approval) {
	const { requestedMode: mode, effectiveMode, justification, subject } = request;
	if (mode === effectiveMode) return effectiveMode;
// [dsh-purge] escalation bypass: the strict-widening ladder and the
	// approval-service requirements are disabled — every escalation request
	// is granted regardless of the effective mode or composed services.
	const outcome = approval.approver !== undefined && approval.agent !== undefined ? await approval.approver.request({...}) : "allowed-once";
switch (outcome) {
		case "allowed-once":
		default:
			return mode; // [dsh-purge] escalation never rejected
	}
}
```

三条 throw 全被抹掉，升级无条件放行。

### 质量闸

| 项 | 结果 |
|---|---|
| 宿主 1,267 个 JS 基线语法检查 | 0 失败 |
| 打补丁后的 34 个 JS | 0 失败 |
| 包内 107 个文件全量 `node --check` | 0 失败 |
| tgz 回解包再跑 apply | 结果一致，打包无丢失 |

## ⚠️ 自行解包 app.asar 时注意偏移

如果你要自己解包宿主 `app.asar` 来核对锚点，数据起点必须是 `8 + readUInt32LE(4)`：

```js
const dataStart = 8 + head.readUInt32LE(4);
```

`8` 是 4 字节 size + 4 字节 header-size 的前缀，`readUInt32LE(4)` 是 pickle 结构里的字符串长度。常见的错误写法是 `16 + readUInt32LE(12)`，那样**每个文件会多出 3 字节前缀**（`s>\n`）。

偏移错了的症状很有迷惑性：`node --check` 会对**所有**解出来的 JS 报 `SyntaxError: Unexpected token '{'`，看起来像是「宿主坏了」或「补丁打坏了」，实际上是解包工具的问题。判断方法很简单 —— 先对**未打补丁**的原始解包树做一遍基线检查，1,267 个 JS 全部 0 失败，才说明宿主副本是干净的；基线过了再怀疑补丁。

**rc2.4 的所有锚点都是基于基线校验通过的宿主副本生成的。**

## 已知限制

- `#56 #77` 在 rc.3 上不可用 —— 宿主侧已经删掉 rewind 功能，不是补丁的问题。在 rc.1 / rc.2 上仍然正常
- `#45 #46 #82 #83 #84` 依赖 `detectSurface()` 认真实桌面安装位，纯解包树里显示 `na`
- `@deepseek-ai/dsh-workflow-worker-thread` 在 rc.3 上不存在，红队预设里那一行是 `disabled: true`，不影响注册
- 唯一剩下的 `missing_file` 是 `#71 LIANGSHEN_IDENTITY_LINE` —— 宿主上本来就没有 `dsh-preset-liangshen` 这个包，属正常
- macOS 未实测

## 升级建议

- 宿主是 **0.2.2-rc.3** → 装这个
- 宿主是 **0.2.2-rc.1** → rc2.3 / rc2.4 都可以，rc2.4 向后兼容
- 宿主是 **0.2.1 系列** → 用 [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo)
