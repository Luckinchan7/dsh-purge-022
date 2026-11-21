# v1.2.4 — 守卫不再闪窗，换完包自己退场

## 你看到的

> 「隔一段时间就有个弹窗出来，很多余」

一个黑框，隔一阵闪一次，什么都不做。

## 弹窗是谁

不是换包本身，是 1.2.1 引入的 `.cmd` 启动器。

`schtasks /tr` 有 261 字符上限（超了直接报 `0x80004005`），而守卫的完整命令行
实测 496 字符，放不进去。所以 1.2.1~1.2.3 先落一个 `.cmd`，`/tr` 只指向这个短路径。

问题是：`.cmd` 由 Task Scheduler 拉起时**必然分配一个控制台**。任务每 2 分钟
触发一次，就每 2 分钟闪一下黑框。

改成 `.vbs`：

```
CreateObject("WScript.Shell").Run "<完整 powershell 命令行>", 0, False
```

- 走 wscript（GUI 子系统），不是 cmd（控制台子系统）
- 窗口样式 `0` = `SW_HIDE`
- 任务动作改 `wscript.exe //B //Nologo "<launcher>"`，`//B` 是 batch 模式，抑制所有脚本弹窗

任务管理器里连 console 都不分配，扫过去什么也看不见。

## 还有一半：换完包要退场

守卫脚本第一句是：

```powershell
if (-not (Test-Path -LiteralPath $AsarPath)) { W 'asar already absent'; Cleanup; exit 0 }
```

换包完成后每一趟触发都会立刻退出。看起来无害，但**那次触发本身已经发生**：
Windows 为它分配进程、闪一下窗口，然后什么也不做。任务要挂 12 小时 × 每 2 分钟
= 360 次。

所以 asar 已经挪走之后，任务必须删掉，而不是留着空转。

新增 `retireGuard(asar)`，删计划任务 + 锁 + deadline + VBS 启动器。
`queueIdleAsarSwap()` 开头就判断 asar 还在不在，不在就直接退役并返回
`reason: "asar_already_swapped"`。

## 顺带修掉一个假状态

`scheduleSealedDesktopRestart()` 原来无条件 `pending: true`。守卫退役时
`queued === false`，此时再报 pending 就是又一次「面板说在等、实际没任务」——
1.2.3 刚修过同类的假 pending，这里不该再犯。

改成 `pending: guarded?.queued === true`。

## 去掉重复的执行者

`lib/core.js` 本来同时调 `asarGuard.queueIdleAsarSwap()` 和
`desktop.scheduleAsarRenameWhenIdle()`。后者是上一代实现——长驻 PowerShell
循环 + detached spawn，与 asar-guard 完全重叠。两条都排会同时留下两个后台
执行者，其中长驻那条被杀后不会收尾。

只保留 asar-guard 一条。

## 现在的行为

| 时刻 | 你看到什么 |
|---|---|
| 点「应用」 | 补丁写进 `resources/app`，守卫静默排上（无窗口） |
| 还没退出客户端 | 每 2 分钟一次心跳，全程无窗口 |
| 完全退出客户端 | 守卫换包 → 删自己的任务 → 重开客户端 |
| 重开之后 | `swap_state = live`，不需要任何守卫了 |
| 已经换完再点应用 | 直接退役，不建任何任务 |

## 破甲

提示词层不依赖换包，一直在跑；代码层 90 条补丁在 1.2.4 之前已经随 21:41 那次
换包真正生效了（进程跑的是 `D:\DSH_DESKTOP\resources\app`，不是 `app.asar`）。

活体证据：

```
D:\DSH_DESKTOP\resources\app\dsh\node_modules\@deepseek-ai\dsh-system-prompt\lib\index.js
  1  [dsh-purge] identity stripped
  1  [dsh-purge] every mode keeps system inject
D:\DSH_DESKTOP\resources\app\dsh\node_modules\@deepseek-ai\dsh-compaction-tool-result-pruner\lib\index.js
  thresholdChars: 16384
D:\DSH_DESKTOP\resources\app\dsh\node_modules\@deepseek-ai\dsh-tool-fs\lib\index.js
  READ_MAX_BYTES = 256 * 1024
```

40 个文件带 `[dsh-purge]` 标记。

## 自检

9 组 189 项全过。verify-rc215 从 47 项加到 54 项，新增 7 项直接卡住这次的
两个缺陷：

- 启动器必须是 `.vbs`，不得是 `.cmd`
- 必须 `CreateObject("WScript.Shell").Run` 且窗口样式 `0`
- 任务动作必须走 `wscript.exe //B`
- VBS 字符串必须转义 `"`
- 必须导出 `retireGuard`
- asar 已挪走时不得再排守卫
- 退役必须连计划任务一起删

## 升级

```bash
# 面板里点「检查更新」→「一键升级」，或者：
pnpm add "dsh-purge-022@file:./.local-packages/dsh-purge-022-1.2.4.tgz"
```

装完不用退出客户端：1.2.4 本身是纯 JS 改动，宿主热加载即可。

## 回滚

`app.asar.bak` 还在原位（209,083,008 字节）。改回来只需把它 rename 成
`app.asar`，然后完全退出客户端重开。
