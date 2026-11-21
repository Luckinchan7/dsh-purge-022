# dsh-purge-022 v1.2.3

修复「换包守卫报在等、其实没人」——面板显示守卫正在等客户端退出，实际执行者早就没了。

## 问题

v1.2.1 的守卫是一个常驻 120 分钟的 PowerShell 循环。实测它会写下 `holders at start=7`
之后无声消失：Task Scheduler 的 `LastTaskResult` 仍是 0，日志里既没有 `timeout`
也没有 `abort`，说明没走正常退出路径。

而 `swapGuardPending()` 判活只依据锁文件 mtime 是否在 30 分钟内 —— 进程死了、锁还在，
于是 `describeSwapState()` 一直返回 `pending: true`，面板一直说「守卫在等客户端退出后自动切换」。
用户当晚完全退出客户端后，没有任何进程去换包。

## 修法

改成短周期轮询：计划任务 `MINUTE /mo 2`，每 2 分钟一趟，每趟只判定一次。

- 锁文件 mtime 就是心跳，只认 6 分钟内；
- 心跳过期但锁还在 = 守卫没了，`queueIdleAsarSwap()` 自动清掉重排；
- 新增 `guardLost` 状态，面板区分「在等」与「守卫已失效」；
- deadline 独立落盘，任务被停也不会永远留着锁。

## 顺带修掉

1. `GUARD_PS1` 的 marker 正则四层转义，到 PowerShell 里变成「反斜杠 + 字符类」，
   对真实文件永远不匹配，恒报 `purge markers=False`。
2. `schtasks /tr` 261 字符上限：完整命令行 496 字符。1.2.1 的 `.cmd` 中转用的是
   `start "" /b`，`/b` 让子进程继承 cmd 的控制台生命周期。改成 cmd 里同步执行。

## 自检

9 组 182 项全过（verify-rc215 加到 47 项）。

## 安装

```powershell
dsh plugin add "file:./dsh-purge-022-1.2.3.tgz"
```
