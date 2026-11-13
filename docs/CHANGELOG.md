# CHANGELOG

本仓库跟踪 **0.2.2 系列适配分支**的变更。上游 1.1.71 及 rc2.1 的完整历史见
[evan545295555-hash/Evans-repo](https://github.com/evan545295555-hash/Evans-repo)。

版本语义沿用上游：`1.1.71-rcX.Y`，X 对应上游兼容分支代次，Y 是本分支的修订号。

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
- 解包 `app.asar` 时数据起点算错（`16 + readUInt32LE(12)` → 应为 `8 + readUInt32LE(4)`），
  导致每个文件多 3 字节前缀、34 个文件全报语法错误。已修正并重新生成全部锚点

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
