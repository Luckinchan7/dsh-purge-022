# dsh-purge-022 1.2.2

**更新源可以被换掉，以及「仓库没了」不再伪装成「已是最新」。**

上一版（1.2.1）解决的是「补丁写了但不生效」。这一版解决的是另一类静默失败：
**补丁没问题，但检查更新这条路已经断了，面板却在说一切正常。**

---

## 一、假报「已是最新」

### 现象

GitHub 账号被停用、仓库整个消失之后，插件面板照常显示 **「已是最新（1.2.1）」**。
不报错、不提示、查更新按钮点下去也是这个结果。

### 根因

`lib/update.js` 的 `describeLane()` 用这一行决定「远端到底读到没有」：

```js
hasRemote: Boolean(sha || versions.length),
```

但 `versions` 是混合数组 —— 里面既有远端拉来的条目，也有 `ensureRunningVersion()`
为了让当前版本能显示在列表里而**本地合成**的一条：

```js
const ref = `local-${ver}`;
return [{ id: ref, ref, sha: localSha || "", version: ver, kind: "local", ... }, ...versions];
```

于是远端三个源（`api.github.com/repos/.../commits/main`、
`github.com/.../commits/main.atom`、`api.github.com/repos/.../tags`）全部失败时，
`versions.length` 仍然 ≥ 1 → `hasRemote` 为真 → **不进「取不到远端」分支** → 不报错，
而 `remoteVersion` 取 `latest?.version`，取到的正是那条本地条目的本机版本号。

一句话：**「远端读到了我自己」被当成了「远端读到了新版本」。**

### 修法

只把非 `local` 的条目算作远端：

```js
const remoteVersions = versions.filter((item) => item.kind !== "local");
const latest = remoteVersions.find((item) => item.latest);
// ...
hasRemote: Boolean(sha || remoteVersions.length),
```

远端真读不到时，结果里多两个字段：`remoteUnreadable: true` 和一段能照做的 `error`。

---

## 二、分清三种失败

原先所有远端失败都归成同一句「无法读取 GitHub（网络不通或 API 限流）」。
但三种情况的处置完全相反 —— 换仓库还是换网络，用户无从判断。

新增 `probeRepo(repo)`：分别探 `api.github.com/repos/<repo>` 与网页两条路径，按信息量取结果。

| state | 判据 | 面板文案 |
|---|---|---|
| `missing` | 404，或 403 且响应体含 `account was suspended` | `更新源 owner/repo 打不开 HTTP 404：账号被停用或仓库已改名。可在下面把更新源换成镜像仓库。` |
| `blocked` | 403 / 429 | `更新源 owner/repo 拒绝访问 HTTP 403：API 限流或需要授权，稍后再试。` |
| `offline` | 连不上 | `连不上 owner/repo：网络不通或代理没开。` |

一个实现细节值得记下来：`requestBuffer()` 对非 2xx 是**直接 reject** 的（`reject(new Error('http ${status}'))`），
所以 `fetchRes` 只会在 2xx 时 resolve。这意味探测函数拿不到 `res.status`，
状态码只能从 `error.message` 里用 `/^http (\d{3})$/` 取。第一版按 `res.status === 404` 写，
结果所有分支都落进 `offline`，把「仓库没了」误报成「网络不通」—— 自检里那条真联网断言就是为这个加的。

---

## 三、更新源可切换

### 配置

`$DSH_HOME/dsh-purge/repo.json`：

```json
{ "repo": "someowner/dsh-purge-022", "at": "2026-11-21T05:40:00.000Z" }
```

- `activeRepo()` 优先读它，非法值（不符合 `^[\w.-]+\/[\w.-]+$`）回落到内置常量
- `writeRepoOverride(repo)`：传空串或默认值 → 删除文件回到默认；格式不对 → 抛 `仓库要写成 owner/repo`
- 写入后清空 `_remotePkgVerCache`，避免还拿旧仓库的 5 分钟 memo

### 覆盖范围

所有 URL 模板从 `${REPO}` 改成 `${activeRepo()}`，共 **13 处**：

| 用途 | 处数 |
|---|---|
| codeload zip / tar.gz（ref、tag、sha 三种拼法） | 6 |
| raw.githubusercontent / jsdelivr（sha、ref 各一份） | 3 |
| api `contents/package.json` | 1 |
| api `commits/<ref>` | 1 |
| github.com `commits/<ref>.atom` | 1 |
| api `tags?per_page=50` | 1 |

### API

```jsonc
// POST /dsh-purge/update
{ "op": "repo", "repo": "someowner/dsh-purge-022" }
```

响应在 `checkUpdate()` 结果的基础上加 `repo` / `override` / `fallback` / `repoChanged: true`，
改完**立刻重探一次**，成不成当场看得到。

### 面板

更新卡片下面多了三件东西：`owner/repo` 输入框、保存、恢复默认（有覆盖时才可点）。
回车等同保存。中英文案 6 条（`repo.label` / `repo.hint` / `repo.save` / `repo.reset` /
`repo.saved` / `repo.savedDefault`）。

---

## 四、改名遗留：profile 认不到

1.2.0 把包名从 `dsh-purge` 改成 `dsh-purge-022`，但 `lib/update.js` 里两处还在用旧名：

```js
const spec = pkg?.dependencies?.["dsh-purge"] || pkg?.devDependencies?.["dsh-purge"];  // findPurgeProfiles
const nm = path.join(profileDir, "node_modules", "dsh-purge");                          // profilePluginDir
```

改名后 `findPurgeProfiles()` 永远返回空数组，`planUpdates()` 于是走
「没有 profile → 只处理当前这份 checkout」的分支 —— 面板上看起来在更新，
实际只动了本机这份源码，profile 里装的那份一条没变。

修法：`PACKAGE_NAMES = ["dsh-purge-022", "dsh-purge"]` + `packageSpec(pkg)` 统一识别
`dependencies` / `devDependencies` / `optionalDependencies` 三个位置，`pinInstalledSpec()`
也改用命中的那个键（原来无脑写 `dsh-purge`，会把新名 profile 写成旧名依赖）。

---

## 五、自检

新增 `tests/verify-rc216.mjs`，48 项。累计 **9 组 182 项全过**。

```
verify-rc213          26 passed    content 形状 / 漏 import / 修剪器 413
verify-rc214           6 passed    #73 纯删除与 marker
verify-rc2142          9 passed    #71 缺席宿主 / 面板口径
verify-rc120          22 passed    包名迁移 / engines / 自愈
verify-migration      21 passed    旧包名清理
verify-migration-yaml  8 passed    cordis.patch.yml 结构
verify-rc215          42 passed    空闲换包守卫（9 项真跑）
verify-rc216          48 passed    更新源切换 / 假报已最新 / 两种包名
verify-pack                      包名一致性 / 打包白名单
```

`verify-rc216` 里几条关键断言：

- 封停账号下 `probeRepo` 必须报 `missing`/`404`，不能报 `ok`
- 网络抖动时允许降级成 `offline`，此时跳过状态码断言（否则自检在不稳的网络上假红）
- `checkUpdate` 必须置 `remoteUnreadable: true`、`hasRemote: false`，`remoteVersion` 不回填本地版本
- 换成 `nodejs/node` 后 `hasRemote` 恢复、`override: true`
- 恢复默认后 `repo.json` 被删、`override: false`
- 两种包名的 profile fixture 都能被 `findPurgeProfiles` / `profilePluginDir` 认出
- 没有任何 URL 模板还在裸用 `${REPO}`

---

## 六、升级

```bash
dsh plugin --profile desktop add --ignore-scripts <镜像>/releases/download/v1.2.2/dsh-purge-022-1.2.2.tgz
```

或面板 → 填更新源 → 保存 → 重新检查 → 更新。

装完**完全退出宿主**（托盘也退）再打开。代码层补丁要换包才生效，机制见 1.2.1 的空闲换包守卫。

---

## 七、这一版没解决的

- **账号封停本身**。这是 GitHub 侧的状态，插件改不了。申诉入口
  <https://support.github.com/contact/account-unblock>；在账号恢复或迁移到新账号/镜像之前，
  本仓库的 Release 资产对外不可达（匿名 404，带 token 403）。
- **仓库 `.git` 仍是 31MB**（历史里躺着早期 tgz）。要真正瘦身得 `filter-repo` 重写历史，
  会改所有 commit hash 并让现有 tag 失效，没有在这一版里做。
