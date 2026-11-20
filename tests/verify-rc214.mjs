// rc2.14：验证 #73 的修复（marker 冲突）不再复现。
import fs from "node:fs";

const core = await import(
  "../lib/core.js"
);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass += 1; console.log("PASS", name); }
  else { fail += 1; console.log("FAIL", name, extra); }
};

/* #73 不再挂在 #70 的 marker 上 */
const p73 = core.ALL_PATCHES.find((x) => x.id === 73);
const p70 = core.ALL_PATCHES.find((x) => x.id === 70);
ok("73a #73 不再 skipIfMarked", !p73.skipIfMarked);
ok("73b #73 的 markers 不与 #70 冲突",
  !p73.markers || !p70.markers || !p73.markers.some((m) => p70.markers.includes(m)));

/* 模拟：文件里已有 #70 标记，但镜像句仍在 —— #73 必须仍能删掉它 */
const withMarker = [
  "              - id: persistent-pwsh # [dsh-purge] preset shell network",
  "                name: '@deepseek-ai/dsh-tool-pwsh-persistent'",
  "              - id: persistent-bash",
  "                name: '@deepseek-ai/dsh-tool-bash-persistent'",
  "                  description: |-",
  "                    Run commands in a bash shell",
  "                    * Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.",
  "                    * State is persistent across command calls.",
].join("\n");

const r = core.applyReplacementsToText(withMarker, p73, "minimal.patch.yml");
ok("73c 有 #70 标记时仍能删镜像句", r.changed && !r.text.includes("Prefer configured mirrors"));
ok("73d 其它行不受影响", r.text.includes("State is persistent across command calls"));

/* 幂等：删完再跑一次不改变 */
const r2 = core.applyReplacementsToText(r.text, p73, "minimal.patch.yml");
ok("73e 重复应用幂等", !r2.changed);

/* 干净文件（本来就没有镜像句）不报错 */
const clean = "              - id: persistent-bash\n";
const r3 = core.applyReplacementsToText(clean, p73, "minimal.patch.yml");
ok("73f 无锚点时安全返回", !r3.changed && r3.text === clean);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
