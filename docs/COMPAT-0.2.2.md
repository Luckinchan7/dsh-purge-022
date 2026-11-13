# 1.1.71-rc2.2 — 0.2.2-rc.1 适配说明

## 这是什么

`dsh-purge 1.1.71` 的一个小改分支，只做一件事：把补丁表对齐到 **DeepSeek Harness 0.2.2-rc.1**。
功能、配置项、展示分组、面板都与 1.1.71-rc2.1 一致，没有新增能力。

## 基线

| 项 | 值 |
|---|---|
| 基线包 | dsh-purge-1.1.71-rc2.1.tgz（evan545295555-hash/Evans-repo，sha256 `0fbcc2e0…44f7`） |
| 锚点来源 | dsh-purge 1.3.9（555bbbAAA 社区版，MIT） |
| 目标宿主 | DeepSeek Harness 0.2.2-rc.1（桌面版 0.2.2-rc.1，内置 `@deepseek-ai/dsh` 0.2.2-rc.1） |

## 改了什么

1. 新增 `lib/compat-0.2.2.js`：一张 `id -> 字段` 覆盖表 + 三个 0.2.2 专用 `targetFiles` 键。
2. `lib/core.js` 只动三处：`import` 一行、`ALL_PATCHES` 外面包一层 `applyCompat()`、
   `targetFiles()` 尾部并入 `compatTargetKeys()`。
3. `package.json`：`version` 提到 `1.1.71-rc2.2`，`dshTarget` 提到 `0.2.2-rc.1`。

补丁的 `id`、顺序、`PATCH_DISPLAY_GROUPS`、`cordis.patch.yml` 的配置项一律未动。

## 逐条处置

### 15 条换锚点（语义不变，原文取自 1.3.9）

| # | 补丁 | 0.2.2 的变化 |
|---|---|---|
| 12 | APPROVAL_ASK_SENTENCE_BYPASS | ask 句改成 `Approval prompts are enabled in this session:` |
| 14 | ESCALATION_GRANT_UNCONDITIONAL | `displayReason` 内联对象抽成函数，新增兜底 pattern |
| 17 | FS_OBSERVATION_INTENT_FREE | `editIntent` 改调 `requirePresent()`，新增 `deleteIntent` |
| 40 | COMPLETE_PROMPT_KEEP_INJECT | `assemble` 两个 return 分支多带 `tools` 字段 |
| 45 | OFFICIAL_DESKTOP_UPDATE_HANDOFF | 插入点改为 `DesktopUpdateCoordinator` 类头 |
| 47 | ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY | 新增正则 pattern |
| 49 | ANTHROPIC_OAUTH_CLI_NEUTRAL | UA / app-id / 工具名三处新增 |
| 54 | DELIVERABLE_DO_NOT | 提示词搬到 `dsh-deliverable-file-references` |
| 57 | DEEPSEEK_SYSTEM_ROLE | 新增 `compat?.supportsDeveloperRole` 两条 |
| 60 | OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL | PTC 执行器拆成 `dsh-tool-executor-ptc` |
| 62 | OFFICIAL_TOOL_ASK_FAILOPEN | `serviceAsk` 挪到 `dsh-tools/lib/types/pipeline.js` |
| 67 | AGENT_LOOP_MESSAGES_GUARD | 上游包了 try，缩进 4→5 tab |
| 74 | ASSEMBLE_BEFORE_PRESTEP | 插入点改到 `inbox.claim` 之后 |
| 82 | DESKTOP_SHELL_PROFILE_FALLBACK | 锚点改成 `//#endregion\n//#region …home-paths` |
| 87 | HUNG_PROMPT_LF_NEEDLE | 新增 LF 归一化两条 |

### 3 条按 0.2.2 原文重写锚点（1.3.9 已放弃，这里保住语义）

| # | 补丁 | 0.2.2 的变化 | 做法 |
|---|---|---|---|
| 32 | WEB_SURFACE_IDENTITY_NEUTRAL | 提示词搬进 `dsh-harness-dev-context` | 新增 `dev-context` 键，锚 `prefix:` 与 `description:` 两行 |
| 53 | WEB_SURFACE_PROHIBITION | 同上 | 锚 `Do not start a replacement server…` 整句 |
| 77 | REWIND_DROP_SENT_ON_APPEND | `append()` 多一行 `revised.size` 判空 | 锚点补上那一行 |

### 1 条退役

`#80 MINIMAL_OFFICIAL_TOOLSET` — 0.2.2 的 `minimal.patch.yml` 本身就带 `persistent-shell` 与完整工具行，
没有可替换的旧文本。留着只会让面板多一行失败。

### 照旧显示 na 的（宿主上确实没有这些包）

`#28 #30 #31 #45 #46 #64 #65 #71 #76 #82/#83/#84`（`desktop-shell` 相关需真实桌面安装位才解析得到）。

## 验证方式

在 `app.asar` 解包出来的 0.2.2-rc.1 宿主副本上跑真代码：

| 项 | 结果 |
|---|---|
| 补丁总数 | 81（原 82，退役 #80） |
| `patchStatus` 首轮 | applied 8 / pending 57 / na 11 / missing_file 1 / skipped 1 |
| `applyPatches` 实跑 | applied 60 / already 9 / missing_file 7 / na 5 |
| 实跑后 `patchStatus` | applied 69 / na 11 / missing_file 1（仅 #71，宿主无 liangshen 包） |
| 被打补丁的 JS | 35 个，`node --check` 全过 |
| 被打补丁的 YAML | 6 个，宿主自带 `yaml` 解析器全部通过 |

## 已知限制

- 未在真机跑过——本机 `~/.dsh` 里已有 1.1.82 部署，装这个等于往回退，装上之前请先看清回滚路径。
- `#60` 的 `dsh-tools-ptc` 键在 0.2.2 上解析为 0（该包已被拆走），靠新增的 `tool-executor-ptc` 键兜住。
- `desktop-shell` 系列（`#45 #46 #82 #83 #84`）在纯解包树里是 na，只有真实桌面安装位才解析得到。
