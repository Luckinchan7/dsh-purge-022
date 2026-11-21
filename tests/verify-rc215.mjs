/**
 * verify-rc215.mjs —— 1.2.1 自检：空闲换包守卫（asar-guard）。
 *
 * 这一版的全部意义在于修掉一个「静默不生效」：
 *   补丁写进了 resources/app，但 app.asar 还在，Electron 按
 *   app.asar → app → default_app.asar 的顺序永远加载旧包。
 * 所以我们不是在测「代码长什么样」，而在测四件事真的成立：
 *   1. 守卫脚本能被 PowerShell 解析；
 *   2. 进程还在时不挪 asar（否则会破坏运行中的客户端）；
 *   3. 进程退净后真的挪走 asar 并留 .bak；
 *   4. app 树不健康时拒绝挪（宁可保留 asar，也不能让客户端起不来）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const TMP = path.join(os.tmpdir(), `dsh-purge-verify-rc215-${process.pid}`);

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function extractGuardPs1() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "asar-guard.js"), "utf8");
  const m = src.match(/const GUARD_PS1 = \[([\s\S]*?)\]\.join\("\\r\\n"\);/);
  if (!m) return "";
  const lines = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`));
  return lines.join("\r\n");
}

function makeFixture(name, { healthy = true } = {}) {
  const dir = path.join(TMP, name);
  const res = path.join(dir, "resources");
  const app = path.join(res, "app");
  fs.mkdirSync(app, { recursive: true });
  if (healthy) {
    fs.writeFileSync(path.join(app, "package.json"), '{"name":"fixture"}', "utf8");
    const prm = path.join(app, "dsh", "node_modules", "@deepseek-ai", "dsh-system-prompt", "lib");
    fs.mkdirSync(prm, { recursive: true });
    fs.writeFileSync(path.join(prm, "index.js"), "// [dsh-purge] identity stripped\n", "utf8");
  }
  fs.writeFileSync(path.join(res, "app.asar"), "fake-asar", "utf8");
  return { dir, res, app };
}

function runGuard(ps1, fx, { waitMinutes = 0, exe = "" } = {}) {
  const log = path.join(fx.dir, "guard.log");
  const lock = path.join(fx.res, "app.asar.swap-guard");
  const exePath = exe || path.join(fx.dir, "Fake.exe");
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1,
        "-AsarPath", path.join(fx.res, "app.asar"),
        "-ExePath", exePath,
        "-LogPath", log,
        "-LockPath", lock,
        "-WaitMinutes", String(waitMinutes)],
      { stdio: "ignore", windowsHide: true, timeout: 60000 },
    );
  } catch {
    // 守卫用 exit code 表达结果，execFileSync 会抛；结果看 log。
  }
  let text = "";
  try { text = fs.readFileSync(log, "utf8"); } catch { /* 没有日志 */ }
  return { log: text, asar: fs.existsSync(path.join(fx.res, "app.asar")), bak: fs.existsSync(path.join(fx.res, "app.asar.bak")) };
}

console.log("verify-rc215: 空闲换包守卫\n");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

// ---- 1. 模块契约
const guard = await import(new URL("./lib/asar-guard.js", `file:///${ROOT.replace(/\\/g, "/")}/`).href);
ok("导出 guardLogPath", typeof guard.guardLogPath === "function");
ok("导出 swapGuardPending", typeof guard.swapGuardPending === "function");
ok("导出 queueIdleAsarSwap", typeof guard.queueIdleAsarSwap === "function");
ok("导出 describeSwapState", typeof guard.describeSwapState === "function");
ok("导出 readGuardLog", typeof guard.readGuardLog === "function");
ok("GUARD_LOG_NAME 指向换包日志", String(guard.GUARD_LOG_NAME).includes("asar-swap"));

// ---- 2. 状态口径：三种状态必须分开
ok(
  "asar 仍在时报 written_not_live",
  guard.describeSwapState({ exe: "x.exe", asar: "x.asar", runningFromAsar: true }).state === "written_not_live",
);
ok(
  "asar 已挪走时报 live",
  guard.describeSwapState({ exe: "x.exe", asar: "x.asar", runningFromAsar: false }).state === "live",
);
ok(
  "没有 asar 时报 no_asar",
  guard.describeSwapState({ exe: "x.exe", asar: "", runningFromAsar: false }).state === "no_asar",
);
ok(
  "written_not_live 要求完全退出",
  guard.describeSwapState({ exe: "x.exe", asar: "x.asar", runningFromAsar: true }).needFullQuit === true,
);
ok(
  "live 不再要求退出",
  guard.describeSwapState({ exe: "x.exe", asar: "x.asar", runningFromAsar: false }).needFullQuit === false,
);

// ---- 2b. 静默：启动器不能是 .cmd（每趟轮询会闪控制台黑框）
const guardSrc = fs.readFileSync(path.join(ROOT, "lib", "asar-guard.js"), "utf8");
ok("启动器改成 .vbs，不再是 .cmd", guardSrc.includes('dsh-purge-asar-swap-${taskName}.vbs') && !guardSrc.includes('dsh-purge-asar-swap-${taskName}.cmd'));
ok("用 WScript.Shell.Run 且窗口样式 0", guardSrc.includes('CreateObject("WScript.Shell").Run') && guardSrc.includes(", 0, False"));
ok("任务动作走 wscript //B", guardSrc.includes("wscript.exe //B //Nologo"));
ok("VBS 里有双引号转义", guardSrc.includes("function vbsLiteral") && guardSrc.includes('.replace(/"/g, \'""\')'));
// 换包完成后必须退役：否则任务仍然每 2 分钟触发一次，虽然立刻退出但那次触发本身会闪一下
ok("导出 retireGuard", typeof guard.retireGuard === "function");
ok("asar 已挪走时不再排守卫", guardSrc.includes("asar_already_swapped"));
ok("退役时连计划任务一起删", /export function retireGuard[\s\S]{0,900}schtasks\.exe[\s\S]{0,200}\/delete/.test(guardSrc));

// ---- 2c. 换包成功后状态不能再报 no_asar
// 真机实测：app.asar 被挪成 .bak 之后，sealedAsarHandoff() 因为
// asarArchiveIsFile() 为 false 直接返回 null，status 把「换好了」误报成 no_asar。
ok("导出 swapSnapshot", typeof guard.swapSnapshot === "function");
ok("导出 asarPathForExe", typeof guard.asarPathForExe === "function");
ok(
  "asarPathForExe 从 exe 反推 resources/app.asar",
  guard.asarPathForExe("D:\\DSH_DESKTOP\\DeepSeek Harness.exe") === "D:\\DSH_DESKTOP\\resources\\app.asar",
);
const fxSwap = makeFixture("swapped");
fs.renameSync(path.join(fxSwap.res, "app.asar"), path.join(fxSwap.res, "app.asar.bak"));
const snapSwapped = guard.swapSnapshot({ asar: path.join(fxSwap.res, "app.asar"), runningFromAsar: false });
ok("asar 不在但 .bak 在 → live", snapSwapped.state === "live", JSON.stringify(snapSwapped));
ok("live 时不要求退出", snapSwapped.needFullQuit === false);
ok("如实报告 swapped=true", snapSwapped.swapped === true);
const fxGone = makeFixture("gone");
fs.rmSync(path.join(fxGone.res, "app.asar"));
const snapGone = guard.swapSnapshot({ asar: path.join(fxGone.res, "app.asar"), runningFromAsar: false });
ok("asar 与 .bak 都不在 → no_asar", snapGone.state === "no_asar", JSON.stringify(snapGone));
ok("asar 与 .bak 都不在时 swapped=false", snapGone.swapped === false);
const fxStill = makeFixture("still");
const snapStill = guard.swapSnapshot({ asar: path.join(fxStill.res, "app.asar"), runningFromAsar: true });
ok("asar 还在 + 进程跑 asar → written_not_live", snapStill.state === "written_not_live");
ok("written_not_live 要求完全退出", snapStill.needFullQuit === true);

// ---- 3. 守卫脚本语法
const ps1Text = extractGuardPs1();
ok("能抽出 GUARD_PS1", ps1Text.length > 500, `${ps1Text.length} 字节`);
const ps1 = path.join(TMP, "guard.ps1");
fs.writeFileSync(ps1, ps1Text, "utf8");
const parse = execFileSync(
  "powershell.exe",
  ["-NoProfile", "-Command",
    `$e=$null; $null=[System.Management.Automation.Language.Parser]::ParseFile('${ps1.replace(/'/g, "''")}',[ref]$null,[ref]$e); if($e){ $e.Count } else { 0 }`],
  { encoding: "utf8", windowsHide: true, timeout: 30000 },
).trim();
ok("守卫脚本 PowerShell 语法通过", parse === "0", `parse errors=${parse}`);

// 这两个是上一版的真实缺陷：路径分隔符拼成双反斜杠会让 holder 判定永远为 0。
ok("不再用字面双反斜杠拼 rootNorm", !ps1Text.includes("+ '\\\\'"));
ok("用 [char]92 拼分隔符", ps1Text.includes("[char]92"));
ok("守卫每趟报告 holders", ps1Text.includes("waiting; holders="));

// ---- 4. 进程还在 → 不挪（单趟轮询：写心跳就退出）
const fxBusy = makeFixture("busy");
const busyExe = path.join(fxBusy.dir, "Fake.exe");
fs.copyFileSync("C:\\Windows\\System32\\ping.exe", busyExe);
const { spawn } = await import("node:child_process");
const holder = spawn(busyExe, ["-n", "30", "127.0.0.1"], { stdio: "ignore", windowsHide: true, detached: false });
await new Promise((r) => setTimeout(r, 1200));
const busyRun = runGuard(ps1, fxBusy, { waitMinutes: 5, exe: busyExe });
holder.kill();
ok("有进程持有时 asar 原地不动", busyRun.asar === true);
ok("有进程持有时不留 .bak", busyRun.bak === false);
ok("日志报告 waiting; holders>=1", /waiting; holders=([1-9]\d*)/.test(busyRun.log), busyRun.log.trim().split("\n").pop() || "");

// ---- 5. 进程退净 → 挪走并留 .bak
const fxFree = makeFixture("free");
const freeRun = runGuard(ps1, fxFree, { waitMinutes: 5 });
ok("进程退净后 asar 被挪走", freeRun.asar === false);
ok("留下 app.asar.bak 以便回滚", freeRun.bak === true);
ok("日志记录 ready to swap", freeRun.log.includes("ready to swap"));
ok("日志记录 asar moved", freeRun.log.includes("asar moved"));

// ---- 6. app 树不健康 → 拒绝挪（宁可旧包能跑，也不能让客户端起不来）
const fxBroken = makeFixture("broken", { healthy: false });
const brokenRun = runGuard(ps1, fxBroken, { waitMinutes: 5 });
ok("app 树不健康时 asar 保留", brokenRun.asar === true);
ok("app 树不健康时不产生 .bak", brokenRun.bak === false);
ok("日志明确 ABORT 原因", brokenRun.log.includes("ABORT: resources/app incomplete"), brokenRun.log.trim().split("\n").pop() || "");

// ---- 6b. 单趟设计：守卫不常驻，跑完一趟就退出（1.2.1 的长驻循环会无声消失）
const ps1Src = ps1Text;
ok("守卫不再用 while 长驻循环", !/while\s*\(\s*\(Get-Date\)/.test(ps1Src));
ok("守卫每趟写心跳 Beat", ps1Src.includes("function Beat"));
ok("心跳靠改锁 mtime", ps1Src.includes("$f.LastWriteTime = Get-Date"));
ok("deadline 过期会自己收尾", ps1Src.includes("deadline passed"));
// marker 正则在 PowerShell 里必须是单层转义，双层会永远不匹配
ok("marker 正则单层转义", ps1Src.includes("if ($t -match '\\[dsh-purge\\]')"));

// ---- 7. 接线：apply 路径必须真的能排出守卫
const core = await import(new URL("./lib/core.js", `file:///${ROOT.replace(/\\/g, "/")}/`).href);
const coreSrc = fs.readFileSync(path.join(ROOT, "lib", "core.js"), "utf8");
ok("core 引入 asar-guard", /import \* as asarGuard from "\.\/asar-guard\.js"/.test(coreSrc));
ok(
  "scheduleSealedDesktopRestart busy 时排守卫",
  /const guarded = asarGuard\.queueIdleAsarSwap\(\{ exe: handoff\.exe, asar: handoff\.asar \}\)/.test(coreSrc),
);
ok("scheduleSealedDesktopRestart 回传 guard 结果", /guard: guarded/.test(coreSrc));
ok("scheduleSealedDesktopRestart 可调用", typeof core.scheduleSealedDesktopRestart === "function");

const idxSrc = fs.readFileSync(path.join(ROOT, "lib", "index.js"), "utf8");
ok("index 引入 asar-guard", /import \* as asarGuard from "\.\/asar-guard\.js"/.test(idxSrc));
ok("apply 成功后排守卫", /if \(shouldRestart && handoff\?\.asar && sealedNow\)/.test(idxSrc));
ok("apply 返回 asar_swap_guard 字段", idxSrc.includes("asar_swap_guard: asarSwap"));
ok("apply 返回 swap_state 字段", idxSrc.includes("swap_state: asarGuard.swapSnapshot("));
ok("status 暴露 swap_state（换包后要报 live，不能报 no_asar）", /swap_state: \(\(\) => \{[\s\S]{0,900}swapSnapshot/.test(idxSrc));
ok("restart 路由也排守卫生兜底", /asarGuard\.queueIdleAsarSwap\(\{ exe: h\.exe, asar: h\.asar \}\)/.test(idxSrc));

// ---- 8. 包名迁移遗留：宿主里写死的模板路径
// 用补丁体（而不是源文件字面量）断言，源文件里是转义过的 \" 形式。
const p45Body = JSON.stringify(core.ALL_PATCHES.find((p) => p.id === 45)?.replacements || []);
ok("补丁体已指向 dsh-purge-022", p45Body.includes("dsh-purge-022"));
ok("补丁体保留旧名回退", p45Body.includes('\\"dsh-purge\\"'));
const compatSrc = fs.readFileSync(path.join(ROOT, "lib", "compat-0.2.2.js"), "utf8");
ok("compat 覆盖也指向 dsh-purge-022", compatSrc.includes("dsh-purge-022"));

// ---- 9. 补丁清单完整性
ok("补丁总数仍为 90", core.ALL_PATCHES.length === 90, `实际 ${core.ALL_PATCHES.length}`);
const p45 = core.ALL_PATCHES.find((p) => p.id === 45);
ok("补丁 45 存在", Boolean(p45));
ok(
  "补丁 45 marker 命中自己写的路径",
  Boolean(p45) && p45.markers.every((m) => JSON.stringify(p45.replacements).includes(m) || m.includes("dshPurge")),
);

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log("\n失败项：");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
