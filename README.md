# dsh-purge 1.1.71-rc2.3 — DeepSeek Harness 0.2.2-rc.1 适配分支

[中文](#中文) · [English](#english)

---

## 中文

`dsh-purge 1.1.71` 的一个小改分支，只做一件事：把补丁表对齐到 **DeepSeek Harness 0.2.2-rc.1**。

功能、配置项、展示分组、面板都与 [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo) 一致，没有新增能力。

### 为什么需要它

宿主升到 0.2.2-rc.1 后，上游拆了包、改了缩进、抽了函数、改了句子，原版 1.1.71 的 82 条补丁里有 **12 条锚点完全撞不上**，静默 skipped；另有 14 条目标文件路径失效。打完之后面板是一片红，注入链路也是断的。

### 本版做了什么

| 类别 | 数量 | 说明 |
|---|---|---|
| 换锚点 | 15 条 | #12 #14 #17 #40 #45 #47 #49 #54 #57 #60 #62 #67 #74 #82 #87，原文取自 [1.3.9](https://github.com/555bbbAAA/dsh-purge) |
| 重写锚点 | 3 条 | #32 #53 #77 —— 1.3.9 放弃了，这里按 0.2.2 原文补上 |
| 退役 | 1 条 | #80 —— 0.2.2 的 minimal 预设自带完整工具行，无事可做 |
| 红队预设 | 删死行 | `list-agents` 子路径在 0.2.2 被删，留着会让整个预设 `registered-broken` |

补丁的 `id`、顺序、展示分组、`cordis.patch.yml` 配置项**一个没动**。

### 实测数据

在 `app.asar` 解包出来的 0.2.2-rc.1 宿主副本上跑真代码：

```
补丁总数          81
applyPatches      applied 60 / already 9 / missing_file 7 / na 5
patchStatus       applied 69 / na 11 / missing_file 1
被打补丁的 JS      35 个，node --check 全过
被打补丁的 YAML    6 个，yaml 解析全过
```

真机（Windows 11 + DeepSeek Harness 0.2.2-rc.1）：宿主 36 个文件带 `[dsh-purge]` 标记，红队预设 `{"ok": true, "phase": "registered", "plugins": 19, "broken": null}`，注入日志 `injectBytes=20964` 持续生效。

唯一剩下的 `missing_file` 是 `#71 LIANGSHEN_IDENTITY_LINE` —— 宿主上本来就没有 `dsh-preset-liangshen` 这个包，属正常。

### 安装

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.3/dsh-purge-1.1.71-rc2.3.tgz
```

或者手动：解包到 `~/.dsh/profiles/desktop/node_modules/dsh-purge`，然后

```bash
node ~/.dsh/profiles/desktop/node_modules/dsh-purge/scripts/ensure-profile-bundle.mjs
```

装完重启宿主，在面板点「应用」。

### 已知限制

- `#45 #46 #82 #83 #84` 要 `detectSurface()` 认真实桌面安装位；纯解包树里显示 `na`，属预期。
- macOS 未实测。
- 本版只保证 0.2.2-rc.1；0.2.1 系列请用 [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo)。

### 完整发行说明

见 [RELEASE-NOTES-1.1.71-rc2.3.md](RELEASE-NOTES-1.1.71-rc2.3.md)。

---

## English

A minimal fork of `dsh-purge 1.1.71` that aligns the patch table with **DeepSeek Harness 0.2.2-rc.1**.

No new capabilities: same patch ids, same order, same display groups, same config keys as [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo).

### Why

Harness 0.2.2-rc.1 split packages, changed indentation, extracted functions, and reworded prompts. Against the original 1.1.71, **12 of 82 patches** had dead anchors and silently reported `skipped`, plus 14 patches pointed at files that no longer exist.

### What changed

| Kind | Count | Detail |
|---|---|---|
| Re-anchored | 15 | #12 #14 #17 #40 #45 #47 #49 #54 #57 #60 #62 #67 #74 #82 #87 (anchors taken from [1.3.9](https://github.com/555bbbAAA/dsh-purge), MIT) |
| Rewritten | 3 | #32 #53 #77 — dropped by 1.3.9, re-anchored here for 0.2.2 |
| Retired | 1 | #80 — 0.2.2's minimal preset already ships the full toolset |
| Red-team preset | dead rows removed | the `list-agents` subpath was deleted in 0.2.2; keeping it made the whole preset `registered-broken` |

### Verified

On an unpacked 0.2.2-rc.1 host tree:

```
patches           81
applyPatches      applied 60 / already 9 / missing_file 7 / na 5
patchStatus       applied 69 / na 11 / missing_file 1
patched JS        35 files, node --check clean
patched YAML      6 files, yaml parse clean
```

On a real Windows 11 box running DeepSeek Harness 0.2.2-rc.1: 36 host files carry the `[dsh-purge]` marker; the red-team preset reports `{"ok": true, "phase": "registered", "plugins": 19, "broken": null}`.

### Install

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.3/dsh-purge-1.1.71-rc2.3.tgz
```

### License

MIT. Upstream: 小杨 (original dsh-purge), 巴里啊啊 (0.2.1-rc.2 compat branch), 555bbbAAA (0.2.2 anchors).
