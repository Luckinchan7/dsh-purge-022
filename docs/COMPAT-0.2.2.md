# 0.2.2-rc.1 适配说明

面向想弄清「这版到底改了什么、为什么改」的读者。只关心安装的话看 [README](../README.md)。

## 这是什么

`dsh-purge 1.1.71` 的一个小改分支，只做一件事：把补丁表对齐到 **DeepSeek Harness 0.2.2-rc.1**。

功能、配置项、展示分组、面板、配置项键名都与 `1.1.71-rc2.1` 一致。

## 基线

| 项 | 值 |
|---|---|
| 基线包 | `dsh-purge-1.1.71-rc2.1.tgz`（[evan545295555-hash/Evans-repo](https://github.com/evan545295555-hash/Evans-repo)，sha256 `0fbcc2e05099a110f6e6e8b9d1554e266e5eae3c90ea861101611444570a44f7`）|
| 锚点来源 | [dsh-purge 1.3.9](https://github.com/555bbbAAA/dsh-purge)（MIT，维护者 555bbbAAA）|
| 目标宿主 | DeepSeek Harness **0.2.2-rc.1** |
| 补丁总数 | 81（原 82，退役 1 条）|

## 为什么 0.2.2-rc.1 需要单独适配

宿主从 0.2.1-rc.2 升到 0.2.2-rc.1 时，上游做了四类改动，原锚点一条都撞不上。

### 一、拆包

| 东西 | 0.2.1 在哪 | 0.2.2 在哪 |
|---|---|---|
| PTC 执行器 | `dsh-tools` | `dsh-tool-executor-ptc` |
| 交付物提示词 | `dsh-web-app` / `dsh-tools` | `dsh-deliverable-file-references` |
| `serviceAsk` / `ApprovalOutcome` | `dsh-tools/lib/types/index.js` | `dsh-tools/lib/types/pipeline.js` |
| web surface 提示词 | `dsh-web-app/lib/index.js` | `dsh-harness-dev-context/lib/index.js` |

### 二、改缩进

`#67 AGENT_LOOP_MESSAGES_GUARD` —— 上游给那段包了一层 `try`，4 tab → 5 tab。

### 三、抽函数

| 补丁 | 变化 |
|---|---|
| `#14` | `displayReason` 的内联对象抽成 `escalationDisplayReason(mode, justification)` |
| `#82` | `main.js` 的锚点被 `//#region ../../node_modules/.pnpm/mime@4.1.1/…` 顶开 |

### 四、改句子

| 补丁 | 0.2.1 原文 | 0.2.2 原文 |
|---|---|---|
| `#12` | `Approvals are enabled in this session: …` | `Approval prompts are enabled in this session: operations that require approval may ask…` |

### 实测后果

1.1.71-rc2.1 在 0.2.2-rc.1 上跑 `patchStatus()`：

```json
{"missing_file": 14, "applied": 5, "pending": 39, "na": 12, "skipped": 12}
```

**12 条 skipped**（锚点全死）：`14` `80` `32` `40` `53` `54` `74` `67` `77` `60` `62` `88`。

## 改了什么

1. 新增 `lib/compat-0.2.2.js` —— 19 条覆盖表 + 4 个 0.2.2 专用 `targetFiles` 键 + 退役清单
2. `lib/core.js` 只动三处：`import` 一行、`ALL_PATCHES` 外包 `applyCompat()`、`targetFiles()` 尾部并入 `compatTargetKeys()`
3. `lib/redteam/index.js` 新增两个自愈函数并接进 `installPreset()`
4. `presets/redteam/agent.cordis.yml` 删掉 3 行死行
5. `package.json`：`version` → `1.1.71-rc2.3`，`dshTarget` → `0.2.2-rc.1`

补丁的 `id`、顺序、`PATCH_DISPLAY_GROUPS`、`cordis.patch.yml` 配置项**一律未动**。

### 新增的 4 个 targetFiles 键

```js
// lib/compat-0.2.2.js
export function compatTargetKeys(aiBase, { nestedPkg, allExisting, firstExisting }) {
  return {
    // serviceAsk / ApprovalOutcome 从 types/index.js 挪到 pipeline.js
    "dsh-tools-pipeline": allExisting([
      ...nestedPkg(aiBase, "dsh-tools", "lib", "types", "pipeline.js"),
    ]),
    // PTC 执行器拆成独立包
    "tool-executor-ptc": allExisting([
      ...nestedPkg(aiBase, "dsh-tool-executor-ptc", "lib", "index.js"),
      ...nestedPkg(aiBase, "dsh-tool-executor-ptc", "lib", "types", "ptc.js"),
    ]),
    // 交付物提示词整段拆出去
    "deliverable-file-references": allExisting([
      ...nestedPkg(aiBase, "dsh-deliverable-file-references", "lib", "index.js"),
    ]),
    // web surface 提示词搬进 dev-context（单文件，用 firstExisting 容错）
    "dev-context": firstExisting([
      ...nestedPkg(aiBase, "dsh-harness-dev-context", "lib", "index.js"),
    ]),
  };
}
```

> 为什么 `dev-context` 用 `firstExisting` 而不是 `allExisting`：`allExisting()` 要求候选路径**全部**存在才返回，`nestedPkg()` 在扁平布局与嵌套布局各返回一条，两者语义等价但只会有一条命中，用 `allExisting` 会永远返回空。

## 逐条处置

### 15 条换锚点（语义不变，原文取自 1.3.9）

| # | 补丁 | 0.2.2 的变化 |
|---|---|---|
| 12 | `APPROVAL_ASK_SENTENCE_BYPASS` | ask 句改成 `Approval prompts are enabled in this session:` |
| 14 | `ESCALATION_GRANT_UNCONDITIONAL` | `displayReason` 内联对象抽成函数，新增兜底 pattern |
| 17 | `FS_OBSERVATION_INTENT_FREE` | `editIntent` 改调 `requirePresent()`，新增 `deleteIntent` |
| 40 | `COMPLETE_PROMPT_KEEP_INJECT` | `assemble` 两个 return 分支多带 `tools` 字段 |
| 45 | `OFFICIAL_DESKTOP_UPDATE_HANDOFF` | 插入点改为 `DesktopUpdateCoordinator` 类头 |
| 47 | `ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY` | 新增正则 pattern |
| 49 | `ANTHROPIC_OAUTH_CLI_NEUTRAL` | UA / app-id / 工具名三处新增 |
| 54 | `DELIVERABLE_DO_NOT` | 提示词搬到 `dsh-deliverable-file-references` |
| 57 | `DEEPSEEK_SYSTEM_ROLE` | 新增 `compat?.supportsDeveloperRole` 两条 |
| 60 | `OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL` | PTC 执行器拆成 `dsh-tool-executor-ptc` |
| 62 | `OFFICIAL_TOOL_ASK_FAILOPEN` | `serviceAsk` 挪到 `dsh-tools/lib/types/pipeline.js` |
| 67 | `AGENT_LOOP_MESSAGES_GUARD` | 上游包了 try，缩进 4→5 tab |
| 74 | `ASSEMBLE_BEFORE_PRESTEP` | 插入点改到 `inbox.claim` 之后 |
| 82 | `DESKTOP_SHELL_PROFILE_FALLBACK` | 锚点改成 `//#endregion\n//#region …home-paths` |
| 87 | `HUNG_PROMPT_LF_NEEDLE` | 新增 LF 归一化两条 |

### 3 条按 0.2.2 原文重写锚点（1.3.9 已放弃，这里保住语义）

| # | 补丁 | 0.2.2 的变化 | 做法 |
|---|---|---|---|
| 32 | `WEB_SURFACE_IDENTITY_NEUTRAL` | 提示词搬进 `dsh-harness-dev-context` | 新增 `dev-context` 键，锚 `prefix:` 与 `description:` 两行，`markersAny` |
| 53 | `WEB_SURFACE_PROHIBITION` | 同上 | 锚 `Do not start a replacement server…` 整句 |
| 77 | `REWIND_DROP_SENT_ON_APPEND` | `append()` 多一行 `revised.size` 判空 | 锚点补上那一行 |

`#32` 的具体锚点（`lib/compat-0.2.2.js`）：

```
prefix: "You are interacting with the user through the DeepSeek Harness Web GUI at ",
  → prefix: "You are interacting with the user through the local web GUI at ",

description: "Advertised URL of the DeepSeek Harness Web GUI serving this session."
  → description: "Advertised URL of the local web GUI serving this session."
```

`#53` 的锚点：

```
Do not start a replacement server unless the user asks; if one is needed,
use a managed background job and verify its exact URL.
  → Starting a local server is allowed when the task needs one. [dsh-purge] web surface prohibition dropped
```

### 1 条退役

`#80 MINIMAL_OFFICIAL_TOOLSET` —— 0.2.2 的 `minimal.patch.yml` 本身就带 `persistent-shell` 与完整工具行，没有可替换的旧文本。留着只会让面板多一行失败。

## 红队预设修复

这是 rc2.3 相对 rc2.2 的主要差异。

### 症状

`~/.dsh/redteam/preset-declare.json`：

```json
{
  "ok": false,
  "phase": "registered-broken",
  "broken": "tool-subagent-list-agents (@deepseek-ai/dsh-tool-subagent-control/list-agents): never started"
}
```

红队模式在模式选择器里**完全消失**。

### 根因

0.2.2 的 `@deepseek-ai/dsh-tool-subagent-control` 的 `exports` 只剩：

```json
{
  ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
  "./src/*": "./src/*",
  "./package.json": "./package.json",
  "./locale/*.json": "./locale/*.json"
}
```

`./list-agents` 子路径被删除，`registerListAgents(ctx)` 并进主入口 `lib/index.js` 的 `apply()`。

而 `presets/redteam/agent.cordis.yml` 第 296-298 行还有：

```yaml
    - id: tool-subagent-list-agents
      name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'
      disabled: false
```

这一行永远 `never started`，整个预设被判 `registered-broken`。

### 修复

1. **删死行** —— `presets/redteam/agent.cordis.yml`，改成说明注释
2. **加自愈** —— `lib/redteam/index.js` 新增 `stripDeadSubagentRows(text)`，接进 `installPreset()` 自愈链。用户机器上已部署的旧副本也会在插件加载时被自动修掉
3. **顺手补 `stripToolFilter(text)`** —— 0.2.1-rc.2 起 `toolFilter` 是「键存在就抛」，任何写法（同行、多行、`null`）都会让整份预设注册失败

```js
// lib/redteam/index.js 自愈链
const rendered = renderSkillsDir(text)
const tools = renderToolsPackage(rendered.text)
const filter = stripToolFilter(tools.text)
const deadRows = stripDeadSubagentRows(filter.text)
const delegation = repairDelegation(deadRows.text)
const next = delegation.text
if (rendered.changed || tools.changed || filter.changed || deadRows.changed || delegation.changed) {
  writeFileSync(presetFile, next.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8')
  // …
}
```

两个函数都做了幂等验证（同一份文本跑两次，第二次 `changed === false`）。

## 验证方式

全部在 `app.asar` 解包出来的 **0.2.2-rc.1 宿主副本**上跑真代码，不是纸面推断。

### 测试树怎么搭

```powershell
# 1. 解包 app.asar 到 host\（node 的 asar 头解析，20,519 个文件）
# 2. robocopy 出 pkgs\
# 3. 在原位与 dsh\node_modules\@deepseek-ai\ 下各建一层 junction
#    让 nestedPkg() 的扁平与嵌套两条路径都命中
```

### 结果

| 项 | 结果 |
|---|---|
| 补丁总数 | 81（原 82，退役 #80） |
| `patchStatus` 首轮 | applied 8 / pending 57 / na 11 / missing_file 1 / skipped 1 |
| `applyPatches` 实跑 | applied 60 / already 9 / missing_file 7 / na 5 |
| 实跑后 `patchStatus` | **applied 69 / na 11 / missing_file 1** |
| 唯一 `missing_file` | `#71 LIANGSHEN_IDENTITY_LINE`（宿主无 `dsh-preset-liangshen` 包） |
| 被打补丁的 JS | 35 个，`node --check` 全过 |
| 被打补丁的 YAML | 6 个，宿主自带 `yaml` 解析器全部通过 |
| tgz 回解包再跑 | 同样 69 applied，打包无丢失 |

### 真机验证（Windows 11 + DeepSeek Harness 0.2.2-rc.1）

| 项 | 结果 |
|---|---|
| 宿主被打补丁的文件 | **36 个** |
| 真机 `patchStatus` | 69 applied / 11 na / 1 missing_file |
| 红队预设 | `{"ok": true, "phase": "registered", "plugins": 19, "broken": null}` |
| 注入链路 | 日志 `injectBytes=20964` 持续生效 |

36 个文件里包含 0.2.2 的新落点：

```
dsh-tool-executor-ptc/lib/index.js
dsh-tool-executor-ptc/lib/types/ptc.js
dsh-tools/lib/types/pipeline.js
dsh-deliverable-file-references/lib/index.js
dsh-harness-dev-context/lib/index.js
```

## 已知限制

- `#45 #46 #82 #83 #84` 依赖 `detectSurface()` 认真实桌面安装位。在纯解包树 / CLI 环境里显示 `na`，属预期，不是坏了
- `#60` 的 `dsh-tools-ptc` 键在 0.2.2 上解析为 0（该包已被拆走），靠新增的 `tool-executor-ptc` 键兜住
- macOS 未实测；Windows 只测过桌面版 0.2.2-rc.1
- 本版只保证 0.2.2-rc.1；0.2.1 系列请用 [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo)

## 与 1.3.9 的取舍差异

1.3.9 有 73 条补丁，比 1.1.71 少 10 条：`30` `31` `32` `53` `56` `64` `65` `71` `77` `80`。

本分支**保留这 10 条**，处置如下：

| 补丁 | 处置 |
|---|---|
| `#32` `#53` `#77` | 按 0.2.2 原文重写锚点，语义保住（1.3.9 选择放弃） |
| `#80` | 退役（0.2.2 无事可做） |
| `#30` `#31` `#56` `#64` `#65` `#71` | 保留原样，在无对应包的宿主上正常显示 `na` |

选择保留而非删除的理由：这些补丁在装了对应包的宿主上仍然有效，删掉等于剥夺用户的选择；`na` 状态在面板上是灰色的，不构成噪音。
