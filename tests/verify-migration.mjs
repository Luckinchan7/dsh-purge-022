// 迁移逻辑测试：在临时目录里造一份「新旧并存」的 profile，验证清理正确。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod = await import(
  "../lib/self-insert.js"
);

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n, c ? "" : e); };

function makeProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-profile-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "dsh-profile-desktop",
    dsh: { profile: { bundles: ["dsh-purge", "dsh-ops", "billion-context"] } },
    dependencies: { "dsh-purge": "file:./x.tgz", "dsh-ops": "0.5.5" },
  }, null, 2), "utf8");
  fs.writeFileSync(path.join(dir, "cordis.patch.yml"), [
    "- id: ui-theme",
    "  config:",
    "    preference: system",
    "- insert:",
    "    - id: dsh-purge",
    "      name: dsh-purge",
    "      inject: [systemPrompt, tools]",
    "      config:",
    "        enabled: true",
    "- id: dsh-ops",
    "  config:",
    "    enabled: true",
    "",
  ].join("\n"), "utf8");
  fs.mkdirSync(path.join(dir, "node_modules", "dsh-purge"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "dsh-purge", "package.json"), '{"name":"dsh-purge"}', "utf8");
  fs.mkdirSync(path.join(dir, "node_modules", "dsh-ops"), { recursive: true });
  return dir;
}

/* 1. 能识别出旧登记 */
const dir = makeProfile();
const found = mod.findLegacyRegistrations(dir);
ok("1a 识别旧 bundles", found.bundles.includes("dsh-purge"));
ok("1b 识别旧 dependencies", found.dependencies.includes("dsh-purge"));
ok("1c 识别旧目录", found.dirs.includes("dsh-purge"));
ok("1d 识别旧 patch 行", found.patch === true);

/* 2. dryRun 不改文件 */
const before = fs.readFileSync(path.join(dir, "package.json"), "utf8");
const dry = mod.removeLegacyRegistrations({ profileDir: dir, dryRun: true });
ok("2a dryRun 返回 ok", dry.ok && dry.dryRun === true);
ok("2b dryRun 不动 package.json", fs.readFileSync(path.join(dir, "package.json"), "utf8") === before);

/* 3. 真删 */
const res = mod.removeLegacyRegistrations({ profileDir: dir });
ok("3a 清理成功", res.ok === true, JSON.stringify(res));
const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
ok("3b bundles 里没有旧名", !pkg.dsh.profile.bundles.includes("dsh-purge"));
ok("3c bundles 里其它插件还在", pkg.dsh.profile.bundles.includes("dsh-ops") && pkg.dsh.profile.bundles.includes("billion-context"));
ok("3d dependencies 里没有旧名", !Object.hasOwn(pkg.dependencies, "dsh-purge"));
ok("3e 其它依赖未受影响", pkg.dependencies["dsh-ops"] === "0.5.5");
ok("3f node_modules/dsh-purge 已删", !fs.existsSync(path.join(dir, "node_modules", "dsh-purge")));
ok("3g node_modules/dsh-ops 还在", fs.existsSync(path.join(dir, "node_modules", "dsh-ops")));

const patch = fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8");
ok("3h patch 里旧 name 已改成新包名", /^\s*name: dsh-purge-022\s*$/m.test(patch));
ok("3i patch 里其它条目还在", patch.includes("id: ui-theme") && patch.includes("id: dsh-ops"));
ok("3j patch 的 YAML 结构没被破坏（insert 块完整）", patch.includes("- insert:") && patch.includes("id: dsh-purge"));

/* 4. 幂等 */
const again = mod.removeLegacyRegistrations({ profileDir: dir });
ok("4a 再跑一次是 skipped", again.skipped === true);

/* 5. 新包名不能被误删 */
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "purge-profile2-"));
fs.writeFileSync(path.join(dir2, "package.json"), JSON.stringify({
  name: "dsh-profile-desktop",
  dsh: { profile: { bundles: ["dsh-purge-022"] } },
  dependencies: { "dsh-purge-022": "1.2.0" },
}, null, 2), "utf8");
fs.writeFileSync(path.join(dir2, "cordis.patch.yml"), "- insert:\n    - id: dsh-purge\n      name: dsh-purge-022\n", "utf8");
const r2 = mod.removeLegacyRegistrations({ profileDir: dir2 });
const pkg2 = JSON.parse(fs.readFileSync(path.join(dir2, "package.json"), "utf8"));
ok("5a 新包名不被误删（bundles）", pkg2.dsh.profile.bundles.includes("dsh-purge-022"));
ok("5b 新包名不被误删（dependencies）", Object.hasOwn(pkg2.dependencies, "dsh-purge-022"));
ok("5c 新 name 行不被误删", fs.readFileSync(path.join(dir2, "cordis.patch.yml"), "utf8").includes("name: dsh-purge-022"));
ok("5d 无旧登记时 skipped", r2.skipped === true);

fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(dir2, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
