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
 * 这个模块把兜底抽出来，任何路径都能排一次；守卫本身用计划任务启动
 * （schtasks），完全脱离宿主进程树 —— 宿主退出、被强杀都不影响它。
 *
 * 守卫脚本做四件事，任何一步失败都不重开客户端：
 *   1. 等安装根下所有进程消失（默认最多 120 分钟）；
 *   2. 校验 resources/app 健康（package.json + @deepseek-ai + dsh-purge 标记）；
 *   3. 把 asar.unpacked 里的原生模块叠进 app 树（否则 napi 加载失败）；
 *   4. 把 app.asar 挪成 app.asar.bak，然后重开 exe。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export const GUARD_LOG_NAME = "dsh-purge-asar-swap.log";
const GUARD_WAIT_MINUTES = 120;
const LOCK_STALE_MS = 30 * 60 * 1000;

const GUARD_PS1 = [
  "param(",
  "  [Parameter(Mandatory = $true)][string]$AsarPath,",
  "  [Parameter(Mandatory = $true)][string]$ExePath,",
  "  [Parameter(Mandatory = $true)][string]$LogPath,",
  "  [Parameter(Mandatory = $true)][string]$LockPath,",
  "  [string]$TaskName = '',",
  "  [int]$WaitMinutes = 120",
  ")",
  "$ErrorActionPreference = 'Continue'",
  "function W($m) { try { Add-Content -LiteralPath $LogPath -Value ((Get-Date).ToString('o') + ' ' + $m) -Encoding utf8 } catch {} }",
  "function Cleanup {",
  "  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue",
  "  if ($TaskName) { & schtasks.exe /delete /tn $TaskName /f 2>&1 | Out-Null }",
  "}",
  "W 'guard start'",
  // 分隔符用 [char]92 拼，避免在 JS 字符串里堆反斜杠把 StartsWith 拼成双斜杠。
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
  "$firstHolders = @(Holders).Count",
  "W ('holders at start=' + $firstHolders)",
  "$deadline = (Get-Date).AddMinutes($WaitMinutes)",
  "while ((Get-Date) -lt $deadline) {",
  "  if (-not (Test-Path -LiteralPath $AsarPath)) { W 'asar already absent; nothing to swap'; Cleanup; exit 0 }",
  "  if (@(Holders).Count -gt 0) { Start-Sleep -Seconds 2; continue }",
  // 二次确认：进程刚退出时文件句柄可能还没释放。
  "  Start-Sleep -Seconds 1",
  "  if (@(Holders).Count -gt 0) { continue }",
  "  $appDir = Join-Path (Split-Path -Parent $AsarPath) 'app'",
  "  $pkg = Join-Path $appDir 'package.json'",
  "  $ai = Join-Path $appDir ('dsh' + $sep + 'node_modules' + $sep + '@deepseek-ai')",
  "  $prm = Join-Path $ai ('dsh-system-prompt' + $sep + 'lib' + $sep + 'index.js')",
  "  if (-not (Test-Path -LiteralPath $pkg) -or -not (Test-Path -LiteralPath $ai)) { W 'ABORT: resources/app incomplete, keeping asar'; Cleanup; exit 1 }",
  "  $mark = $false",
  "  try { $t = Get-Content -LiteralPath $prm -Raw -ErrorAction Stop; if ($t -match '\\[dsh-purge\\]') { $mark = $true } } catch {}",
  "  W ('health ok; purge markers=' + $mark)",
  "  if (-not $mark) { W 'WARN: no purge markers in prompt module, swapping anyway (patch set may differ)' }",
  // asar.unpacked 里是原生 .node，asar 挪走后 app 树必须自带，否则 require 失败。
  "  $unpacked = $AsarPath + '.unpacked'",
  "  $nativeRel = 'dsh' + $sep + 'node_modules' + $sep + 'node-addon-require-builtin-win32-x64-msvc' + $sep + 'prebuilt' + $sep + 'win32-x64-msvc-napi-v9.node'",
  "  $nmark = Join-Path $appDir $nativeRel",
  "  if ((Test-Path -LiteralPath $unpacked) -and -not (Test-Path -LiteralPath $nmark)) {",
  "    W 'overlaying app.asar.unpacked native modules'",
  "    & robocopy.exe $unpacked $appDir /E /XC /XN /XO /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null",
  "  }",
  "  $bak = \"$AsarPath.bak\"",
  "  $moved = $false",
  "  for ($i = 0; $i -lt 60; $i++) {",
  "    try {",
  "      if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force -ErrorAction SilentlyContinue }",
  "      Move-Item -LiteralPath $AsarPath -Destination $bak -Force -ErrorAction Stop",
  "      $moved = $true",
  "      break",
  "    } catch {",
  "      if (@(Holders).Count -gt 0) { W 'holder reappeared; waiting'; Start-Sleep -Seconds 2 } else { Start-Sleep -Milliseconds 500 }",
  "    }",
  "  }",
  "  if (-not $moved) { W 'ABORT: could not move asar (still locked)'; Cleanup; exit 2 }",
  "  W 'asar moved to app.asar.bak'",
  "  Cleanup",
  "  Start-Sleep -Milliseconds 600",
  "  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue",
  "  try { Start-Process -FilePath $ExePath; W 'relaunched' } catch { W ('relaunch failed: ' + $_.Exception.Message) }",
  "  exit 0",
  "}",
  "W 'timeout: client stayed open, asar untouched'",
  "Cleanup",
  "exit 3",
  "",
].join("\r\n");

export function guardLogPath() {
  return path.join(os.tmpdir(), GUARD_LOG_NAME);
}

function lockPathFor(asar) {
  return `${asar}.swap-guard`;
}

function taskNameFor(asar) {
  const h = createHash("sha1").update(String(asar).toLowerCase()).digest("hex").slice(0, 10);
  return `DSHPurgeAsarSwap-${h}`;
}

/** 守卫进程还在等吗（锁文件新鲜且未过期）。 */
export function swapGuardPending(asar) {
  if (!asar) return false;
  try {
    const age = Date.now() - fs.statSync(lockPathFor(asar)).mtimeMs;
    return age >= 0 && age < LOCK_STALE_MS;
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
 * 注意 schtasks 的 /tr 上限 261 字符（超了直接 0x80004005），
 * 而我们要传的路径加起来就超了。所以先落一个 .cmd 启动器，
 * 任务只指向这个短路径，参数全在 cmd 里。
 */
function launchViaTask(script, args, taskName, launcher) {
  try {
    fs.writeFileSync(
      launcher,
      `@echo off\r\nstart "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${script}" ${args}\r\n`,
      "utf8",
    );
    execFileSync("schtasks.exe", ["/create", "/tn", taskName, "/tr", `"${launcher}"`,
      "/sc", "once", "/st", "23:59", "/f"], { stdio: "ignore", windowsHide: true, timeout: 15000 });
    execFileSync("schtasks.exe", ["/run", "/tn", taskName], { stdio: "ignore", windowsHide: true, timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 排一次空闲换包。重复调用是安全的：锁新鲜时直接返回 already。
 * 不杀进程、不动 asar —— 只等用户自己退出。
 */
export function queueIdleAsarSwap({ exe, asar, waitMinutes = GUARD_WAIT_MINUTES } = {}) {
  if (!exe || !asar) return { queued: false, reason: "missing_exe_or_asar" };
  if (process.platform !== "win32") return { queued: false, reason: "windows_only" };
  const lock = lockPathFor(asar);
  if (swapGuardPending(asar)) return { queued: true, already: true, lock };
  try {
    const age = Date.now() - fs.statSync(lock).mtimeMs;
    if (age < 0 || age >= LOCK_STALE_MS) fs.unlinkSync(lock);
  } catch {
    // 没有旧锁，继续。
  }
  fs.writeFileSync(lock, `${Date.now()}\n`, "utf8");
  const script = path.join(os.tmpdir(), `dsh-purge-asar-guard-${process.pid}-${Date.now()}.ps1`);
  fs.writeFileSync(script, GUARD_PS1, "utf8");
  const launcher = path.join(os.tmpdir(), `dsh-purge-asar-swap.cmd`);
  const log = guardLogPath();
  try {
    fs.appendFileSync(log, `${new Date().toISOString()} queued by pid ${process.pid}\n`, "utf8");
  } catch {
    // 日志写不进去不影响换包。
  }
  const taskName = taskNameFor(asar);
  const argLine = [
    "-AsarPath", `"${asar}"`,
    "-ExePath", `"${exe}"`,
    "-LogPath", `"${log}"`,
    "-LockPath", `"${lock}"`,
    "-TaskName", taskName,
    "-WaitMinutes", String(waitMinutes),
  ].join(" ");
  // 首选计划任务：脱离进程树，宿主退出后仍然活着。
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
 * 三种状态必须分开报，否则「已写入」会被读成「已生效」。
 */
export function describeSwapState({ exe, asar, runningFromAsar = false } = {}) {
  const pending = swapGuardPending(asar);
  if (!asar) return { state: "no_asar", pending: false, needFullQuit: false };
  if (runningFromAsar) {
    return { state: "written_not_live", pending, needFullQuit: true };
  }
  return { state: "live", pending, needFullQuit: false };
}
