# 1.2.1 — 让「已写入」真的变成「已生效」

这一版只修一个东西：**补丁写进了磁盘，但客户端跑的还是旧包。**

## 问题

官方桌面把宿主装在 `resources/app.asar` 里。Electron 的解析顺序是

```
app.asar  →  app  →  default_app.asar
```

`app.asar` 一定赢。所以补丁写进 `resources/app` 之后，只要 asar 还在（哪怕同目录下 `app` 已经是打过补丁的那份），进程加载的仍然是旧代码：

- 面板显示「67 / 67 已写入」——这是真的；
- 实际运行的是没打补丁的宿主——这也是真的；
- 于是提示词层（破甲文案）在跑，代码层 70 多条补丁一条都没生效。

而 `app.asar` 被运行中的进程**独占锁定**，实测：

```
[IO.File]::Move('app.asar','app.asar.bak')
→ The process cannot access the file because it is being used by another process
```

也就是说：换包只能发生在「客户端已经完整退出」的那个窗口里。

旧实现有两个洞，合起来导致这个窗口永远抓不到：

1. `lib/core.js` 的 `scheduleSealedDesktopRestart()` 在进程内直接 `renameSync`。必然 busy，然后就没有下文了。
2. 唯一的空闲兜底 `scheduleAsarRenameWhenIdle()` 只挂在 `lib/reapply.js` 的启动自愈上，而桌面密封 surface 的启动自愈被 `lib/settle-policy.js` 的 `settleMayReapply({surface:"desktop", sealed:true}) → false` 禁掉了（原因是不想和 Electron 的 `Fiber._reload` 抢锁）。

结果：点「应用」时补丁写完了，asar 一动不动；用户重启多少次都一样，因为重启不会让 asar 消失。

## 修法

新增 `lib/asar-guard.js`，一个**活在进程树之外**的换包守卫：

1. 用 `schtasks` 起一个独立计划任务（`/tr` 指向一个 .cmd 启动器，绕开 261 字符上限），任务再拉起 PowerShell 脚本。宿主退出、被强杀都不影响它。
2. 守卫等安装根下**所有**进程消失（默认最多 120 分钟，只认 `ExecutablePath` 落在安装根下的进程，不会误伤同名程序）。
3. 进程退净后校验 `resources/app` 健康：`package.json` 在、`dsh/node_modules/@deepseek-ai` 在。**不健康就原地放弃**——宁可继续跑旧包，也不能让客户端起不来。
4. 需要时把 `app.asar.unpacked` 里的原生模块 `robocopy` 叠进 `app` 树（实测 20 个 `.node`/`.dll`，20/20 已存在，不会重复拷）。
5. `Move-Item app.asar → app.asar.bak`，重开 exe。asar 挪走后 Electron 自然落到 `resources/app`，补丁这才开始跑。

接线三处，任何一条路径都能排出守卫：

| 位置 | 行为 |
|---|---|
| `lib/core.js` `scheduleSealedDesktopRestart()` | asar busy 时**不再静默放弃**，排守卫并回传 `guard` 结果 |
| `lib/index.js` `/dsh-purge/apply` | apply 成功 + 密封 + 有 handoff → 排守卫；响应新增 `asar_swap_guard` / `swap_state` |
| `lib/index.js` `/dsh-purge/restart` | 强退换包的同时也排守卫做兜底（强退 PS1 有静默失败的历史） |

## 面板口径

以前只有一个「已写入」，容易被读成「已生效」。现在 `swap_state` 分开报三种：

| state | 含义 |
|---|---|
| `live` | 补丁在跑（asar 已挪走，或本来就不是密封包） |
| `written_not_live` | 补丁写好了，asar 还在，进程跑的是旧包 |
| `no_asar` | 非桌面 / 还没定位到 asar |

`pending` 为真时说明守卫已经在等退出，届时自动换包并重开。面板上写成「已写入，守卫在等客户端退出后自动切换」。

## 顺带修掉的遗留缺陷

`lib/core.js:4331` 生成的宿主补丁（#45 `OFFICIAL_DESKTOP_UPDATE_HANDOFF`）里，模板路径写死成 `node_modules/dsh-purge/lib/official-update.wscript`。包名改成 `dsh-purge-022` 之后这条路径不存在了 → 宿主里的 helper 找不到模板，官方更新会静默回落到 `quitAndInstall`。

改为新名优先、旧名兜底的四条路径；`lib/compat-0.2.2.js` 里覆盖的那一份同步改。老安装的宿主缺新路径指纹，补丁会自己重跑一次把它写进去。

## 自检

`verify-rc215.mjs` 42 项，其中 9 项是真跑：

- 进程持有时 asar 原地不动、不留 `.bak`、日志报 `holders at start>=1`
- 进程退净后 asar 被挪走、留 `.bak`、日志记 `health ok` / `asar moved`
- `resources/app` 不健康时 asar 保留、不产生 `.bak`、日志明确 `ABORT`
- 守卫 PS1 通过 PowerShell `Parser::ParseFile`

累计 7 组 134 项全过：rc213 26 / rc214 6 / rc2142 9 / rc120 22 / migration 21 / migration-yaml 8 / rc215 42。

## 升级后怎么生效

1. 装这个版本 → 面板点「应用」（补丁写入 `resources/app`，守卫被排上）
2. **完全退出** DeepSeek Harness —— 窗口关掉不够，托盘图标也要退
3. 守卫检测到进程全没了，挪走 `app.asar`，自己把客户端重新拉起来
4. 这一次加载的是 `resources/app`，代码层补丁开始生效

不想等的话，点「重启」也会走强退路径立刻换包，守卫作为兜底留着。

回滚：把 `resources/app.asar.bak` 改回 `app.asar` 即可，一切照旧。
