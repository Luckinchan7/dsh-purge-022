// rc1.2.0 发布前验证：改名后各环节是否仍然自洽。
import fs from "node:fs";
import path from "node:path";

const root = "C:/Users/devin/Documents/deepseek-harness/default-workspace/release";
let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n, c ? "" : e); };

/* 1. package.json 元数据 */
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok("1a 包名 dsh-purge-022", pkg.name === "dsh-purge-022");
ok("1b 版本是正式 semver（无 prerelease）", /^\d+\.\d+\.\d+$/.test(pkg.version), pkg.version);
ok("1c 有 engines.dsh", Boolean(pkg.engines?.dsh), JSON.stringify(pkg.engines));
ok("1d 有 dsh.bundle.patch", Boolean(pkg.dsh?.bundle?.patch));
ok("1e bin 名已同步", Boolean(pkg.bin?.["dsh-purge-022"]));

/* 2. cordis.patch.yml 的 name: 全部指向新包名 */
const patchYml = fs.readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
const staleNames = [...patchYml.matchAll(/^(\s*)name: dsh-purge(\/|$)/gm)];
ok("2a 没有残留旧包名 name:", staleNames.length === 0, `残留 ${staleNames.length} 处`);
const newNames = [...patchYml.matchAll(/name: dsh-purge-022/g)];
ok("2b 新包名出现 5 次", newNames.length === 5, `实际 ${newNames.length}`);

/* 3. id 必须保持原名（组合 id 与包名无关） */
for (const id of ["id: dsh-purge", "id: dsh-purge-redteam", "id: dsh-purge-nolimit"]) {
  ok(`3 ${id} 保持不变`, patchYml.includes(id));
}

/* 4. profile-insert */
const { PURGE_NAME, INSERT_BLOCK } = await import(
  "file:///C:/Users/devin/Documents/deepseek-harness/default-workspace/release/lib/profile-insert.js"
);
ok("4a PURGE_NAME 是新包名", PURGE_NAME === "dsh-purge-022");
ok("4b INSERT_BLOCK 里 name 用新包名", INSERT_BLOCK.includes("name: dsh-purge-022"));
ok("4c INSERT_BLOCK 里 id 仍是 dsh-purge", INSERT_BLOCK.includes("id: dsh-purge"));

/* 5. client.js 模块 id */
const client = fs.readFileSync(path.join(root, "client.js"), "utf8");
ok("5a client.js 模块 id 已改", client.includes('id: "dsh-purge-022"'));
ok("5b client.js 的 name 常量已改", client.includes('const name = "dsh-purge-022"'));
ok("5c client.js 路由前缀仍是 /dsh-purge/", client.includes("/dsh-purge/"));

/* 6. 自愈模块 */
const selfInsert = await import(
  "file:///C:/Users/devin/Documents/deepseek-harness/default-workspace/release/lib/self-insert.js"
);
ok("6a 导出 ensureSelfRegistered", typeof selfInsert.ensureSelfRegistered === "function");
ok("6b 导出 needsSelfRegister", typeof selfInsert.needsSelfRegister === "function");
ok("6c 工作区里 resolveProfileDir 返回空", selfInsert.resolveProfileDir() === "");

/* 7. 内部标识没被误改 */
const coreSrc = fs.readFileSync(path.join(root, "lib/core.js"), "utf8");
ok("7a 配置目录仍是 $DSH_HOME/dsh-purge", coreSrc.includes('"dsh-purge", "unpacked-asar.json"'));
const identitySrc = fs.readFileSync(path.join(root, "lib/identity.js"), "utf8");
ok("7b section 名仍是 dsh-purge", identitySrc.includes('name === "dsh-purge"'));

/* 8. files 字段包含新模块 */
ok("8a files 未显式排除 lib", (pkg.files || []).includes("lib"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
