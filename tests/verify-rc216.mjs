/**
 * verify-rc216.mjs —— 1.2.2 自检：更新源可切换 + 「仓库没了」不再假装已是最新。
 *
 * 触发这次修改的现象：账号被 GitHub 停用后，面板照常显示「已是最新（1.2.1）」。
 * 原因是 describeLane 的 hasRemote 把本机那一条（kind: "local"）也算进了"远端读到了"，
 * 于是三个远端源全 404 时仍判成有远端，remoteVersion 直接回填本地版本号。
 * 这里测的是四件事真成立：
 *   1. 远端全失败时 hasRemote=false、remoteUnreadable=true，且报的是可读原因；
 *   2. probeRepo 能从状态码里分清「仓库没了(404)」和「连不上」，不被后一个 URL 覆盖；
 *   3. 换源后真的按新仓库查，「恢复默认」能撤回；
 *   4. 改名遗留：profile 里写 dsh-purge-022 或旧名 dsh-purge 都要能认出来。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const TMP = path.join(os.tmpdir(), `dsh-purge-verify-rc216-${process.pid}`);
const HOME = path.join(TMP, "home");

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

fs.mkdirSync(path.join(HOME, "dsh-purge"), { recursive: true });
process.env.DSH_HOME = HOME;

const upd = await import(pathToFileURL(path.join(ROOT, "lib", "update.js")).href);
const repoJson = path.join(HOME, "dsh-purge", "repo.json");

// ---- 1. 换源读写
console.log("\n[1] 更新源覆盖读写");
ok("默认走常量里的仓库", upd.activeRepo() === "devin667/dsh-purge-022", upd.activeRepo());
ok("默认没有覆盖标记", upd.readRepoOverride().override === false);

const swapped = upd.writeRepoOverride("someone/mirror-022");
ok("写入后生效", upd.activeRepo() === "someone/mirror-022");
ok("覆盖标记为真", swapped.override === true);
ok("fallback 仍是原仓库", swapped.fallback === "devin667/dsh-purge-022");
ok("落盘成 repo.json", fs.existsSync(repoJson));

let rejected = "";
try {
  upd.writeRepoOverride("这不是仓库");
} catch (e) {
  rejected = String(e && e.message);
}
ok("非法输入被拒", /owner\/repo/.test(rejected), rejected);
ok("被拒后仍是上一个值", upd.activeRepo() === "someone/mirror-022");

// ---- 2. 撤销覆盖
console.log("\n[2] 撤销覆盖");
const back = upd.writeRepoOverride("");
ok("恢复默认", back.repo === "devin667/dsh-purge-022" && back.override === false);
ok("repo.json 已删除", !fs.existsSync(repoJson));

const bySame = upd.writeRepoOverride("devin667/dsh-purge-022");
ok("显式写成默认值等同于撤销", bySame.override === false && !fs.existsSync(repoJson));

// ---- 3. describeProbe 的三种措辞
console.log("\n[3] 失败原因要能区分");
const missingText = upd.describeProbe({ state: "missing", status: 404, repo: "a/b" });
ok("404 提示换源", /404/.test(missingText) && /换成镜像仓库/.test(missingText), missingText);
const blockedText = upd.describeProbe({ state: "blocked", status: 403, repo: "a/b" });
ok("403 提示限流", /403/.test(blockedText) && /限流/.test(blockedText), blockedText);
const offlineText = upd.describeProbe({ state: "offline", status: 0, repo: "a/b" });
ok("连不上提示网络", /网络不通/.test(offlineText), offlineText);

// ---- 4. 真联网：封停账号下必须报错，不能报"已是最新"
// 这一段依赖真实网络：网络抖一下 probe 会从 missing 掉成 offline。
// 所以断言分两层——"不能可读"是硬要求，"具体是 404"允许重试后判定，
// 否则这个自检会在网络不稳的机器上假红。
console.log("\n[4] 真联网探一次（当前账号被停用，应报 missing/404）");
let probe = await upd.probeRepo("devin667/dsh-purge-022");
for (let i = 0; i < 3 && probe.state !== "missing"; i += 1) {
  if (probe.state === "ok") break;
  await new Promise((r) => setTimeout(r, 400));
  probe = await upd.probeRepo("devin667/dsh-purge-022");
}
ok("仓库不可读", probe.state !== "ok", JSON.stringify(probe));
if (probe.state === "missing") {
  ok("probe 带 404", probe.status === 404, String(probe.status));
} else {
  console.log(`  skip probe 状态码断言（本次探到 ${probe.state}，网络抖动）`);
}

const live = await upd.checkUpdate();
ok("远端读不到时置 remoteUnreadable", live.remoteUnreadable === true);
ok("hasRemote 不再被本机条目顶成 true", live.lanes.stable.hasRemote === false, String(live.lanes.stable.hasRemote));
ok("remoteVersion 不再回填本地版本", !live.remoteVersion || live.remoteVersion !== live.localVersion, String(live.remoteVersion));
ok("有可读的原因而不是空错误", Boolean(live.error), String(live.error));
ok("结果里带当前 repo", live.repo === "devin667/dsh-purge-022", String(live.repo));

// ---- 5. 换成能读的仓库后，hasRemote 恢复
console.log("\n[5] 换成可读仓库后恢复");
upd.writeRepoOverride("nodejs/node");
const swappedProbe = await upd.probeRepo();
ok("新源可读", swappedProbe.state === "ok", JSON.stringify(swappedProbe));
const swappedCheck = await upd.checkUpdate();
ok("hasRemote 恢复", swappedCheck.lanes.stable.hasRemote === true);
ok("不再标 remoteUnreadable", !swappedCheck.remoteUnreadable);
ok("repo 字段跟着变", swappedCheck.repo === "nodejs/node", String(swappedCheck.repo));
upd.writeRepoOverride("");

// ---- 6. handleUpdateOp 的 repo 动作
console.log("\n[6] API 动作 op=repo");
const opResult = await upd.handleUpdateOp({ op: "repo", repo: "nodejs/node" });
ok("op=repo 返回 repoChanged", opResult.repoChanged === true);
ok("op=repo 后 repo 已切换", opResult.repo === "nodejs/node", String(opResult.repo));
ok("op=repo 同时带上探测结果", typeof opResult.error === "string" || opResult.error === undefined);
const opReset = await upd.handleUpdateOp({ op: "repo", repo: "" });
ok("op=repo 空值回到默认", opReset.repo === "devin667/dsh-purge-022", String(opReset.repo));
ok("复位后 override 为假", opReset.override === false);

// ---- 7. 改名遗留：profile 认两种包名
console.log("\n[7] profile 里两种包名都要认");
const mkProfile = (name, depName, spec) => {
  const dir = path.join(HOME, "profiles", name);
  fs.mkdirSync(path.join(dir, "node_modules", depName), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, dependencies: { [depName]: spec } }, null, 2));
  fs.writeFileSync(path.join(dir, "node_modules", depName, "package.json"), JSON.stringify({ name: depName, version: "1.2.1" }));
  return dir;
};
const pNew = mkProfile("prof-new", "dsh-purge-022", "file:./x.tgz");
const pOld = mkProfile("prof-old", "dsh-purge", "file:./y.tgz");
const found = upd.findPurgeProfiles();
const names = found.map((x) => x.name).sort();
ok("两个 profile 都找到了", names.includes("prof-new") && names.includes("prof-old"), names.join(","));
const hitNew = found.find((x) => x.name === "prof-new");
const hitOld = found.find((x) => x.name === "prof-old");
ok("新名 profile 带上 pkgName", hitNew && hitNew.pkgName === "dsh-purge-022", JSON.stringify(hitNew));
ok("旧名 profile 带上 pkgName", hitOld && hitOld.pkgName === "dsh-purge", JSON.stringify(hitOld));
ok("profilePluginDir 认得新名", upd.profilePluginDir(pNew).toLowerCase().includes("dsh-purge-022"));
ok("profilePluginDir 认得旧名", upd.profilePluginDir(pOld).toLowerCase().includes("dsh-purge"));

// ---- 8. 面板文案齐全（中英都要有，否则会显示 key 本身）
console.log("\n[8] 面板文案");
const clientSrc = fs.readFileSync(path.join(ROOT, "client.js"), "utf8");
for (const key of ["repo.label", "repo.hint", "repo.save", "repo.reset", "repo.saved", "repo.savedDefault"]) {
  const hits = (clientSrc.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length;
  ok(`文案 ${key} 中英各一份`, hits >= 2, `出现 ${hits} 次`);
}
ok("面板有更新源输入框", /placeholder: "owner\/repo"/.test(clientSrc));
ok("面板调 op=repo", /op: "repo"/.test(clientSrc));
ok("有恢复默认按钮", /t\("repo\.reset"\)/.test(clientSrc));

// ---- 9. 不引入构建期依赖
console.log("\n[9] 依赖与兼容");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
ok("没有新增 dependencies", !pkg.dependencies || Object.keys(pkg.dependencies).length === 0, JSON.stringify(pkg.dependencies));
ok("engines.dsh 仍钉住 0.2.2", String(pkg.engines?.dsh || "").includes("0.2.2"), String(pkg.engines?.dsh));
const updateSrc = fs.readFileSync(path.join(ROOT, "lib", "update.js"), "utf8");
ok("没有任何地方再裸用 REPO", !/\$\{REPO\}/.test(updateSrc));
ok("activeRepo 被 URL 模板使用", (updateSrc.match(/\$\{activeRepo\(\)\}/g) || []).length >= 13, String((updateSrc.match(/\$\{activeRepo\(\)\}/g) || []).length));

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log("\n失败项：");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
