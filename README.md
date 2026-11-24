# dsh-purge-022 1.2.7 — DeepSeek Harness 0.2.2 适配分支

[![DSH target](https://img.shields.io/badge/DeepSeek%20Harness-0.2.2--rc.5-4f46e5)](https://github.com/Luckinchan7/dsh-purge-022)
[![version](https://img.shields.io/badge/version-1.2.7-16a34a)](https://github.com/Luckinchan7/dsh-purge-022/releases/tag/v1.2.7)
[![patches](https://img.shields.io/badge/patches-131%20in%20table-0ea5e9)](docs/COMPAT-0.2.2.md)
[![license](https://img.shields.io/badge/license-MIT-a3a3a3)](LICENSE)
[![base](https://img.shields.io/badge/base-1.1.71--rc2.1-6b7280)](https://github.com/evan545295555-hash/Evans-repo)

[中文](#中文) · [English](#english) · [变更日志](docs/CHANGELOG.md) · [适配说明](docs/COMPAT-0.2.2.md) · [1.2.7 发行说明](docs/releases/RELEASE-NOTES-1.2.7.md)

> **更新源**：`Luckinchan7/dsh-purge-022`，仓库与 Release 均已上线可用。
> 原 `devin667` 账号被 GitHub 停用（仓库与 Release 全部对外 404），项目已整体迁到新账号，
> 20 个 tag 全部推送、对应 Release 已补齐资产。1.2.2 起更新源做成可切换的：面板「更新源」
> 一栏填任意 `owner/repo` 镜像即可换源，本机已装的部分不受影响。

![banner](docs/banner.svg)

---

## 中文

`dsh-purge 1.1.71` 的一个分支：把补丁表对齐到 **DeepSeek Harness 0.2.2 系列**，并修掉几处会让「补丁写了但不生效」的链路缺陷。

功能、配置项、展示分组、面板与上游一致。

### 支持哪些宿主

| 宿主 | 推荐版本 |
|---|---|
| **0.2.2-rc.5** | **本版（1.2.7）** |
| 0.2.2-rc.3 / rc.1 | 1.2.1（向后兼容） |
| 0.2.1 系列 | [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo) |

补丁层用「只追加、不替换」的兼容策略：新锚点追加到已有 `replacements` 末尾，老宿主先命中老锚点、新锚点静默跳过，所以**同一份包在几个 rc 上行为一致**。

<a id="127-what"></a>

### 1.2.7 修了什么：补丁表扩到 131 条，容量类上限全面抬升

补丁表从 90 条扩到 **131 条**。新增的 41 条（#100–#140）改的不是行为，是**容量** —— 宿主出厂把各种输出、检索、并发、超时的预算压得很小，模型一旦真干活就频繁撞顶。每条只动一个常量或一个 schema 默认值，逻辑代码一行不改。

| 分组 | 条数 | 内容 |
|---|---|---|
| 输出体积 #100–#105 | 6 | 持久 shell 16KB→256KB、单次 shell 64KB→4MB、terminal 256KB→4MB、后台任务 2KB→256KB、workflow 50k→1M 字符、spill 12500→100000 token |
| 检索容量 #106 #131 | 2 | glob 100→1万条、grep 250→1万行；原始输出 20MB→200MB、超时 30s→180s、行宽 2KB→16KB |
| 并发与轮次 #107–#110 | 4 | 子代理 8→32、并行工具 10→24、目标续跑 256→4096、team 任务 256→4096 |
| 出网 #112 #113 #114 #136–#139 | 8 | fetch 5MB/30s→50MB/120s、正文 100k→2M 字符、重定向 5→20、web_search 10/10→50/20、MCP 60s/32KB→600s/256KB、重连 10→100 |
| 超时 #128–#130 | 3 | shell 120s→600s（上限 2400s）、持久 shell 300s→1800s、后台等待 600s→1800s |
| 会话与素材 #115–#119 #132–#135 | 10 | 会话搜索 20→100 页 / 100→1000 条、引用 64KB→1MB 与 3→32 个、图片边长 8192→16384、消息内图片 20→100 |
| 其他 #111 #120–#126 #140 | 9 | CUA 树深 25→200 / 元素 2000→2万、present 8→32、定时 60s→30s、office 8M→32M、AGENTS.md 1MB→16MB、压缩 80%/16%→95%/50% |

**顺带修掉一个真 bug。** `dsh-compaction-tool-result-pruner` 的 Config 是 `thresholdChars: z.number().default(DEFAULTS.thresholdChars)`，但 `dsh-base/cordis.patch.yml` 里**显式写了** `thresholdChars: 8192`。显式 config 优先于 schema default —— 所以 1.2.0 起 #19 把 DEFAULTS 抬到 16384 之后，运行时读到的仍然是 yml 的 8192，#19 在真机上等于没生效。新增的 #127 把 yml 一起抬到 50000/32768/8192，与 #19 对齐。

验证方式是先静态干跑再真机 apply：41 条全部命中、marker 全部能找到、二次应用无变化；真机第一次 applied 41 / failed 0，第二次 applied 0 / already 116（幂等）；34 个被改的 JS 文件 `node --check` 全过；7 个被改包的 `import()` 全部可加载；yml `yaml.parse` 通过。自检 9 组 **743 项** 全过。

<a id="126-what"></a>

### 1.2.6 修了什么：更新检查补上出网代理

仓库迁好之后更新能查了，但面板「最新版本」显示的是 `00ca3f4` —— 一串提交号。

原因是 `remotePackageVersion()` 拿 `package.json` 里 `version` 的四个源，在当前网络下直连全不通：

| 源 | 直连 | 走 `127.0.0.1:7897` |
|---|---|---|
| `cdn.jsdelivr.net` | `ECONNRESET` | 200 |
| `raw.githubusercontent.com` | `000` | 200 |
| `api.github.com`（未认证） | 403 配额用尽 | 200 |

而 `lib/update.js` 的 `requestBuffer()` 是纯 `https.request`，没有代理支持。于是 head 那条的
`version` 恒为空，`remoteVersion: lane.version || lane.sha` 就把提交号顶上去了。

现在 `requestBuffer()` 多一个可选 `socket` 参数（`undefined` 试代理 / `false` 直连 / 对象 用现成隧道），
`resolveProxy()` 按 环境变量 → Windows 注册表 `Internet Settings\ProxyServer` 的顺序取值，
只认 `http://` 形态，`socks` 跳过，代理挂了自动退回直连。

顺带补了一条降级：`describeLane()` 在 head 拿不到版本号时退到同频道最新 tag 的版本号，不再直接给提交号。

<a id="125-what"></a>

### 1.2.5 修了什么：项目迁到新账号

原 GitHub 账号 `devin667` 被停用，仓库与 Release 全部对外 404 —— 匿名访问
`/users/devin667` 与仓库都返回 Not Found，带 token 则是
`Sorry. Your account was suspended`。项目整体迁到 `Luckinchan7/dsh-purge-022`。

这一版只改字符串常量，不动任何宿主补丁。迁完之后新仓库已建、代码与标签推齐、Release 资产补齐。

### 改了哪些位置

| 文件 | 位置 |
|---|---|
| `lib/update.js` | `const REPO` 常量、报错示例文案 |
| `lib/redteam/ui.js` | `githubRepoOf()` 兜底值 |
| `client.js` | `welcome.repo` 中英文两处 |
| `package.json` | `repository` / `homepage` / `bugs` / `publishConfig` 共 6 处 |
| `README.md` / `README.zh-CN.md` | badge、链接、安装命令、更新源说明 |

### 内部标识一个没动

配置目录 `$DSH_HOME/dsh-purge`（`tuning.json` / `unpacked-asar.json` /
`refusal-log.jsonl` 都在这里）、路由前缀 `/dsh-purge/*`、Cordis section 名、
npm 包名 `dsh-purge-022` —— 全部保持原样，所以升级不会丢本地状态。

### 已经装过 1.2.x 的怎么办

什么都不用做。`readRepoOverride()` 读 `$DSH_HOME/dsh-purge/repo.json`，
没有该文件就走新常量。之前手动填过旧仓库名的，面板「更新源」一栏清空
→「保存更新源」即可回落默认。

完整说明见 [1.2.6 发行说明](docs/releases/RELEASE-NOTES-1.2.6.md)。

---

<a id="124-what"></a>

### 1.2.4 修的是什么：不再闪窗，换完包自己退场

**每 2 分钟闪一次的弹窗（真缺陷，1.2.1 引入）**。`schtasks /tr` 有 261 字符上限
（超了直接 `0x80004005`），而守卫完整命令行实测 496 字符，放不进去。1.2.1~1.2.3
用 `.cmd` 当中转，但 `.cmd` 由 Task Scheduler 拉起时**必然分配控制台** ——
任务每 2 分钟触发，就每 2 分钟在屏幕上闪一下黑框。

改成 `.vbs` + `CreateObject("WScript.Shell").Run cmd, 0, False`：走 wscript
（GUI 子系统），窗口样式 `0` = `SW_HIDE`；任务动作改为 `wscript.exe //B //Nologo`。
任务管理器里连 console 都不分配。

**换完包不退役（真缺陷，1.2.1 引入）**。守卫脚本第一句是
`if (-not (Test-Path $AsarPath)) { exit 0 }`，换包完成后每趟触发都立刻退出。
看起来无害，但那次触发本身已经发生：分配进程、闪一下窗口、什么都不做 ——
12 小时 × 每 2 分钟 = 360 次。

新增 `retireGuard(asar)`：删计划任务 + 锁 + deadline + VBS 启动器。
`queueIdleAsarSwap()` 开头判断 asar 还在不在，不在就直接退役并返回
`reason: "asar_already_swapped"`。

顺带两处：

| 修的东西 | 旧行为 | 现在 |
|---|---|---|
| `scheduleSealedDesktopRestart()` 的 `pending` | 无条件 `true` | `guarded?.queued === true`（守卫退役时不再谎报在等） |
| `lib/core.js` 排守卫 | 同时调 `queueIdleAsarSwap` 和 `scheduleAsarRenameWhenIdle` | 只留前者（后者是上一代长驻实现的重复执行者） |

### 1.2.3 修的是什么：换包守卫不再「报在等、其实没人」

1.2.1 的守卫是一个常驻 120 分钟的 PowerShell 循环。实测它会写下 `holders at start=7`
之后无声消失 —— Task Scheduler 的 `LastTaskResult` 仍是 0，日志里既没有 `timeout`
也没有 `abort`，说明没走正常退出路径。

而 `swapGuardPending()` 判活只依据锁文件 mtime 是否在 30 分钟内：进程死了、锁还在，
于是 `describeSwapState()` 一直返回 `pending: true`，面板一直显示「守卫在等客户端退出后自动切换」。
**用户当晚完全退出客户端，没有任何进程去换包。**

改成短周期轮询后：

| 项 | 1.2.1（旧） | 1.2.3（现在） |
|---|---|---|
| 任务形态 | `once` + 常驻 120 分钟循环 | `MINUTE /mo 2`，每 2 分钟一趟，限时 13 小时 |
| 单趟行为 | 循环里 `sleep 2; continue` | 判定一次就走：退净就换包，没退净写心跳退出 |
| 判活依据 | 锁 mtime < 30 分钟 | 锁 mtime < 6 分钟（3 个轮询周期） |
| 进程死了 | 锁还在 → 假 `pending` | 心跳过期 → `guardLost: true`，提示重新点应用 |
| 重排 | 30 分钟内不会重排 | 心跳过期就清锁重排 |

顺带修掉两个真 bug：`GUARD_PS1` 的 marker 正则四层转义（到 PowerShell 里永远不匹配，
恒报 `purge markers=False`）；`start /b` 让子进程继承了 cmd 的控制台生命周期。

### 1.2.2 修的是什么：更新源可切换 + 不再假报「已是最新」

**假报已最新（真缺陷，从有更新卡片起就存在）**。`describeLane()` 用
`hasRemote: Boolean(sha || versions.length)` 判断远端读没读到，而 `versions` 里混着
`ensureRunningVersion()` 补出来的本机条目（`kind: "local"`）。远端三个源全 404 时
`versions.length` 仍然 ≥ 1，于是 `hasRemote` 为真、不进「取不到远端」分支、`remoteVersion`
直接回填本机版本号 —— 账号被停用、仓库整个消失，面板照常显示「已是最新（1.2.1）」。

现在只把非 `local` 条目算作远端，读不到时置 `remoteUnreadable: true` 并说明原因：

| state | 判据 | 面板文案 |
|---|---|---|
| `missing` | 404，或 403 且 body 含 `account was suspended` | 账号被停用或仓库已改名，可换镜像 |
| `blocked` | 403 / 429 | API 限流或需要授权，稍后再试 |
| `offline` | 连不上 | 网络不通或代理没开 |

**换更新源**。`$DSH_HOME/dsh-purge/repo.json` 存 `{ repo, at }`，`activeRepo()` 优先读它、
非法值回落到内置常量；13 处 URL 模板（codeload zip/tar、raw、jsdelivr、api commits/tags/contents）
全部改用 `activeRepo()`。面板更新卡片下面多一行「更新源」输入框 + 保存 + 恢复默认，
改完立刻重探一次，成不成当场看得到。

**改名遗留**。1.2.0 把包名改成 `dsh-purge-022`，但 `findPurgeProfiles()` 还在查
`dependencies["dsh-purge"]`、`profilePluginDir()` 只找 `node_modules/dsh-purge`，改名后
永远返回空数组，更新计划退化成「只更新当前这份 checkout」。现在两种包名都认。

### 1.2.1 修的是什么：让「已写入」真的变成「已生效」

官方桌面把宿主装在 `resources/app.asar` 里，Electron 的解析顺序是

```
app.asar  →  app  →  default_app.asar
```

`app.asar` 一定赢。补丁写进 `resources/app` 之后，只要 asar 还在，进程加载的仍然是旧代码 —— 面板显示「67 / 67 已写入」是真的，但代码层一条补丁都没在跑。

而 `app.asar` 被运行中的进程独占锁定：

```
[IO.File]::Move('app.asar','app.asar.bak')
→ The process cannot access the file because it is being used by another process
```

换包只能在「客户端已经完整退出」的那个窗口里做。旧实现有两处洞，合起来让这个窗口永远抓不到：

1. `lib/core.js` 的 `scheduleSealedDesktopRestart()` 在进程内直接 `renameSync`，必然 busy，然后没有下文；
2. 唯一的空闲兜底只挂在启动自愈上，而桌面密封 surface 的启动自愈被 `lib/settle-policy.js` 的 `settleMayReapply({surface:"desktop",sealed:true}) → false` 禁掉了。

于是点了「应用」，补丁写完了，asar 一动不动；重启多少次都一样，因为**重启不会让 asar 消失**。

修法是新增 `lib/asar-guard.js`，一个活在进程树之外的换包守卫：

| 步骤 | 做什么 |
|---|---|
| 1 | 用 `schtasks` 起独立计划任务（`/tr` 指向一个 .cmd 启动器，绕开 261 字符上限），再拉起 PowerShell。宿主退出、被强杀都不影响它 |
| 2 | 等安装根下**所有**进程消失（默认最多 120 分钟，只认 `ExecutablePath` 落在安装根下的进程，不误伤同名程序） |
| 3 | 校验 `resources/app` 健康（`package.json` 在、`dsh/node_modules/@deepseek-ai` 在）。**不健康就原地放弃** —— 宁可跑旧包，也不能让客户端起不来 |
| 4 | 需要时把 `app.asar.unpacked` 里的原生模块 `robocopy` 叠进 `app` 树 |
| 5 | `Move-Item app.asar → app.asar.bak`，重开 exe。asar 挪走后 Electron 自然落到 `resources/app`，补丁这才开始跑 |

接线三处，任何一条路径都能排出守卫：

| 位置 | 行为 |
|---|---|
| `lib/core.js` `scheduleSealedDesktopRestart()` | asar busy 时不再静默放弃，排守卫并回传 `guard` 结果 |
| `lib/index.js` `/dsh-purge/apply` | apply 成功 + 密封 + 有 handoff → 排守卫；响应新增 `asar_swap_guard` / `swap_state` |
| `lib/index.js` `/dsh-purge/restart` | 强退换包的同时也排守卫做兜底 |

面板口径也跟着分开，不再把「已写入」读成「已生效」：

| `swap_state` | 面板显示 |
|---|---|
| `live` | 67 / 67 已写入 |
| `written_not_live` | 已写入，要完全退出客户端才生效（守卫已排上时写「守卫在等客户端退出后自动切换」） |
| `no_asar` | 非桌面 / 还没定位到 asar |

**升级后怎么生效**：装 1.2.7 → 面板点「应用」→ **完全退出** DeepSeek Harness（窗口关掉不够，托盘也要退）→ 守卫挪走 asar 并自己把客户端拉起来 → 这次加载的是 `resources/app`。不想等就点「重启」，走强退路径立刻换包，守卫作为兜底留着。回滚只需把 `resources/app.asar.bak` 改回 `app.asar`。

### 1.2.0：可查更新 + 一键升级（包名改为 dsh-purge-022）

DSH 的插件面板「版本 / 重新检查 / 更新到 x.y.z」只认 **npm registry 上的包名 + semver range**：

```js
// dsh-plugin-manager/lib/index.js
const parsed = parsedForRegistry(bundle.source);
if (parsed.kind !== "registry" || parsed.name !== bundle.name || parsed.range?.includes(":") === true)
  return bundle.name + " is installed neither from a registry under its own name nor from a Git commit";
```

`file:` 本地 tarball 与 GitHub 安装都拿不到版本列表（后者直接回 `is installed from Git, which lists no versions`）。而 `dsh-purge` 这个 npm 名已被他人占用（`panda11445` 的 `0.0.0-stage` stub 占位包），故改名为 **`dsh-purge-022`**。

**两类 "dsh-purge" 分开处理：**

| 类型 | 举例 | 处理 |
| --- | --- | --- |
| 包名 / Cordis 模块名 | `package.json` name、`cordis.patch.yml` 的 `name:`、profile `bundles`、`client.js` 模块 id、`bin` | 改成 `dsh-purge-022` |
| 内部标识 | `$DSH_HOME/dsh-purge` 配置目录、section 名、`/dsh-purge/*` 路由、组合 `id: dsh-purge*` | **保持原名** |

第二类不能改 —— 改了老用户的 `tuning.json` / `unpacked-asar.json` / `refusal-log.jsonl` 全部失联。

版本号同时从 `1.1.71-rc2.14.2` 改为 `1.2.0`：带 prerelease 段会被面板的 `versionsNoneInstallable` 当成预发布过滤掉，更新链会断。

内置的更新检查读本仓库的 GitHub Release（`lib/update.js` 的 `checkUpdate()` / `applyUpdate()` / `switchChannel()` / `switchVersion()`），不依赖 npm。1.2.2 起更新源可切换，远端读不到会明确报原因而不是报「已是最新」。当年账号封停时的实测（历史记录）：

```
ok:true  hasUpdate:false  remoteUnreadable:true
error: 更新源 Luckinchan7/dsh-purge-022 打不开 HTTP 404：账号被停用或仓库已改名。可在面板把更新源换成镜像仓库。
repo:  Luckinchan7/dsh-purge-022  override:false
```

换成可读镜像后立刻恢复：

```
ok:true  hasUpdate:false  repo: nodejs/node  override:true  remoteUnreadable:false
```

迁到 `Luckinchan7` 之后，默认源直接可用：

```
ok:true  hasUpdate:false  localVersion:1.2.7  remoteVersion:1.2.7  via:git
repo:  Luckinchan7/dsh-purge-022  override:false
```

老用户升级时 profile 里会新旧并存（两份都带 `id: dsh-purge`，Cordis 报 already queued，宿主起不来）。`lib/self-insert.js` 的 `removeLegacyRegistrations()` 在启动时自动清理：摘掉 `bundles` / `dependencies` 里的旧名、删 `node_modules/dsh-purge`、把 `cordis.patch.yml` 里的 `name: dsh-purge` 就地改成新包名。

### 本版补丁表做了什么

| 类别 | 数量 | 说明 |
|---|---|---|
| 换锚点（0.2.2-rc.1） | 15 条 | #12 #14 #17 #40 #45 #47 #49 #54 #57 #60 #62 #67 #74 #82 #87 |
| 重写锚点（0.2.2-rc.1） | 3 条 | #32 #53 #77 —— 上游放弃了，这里按 0.2.2 原文补上 |
| 追加锚点（0.2.2-rc.3） | 4 条 | #13 #18 #35 #62 —— rc.3 改了异常类型、删了分支、改用辅助函数 |
| 退役 | 3 条 | #80（minimal 预设自带完整工具行）、#56 #77（宿主已删除 rewind 功能） |
| 红队预设 | 删死行 | `list-agents` 子路径在 0.2.2 被删，留着会让整个预设 `registered-broken` |

补丁的 `id`、顺序、展示分组、`cordis.patch.yml` 配置项**一个没动**。表内共 **90 条**，实际可写入的取决于宿主版本。

**rc.5 没有改动任何锚点。** 逐条实测：90 条里 70 条可直接改写、5 条已是幂等状态、15 条目标缺失（14 条带 `optional`）。1261 个宿主 JS 文件语法体检全通过。

### 之前修过、仍然有效的几处

- **#73 的 marker 被 #70 顶掉**。#73 负责删 bash 工具描述里的 `* Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.`，原来挂着 #70 的 marker 并设 `skipIfMarked`，但 #70 只改 `persistent-pwsh` 段，那句在 `persistent-bash` 段里原封不动 → 面板显示 already、实际没删。改成去 `skipIfMarked`、无条件执行，加 `softSettle: true`。
- **#45 里写死的旧包名**。改名到 `dsh-purge-022` 后，宿主里的 `dshPurgeHandoffDesktopUpdate` 找不到 `node_modules/dsh-purge/lib/official-update.wscript`，官方更新会静默回落到 `quitAndInstall`。改为新名优先、旧名兜底的四条路径。
- **applyPatchesAllHosts 误洗 npx 宿主**。`findAiBaseWeb()` 顺着 profile 向上 require 会落到 npx 缓存里那份 8 月遗留的 0.1.0-rc.6，锚点对不上 → 硬失败 → 整体回滚，连桌面那份一起。改为桌面 surface 下只处理 `desktop.isInsideDesktopInstall()` 为真的宿主。

### 安装

**方式一：Release tarball（最稳）**

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.7/dsh-purge-022-1.2.7.tgz
```

本地文件同理：

```powershell
$p = "$env:USERPROFILE\.dsh\profiles\desktop"
npm install --prefix $p --save --ignore-scripts `
  "$p\.local-packages\dsh-purge-022-1.2.7.tgz"
```

**方式二：面板一键升级**。已经装过 1.2.x 的，打开插件面板 →「重新检查」→「更新」。
更新源默认就是 `Luckinchan7/dsh-purge-022`，不用改。想换镜像就在「更新源」一栏填 `owner/repo` →「保存更新源」。

**方式三：手动**。解包到 `~/.dsh/profiles/desktop/node_modules/dsh-purge-022`，然后

```bash
node ~/.dsh/profiles/desktop/node_modules/dsh-purge-022/scripts/ensure-profile-bundle.mjs
```

装完**完全退出宿主**（托盘也退）再打开，在会话标题旁点 **dsh-purge → 清洗 → 应用**。

> npm registry 上的 `dsh-purge-022` 目前还没有发布（`www.npmjs.com` 对当前 IP 做人机验证拦截）。所以 `dsh plugin add dsh-purge-022` 这种 registry 安装暂时不可用，走上面的 tarball 或面板升级。

### 已知限制

- `#56 #77` 在 **0.2.2-rc.3 及以后不可用** —— 宿主已删除 rewind 功能，不是补丁的问题。
- `#45 #46 #82 #83 #84` 要 `detectSurface()` 认真实桌面安装位；纯解包树里显示 `na`，属预期。
- `@deepseek-ai/dsh-workflow-worker-thread` 在 rc.3 及以后不存在，红队预设里那一行是 `disabled: true`，不影响注册。
- **代码层补丁必须换包才生效**（见上文 1.2.1 节）。提示词层（破甲文案）不走 asar，装好就活。
- macOS 未实测。

### 界面预览

> 截图来自上游 1.1.31，面板布局与配置项在 1.2.x 保持不变；截图里的版本号不是本版。

| 面板 | 规则总览 |
|---|---|
| ![dock](docs/preview/dock-clean.png) | ![rules](docs/preview/rules.png) |

| 设置 | 演练台 |
|---|---|
| ![settings](docs/preview/settings.png) | ![drill](docs/preview/dock-drill.png) |

### 自检

```
verify-rc213          26 passed    content 形状 / 漏 import / 修剪器 413
verify-rc214           6 passed    #73 纯删除与 marker
verify-rc2142          9 passed    #71 缺席宿主 / 面板口径
verify-rc120          22 passed    包名迁移 / engines / 自愈
verify-migration      21 passed    旧包名清理
verify-migration-yaml  8 passed    cordis.patch.yml 结构
verify-rc215          64 passed    空闲换包守卫（9 项真跑）+ .vbs 静默 + 换完退役
verify-rc216          64 passed    更新源 / 假报已最新 / 两种包名 / 出网代理
                     ─────────
                     220 项全过
```

`verify-rc216` 里那几项联网断言：

- 探一个不存在的仓库时 `probeRepo` 必须报 `missing`/`404`，不能报 `ok`（网络抖动时允许降级成 `offline`，此时跳过状态码断言）
- 该状态下 `checkUpdate` 必须置 `remoteUnreadable: true`、`hasRemote: false`，且 `remoteVersion` 不回填本地版本
- 默认源 `Luckinchan7/dsh-purge-022` 可读：`hasRemote: true`、`remoteVersion: "1.2.7"`
- 换成 `nodejs/node` 后 `hasRemote` 恢复、`override: true`
- 恢复默认后 `repo.json` 被删、`override: false`

`verify-rc215` 里真跑的那 9 项：

- 进程持有时 asar 原地不动、不留 `.bak`、日志报 `holders at start>=1`
- 进程退净后 asar 被挪走、留 `.bak`、日志记 `health ok` / `asar moved`
- `resources/app` 不健康时 asar 保留、不产生 `.bak`、日志明确 `ABORT`
- 守卫 PS1 通过 PowerShell `Parser::ParseFile`

### 文档

- [1.2.7 发行说明](docs/releases/RELEASE-NOTES-1.2.7.md) —— #100–#140 容量补丁与 #19 失效根因
- [1.2.6 发行说明](docs/releases/RELEASE-NOTES-1.2.6.md) —— 迁到新账号的完整说明
- [1.2.4 发行说明](docs/releases/RELEASE-NOTES-1.2.4.md) —— 换包守卫假 pending 的完整来龙去脉
- [1.2.2 发行说明](docs/releases/RELEASE-NOTES-1.2.2.md) —— 更新源切换与假报已最新
- [1.2.1 发行说明](docs/releases/RELEASE-NOTES-1.2.1.md) —— 空闲换包守卫
- [适配说明 docs/COMPAT-0.2.2.md](docs/COMPAT-0.2.2.md) —— 锚点前后对照、红队预设 broken 根因与修法
- [变更日志 docs/CHANGELOG.md](docs/CHANGELOG.md) —— 完整变更链
- [中文详解 README.zh-CN.md](README.zh-CN.md) —— 安装、三套预设、排错、路径探测

---

## English

A fork of `dsh-purge 1.1.71` that aligns the patch table with **DeepSeek Harness 0.2.2**, and fixes a few link-level defects that made patches land on disk without ever running.

Same patch ids, same order, same display groups, same config keys as upstream.

### Supported hosts

| Host | Use |
|---|---|
| **0.2.2-rc.5** | **this release (1.2.7)** |
| 0.2.2-rc.3 / rc.1 | 1.2.1 (backward compatible) |
| 0.2.1 series | [1.1.71-rc2.1](https://github.com/evan545295555-hash/Evans-repo) |

The compat layer is **append-only**: new anchors go to the end of the existing `replacements` array. On an older host the original anchor matches first and the new ones are skipped silently — one package behaves identically across rc releases.

<a id="126-what"></a>

### 1.2.7 fixes: the patch table grows to 131 entries and every capacity cap gets room

The patch table grows from 90 to **131 entries**. The 27 new ones listed in the request (plus 14 more I added) change **capacity**, not behaviour — the host ships with very small budgets for output, search, concurrency and timeouts, so a model that actually works hits them constantly. Each entry moves one constant or one schema default; no logic is rewritten.

| Group | Count | What |
|---|---|---|
| Output volume #100–#105 | 6 | persistent bash 16KB→256KB, one-shot bash 64KB→4MB, terminal 256KB→4MB, job inline 2KB→256KB, workflow 50k→1M chars, spill 12500→100000 tokens |
| Search capacity #106 #131 | 2 | glob 100→10k, grep 250→10k; raw output 20MB→200MB, timeout 30s→180s, line width 2KB→16KB |
| Concurrency #107–#110 | 4 | subagents 8→32, parallel tools 10→24, goal rounds 256→4096, team tasks 256→4096 |
| Network #112 #113 #114 #136–#139 | 8 | fetch 5MB/30s→50MB/120s, body 100k→2M chars, redirects 5→20, web_search 10/10→50/20, MCP 60s/32KB→600s/256KB, reconnect 10→100 |
| Timeouts #128–#130 | 3 | bash 120s→600s (ceiling 2400s), persistent bash 300s→1800s, job wait 600s→1800s |
| Sessions and media #115–#119 #132–#135 | 10 | session search 20→100 per page / 100→1000 per call, references 64KB→1MB and 3→32, image edge 8192→16384, images per message 20→100 |
| Rest #111 #120–#126 #140 | 9 | CUA depth 25→200 / elements 2000→20k, present 8→32, schedule 60s→30s, office 8M→32M, AGENTS.md 1MB→16MB, compaction 80%/16%→95%/50% |

**One real bug fell out of this.** `dsh-compaction-tool-result-pruner` declares `thresholdChars: z.number().default(DEFAULTS.thresholdChars)`, but `dsh-base/cordis.patch.yml` sets it **explicitly** to `8192`. Explicit config outranks a schema default — so patch #19, which raised DEFAULTS to 16384 back in 1.2.0, never took effect on a real install; anything over 8KB was still pruned. New patch #127 raises the yml to 50000/32768/8192 so it agrees with #19.

Verification: a dry run first (every pattern hits, every marker is findable in the output, a second pass changes nothing), then a real apply — first pass applied 41 / failed 0, second pass applied 0 / already 116 (idempotent), 34 modified JS files pass `node --check`, 7 modified packages `import()` cleanly, the yml parses. Self-check: 9 groups, **743 assertions**, all green.

### 1.2.6 fixes: the updater can reach GitHub again

Once the repository moved, updates could be checked — but the panel's "latest" field showed `00ca3f4`, a raw commit hash.

`remotePackageVersion()` tries four sources for the `version` field in `package.json`. On this network every one of them fails when connecting directly:

| Source | Direct | Via `127.0.0.1:7897` |
|---|---|---|
| `cdn.jsdelivr.net` | `ECONNRESET` | 200 |
| `raw.githubusercontent.com` | `000` | 200 |
| `api.github.com` (unauthenticated) | 403, quota exhausted | 200 |

`requestBuffer()` in `lib/update.js` was plain `https.request` with no proxy support at all, so the head row's `version` stayed empty and `remoteVersion: lane.version || lane.sha` fell through to the commit hash.

`requestBuffer()` now takes an optional `socket` argument — `undefined` means "try the proxy", `false` means "direct this round", an object means "reuse this CONNECT tunnel". `resolveProxy()` reads env vars first, then `Internet Settings\ProxyServer` from the Windows registry, accepts only `http://` form, skips `socks`, and falls back to a direct connection when the proxy is unreachable.

Also fixed a fallback that leaked hashes: `describeLane()` now drops to the newest tag version on that channel when the head row has no version, instead of leaving it empty.

<a id="125-what"></a>

### 1.2.5 fixes: the project moved to a new account

The original GitHub account `devin667` was suspended. The repository and every
Release asset return 404 — anonymous access to `/users/devin667` and the repo both
give Not Found, and an authenticated call returns `Sorry. Your account was suspended`.
The project now lives at `Luckinchan7/dsh-purge-022`.

This release changes string constants only. No host patch is touched. After the move the new
repository is live, all 20 tags are pushed and every Release carries its assets.

| File | What changed |
|---|---|
| `lib/update.js` | the `REPO` constant and the error example text |
| `lib/redteam/ui.js` | `githubRepoOf()` fallback value |
| `client.js` | `welcome.repo`, both locales |
| `package.json` | `repository` / `homepage` / `bugs` / `publishConfig` (6 spots) |
| `README.md` / `README.zh-CN.md` | badges, links, install commands, update-source notes |

Internal identifiers are untouched — config dir `$DSH_HOME/dsh-purge`, route prefix
`/dsh-purge/*`, Cordis section names, npm package name `dsh-purge-022` — so upgrading
loses no local state.

If you already run 1.2.x, do nothing. `readRepoOverride()` reads
`$DSH_HOME/dsh-purge/repo.json`; when that file is absent the new constant applies.
Clear the Update source field and save to drop a manually pinned old value.

See [1.2.7 release notes](docs/releases/RELEASE-NOTES-1.2.7.md).

---

### What 1.2.4 fixes: no more flashing console, and the guard retires itself

**A console flashing every 2 minutes (real defect, introduced in 1.2.1).** `schtasks /tr`
caps at 261 characters (over that it fails with `0x80004005`), while the guard's full command
line measures 496. Versions 1.2.1–1.2.3 used a `.cmd` shim — but Task Scheduler always gives
a `.cmd` a console, so every 2-minute tick flashed a black box on screen.

Switched to `.vbs` with `CreateObject("WScript.Shell").Run cmd, 0, False`: it goes through
wscript (GUI subsystem), window style `0` is `SW_HIDE`, and the task action is now
`wscript.exe //B //Nologo`. Task Manager shows no console at all.

**The guard never retired (real defect, introduced in 1.2.1).** Its first statement is
`if (-not (Test-Path $AsarPath)) { exit 0 }`, so once the swap is done every tick exits
immediately. Sounds harmless — but the tick itself already happened: process allocated,
window flashed, nothing done. 12 hours × every 2 minutes = 360 times.

New `retireGuard(asar)` deletes the scheduled task, the lock, the deadline, and the VBS
launcher. `queueIdleAsarSwap()` now checks up front whether the asar is still there and
returns `reason: "asar_already_swapped"` instead of creating anything.

Two more, fixed in passing:

| Fix | Old behaviour | Now |
|---|---|---|
| `pending` in `scheduleSealedDesktopRestart()` | always `true` | `guarded?.queued === true` (no more lying when the guard retires) |
| guard scheduling in `lib/core.js` | called both `queueIdleAsarSwap` and `scheduleAsarRenameWhenIdle` | only the former (the latter is a duplicate from the previous resident-loop generation) |

### What 1.2.3 fixes: the swap guard no longer claims to be waiting when nothing is

The 1.2.1 guard was a resident 120-minute PowerShell loop. Measured on a real install, it
logged `holders at start=7` and then vanished silently — Task Scheduler's `LastTaskResult`
stayed 0, and the log had neither `timeout` nor `abort`, so it never took a normal exit path.

Meanwhile `swapGuardPending()` decided liveness from one thing only: whether the lock file's
mtime was within 30 minutes. Dead process, lock still there, so `describeSwapState()` kept
returning `pending: true` and the panel kept saying the guard was waiting. **The user fully
quit the app that evening and nothing swapped the asar.**

| | 1.2.1 (old) | 1.2.3 (now) |

|---|---|---|
| Task shape | `once` + resident 120-min loop | `MINUTE /mo 2`, one tick every 2 min, 13 h cap |
| Per tick | `sleep 2; continue` inside the loop | Decide once: swap if clear, else heartbeat and exit |
| Liveness | lock mtime < 30 min | lock mtime < 6 min (3 poll cycles) |
| Guard died | lock remains → fake `pending` | heartbeat expires → `guardLost: true`, re-arm prompt |
| Re-arm | blocked for 30 minutes | stale heartbeat clears the lock and re-queues |

Two real bugs fixed along the way: the `GUARD_PS1` marker regex was escaped four times
(which reaches PowerShell as "backslash + character class" and never matches, so it always
reported `purge markers=False`), and the `.cmd` shim used `start /b`, letting the child
inherit the cmd console lifetime.

### What 1.2.2 fixes: switchable update source, and no more fake "up to date"

`describeLane()` decided whether the remote was readable with
`hasRemote: Boolean(sha || versions.length)` — but `versions` includes the local row that
`ensureRunningVersion()` synthesizes (`kind: "local"`). With all three remote sources returning
404, `versions.length` was still ≥ 1, so `hasRemote` stayed true, the "remote unreadable" branch
never ran, and `remoteVersion` fell back to the local version string. A suspended account with a
fully vanished repo still rendered "Up to date (1.2.1)".

Now only non-`local` rows count as remote; when the remote is unreadable the result carries
`remoteUnreadable: true` plus a reason that distinguishes the three cases:

| state | Signal | Message |
|---|---|---|
| `missing` | 404, or 403 whose body contains `account was suspended` | account suspended or repo renamed — point it at a mirror |
| `blocked` | 403 / 429 | rate-limited or needs auth, retry later |
| `offline` | cannot connect | network or proxy down |

`$DSH_HOME/dsh-purge/repo.json` holds `{ repo, at }`; `activeRepo()` prefers it and falls back to
the built-in constant on invalid input. All 13 URL templates (codeload zip/tar, raw, jsdelivr,
api commits/tags/contents) now use `activeRepo()`. The panel grows an update-source input plus
Save and Reset; saving re-probes immediately so the result is visible right away.

Also fixed: `findPurgeProfiles()` and `profilePluginDir()` still only recognized the pre-1.2.0
package name, so after the rename the update plan silently degraded to "update this checkout only".

### What 1.2.1 fixes: "written" becoming "live"

The official desktop ships the host inside `resources/app.asar`. Electron resolves

```
app.asar  →  app  →  default_app.asar
```

so `app.asar` always wins. Once patches were written into `resources/app`, the running process still loaded the old code — the panel saying "67 / 67 written" was true, and so was the fact that zero code patches were running.

`app.asar` is exclusively locked by the running process:

```
[IO.File]::Move('app.asar','app.asar.bak')
→ The process cannot access the file because it is being used by another process
```

The swap can only happen inside the window where the app has fully quit. The old code had two holes that made that window unreachable:

1. `scheduleSealedDesktopRestart()` in `lib/core.js` called `renameSync` in-process, always hit busy, and then did nothing further;
2. the only idle fallback hung off startup self-healing, which `lib/settle-policy.js` disables for the sealed desktop surface (`settleMayReapply({surface:"desktop",sealed:true}) → false`).

So "Apply" wrote the patches, `app.asar` never moved, and restarting never helped — **restarting does not make the asar go away.**

The fix is `lib/asar-guard.js`, a swap guard that lives outside the process tree:

| Step | What it does |
|---|---|
| 1 | Launches via `schtasks` (a `.cmd` launcher avoids the 261-char `/tr` limit), which then runs PowerShell. Survives the host quitting or being killed |
| 2 | Waits for **every** process under the install root to disappear (120 min default; only matches `ExecutablePath` under that root) |
| 3 | Verifies `resources/app` is healthy (`package.json` present, `dsh/node_modules/@deepseek-ai` present). **Bails out in place if not** — running the old bundle beats a client that won't start |
| 4 | Overlays native modules from `app.asar.unpacked` via `robocopy` when needed |
| 5 | `Move-Item app.asar → app.asar.bak`, relaunches the exe. Electron now falls through to `resources/app` and the patches finally run |

Wired into three places: `scheduleSealedDesktopRestart()` queues the guard when the asar is busy, `/dsh-purge/apply` queues it on a successful apply of a sealed install, and `/dsh-purge/restart` queues it as a backstop behind the forced-kill path.

The panel now separates the two states instead of reporting only "written":

| `swap_state` | Panel |
|---|---|
| `live` | 67 / 67 written |
| `written_not_live` | Written — quit the app fully to take effect (or: guard is waiting for the app to quit, then swaps) |
| `no_asar` | Not the desktop app / asar not located |

**To take effect:** install 1.2.7 → click Apply → **fully quit** DeepSeek Harness (closing the window is not enough, quit from the tray too) → the guard moves the asar and relaunches → this boot loads `resources/app`. Clicking Restart forces the swap immediately, with the guard still standing by. Rollback is just renaming `resources/app.asar.bak` back to `app.asar`.

### 1.2.0: in-panel update check (package renamed to dsh-purge-022)

DSH's plugin panel only lists versions for **a registry install under the bundle's own name**:

```js
const parsed = parsedForRegistry(bundle.source);
if (parsed.kind !== "registry" || parsed.name !== bundle.name || parsed.range?.includes(":") === true)
  return bundle.name + " is installed neither from a registry under its own name nor from a Git commit";
```

`file:` tarballs and Git installs list nothing (the latter returns `is installed from Git, which lists no versions`). The npm name `dsh-purge` is already taken by someone else's `0.0.0-stage` stub, hence `dsh-purge-022`.

**Two kinds of "dsh-purge" are handled differently:**

| Kind | Examples | Action |
| --- | --- | --- |
| Package / Cordis module name | `package.json` name, `cordis.patch.yml` `name:`, profile `bundles`, `client.js` module id, `bin` | renamed to `dsh-purge-022` |
| Internal identifiers | `$DSH_HOME/dsh-purge` config dir, section names, `/dsh-purge/*` routes, composition `id: dsh-purge*` | **left alone** |

The second kind must not change — renaming them orphans existing `tuning.json` / `unpacked-asar.json` / `refusal-log.jsonl`.

The version also went from `1.1.71-rc2.14.2` to `1.2.0`: a prerelease segment gets filtered out by the panel's `versionsNoneInstallable`, breaking the update chain.

The built-in updater reads this repo's GitHub Releases (`checkUpdate()` / `applyUpdate()` / `switchChannel()` / `switchVersion()` in `lib/update.js`) and does not depend on npm. From 1.2.2 the source is switchable, and an unreadable remote reports why instead of claiming "up to date". Measured while the account was still suspended (historical):

```
ok:true  hasUpdate:false  remoteUnreadable:true
error: update source Luckinchan7/dsh-purge-022 returned HTTP 404 — account suspended or repo renamed
repo:  Luckinchan7/dsh-purge-022  override:false
```

After the move to the new account the same call against the default source returns:

```
ok:true  hasUpdate:false  remoteUnreadable:false
localVersion: 1.2.7   remoteVersion: 1.2.7   via: "git"
localSha: 00ca3f4     remoteSha: 00ca3f4
```

Pointing it at a readable mirror restores the check immediately:

```
ok:true  hasUpdate:false  repo: nodejs/node  override:true  remoteUnreadable:false
```

### Patch table

| Category | Count | Notes |
|---|---|---|
| Re-anchored (0.2.2-rc.1) | 15 | #12 #14 #17 #40 #45 #47 #49 #54 #57 #60 #62 #67 #74 #82 #87 |
| Rewritten anchors | 3 | #32 #53 #77 — dropped upstream, rebuilt from 0.2.2 source |
| Appended anchors (0.2.2-rc.3) | 4 | #13 #18 #35 #62 |
| Retired | 3 | #80, #56, #77 |

Patch ids, order, display groups and config keys are unchanged. **90 entries in the table.** rc.5 changed no anchors: of the 90, 70 rewrite directly, 5 are already idempotent, 15 target missing files (14 marked `optional`). All 1,261 host JS files pass a syntax check.

### Install

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.7/dsh-purge-022-1.2.7.tgz
```

Or, if already on 1.2.x: plugin panel → Check again → Update. The update source defaults to
`Luckinchan7/dsh-purge-022` and needs no change; to point it at a mirror, type `owner/repo` into
the "update source" field and save.

Then **fully quit the host** (tray included), reopen, and click **dsh-purge → Clean → Apply**.

> `dsh-purge-022` is not on npm yet (`www.npmjs.com` challenges the current IP), so a plain `dsh plugin add dsh-purge-022` registry install will not resolve. Use the tarball or the in-panel updater.

### Verified

```
verify-rc213          26 passed
verify-rc214           6 passed
verify-rc2142          9 passed
verify-rc120          22 passed
verify-migration      21 passed
verify-migration-yaml  8 passed
verify-rc215          64 passed   (9 of them execute the real guard)
verify-rc216          64 passed   (live probe + repo switch + proxy egress)
                     ─────────
                      220 passed, 0 failed
```

### License

MIT. Upstream: 小杨 (original dsh-purge), 巴里啊啊 (0.2.1-rc.2 compat branch), 555bbbAAA (0.2.2 anchors).

### Docs

- [RELEASE-NOTES-1.2.4.md](docs/releases/RELEASE-NOTES-1.2.4.md) — the fake-pending swap guard
- [RELEASE-NOTES-1.2.2.md](docs/releases/RELEASE-NOTES-1.2.2.md) — switchable source and the fake up-to-date bug
- [RELEASE-NOTES-1.2.1.md](docs/releases/RELEASE-NOTES-1.2.1.md) — the idle-swap story
- [docs/COMPAT-0.2.2.md](docs/COMPAT-0.2.2.md) — before/after anchors, red-team preset `registered-broken` root cause
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — full change chain
