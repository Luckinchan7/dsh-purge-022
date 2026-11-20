// 模拟 npm pack：按 files 字段算出最终发布内容，检查有没有漏或多。
import fs from "node:fs";
import path from "node:path";

const root = "C:/Users/devin/Documents/deepseek-harness/default-workspace/release";
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const files = pkg.files || [];

function walk(dir, base = "", out = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
}

const included = ["package.json"];
for (const entry of files) {
  if (entry.startsWith("!")) continue;
  const p = path.join(root, entry);
  if (!fs.existsSync(p)) { console.log("  files 里列了但不存在:", entry); continue; }
  const st = fs.statSync(p);
  if (st.isDirectory()) included.push(...walk(p, entry));
  else included.push(entry);
}

/* 应用排除规则 */
const excludes = files.filter((f) => f.startsWith("!")).map((f) => f.slice(1).replace(/^\//, ""));
const final = included.filter((rel) => !excludes.some((ex) => {
  if (ex.endsWith("/**")) return rel.startsWith(ex.slice(0, -3) + "/");
  return rel === ex;
}));

console.log("发布文件数:", final.length);
console.log("总大小:", (final.reduce((n, rel) => {
  try { return n + fs.statSync(path.join(root, rel)).size; } catch { return n; }
}, 0) / 1024 / 1024).toFixed(2), "MB");

/* 关键文件必须在 */
const must = [
  "package.json",
  "cordis.patch.yml",
  "client.js",
  "lib/index.js",
  "lib/core.js",
  "lib/self-insert.js",
  "lib/profile-insert.js",
  "bin/dsh-purge.js",
];
console.log("\n关键文件:");
let missing = 0;
for (const m of must) {
  const hit = final.includes(m);
  if (!hit) missing += 1;
  console.log(`  ${hit ? "✔" : "✗"} ${m}`);
}

/* 不该出现的 */
const bad = final.filter((rel) => /\.bak|\.tgz$|verify-rc|_selftest|node_modules\//.test(rel));
console.log("\n不应打包的文件:", bad.length ? JSON.stringify(bad) : "无");

/* 旧包名的残留 */
console.log("\n包名一致性:");
const yml = fs.readFileSync(path.join(root, "cordis.patch.yml"), "utf8");
console.log("  cordis.patch.yml 旧 name 残留:", /^\s*name: dsh-purge(\/|$)/m.test(yml) ? "有" : "无");
console.log("  最终 missing:", missing);
process.exitCode = missing > 0 || bad.length > 0 ? 1 : 0;
