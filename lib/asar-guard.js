/**
 * 空闲换包守卫 / idle asar swap guard。
 *
 * 为什么需要它
 * ------------
 * 官方桌面把宿主塞在 `resources/app.asar` 里，Electron 的解析顺序是
 *   app.asar  →  app  →  default_app.asar
 * 也就是 asar 一定赢。补丁写进 `resources/app` 之后，只要 asar 还在，
 * 当前进程就仍然跑旧代码 —— 面板上「已写入」是真的，但「生效」是假的。
 *
 * 而 asar 被运行中的进程独占锁定（实测 Windows 上 Move 直接
 * `The process cannot access the file because it is being used by another process`），
 * 所以换包只能发生在「应用已经完全退出」的那个窗口里。
 *
 * 旧实现有两个洞：
 *   1. `renameAsarAside()` 在进程内直接 Move，必然 busy，然后就没有下文；
 *   2. 唯一的空闲兜底 `scheduleAsarRenameWhenIdle()` 只在 `reapply.js` 的
 *      启动自愈里被调用，而桌面 surface 的启动自愈被 `settleMayReapply` 禁掉了
 *      （sealed 时返回 false，避免和 Electron Fiber._reload 抢锁）。
 *      结果：apply 路径永远走不到空闲兜底，asar 永远挪不动。
 *
 * 为什么不是「一个常驻 120 分钟的循环」
 * ------------------------------------
 * 1.2.1 第一版让计划任务拉起一个长驻 PowerShell，在循环里等进程退净。
 * 实测这个长驻进程会在 `holders at start=7` 之后无声消失（任务 Last Result
 * 仍是 0、日志里没有 timeout 也没有 abort），而锁文件靠 mtime 判活，
 * 于是面板一直显示「守卫在等客户端退出」，实际已经没有执行者 —— 用户
 * 退出客户端也不会换包。
 *
 * 现在改成「短周期轮询」：
 *   - 计划任务每 2 分钟触发一次（`/sc MINUTE /mo 2`），每次只跑一趟：
 *     读锁 → 看进程是否退净 → 退净就换包，没退净就打完心跳立刻退出；
 *   - 锁文件的 mtime 就是心跳，`swapGuardPending()` 只认 3 分钟内的心跳；
 *   - 守卫被杀 / 机器重启 / 任务被停，下一次触发会把状态重新算对上，
 *     不存在「进程死了却还报在等」的假状态；
 *   - 任务带 deadline（默认 12 小时），过期自删，不会永远留着。
 *
 * 守卫每一趟做四件事，任何一步失败都不重开客户端：
 *   1. 校验 resources/app 健康（package.json + @deepseek-ai）；
 *   2. 把 asar.unpacked 里的原生模块叠进 app 树（否则 napi 加载失败）；
 *   3. 把 app.asar 挪成 app.asar.bak；
 *   4. 重开 exe。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const GUARD_LOG_NAME = "dsh-purge-asar-swap.log";
const GUARD_WAIT_MINUTES = 12 * 60;
/** 任务轮询间隔（分钟）。也是「心跳多久算新鲜」的下界。 */
const GUARD_POLL_MINUTES = 2;
/** 心跳容忍窗口：两个轮询周期 + 一个周期余量。 */
const HEARTBEAT_TTL_MS = (GUARD_POLL_MINUTES * 3) * 60 * 1000;
/** deadline 文件不写时的兜底过期时间。 */
const LOCK_STALE_MS = HEARTBEAT_TTL_MS;

const GUARD_PS1 = [
  "param(",
  "  [Parameter(Mandatory = $true)][string]$AsarPath,",
  "  [Parameter(Mandatory = $true)][string]$ExePath,",
  "  [Parameter(Mandatory = $true)][string]$LogPath,",
  "  [Parameter(Mandatory = $true)][string]$LockPath,",
  "  [string]$TaskName = '',",
  "  [int]$WaitMinutes = 720",
  ")",
  "$ErrorActionPreference = 'Continue'",
  "function W($m) { try { Add-Content -LiteralPath $LogPath -Value ((Get-Date).ToString('o') + ' ' + $m) -Encoding utf8 } catch {} }",
  // 心跳 = 锁文件 mtime。Node 侧 swapGuardPending() 只认这个。
  "function Beat { try { $f = Get-Item -LiteralPath $LockPath -ErrorAction Stop; $f.LastWriteTime = Get-Date } catch {} }",
  "function Deadline {",
  "  $dp = $LockPath + '.deadline'",
  "  try { return [datetime]::Parse((Get-Content -LiteralPath $dp -Raw).Trim()) } catch { return (Get-Date).AddMinutes($WaitMinutes) }",
  "}",
  "function Cleanup {",
  "  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue",
  "  Remove-Item -LiteralPath ($LockPath + '.deadline') -Force -ErrorAction SilentlyContinue",
  "  if ($TaskName) { & schtasks.exe /delete /tn $TaskName /f 2>&1 | Out-Null }",
  "}",
  // 单趟执行：不 loop、不常驻，这样被杀也不会留下假心跳。
  "if (-not (Test-Path -LiteralPath $AsarPath)) { W 'asar already absent; nothing to swap'; Cleanup; exit 0 }",
  "$dl = Deadline",
  "if ((Get-Date) -gt $dl) { W ('deadline passed at ' + $dl.ToString('o') + '; giving up, asar untouched'); Cleanup; exit 3 }",
  "$sep = [char]92",
  "$installRoot = (Split-Path -Parent $ExePath).TrimEnd([char]92)",
  "$exeNorm = $ExePath.ToLower()",
  "$rootNorm = $installRoot.ToLower() + $sep",
  // 只认本安装根下的进程，避免误伤同名第三方客户端。
  "function Holders {",
  "  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {",
  "    $ep = $_.ExecutablePath",
  "    if (-not $ep) { return $false }",
  "    $low = $ep.ToLower()",
  "    return ($low -eq $exeNorm) -or $low.StartsWith($rootNorm)",
  "  })",
  "}",
  "$holders = @(Holders).Count",
  "if ($holders -gt 0) { Beat; W ('waiting; holders=' + $holders); exit 0 }",
  // 进程刚退出时文件句柄可能还没释放，二次确认。
  "Start-Sleep -Seconds 1",
  "$holders = @(Holders).Count",
  "if ($holders -gt 0) { Beat; W ('waiting; holders=' + $holders); exit 0 }",
  "$appDir = Join-Path (Split-Path -Parent $AsarPath) 'app'",
  "$pkg = Join-Path $appDir 'package.json'",
  "$ai = Join-Path $appDir ('dsh' + $sep + 'node_modules' + $sep + '@deepseek-ai')",
  "$prm = Join-Path $ai ('dsh-system-prompt' + $sep + 'lib' + $sep + 'index.js')",
  "if (-not (Test-Path -LiteralPath $pkg) -or -not (Test-Path -LiteralPath $ai)) { W 'ABORT: resources/app incomplete, keeping asar'; Cleanup; exit 1 }",
  "$mark = $false",
  "try { $t = Get-Content -LiteralPath $prm -Raw -ErrorAction Stop; if ($t -match '\\[dsh-purge\\]') { $mark = $true } } catch {}",
  "W ('ready to swap; purge markers=' + $mark)",
  "if (-not $mark) { W 'WARN: no purge markers in prompt module, swapping anyway (patch set may differ)' }",
  // asar.unpacked 里是原生 .node，asar 挪走后 app 树必须自带，否则 require 失败。
  "$unpacked = $AsarPath + '.unpacked'",
  "$nativeRel = 'dsh' + $sep + 'node_modules' + $sep + 'node-addon-require-builtin-win32-x64-msvc' + $sep + 'prebuilt' + $sep + 'win32-x64-msvc-napi-v9.node'",
  "$nmark = Join-Path $appDir $nativeRel",
  "if ((Test-Path -LiteralPath $unpacked) -and -not (Test-Path -LiteralPath $nmark)) {",
  "  W 'overlaying app.asar.unpacked native modules'",
  "  & robocopy.exe $unpacked $appDir /E /XC /XN /XO /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null",
  "}",
  "$bak = \"$AsarPath.bak\"",
  "$moved = $false",
  "for ($i = 0; $i -lt 30; $i++) {",
  "  try {",
  "    if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }",
  "    Move-Item -LiteralPath $AsarPath -Destination $bak -Force -ErrorAction Stop",
  "    $moved = $true",
  "    break",
  "  } catch {",
  "    if (@(Holders).Count -gt 0) { Beat; W 'holder reappeared; waiting for next tick'; exit 0 }",
  "    Start-Sleep -Milliseconds 400",
  "  }",
  "}",
  "if (-not $moved) { Beat; W 'could not move asar this tick (still locked); retrying next tick'; exit 0 }",
  "W 'asar moved to app.asar.bak'",
  "Cleanup",
  "Start-Sleep -Milliseconds 600",
  "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue",
  "try { Start-Process -FilePath $ExePath; W 'relaunched' } catch { W ('relaunch failed: ' + $_.Exception.Message) }",
  "exit 0",
  "",
].join("\r\n");

export function guardLogPath() {
  return path.join(os.tmpdir(), GUARD_LOG_NAME);
}

function lockPathFor(asar) {
  return `${asar}.swap-guard`;
}

function deadlinePathFor(asar) {
  return `${asar}.swap-guard.deadline`;
}

function taskNameFor(asar) {
  const h = createHash("sha1").update(String(asar).toLowerCase()).digest("hex").slice(0, 10);
  return `DSHPurgeAsarSwap-${h}`;
}

/**
 * 换包任务还在守吗。
 *
 * 只看心跳 mtime：任务每 GUARD_POLL_MINUTES 分钟触发一次并 Beat 一次，
 * 所以心跳在 HEARTBEAT_TTL_MS 内就意味着「有一个活着的执行者」。
 * 任务被停 / 被删 / 机器重启，心跳自然过期，不会再出现假 pending。
 */
export function swapGuardPending(asar) {
  if (!asar) return false;
  const lock = lockPathFor(asar);
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    return age >= 0 && age < HEARTBEAT_TTL_MS;
  } catch {
    return false;
  }
}

/** 心跳过期但锁还在 = 守卫已经不在了，需要重新排。 */
function lockLeftBehind(asar) {
  if (!asar) return false;
  try {
    fs.statSync(lockPathFor(asar));
    return !swapGuardPending(asar);
  } catch {
    return false;
  }
}

export function readGuardLog(limit = 40) {
  try {
    const lines = fs.readFileSync(guardLogPath(), "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * 用计划任务启动守卫：任务由 Task Scheduler 拉起，
 * 不属于宿主进程树，宿主退出/强杀都不影响它。
 *
 * 关键点：
 *   - 用 `/sc MINUTE /mo 2` 轮询，而不是 `once` + 长驻循环。长驻进程被杀后
 *     没人知道，而轮询任务下一次触发会自己把状态算对上；
 *   - `/du 12:00` 限定时长，过期任务自动停止，不留垃圾；
 *   - schtasks 的 /tr 上限 261 字符（超了直接 0x80004005）。完整命令行实测
 *     496 字符，放不进 /tr，所以先落一个 `.cmd` 启动器，/tr 只指向这个短路径，
 *     参数全在 cmd 里。cmd 里**同步**执行 powershell（不用 `start /b`），
 *     这样 Task Scheduler 跟踪的进程树就是守卫本身，一趟跑完任务即刻结束。
 */
function launchViaTask(script, argLine, taskName, launcher) {
  try {
    fs.writeFileSync(
      launcher,
      `@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" ${argLine}\r\n`,
      "utf8",
    );
    if (launcher.length > 261) return false;
    const start = new Date(Date.now() + 60 * 1000);
    const hhmm = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
    const duration = String(Math.max(1, Math.ceil((GUARD_WAIT_MINUTES + 30) / 60))).padStart(4, "0");
    execFileSync(
      "schtasks.exe",
      ["/create", "/tn", taskName, "/tr", `"${launcher}"`,
        "/sc", "MINUTE", "/mo", String(GUARD_POLL_MINUTES),
        "/du", `${duration}:00`, "/st", hhmm, "/f"],
      { stdio: "ignore", windowsHide: true, timeout: 15000 },
    );
    execFileSync("schtasks.exe", ["/run", "/tn", taskName], { stdio: "ignore", windowsHide: true, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 排一次空闲换包。重复调用是安全的：心跳新鲜时直接返回 already。
 * 不杀进程、不动 asar —— 只等用户自己退出。
 */
export function queueIdleAsarSwap({ exe, asar, waitMinutes = GUARD_WAIT_MINUTES } = {}) {
  if (!exe || !asar) return { queued: false, reason: "missing_exe_or_asar" };
  if (process.platform !== "win32") return { queued: false, reason: "windows_only" };
  const lock = lockPathFor(asar);
  if (swapGuardPending(asar)) return { queued: true, already: true, lock };
  // 心跳过期但锁还在 = 上一任守卫已经没了，清掉重排（否则会残留假 pending）。
  if (lockLeftBehind(asar)) {
    try { fs.unlinkSync(lock); } catch { /* 删不掉就覆盖 */ }
  }
  try { fs.unlinkSync(deadlinePathFor(asar)); } catch { /* 不存在 */ }
  fs.writeFileSync(lock, `${process.pid}\n`, "utf8");
  try {
    fs.writeFileSync(
      deadlinePathFor(asar),
      new Date(Date.now() + waitMinutes * 60 * 1000).toISOString(),
      "utf8",
    );
  } catch { /* deadline 写不进去时脚本用 WaitMinutes 兜底 */ }
  const script = path.join(os.tmpdir(), `dsh-purge-asar-guard-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(script, GUARD_PS1, "utf8");
  const taskName = taskNameFor(asar);
  const launcher = path.join(os.tmpdir(), `dsh-purge-asar-swap-${taskName}.cmd`);
  const log = guardLogPath();
  try {
    fs.appendFileSync(log, `${new Date().toISOString()} queued by pid ${process.pid}\n`, "utf8");
  } catch {
    // 日志写不进去不影响换包。
  }
  const argLine = [
    "-AsarPath", `"${asar}"`,
    "-ExePath", `"${exe}"`,
    "-LogPath", `"${log}"`,
    "-LockPath", `"${lock}"`,
    "-TaskName", taskName,
    "-WaitMinutes", String(waitMinutes),
  ].join(" ");
  if (launchViaTask(script, argLine, taskName, launcher)) {
    return { queued: true, already: false, via: "schtasks", taskName, script, launcher, lock, log };
  }
  // 兜底：detached spawn。宿主正常退出时也能存活，只是被强杀时可能一起没。
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-AsarPath", asar, "-ExePath", exe, "-LogPath", log,
      "-LockPath", lock, "-TaskName", taskName, "-WaitMinutes", String(waitMinutes)],
    { detached: true, stdio: "ignore", windowsHide: true, shell: false },
  );
  // detached spawn 的 ENOENT 没监听会 uncaught 打崩进程。
  child.on("error", (err) => {
    try {
      fs.appendFileSync(log, `${new Date().toISOString()} spawn failed: ${err?.message || err}\n`, "utf8");
    } catch {
      // 忽略
    }
  });
  child.unref();
  return { queued: true, already: false, via: "spawn", taskName, script, lock, log };
}

/**
 * 面板/API 用的口径：补丁写在哪、进程跑在哪、还差什么才算生效。
 *
 * 三种主状态必须分开报，否则「已写入」会被读成「已生效」：
 *   live             = 补丁在跑（asar 已挪走或本就不是密封包）
 *   written_not_live = 补丁写好了，asar 还在，进程跑的还是旧包
 *   no_asar          = 非桌面 / 还没有 asar
 *
 * 另外带 pending / guardLost 两个正交事实：
 *   pending=true   守卫有心跳，退出客户端就会自动换包
 *   guardLost=true 守卫心跳过期（任务被停/被杀/机器重启），要重新点应用
 */
export function describeSwapState({ exe, asar, runningFromAsar = false } = {}) {
  if (!asar) return { state: "no_asar", pending: false, guardLost: false, needFullQuit: false };
  const pending = swapGuardPending(asar);
  const guardLost = !pending && lockLeftBehind(asar);
  if (runningFromAsar) {
    return { state: "written_not_live", pending, guardLost, needFullQuit: true };
  }
  return { state: "live", pending, guardLost, needFullQuit: false };
}
