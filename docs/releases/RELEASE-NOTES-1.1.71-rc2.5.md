# 1.1.71-rc2.5 — 更新源归位与本地面板自洽

一句话：补丁能力一点没动，只把「更新」这条链路从上游仓库挪回本仓库，并让面板在断网 / API 限流时不再报错。

功能、补丁表（79 条）、配置项、展示分组、红队预设与 rc2.4 完全一致。

## 为什么还要一版

面板的「正式版」下拉在 rc2.4 里读的是**上游仓库** `evan545295555-hash/Evans-repo` 的 `master`，而那条分支上的包是 `1.1.71-rc2.1`（`dshTarget` 只到 `0.2.1-rc.2`）。

于是面板上会出现一个能点、但点下去**会降级**的按钮：

- `hasUpdate` 永远是 `false`（版本号不比本地新），可按钮文案走的是「切换到此版本」分支；
- 一旦真的点了，`applyUpdate()` 会从 `codeload.github.com` 拉上游 zip，把 `lib`、`bin`、`docs` **整个目录先删再覆盖**（`lib/update.js` 里 `fsp.rm(to, { recursive: true, force: true })` 那一行）；
- 结果就是 `lib/compat-0.2.2.js`、`lib/compat-0.2.3.js` 消失，补丁表退回 1.1.71 原版，在 0.2.2-rc.3 上大面积失效，红队预设的三行死行也会回来、预设重新变成 `registered-broken`。

另外，面板每次刷新都会打 `api.github.com`。未认证配额只有 60 次/小时，用完之后 `checkUpdate()` 直接 `throw new Error("无法读取 GitHub master")`，整块更新面板变成 HTTP 500。

这一版把这两件事一起收掉。

## 改了什么

1. **更新源换成本仓库**
   - `lib/update.js`：`const REPO = "devin667/dsh-purge-022";`（原 `evan545295555-hash/Evans-repo`）
   - `lib/update.js`：`const STABLE_REF = "main";`（原 `master`）
2. **断网 / 限流降级**
   - `lib/update.js`：`checkUpdate()` 里原本 `if (!lanes.stable.hasRemote) throw new Error("无法读取 GitHub master");`
     改成返回 `ok: true` + `error: "无法读取 GitHub（网络不通或 API 限流）"`，面板只显示提示，不再 500。
   - 取不到远端时不提供任何可切换目标，`versions` 为空数组。
3. **本地版本行不再与远端撞名**
   - `ensureRunningVersion()` 里原本
     `const ref = (versions || []).some((item) => item.ref === "master") ? \`local-${ver}\` : "master";`
     本地行有时会被命名成 `master`，和真正的远端分支同名，造成 `markCurrent()` 判定混乱。
     现在固定为 `const ref = \`local-${ver}\`;` —— 本地行永远带 `local-` 前缀，不可能被当成可切换目标。
4. **其余指向上游的位置一并归位**
   - `lib/redteam/ui.js`：`githubRepoOf()` 的兜底返回值 → `devin667/dsh-purge-022`
   - `client.js`：`welcome.repo`（中英各一处）→ `https://github.com/devin667/dsh-purge-022`
   - `package.json`：`repository` / `homepage` / `bugs` / `dsh.install.{tarball,zip,git}` 全部指向本仓库与 `v1.1.71-rc2.5` 标签
   - `package.json`：`description` 里「本版为 0.2.2-rc.1 适配分支」→「0.2.2-rc.3 / rc.1 适配分支」，与 `dshTarget` 对齐

补丁的 `id`、顺序、展示分组、`cordis.patch.yml` 配置项**一个没动**。

## 验证

在 0.2.2-rc.3 宿主上跑插件自身的 `patchStatus()`：

```
{"applied": 67, "na": 11, "missing_file": 1}
```

唯一 `missing_file` 仍是 `#71 LIANGSHEN_IDENTITY_LINE` —— 这台机器没装良神预设 `@linxin666/dsh-liangshen`，没有可打对象，与 rc2.4 一致。

包内 62 个 `.js` / `.mjs` 全量 `node --check`，0 失败。

`checkUpdate()` 两种网络状态各验一次：

| 状态 | 结果 |
|---|---|
| 走本地代理（7897） | `ok: true`、`localVersion: 1.1.71-rc2.5`、`remoteVersion: 9a74fae`、`hasUpdate: false`、`error: null` |
| 直连（GitHub 超时） | `ok: true`、`hasUpdate: false`、`error: "无法读取 GitHub（网络不通或 API 限流）"`、`versions: []` |

## 升级

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.5/dsh-purge-1.1.71-rc2.5.tgz
```

装完重启宿主，在面板点一次「应用」。

从 rc2.4 升上来的机器：补丁戳（`~/.dsh/dsh-purge/applied.json`）需要跟着改成 `1.1.71-rc2.5`，否则面板会认为补丁丢失、要求重打一次。重打一次也无害（幂等），只是多花一轮重启。
