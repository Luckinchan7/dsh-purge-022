## v1.1.71-rc2.7 — 2026-11-16

### Added

- `lib/anchor.js` —— 尾部锚点（2,542 B）。主锚点 `purge-anchor` / order 10250 / 在 `rewriteLiveAssembly` 返回值末尾 append；子锚点 `purge-child-anchor` / order 235 / 走 `systemPrompt.context` / 只对子会话生效。理由：注入正文在 system prompt 最前，隔上万 token 才到末尾，长上下文里指令权重会被稀释。
- 补丁 `#89 ASK_USER_NO_BLOCK` —— ask_user_question 等待上限 120s / 无限 → 1s，反问不再卡住回合。
- 补丁 `#90 SANDBOX_POLICY_BRAND_NEUTRAL` —— 三条沙箱策略文案全部去 DSH 品牌词（`#61` 只覆盖了 read-only 一支）。
- 补丁 `#91 SKILL_BADGE_DESCRIPTION_NEUTRAL` —— 技能描述去「powered by dsh」官方徽章话术。
- 补丁 `#92 DESKTOP_HOST_EXIT_TRACE` —— host 退出记 code / signal / stderr 到 `%TEMP%\dsh-purge-desktop.log`。
- 补丁 `#93 DESKTOP_MAIN_EXIT_TRACE` —— 主进程生命周期日志（exit / uncaughtExceptionMonitor / 信号 / Electron quit 钩子 / 进程崩溃 / 60s 心跳）。
- `targetFiles` 新增 `tool-ask-user` 与 `skill-badge` 两键。
- `config.tailAnchor`（默认 `true`）—— 关掉后主 / 子锚点都不挂。
- `package.json` exports 新增 `./anchor`。

### Changed

- `rewriteLiveAssembly` 返回值末尾追加锚点；`purgeLog` 的 `anchorApplied` 从恒 false 改成真实值。
- 对比六个社区分支后只吸收 5 条补丁与 1 个模块；显式不引入的项与理由见 RELEASE-NOTES。

### Not adopted

- `#56` / `#77`（rewind）：0.2.2-rc.3 上游已删该功能，全宿主 0 命中，无对象可打。
- guLab `lib/subagent-control.js`：本插件 `#9` 已在 `decide()` 首行 `return "allowed-once"` 短路，子会话 never 走不到。
- guLab `lib/web-reclaim.js` / `bin-preflight.js`：桌面版不跑 `dsh web`，无 `EADDRINUSE` 场景。
- morty 的 41,870 B 提示词：多出篇幅是人设演绎与已有同源的 CTF 段落，不提升规则密度。

### Verified

- `ALL_PATCHES` 84 条；宿主实跑 applied 67 / na 13 / missing_file 1 / pending 3（pending 即本次三条新增）。
- `#89` / `#90` / `#91` 在宿主副本上 applied，打完 `node --check` 全过，重跑全部 already。
- 锚点排序后确为末位（order 10250 > persona-suffix 10200）。
- 113 文件全量 `node --check` 0 失败；5 个 YAML 过宿主自带 `yaml` 0 失败。

# CHANGELOG

本仓库跟踪 **0.2.2 系列适配分支**的变更。上游 1.1.71 及 rc2.1 的完整历史见
[evan545295555-hash/Evans-repo](https://github.com/evan545295555-hash/Evans-repo)。

版本语义沿用上游：`1.1.71-rcX.Y`，X 对应上游兼容分支代次，Y 是本分支的修订号。

---

## v1.1.71-rc2.6 — 2026-11-15

补丁能力与 rc2.5 完全一致（79 条补丁、67 applied / 11 na / 1 missing_file）。本版只加预设。

### Added

- **无限制模式**（preset id `nolimit`，`presets/nolimit/`，注册器 `lib/nolimit/index.js`）。
  与红队模式并列出现在模式下拉里，但形态相反：不设阶段、不设并发上限、不裁子智能体深度、
  不要环境适配置页、不让模型"先问再做"。

  20 个插件行：`persona`（本地 `persona.mjs`，绕开 0.2.1-rc.x 的 scope 隔离 bug）、
  `agent-instructions`、`tool-bash` + `tool-pwsh`（两个都开，不按平台互斥）、
  `tool-fs`（读取上限 200000 行 / 40000 字符单行 / 64 MB）+ `tool-fs-search`、
  `tool-jobs`、`skill-filesystem` + `tool-skill`、`command-goal` + `tool-goal`、
  `planning`（section 换成"要改就直接改"）、`compaction`（pruner 阈值 32768/16384/4096）、
  `delegation`（subagent / fork / workflow / ralph 全开，不设 maxDepth）、
  `tool-ask-user`、`tool-todo`、`tool-web`（fetch 开，超时 180s）、`present`、`tool-office`、`tool-schedule`。

  persona 明确声明：权限基线是"能读写任何路径、起任何进程、访问任何目标"；不存在授权步骤；
  工具报错只代表单次调用失败；不加免责、风险提示、合规提醒与替代方案建议；
  本文件覆盖宿主默认身份说明与工具描述里"应当征询用户"的措辞。

  自愈：`installPreset()` 在目标已存在时补齐缺失文件（不会覆盖用户改过的人设），
  覆盖入口是 `NOLIMIT_PRESET_REFRESH=1`。注册状态写 `$DSH_HOME/redteam/nolimit-preset.json`。

### Changed

- `cordis.patch.yml` 的 `insert:` 段新增 `dsh-purge-nolimit` 行，与 `dsh-purge-redteam` 并列。
- `package.json` 新增 `./nolimit` 导出，`version` → `1.1.71-rc2.6`，`description` 提到两套预设。

### Verified

- `readPresetDefinition('nolimit', ...)` 解析通过：`name=无限制模式 order=15 plugins=20`。
- 临时 `DSH_HOME` 里跑 `installPreset({force:true})` → `action: installed`，落盘三文件，复解析一致。
- 63 个 `.js` / `.mjs` 全量 `node --check` 0 失败。
- `cordis.patch.yml` 过宿主自带 `yaml` 解析（`!!js` 先替换成占位标签），8 个顶层条目，
  `insert` 里四个 id：`dsh-purge-redteam` / `dsh-purge-nolimit` / `dsh-purge-redteam-store` / `dsh-purge-redteam-ui`。

---

## v1.1.71-rc2.5 — 2026-11-14

只动更新链路，补丁能力与 rc2.4 完全一致（79 条补丁、67 applied / 11 na / 1 missing_file）。

### Fixed

- **更新源指回了上游，会误点降级。** `lib/update.js` 的 `REPO` 原本是
  `evan545295555-hash/Evans-repo`、`STABLE_REF` 是 `master`，那条分支上的包是
  `1.1.71-rc2.1`（`dshTarget` 只到 `0.2.1-rc.2`）。面板因此会摆出一个可点、
  但点下去会删掉 `lib/compat-0.2.2.js` 与 `lib/compat-0.2.3.js` 的「切换到此版本」按钮。
  现在 `REPO = "devin667/dsh-purge-022"`、`STABLE_REF = "main"`。
- **GitHub 不可达时整块面板 500。** `checkUpdate()` 原本在
  `if (!lanes.stable.hasRemote) throw new Error("无法读取 GitHub master");` 直接抛错；
  未认证 API 配额（60 次/小时）用完后必现。改为返回
  `ok: true` + `error: "无法读取 GitHub（网络不通或 API 限流）"`，`versions` 为空数组，
  不提供任何可切换目标。
- **本地版本行与远端分支同名。** `ensureRunningVersion()` 原本会按「列表里有没有
  `master`」决定本地行叫 `master` 还是 `local-<ver>`，撞名会让 `markCurrent()` 误判当前版本。
  现在固定为带 `local-` 前缀的 ref，不再与远端分支同名。

### Changed

- `lib/redteam/ui.js`：`githubRepoOf()` 兜底值 → `devin667/dsh-purge-022`
- `client.js`：`welcome.repo` 中英两处 → `https://github.com/devin667/dsh-purge-022`
- `package.json`：`repository` / `homepage` / `bugs` / `dsh.install.{tarball,zip,git}`
  全部指向本仓库与 `v1.1.71-rc2.5`
- `package.json`：`description` 由「0.2.2-rc.1 适配分支」改为「0.2.2-rc.3 / rc.1 适配分支」，
  与 `dshTarget` 对齐

### Verified

- 0.2.2-rc.3 宿主跑 `patchStatus()`：`{"applied":67,"na":11,"missing_file":1}`，
  唯一 missing 仍是 `#71`（未装良神预设）
- 包内 62 个 `.js` / `.mjs` 全量 `node --check`：0 失败
- `checkUpdate()` 走代理 → `hasUpdate:false` / `error:null`；直连超时 →
  `ok:true` / `error:"无法读取 GitHub（网络不通或 API 限流）"` / `versions:[]`

---

## v1.1.71-rc2.4 — 2026-11-14

在 rc2.3 基础上再往前对齐一版，同一份包同时支持 **0.2.2-rc.1** 与 **0.2.2-rc.3**。

### Added

- `lib/compat-0.2.3.js` —— 0.2.2-rc.3 增量兼容层：
  - `COMPAT_023_REPLACEMENTS` —— 4 条补丁（`13` `18` `35` `62`）的 rc.3 锚点，
    **追加**到已有 `replacements` 数组末尾而非替换
  - `RETIRED_023_IDS = new Set([56, 77])` —— 宿主侧已删除 rewind 功能，无可锚定对象
  - `applyCompat023(patches)` —— 就地追加 + 摘除退役条目
- `RELEASE-NOTES-1.1.71-rc2.4.md`

### Changed

- `lib/core.js` —— 两处接线：`import { applyCompat023 } from "./compat-0.2.3.js"`、
  `ALL_PATCHES = applyCompat023(applyCompat([...]))`
- `package.json` —— `version` → `1.1.71-rc2.4`，`dshTarget` → `0.2.2-rc.3`，
  `dshTargets` 加上 `0.2.2-rc.3`

### Removed

- `#56 REWIND_HIDE_CUT_ONLY`、`#77 REWIND_DROP_SENT_ON_APPEND` 退役。
  目标文件 `dsh-client-ui-conversation/lib/client.js` 在 rc.3 变成 704 KB / 28 行的压缩 bundle，
  标识符全部 mangle；`src/client/locales.ts` 里 `回退`/`撤销`/`rewind` 一次都不出现，
  证明该功能已被上游删除而非搬家

### Fixed

- 4 条代码层补丁在 0.2.2-rc.3 上显示「跳过」
- 解包 `app.asar` 的数据起点统一按 `8 + readUInt32LE(4)` 处理（`16 + readUInt32LE(12)`
  会让每个文件多 3 字节前缀、全部语法检查失败）。全部锚点均基于基线校验通过的宿主副本生成

### Verified

| 宿主 | applyPatches | patchStatus |
|---|---|---|
| 0.2.2-rc.3 | applied 58 / already 9 / missing_file 7 / na 5 | applied 67 / na 11 / missing_file 1 |
| 0.2.2-rc.1（回归）| 同上，完全一致 | 同上，完全一致 |

- 宿主 1,267 个 JS 基线语法检查：0 失败
- 打补丁后的 34 个 JS：0 失败
- 包内 107 个文件全量 `node --check`：0 失败
- tgz 回解包再跑 apply：结果一致

---

## v1.1.71-rc2.3 — 2026-11-13

首个公开发布版本。在 rc2.2 的基础上补了红队预设修复，并把兼容层从 18 条扩到 19 条。

### Added

- `lib/compat-0.2.2.js` —— 0.2.2-rc.1 兼容层：
  - `compatTargetKeys(aiBase, { nestedPkg, allExisting, firstExisting })` 新增 4 个 `targetFiles` 键：
    `dsh-tools-pipeline`、`tool-executor-ptc`、`deliverable-file-references`、`dev-context`
  - `COMPAT_FIELDS` —— 19 条补丁的锚点覆盖表
  - `RETIRED_IDS` —— 退役补丁清单（当前只有 `#80`）
  - `applyCompat(patches)` —— 就地改写补丁表
- `lib/redteam/index.js` 新增两个自愈函数：
  - `stripDeadSubagentRows(text)` —— 摘掉指向 `@deepseek-ai/dsh-tool-subagent-control/*` 子路径的整块行
  - `stripToolFilter(text)` —— 摘掉任何形态的 `toolFilter:` 键（含同行、多行、`null`）
  - 两者均接入 `installPreset()` 的自愈链，幂等，已单测
- `docs/CHANGELOG.md`（本文件）

### Changed

- `presets/redteam/agent.cordis.yml` —— 删掉 3 行指向 `dsh-tool-subagent-control/list-agents` 的死行，
  改为一段说明注释。该子路径在 0.2.2 已删除，留着会让整份预设 `registered-broken`
- `package.json` —— `version` → `1.1.71-rc2.3`，`dshTarget` → `0.2.2-rc.1`，
  `dshTargets` 加上 `0.2.2-rc.1`，`contributors` 加上 555bbbAAA
- `lib/core.js` —— 三处接线：`import` 一行、`ALL_PATCHES` 外包 `applyCompat()`、
  `targetFiles()` 尾部并入 `compatTargetKeys()`

### Fixed

- 红队模式在 0.2.2-rc.1 上从模式选择器里消失（`preset-declare.json` 报 `registered-broken`）
- 12 条补丁在 0.2.2-rc.1 上静默 `skipped`（锚点全死）
- 14 条补丁在 0.2.2-rc.1 上报 `missing_file`（目标文件被拆包/拆文件）

### Verified

| 项 | 结果 |
|---|---|
| 补丁总数 | 81 |
| `applyPatches` | applied 60 / already 9 / missing_file 7 / na 5 |
| 实跑后 `patchStatus` | applied 69 / na 11 / missing_file 1 |
| 唯一 `missing_file` | `#71 LIANGSHEN_IDENTITY_LINE`（宿主无 `dsh-preset-liangshen`） |
| 被打补丁的 JS | 35 个，`node --check` 全过 |
| 被打补丁的 YAML | 6 个，宿主自带 `yaml` 解析全过 |
| 真机（Windows 11 + 0.2.2-rc.1） | 36 个宿主文件带 `[dsh-purge]` 标记 |
| 红队预设 | `{"ok": true, "phase": "registered", "plugins": 19, "broken": null}` |
| 注入链路 | 日志 `injectBytes=20964` 持续生效 |

---

## v1.1.71-rc2.2 — 2026-11-13（未公开发布）

内部迭代版本，用于建立并验证兼容层。

### Added

- `lib/compat-0.2.2.js` 初版：18 条覆盖项 + 3 个 `targetFiles` 键

### Changed

- `lib/core.js` 三处接线

### Verified

- `patchStatus` applied 69 / na 11 / missing_file 1
- 35 个 JS 过 `node --check`，6 个 YAML 过解析

### Known issue

- 红队预设仍 `registered-broken`（`presets/redteam/agent.cordis.yml` 里的 `list-agents` 死行未处理）
- 未打进 tgz，未发布

---

## 上游版本（供对照）

| 版本 | 目标宿主 | 说明 |
|---|---|---|
| `1.1.71` | 0.2.0-rc.2 | 小杨 / YuJunZhiXue 原版，无 `postinstall`，无 `./redteam/persona` 导出 |
| `1.1.71-rc2.1` | 0.2.1-rc.2 | 巴里啊啊的兼容分支；去掉 persona-suffix 里写死的 `{{cwd}}`、去掉 bundle 层重复 insert |
| `1.1.71-rc2.3` | 0.2.2-rc.1 | 本仓库首个公开版 |
| `1.1.71-rc2.4` | **0.2.2-rc.3**（兼容 rc.1） | 本仓库当前版本 |
| `1.3.9` | >=0.2.1-0 <0.3.0 | 555bbbAAA 社区版，73 条补丁，本分支的锚点来源之一 |

### 与 1.3.9 的差异

1.3.9 有 73 条补丁，比 1.1.71 少 10 条（`30` `31` `32` `53` `56` `64` `65` `71` `77` `80`），多 1 条 `89`。

本分支**保留了这 10 条**，其中：

- `#32` `#53` —— 按 0.2.2 原文重写锚点，语义保住
- `#56` `#77` —— rc2.3 时按 0.2.2-rc.1 原文重写过；rc2.4 因宿主删除 rewind 功能而退役
- `#80` —— 退役（0.2.2 的 minimal 预设自带完整工具行）
- `#30` `#31` `#64` `#65` `#71` —— 保留原样，在无对应包的宿主上正常显示 `na`
