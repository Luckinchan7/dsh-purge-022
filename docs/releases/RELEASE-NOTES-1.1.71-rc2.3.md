# 1.1.71-rc2.3 — 适配 DeepSeek Harness 0.2.2-rc.1

一句话：把 dsh-purge 1.1.71 的补丁表对齐到 **DeepSeek Harness 0.2.2-rc.1**，顺带修好红队预设在新宿主上注册失败的问题。

功能、配置项、展示分组、面板与 1.1.71-rc2.1 一致，没有新增能力。

## 基线

| 项 | 值 |
|---|---|
| 基线包 | `dsh-purge-1.1.71-rc2.1.tgz`（[evan545295555-hash/Evans-repo](https://github.com/evan545295555-hash/Evans-repo)，sha256 `0fbcc2e05099a110f6e6e8b9d1554e266e5eae3c90ea861101611444570a44f7`）|
| 锚点来源 | [dsh-purge 1.3.9](https://github.com/555bbbAAA/dsh-purge)（MIT，维护者 555bbbAAA）|
| 目标宿主 | DeepSeek Harness **0.2.2-rc.1**（内置 `@deepseek-ai/dsh` 0.2.2-rc.1）|

## 为什么需要这一版

宿主从 0.2.1-rc.2 升到 0.2.2-rc.1 后，上游做了四类改动，原锚点一条都撞不上：

1. **拆包** —— PTC 执行器从 `dsh-tools` 拆成 `dsh-tool-executor-ptc`；交付物提示词拆到 `dsh-deliverable-file-references`；`serviceAsk` 挪到 `dsh-tools/lib/types/pipeline.js`；web surface 提示词搬进 `dsh-harness-dev-context`
2. **改缩进** —— `#67` 上游包了一层 try，4 tab → 5 tab
3. **抽函数** —— `#14` 的 `displayReason` 内联对象抽成函数；`#82` 的 `main.js` 插入位置被 `mime` 的 region 顶开
4. **改句子** —— `#12` 的 ask 句开头换成 `Approval prompts are enabled in this session:`

实测原版 rc2.1 在 0.2.2-rc.1 上的 `patchStatus`：**12 条 skipped**（锚点全死），另有 14 条 `missing_file`。

## 改了什么

1. 新增 `lib/compat-0.2.2.js` —— 一张 `id → 字段` 覆盖表 + 四个 0.2.2 专用 `targetFiles` 键。
2. `lib/core.js` 只动三处：`import` 一行、`ALL_PATCHES` 外面包一层 `applyCompat()`、`targetFiles()` 尾部并入 `compatTargetKeys()`。
3. `lib/redteam/index.js` 新增两个自愈函数：`stripDeadSubagentRows()`、`stripToolFilter()`，并接进 `installPreset()` 的自愈链。
4. `presets/redteam/agent.cordis.yml` 删掉 3 行指向 `@deepseek-ai/dsh-tool-subagent-control/list-agents` 的死行。
5. `package.json`：`version` → `1.1.71-rc2.3`，`dshTarget` → `0.2.2-rc.1`。

补丁的 `id`、顺序、`PATCH_DISPLAY_GROUPS`、`cordis.patch.yml` 配置项一律未动。

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

`#80 MINIMAL_OFFICIAL_TOOLSET` —— 0.2.2 的 `minimal.patch.yml` 本身就带 `persistent-shell` 与完整工具行，没有可替换的旧文本。

### 红队预设修复

0.2.2 的 `@deepseek-ai/dsh-tool-subagent-control` 只剩根入口（`exports` 里 `.` / `./src/*` / `./package.json` / `./locale/*.json`），`list_agents` 已并入主入口的 `apply()`，`/list-agents` 子路径被删除。

老预设里那三行会让该行 `never started` → 整个预设被判 `registered-broken` → **红队模式在模式选择器里完全消失**。本版删掉死行，并加了 `stripDeadSubagentRows()` 自愈，用户机器上已部署的旧副本也会在插件加载时自动修掉。

## 验证

全部在 `app.asar` 解包出来的 **0.2.2-rc.1 宿主副本**上跑真代码，不是纸面推断。

| 项 | 结果 |
|---|---|
| 补丁总数 | **81**（原 82，退役 #80）|
| `applyPatches` 实跑 | applied 60 / already 9 / missing_file 7 / na 5 |
| 实跑后 `patchStatus` | **applied 69 / na 11 / missing_file 1** |
| 唯一 missing_file | `#71 LIANGSHEN_IDENTITY_LINE` —— 宿主无 `dsh-preset-liangshen` 包，属正常 |
| 被打补丁的 JS | 35 个，`node --check` **全部通过** |
| 被打补丁的 YAML | 6 个，宿主自带 `yaml` 解析器**全部通过** |
| 红队预设 YAML | 19 个顶层条目，解析通过 |
| `stripDeadSubagentRows` / `stripToolFilter` | 单测通过 + 幂等验证通过 |
| 打好的 tgz 回解包再跑 | 同样 69 applied，打包无丢失 |

### 真机验证（Windows 11，DeepSeek Harness 0.2.2-rc.1）

| 项 | 结果 |
|---|---|
| 宿主被打补丁的文件 | **36 个**（含 `dsh-harness-dev-context`、`dsh-tool-executor-ptc`、`dsh-tools/lib/types/pipeline.js` 这些 0.2.2 新落点）|
| 真机 `patchStatus` | 69 applied / 11 na / 1 missing_file |
| 红队预设 | `{"ok": true, "phase": "registered", "plugins": 19, "broken": null}` |
| 注入链路 | 日志 `injectBytes=20964` 持续生效 |

## 安装

```bash
# 方式一：tarball
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.3/dsh-purge-1.1.71-rc2.3.tgz

# 方式二：手动放置（本机没有 dsh CLI 时）
#   解包到 ~/.dsh/profiles/desktop/node_modules/dsh-purge
#   然后跑：node ~/.dsh/profiles/desktop/node_modules/dsh-purge/scripts/ensure-profile-bundle.mjs
```

装完重启宿主，在面板点「应用」。

## 回滚

```bash
# 宿主侧：删掉 resources/app，让宿主回到密封的 app.asar
# 插件侧：
rm -rf ~/.dsh/profiles/desktop/node_modules/dsh-purge
# 再从 profile 的 package.json bundles 里移除 dsh-purge
```

## 已知限制

- `#45 #46 #82 #83 #84` 依赖 `detectSurface()` 认真实桌面安装位。在纯解包树 / CLI 环境里它们显示 `na`，属预期，不是坏了。
- `#60` 的 `dsh-tools-ptc` 键在 0.2.2 上解析为 0（该包已被拆走），靠新增的 `tool-executor-ptc` 键兜住。
- macOS 未实测；Windows 只测过桌面版 0.2.2-rc.1。

## 致谢

- 小杨 —— dsh-purge 原作者
- 巴里啊啊 —— 1.1.71-rc2.1 的 0.2.1-rc.2 兼容分支
- 555bbbAAA —— 1.3.9 的 0.2.2 锚点（本版 15 条覆盖项直接取自该版本，MIT）

MIT License.
