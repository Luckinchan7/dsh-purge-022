// 迁移逻辑对「真实 profile 结构」的安全性验证：
// 造一份含 comfy 那种大 JSON、多 insert 块的 profile，跑迁移后必须仍能被 YAML 解析。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mod = await import(
  "../lib/self-insert.js"
);

let pass = 0, fail = 0;
const ok = (n, c, e = "") => { c ? pass++ : fail++; console.log((c ? "PASS " : "FAIL ") + n, c ? "" : e); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-yaml-"));

/* 模拟真实 profile：多条 insert 块、大块 JSON 字符串、禁用行 */
const yaml = [
  "- id: ui-theme",
  "  config:",
  "    preference: system",
  "- insert:",
  "    - id: dsh-purge",
  "      name: dsh-purge",
  "      inject: [ systemPrompt, tools ]",
  "      config:",
  "        enabled: true",
  "        stripMnemon: true",
  "- id: dsh-comfy-models",
  "  config:",
  "    comfyuiWorkflowJson: '{\"1\":{\"class_type\":\"CheckpointLoaderSimple\",\"inputs\":{\"ckpt_name\":\"x.safetensors\"}}}'",
  "  disabled: false",
  "- insert:",
  "    - id: dsh-undici-guard",
  "      name: dsh-undici-guard",
  "",
].join("\n");

fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
  name: "dsh-profile-desktop",
  dsh: { profile: { bundles: ["dsh-purge", "dsh-comfy-models", "dsh-undici-guard"] } },
  dependencies: { "dsh-purge": "file:./x.tgz" },
}, null, 2), "utf8");
fs.writeFileSync(path.join(dir, "cordis.patch.yml"), yaml, "utf8");
fs.mkdirSync(path.join(dir, "node_modules", "dsh-purge"), { recursive: true });

/* 先确认基线可解析 */
const YAML = await import("file:///D:/DSH_DESKTOP/resources/app/dsh/node_modules/yaml/dist/index.js");
const baseline = (() => { try { return YAML.parse(yaml); } catch (e) { return e; } })();
ok("0 基线 YAML 可解析", Array.isArray(baseline) && baseline.length === 4);

const res = mod.removeLegacyRegistrations({ profileDir: dir });
ok("1 迁移返回 ok", res.ok === true, JSON.stringify(res));

const after = fs.readFileSync(path.join(dir, "cordis.patch.yml"), "utf8");
let parsed = null;
try { parsed = YAML.parse(after); } catch (e) { parsed = e; }
ok("2 迁移后 YAML 仍可解析", Array.isArray(parsed), parsed instanceof Error ? parsed.message : "");

if (Array.isArray(parsed)) {
  ok("3 顶层条目数不变（4 条）", parsed.length === 4, `实际 ${parsed.length}`);
  const insertIds = [];
  for (const e of parsed) {
    if (e?.insert) for (const it of e.insert) insertIds.push(`${it.id}->${it.name}`);
  }
  ok("4 purge 那条 name 改成新包名", insertIds.includes("dsh-purge->dsh-purge-022"), JSON.stringify(insertIds));
  ok("5 其它 insert 未被误删", insertIds.some((s) => s.startsWith("dsh-undici-guard")), JSON.stringify(insertIds));
  ok("6 comfy 配置块仍在且未被破坏", parsed.some((e) => e?.id === "dsh-comfy-models" && typeof e?.config?.comfyuiWorkflowJson === "string"));
  ok("7 comfy 的 disabled: false 仍在", parsed.some((e) => e?.id === "dsh-comfy-models" && e?.disabled === false));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
