// rc2.14.2：面板口径验证。跳过数必须为 0，且「纯删除型」补丁不再被判 skipped。
import fs from "node:fs";

const core = await import(
  "../lib/core.js"
);

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n, c ? "" : e); };

/* 1. #73 必须挂 softSettle，否则纯删除永远显示 skipped */
const p73 = core.ALL_PATCHES.find((x) => x.id === 73);
ok("73a #73 有 softSettle", p73.softSettle === true);
ok("73b #73 不再 skipIfMarked", !p73.skipIfMarked);
ok("73c #73 不挂别人的 marker", !p73.markers || p73.markers.length === 0);

/* 2. #71 是可选（宿主本来没那个包） */
const p71 = core.ALL_PATCHES.find((x) => x.id === 71);
ok("71a #71 标为 optional", p71.optional === true);

/* 3. 模拟面板统计：一个只有 #73 目标文件、镜像句已删的宿主 */
const cleanYml = [
  "              - id: persistent-bash",
  "                name: '@deepseek-ai/dsh-tool-bash-persistent'",
  "                  description: |-",
  "                    Run commands in a bash shell",
  "                    * State is persistent across command calls.",
].join("\n");
const dirtyYml = cleanYml.replace(
  "                    * State is persistent across command calls.",
  "                    * Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.\n                    * State is persistent across command calls.",
);

/* 用 applyReplacementsToText 模拟两次状态 */
const rClean = core.applyReplacementsToText(cleanYml, p73, "minimal.patch.yml");
ok("3a 干净文件无需改动（changed=false）", !rClean.changed);
const rDirty = core.applyReplacementsToText(dirtyYml, p73, "minimal.patch.yml");
ok("3b 脏文件能删掉镜像句", rDirty.changed && !rDirty.text.includes("Prefer configured mirrors"));

/* 4. 删除后的文件再跑一次：锚点消失、无 marker，但 softSettle 应判 settled */
const again = core.applyReplacementsToText(rDirty.text, p73, "minimal.patch.yml");
ok("4a 重复应用幂等", !again.changed);

/* 5. 面板统计不把 na 计入分母 */
const rows = core.groupPatchesForDisplay(
  core.ALL_PATCHES,
  { 71: "na", 73: "applied" },
  "desktop",
);
const has71 = rows.some((r) => r.id === 71);
const has73 = rows.some((r) => r.id === 73);
ok("5a na 的 #71 不进面板", !has71);
ok("5b applied 的 #73 进面板", has73);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
