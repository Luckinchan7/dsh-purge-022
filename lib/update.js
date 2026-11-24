import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { atomicWriteSync, findDshHome } from "./core.js";
import { extractZipArchive } from "./zip-extract.js";

/** 默认更新源。拿不到（封停/改名前/私有化）时可以用 repo.json 换成镜像仓库，见 activeRepo()。 */
const REPO = "Luckinchan7/dsh-purge-022";
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const STABLE_REF = "main";
const BETA_REF = "beta";
const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CHANNELS = {
  stable: { id: "stable", ref: STABLE_REF, label: "正式版" },
  beta: { id: "beta", ref: BETA_REF, label: "测试版" },
};
const COPY_NAMES = [
  "lib",
  "bin",
  "docs",
  "client.js",
  "cordis.patch.yml",
  "screenshots.json",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
];

const HIDDEN = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true,
  timeout: 20000,
};

// 只允许来自 GitHub / jsdelivr 的 302 跳转落地,阻挡中间人把下载指向任意主机。
const UPDATE_REDIRECT_ALLOWED_HOSTS = new Set([
  "github.com",
  "codeload.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "cdn.jsdelivr.net",
]);
const MAX_UPDATE_BYTES = 50 * 1024 * 1024;

/**
 * 出网代理。
 *
 * 为什么需要：raw.githubusercontent.com 与 cdn.jsdelivr.net 在部分网络下直连会被
 * ECONNRESET 掐掉（实测 raw 直连 000、jsdelivr 直连 ECONNRESET，走本机 7897 全部 200）。
 * requestBuffer 原来完全没有代理支持，于是 remotePackageVersion 的四个源全失败、
 * head 那条的 version 恒为空，上层 `remoteVersion: lane.version || lane.sha` 把提交号
 * 当版本号报给面板——面板上就会显示「最新 00ca3f4」这种东西。
 *
 * 取值顺序：环境变量（https_proxy / HTTPS_PROXY / http_proxy / HTTP_PROXY / all_proxy /
 * ALL_PROXY）→ Windows 注册表里的系统代理（Internet Settings\ProxyServer）。
 * 只解析 http:// 形态的代理（CONNECT 隧道足够）；socks 形态直接跳过、走直连。
 */
let _proxyCache;
function resolveProxy() {
  if (_proxyCache !== undefined) return _proxyCache;
  const raw = [
    process.env.https_proxy,
    process.env.HTTPS_PROXY,
    process.env.http_proxy,
    process.env.HTTP_PROXY,
    process.env.all_proxy,
    process.env.ALL_PROXY,
    readWindowsSystemProxy(),
  ].find((value) => typeof value === "string" && value.trim());
  if (!raw) {
    _proxyCache = null;
    return null;
  }
  let text = String(raw).trim();
  if (/^socks/i.test(text)) {
    // socks 需要额外依赖，这里不引；直连走不通时由上层报 offline，比假装成功好。
    _proxyCache = null;
    return null;
  }
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  try {
    const parsed = new URL(text);
    const port = Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    _proxyCache = { host: parsed.hostname, port, auth: parsed.username ? `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password || "")}` : "" };
  } catch {
    _proxyCache = null;
  }
  return _proxyCache;
}

function readWindowsSystemProxy() {
  if (process.platform !== "win32") return "";
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings", "/v", "ProxyServer"],
      { ...HIDDEN, encoding: "utf8" },
    );
    const hit = String(out).match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
    if (!hit) return "";
    // 形如 `127.0.0.1:7897` 或 `https=127.0.0.1:7897;http=...`，取 https 那段。
    const value = hit[1];
    const httpsPart = value.match(/https=([^;]+)/i);
    return (httpsPart ? httpsPart[1] : value.split(";")[0]).trim();
  } catch {
    return "";
  }
}

function proxyConnect(proxy, target) {
  return new Promise((resolve, reject) => {
    const headers = { host: `${target.hostname}:${target.port || 443}` };
    if (proxy.auth) {
      headers["proxy-authorization"] = `Basic ${Buffer.from(proxy.auth).toString("base64")}`;
    }
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers,
    });
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`update: proxy CONNECT ${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on("error", reject);
    req.end();
  });
}

export function pluginRoot() {
  return PLUGIN_ROOT;
}

export function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

function channelStatePath() {
  return path.join(findDshHome(), "dsh-purge", "channel.json");
}

function historyPath() {
  return path.join(findDshHome(), "dsh-purge", "version-history.json");
}

function stampPath() {
  return path.join(findDshHome(), "dsh-purge", "installed-rev");
}

function autoUpdateGuardPath() {
  return path.join(findDshHome(), "dsh-purge", "auto-update-guard.json");
}

/** 更新源镜像。账号被封停或仓库改名后，用户把仓库改成任意同名镜像即可继续查更新。 */
function repoOverridePath() {
  return path.join(findDshHome(), "dsh-purge", "repo.json");
}

/** 当前生效的 owner/repo。缺省常量，本地 repo.json 里有合法值就优先。 */
export function activeRepo() {
  const raw = readJson(repoOverridePath());
  const value = typeof raw?.repo === "string" ? raw.repo.trim() : "";
  return REPO_RE.test(value) ? value : REPO;
}

export function readRepoOverride() {
  const repo = activeRepo();
  return { repo, override: repo !== REPO, fallback: REPO };
}

/** 传空串或默认值即撤销覆盖，回到常量里的官方仓库。 */
export function writeRepoOverride(repo) {
  const value = String(repo || "").trim();
  if (!value || value === REPO) {
    try { fs.rmSync(repoOverridePath(), { force: true }); } catch { /* 删不掉就是没有，不影响读取 */ }
    return readRepoOverride();
  }
  if (!REPO_RE.test(value)) throw new Error("仓库要写成 owner/repo，例如 Luckinchan7/dsh-purge-022");
  atomicWriteSync(repoOverridePath(), `${JSON.stringify({ repo: value, at: new Date().toISOString() }, null, 2)}\n`);
  _remotePkgVerCache.clear();
  return readRepoOverride();
}

function markAutoUpdateGuard(ref, sha = "") {
  atomicWriteSync(autoUpdateGuardPath(), `${JSON.stringify({
    ref: String(ref || ""),
    sha: String(sha || ""),
    at: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function normalizeChannel(value) {
  return String(value || "").toLowerCase() === "beta" ? "beta" : "stable";
}

function isBetaName(name) {
  return /(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(String(name || ""));
}

function withdrawnVersion(item) {
  const text = [item?.version, item?.ref, item?.id].filter(Boolean).join(" ");
  return /(?:^|[\sv])1\.1\.11-beta/i.test(String(text).replace(/^v/i, " "));
}

function splitVersion(raw) {
  const text = String(raw || "").trim().replace(/^v/i, "");
  const cut = text.split("-");
  const core = String(cut[0] || "").split(".").map((n) => parseInt(n, 10) || 0);
  return { core: [core[0] || 0, core[1] || 0, core[2] || 0], pre: cut.slice(1).join("-") };
}

export function versionIsNewer(remote, local) {
  if (!remote) return false;
  if (!local) return true;
  if (String(remote) === String(local)) return false;
  const a = splitVersion(remote);
  const b = splitVersion(local);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  if (a.pre && !b.pre) return false;
  if (!a.pre && b.pre) return true;
  return a.pre > b.pre;
}

export function latestStableVersion(versions) {
  let best = "";
  for (const item of versions || []) {
    if (!item || item.channel === "beta") continue;
    const ver = String(item.version || "").replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+/.test(ver) || isBetaName(ver)) continue;
    if (!best || versionIsNewer(ver, best)) best = ver;
  }
  return best;
}

/** 测试通道只认 beta 分支头。旧的 beta/rc/pre 标签不列出。 */
export function hideListedVersion(item, _stableVersion = "") {
  if (!item || withdrawnVersion(item)) return true;
  if (item.ref === BETA_REF && item.channel === "beta") return false;
  return item.channel === "beta" || isBetaName(item.version) || isBetaName(item.ref) || isBetaName(item.id);
}

export function readChannelState() {
  const raw = readJson(channelStatePath()) || {};
  const stored = String(raw.channel || "").toLowerCase();
  const pin = typeof raw.pin === "string" ? raw.pin.trim() : "";
  const channel = stored === "beta" ? "beta" : "stable";
  const state = {
    channel,
    pin: isBetaName(pin) || pin === BETA_REF ? "" : pin,
  };
  if ((stored === "beta") !== (channel === "beta") || state.pin !== pin) writeChannelState(state);
  return state;
}

function writeChannelState(next) {
  const state = {
    channel: normalizeChannel(next?.channel),
    pin: typeof next?.pin === "string" ? next.pin.trim() : "",
  };
  atomicWriteSync(channelStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function channelPublic(state = readChannelState()) {
  const meta = CHANNELS[state.channel] || CHANNELS.stable;
  return {
    channel: meta.id,
    channelLabel: meta.label,
    pin: state.pin || "",
  };
}

function currentChannelRef(state = readChannelState()) {
  return (CHANNELS[state.channel] || CHANNELS.stable).ref;
}

function readHistory() {
  const raw = readJson(historyPath());
  const rows = Array.isArray(raw) ? raw : [];
  return rows.filter((item) => item && !withdrawnVersion(item));
}

function pushHistory(entry) {
  const next = [entry, ...readHistory().filter((item) => item && item.ref !== entry.ref)].slice(0, 20);
  atomicWriteSync(historyPath(), `${JSON.stringify(next, null, 2)}\n`);
}

/** 直连 codeload，避免 github.com/archive → 302 在 Electron/部分 Node 下变成 http 302 / fetch failed。 */
function archiveZipUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${activeRepo()}/zip/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${activeRepo()}/zip/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${activeRepo()}/zip/refs/heads/${encodeURIComponent(value)}`;
}

function archiveTarballUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${activeRepo()}/tar.gz/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${activeRepo()}/tar.gz/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${activeRepo()}/tar.gz/refs/heads/${encodeURIComponent(value)}`;
}

function readStamp() {
  try {
    return fs.readFileSync(stampPath(), "utf8").trim();
  } catch {
    return "";
  }
}

function writeStamp(value) {
  if (!value) return;
  atomicWriteSync(stampPath(), `${value}\n`);
}

function sameRev(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function isGitCheckout(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function canGit(dir) {
  if (!isGitCheckout(dir)) return false;
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], HIDDEN);
    return true;
  } catch {
    return false;
  }
}

function gitOk() {
  return canGit(PLUGIN_ROOT);
}

function gitHead(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], HIDDEN).trim();
  } catch {
    return "";
  }
}

export function isLinkSpec(spec) {
  const s = String(spec || "");
  return /^(link|file):/i.test(s) || s === "." || /^\.\.?(?:[/\\]|$)/.test(s);
}

export function resolveLinkDir(profileDir, spec) {
  const raw = String(spec).replace(/^(link|file):/i, "");
  return path.resolve(profileDir, raw);
}

export function findPurgeProfiles() {
  const root = path.join(findDshHome(), "profiles");
  if (!fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkg = readJson(path.join(dir, "package.json"));
    const hit = packageSpec(pkg);
    if (!hit) continue;
    out.push({ name, dir, spec: String(hit.spec), pkgName: hit.name });
  }
  return out;
}

/** 1.2.0 起包名从 dsh-purge 改成 dsh-purge-022，老 profile 里两种写法都要认。 */
const PACKAGE_NAMES = ["dsh-purge-022", "dsh-purge"];

function packageSpec(pkg) {
  if (!pkg) return null;
  for (const name of PACKAGE_NAMES) {
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const spec = pkg[key]?.[name];
      if (typeof spec === "string" && spec.trim()) return { name, key, spec };
    }
  }
  return null;
}

export function profilePluginDir(profileDir) {
  for (const name of PACKAGE_NAMES) {
    const nm = path.join(profileDir, "node_modules", name);
    if (fs.existsSync(nm)) return realPath(nm);
  }
  return "";
}

/** 把 profile 里的安装地址改成 codeload。github.com/archive 会 302，pnpm 的 fetch 接着失败。 */
function pinInstalledSpec(profileDir, ref) {
  if (!profileDir) return;
  const url = archiveTarballUrl(ref);
  const pkgPath = path.join(profileDir, "package.json");
  const pkg = readJson(pkgPath);
  const hit = packageSpec(pkg);
  if (pkg && hit && pkg[hit.key][hit.name] !== url) {
    pkg[hit.key][hit.name] = url;
    atomicWriteSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  // 这里曾经用正则把 pnpm-lock.yaml 里 importer 的 specifier/version 两行换成新地址，
  // 却没有写 packages:/snapshots: 条目。锁文件于是自相矛盾，pnpm 在任何命令之前校验
  // 锁文件就失败：
  //   ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY / Broken lockfile: no entry for 'dsh-purge@…'
  // dsh 又给子进程带 CI=1（frozen-lockfile 默认开），于是 profile 里连紧随其后、
  // 本来能修好它的 pnpm add --force 都起不来 —— 整个 profile 从此不可安装。
  // 这个手改并不需要：pin 完 package.json 后，pnpm 自己会在 add --force 时按新地址
  // 重新解析，把 importer / packages / snapshots 一次写一致。锁文件只能由解析出这些
  // 字段的解析器来写。
}

function planUpdates() {
  const profiles = findPurgeProfiles();
  const jobs = [];
  const seen = new Set();
  const remember = (dir) => {
    const key = realPath(dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const p of profiles) {
    if (isLinkSpec(p.spec)) {
      const dir = resolveLinkDir(p.dir, p.spec);
      if (!remember(dir)) continue;
      jobs.push(canGit(dir) ? { kind: "git", dir, profile: p.name } : { kind: "zip", dir, profile: p.name });
      continue;
    }
    const dir = profilePluginDir(p.dir) || PLUGIN_ROOT;
    jobs.push({ kind: "dsh", profile: p.name, spec: p.spec, dir, profileDir: p.dir });
    remember(dir);
  }

  if (!jobs.length) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
    return jobs;
  }
  if (remember(PLUGIN_ROOT)) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
  }
  return jobs;
}

function detectVia() {
  if (gitOk()) {
    const extra = findPurgeProfiles().some((p) => !isLinkSpec(p.spec));
    return extra ? "mixed" : "git";
  }
  if (findPurgeProfiles().some((p) => !isLinkSpec(p.spec))) return "dsh";
  if (findPurgeProfiles().length) return "dsh";
  return "zip";
}

function isAbortError(e) {
  const msg = String((e && e.message) || e || "");
  return (e && (e.name === "AbortError" || e.name === "TimeoutError")) || /aborted|abort|超时/i.test(msg);
}

function rewriteDownloadUrl(url) {
  const value = String(url || "");
  let match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/refs\/(tags|heads)\/(.+)\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[4].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/refs/${match[2]}/${decodeURIComponent(match[3])}`;
  }
  match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/([0-9a-f]{7,40})\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[3].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/${match[2]}`;
  }
  return "";
}

function requestBuffer(url, ms, headers, redirectsLeft = 5, socket) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error(`update: unsupported protocol ${parsed.protocol}`));
      return;
    }
    // socket 有三态：undefined = 还没试过代理；false = 已经试过、这回直连；对象 = 现成的 CONNECT 隧道。
    if (socket === undefined && parsed.protocol === "https:") {
      const proxy = resolveProxy();
      if (proxy) {
        proxyConnect(proxy, parsed)
          .then((tunnel) => requestBuffer(url, ms, headers, redirectsLeft, tunnel).then(resolve, reject))
          .catch(() => {
            // 代理挂了就退回直连，别让一个坏代理把整条更新链拖死。
            requestBuffer(url, ms, headers, redirectsLeft, false).then(resolve, reject);
          });
        return;
      }
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const opts = {
      method: "GET",
      headers: { "user-agent": "dsh-purge-update", accept: "*/*", ...headers },
    };
    if (socket) {
      // 走已有的 CONNECT 隧道。注意：直接把 createConnection 塞给 https.request 在
      // 「第一个参数是 URL 字符串」的形态下会被忽略（实测 ETIMEDOUT），必须包成 Agent。
      const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
      agent.createConnection = () => tls.connect({ socket, servername: parsed.hostname });
      opts.agent = agent;
    }
    const req = lib.request(parsed, opts, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("http redirect loop"));
          return;
        }
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        const candidate = loc ? new URL(loc, url).href : rewriteDownloadUrl(url);
        if (!candidate || candidate === url) {
          reject(new Error(`http ${status}`));
          return;
        }
        let nextUrl;
        try {
          nextUrl = new URL(candidate);
        } catch (e) {
          reject(e);
          return;
        }
        if (nextUrl.protocol !== "https:") {
          reject(new Error(`update: redirect rejected (non-https: ${nextUrl.protocol})`));
          return;
        }
        if (!UPDATE_REDIRECT_ALLOWED_HOSTS.has(nextUrl.hostname)) {
          reject(new Error(`update: redirect rejected (host not allowed: ${nextUrl.hostname})`));
          return;
        }
        requestBuffer(nextUrl.href, ms, headers, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        const rewritten = rewriteDownloadUrl(url);
        if (rewritten && rewritten !== url && redirectsLeft > 0) {
          requestBuffer(rewritten, ms, headers, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        reject(new Error(`http ${status}`));
        return;
      }
      const chunks = [];
      let received = 0;
      let aborted = false;
      res.on("data", (chunk) => {
        if (aborted) return;
        received += chunk.length;
        if (received > MAX_UPDATE_BYTES) {
          aborted = true;
          req.destroy(new Error(`update: response exceeds ${MAX_UPDATE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (!aborted) resolve({ status, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(ms, () => {
      req.destroy(new Error("GitHub 超时"));
    });
    req.end();
  });
}

async function fetchRes(url, ms = 20000, headers = {}) {
  const started = rewriteDownloadUrl(url) || url;
  try {
    const result = await requestBuffer(started, ms, headers);
    return {
      ok: true,
      status: result.status,
      async text() {
        return result.body.toString("utf8");
      },
      async arrayBuffer() {
        return result.body.buffer.slice(
          result.body.byteOffset,
          result.body.byteOffset + result.body.byteLength,
        );
      },
    };
  } catch (e) {
    if (isAbortError(e) || /GitHub 超时/.test(String(e && e.message))) throw new Error("GitHub 超时");
    throw e;
  }
}

async function fetchText(url, ms = 20000, headers = {}) {
  return (await fetchRes(url, ms, headers)).text();
}

async function fetchJson(url, ms = 20000, headers = {}) {
  return JSON.parse(await fetchText(url, ms, headers));
}

function versionFromPackageText(text) {
  const pkg = JSON.parse(text);
  return pkg && pkg.version ? String(pkg.version) : "";
}

// 远端 package.json 版本号查询:5 分钟 memo,频繁刷新面板时不重复打 raw.github / jsdelivr。
const _remotePkgVerCache = new Map();
const REMOTE_PKG_VER_TTL = 300_000;
async function remotePackageVersion(sha = "", fallbackRef = STABLE_REF) {
  const ref = sha || fallbackRef;
  const key = sha || `ref:${ref}`;
  const now = Date.now();
  const hit = _remotePkgVerCache.get(key);
  if (hit && now - hit.at < REMOTE_PKG_VER_TTL) return hit.value;
  const urls = [
    sha ? `https://cdn.jsdelivr.net/gh/${activeRepo()}@${sha}/package.json` : "",
    `https://raw.githubusercontent.com/${activeRepo()}/${ref}/package.json`,
    `https://cdn.jsdelivr.net/gh/${activeRepo()}@${ref}/package.json`,
    `https://api.github.com/repos/${activeRepo()}/contents/package.json?ref=${encodeURIComponent(ref)}`,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      if (url.includes("api.github.com/repos/")) {
        const data = await fetchJson(url, 20000, { accept: "application/vnd.github.raw" });
        let ver = "";
        if (typeof data === "string") ver = versionFromPackageText(data);
        else if (data && data.version) ver = String(data.version);
        else if (data && data.content && data.encoding === "base64") {
          ver = versionFromPackageText(Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8"));
        }
        if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
        continue;
      }
      const ver = versionFromPackageText(await fetchText(url));
      if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
    } catch {
      // 换下一个源。
    }
  }
  // 失败也记短缓存 30 秒,避免反复打空请求。
  _remotePkgVerCache.set(key, { value: "", at: now - (REMOTE_PKG_VER_TTL - 30_000) });
  return "";
}

async function remoteHeadSha(ref = STABLE_REF) {
  const target = encodeURIComponent(ref || STABLE_REF);
  const fromApi = fetchJson(`https://api.github.com/repos/${activeRepo()}/commits/${target}`)
    .then((data) => (data?.sha ? String(data.sha) : ""))
    .catch(() => "");
  const fromAtom = fetchText(`https://github.com/${activeRepo()}/commits/${ref}.atom`)
    .then((atom) => {
      const hit = atom.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/);
      return hit ? hit[1] : "";
    })
    .catch(() => "");
  const [apiSha, atomSha] = await Promise.all([fromApi, fromAtom]);
  return apiSha || atomSha || "";
}

function versionLabel(version, channel, sha = "") {
  const ver = String(version || "").replace(/^v/, "") || (sha ? String(sha).slice(0, 7) : "");
  const mark = channel === "beta" ? "测试" : "正式";
  return ver ? `${ver}（${mark}）` : mark;
}

/**
 * 远端到底怎么了。三个更新源全 404 和"网线被拔"在 checkUpdate 里长得一模一样，
 * 都会走"取不到远端"分支，但处理办法完全不同：前者换仓库，后者换网络。
 * 所以额外打一次仓库页，把状态码带回来。
 *   ok       仓库可读
 *   missing  仓库 404：账号被封停、仓库改名或转私有
 *   blocked  403：被限流或需要授权
 *   offline  连不上：网络/代理问题
 */
export async function probeRepo(repo = activeRepo()) {
  const urls = [
    `https://api.github.com/repos/${repo}`,
    `https://github.com/${repo}`,
  ];
  // 先问 api，再问网页。api 说 404（仓库确实没了）比网页连不上更有信息量，
  // 所以最后要按"信息量"挑结果，不能让后一个 URL 的 ECONNRESET 盖掉 missing。
  let best = null;
  const rank = { missing: 3, blocked: 2, ok: 1, offline: 0 };
  const keep = (probe) => {
    if (!best || rank[probe.state] > rank[best.state]) best = probe;
  };
  for (const url of urls) {
    const startedAt = Date.now();
    try {
      const res = await fetchRes(url, 15000, { accept: "application/vnd.github+json" });
      const ms = Date.now() - startedAt;
      // fetchRes 只在 2xx 时返回，所以走到这里就是仓库可读。
      return { state: "ok", status: res.status || 200, repo, url, ms };
    } catch (e) {
      // requestBuffer 对非 2xx 直接抛 `http <code>`，状态码只能从 message 里取；
      // 别把它当成网络故障——404 是仓库没了，403 是被拒，两者处理办法不同。
      const ms = Date.now() - startedAt;
      const msg = String((e && e.message) || e);
      const code = Number((msg.match(/^http (\d{3})$/) || [])[1] || 0);
      if (code === 403 || code === 429) {
        keep({ state: "blocked", status: code, repo, url, ms });
        continue;
      }
      if (code === 404) {
        keep({ state: "missing", status: 404, repo, url, ms });
        continue;
      }
      keep({ state: "offline", status: code, repo, url, ms, error: msg });
    }
  }
  return best || { state: "offline", status: 0, repo };
}

/** 把 probe 结果翻成人话，面板直接显示 error 字段。 */
export function describeProbe(probe) {
  const repo = probe?.repo || activeRepo();
  const status = probe?.status ? ` HTTP ${probe.status}` : "";
  if (probe?.state === "missing") {
    return `更新源 ${repo} 打不开${status}：账号被停用或仓库已改名。可在下面把更新源换成镜像仓库。`;
  }
  if (probe?.state === "blocked") {
    return `更新源 ${repo} 拒绝访问${status}：API 限流或需要授权，稍后再试。`;
  }
  return `连不上 ${repo}：网络不通或代理没开。`;
}

function rememberVersion(item, seen) {
  if (!item || !item.ref) return null;
  const key = `${item.sha || ""}|${item.ref}`.toLowerCase();
  if (seen.has(key)) return null;
  seen.add(key);
  return item;
}

const UPDATE_REF_RE = /^(?:v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?|master|main|beta|[0-9a-f]{7,40})$/i;

export function safeUpdateRef(ref) {
  const target = String(ref || "").trim();
  if (!target) return "";
  if (!UPDATE_REF_RE.test(target)) return "";
  return target;
}

export function markCurrent(versions, state, localVer, localSha) {
  const pin = String(state?.pin || "");
  const rows = versions || [];
  const ver = String(localVer || "").replace(/^v/i, "");
  const channel = state?.channel || "stable";
  const sameVersion = (item) => ver && String(item?.version || "").replace(/^v/i, "") === ver && item.channel === channel;
  const sameSha = (item) => Boolean(localSha && item?.sha && sameRev(localSha, item.sha));
  let chosen = null;
  if (pin) {
    chosen = rows.find((item) => item.ref === pin) || null;
  } else {
    const pool = rows.filter(sameVersion);
    // 安装记录里的旧提交号不能把较低版本标成当前。只认和正在跑的 package.json 相同的版本。
    chosen = pool.find((item) => sameSha(item) && (item.latest || item.ref === "master" || item.kind === "head"))
      || pool.find((item) => item.latest || item.ref === "master" || item.kind === "head")
      || pool.find((item) => sameSha(item))
      || pool[0]
      || null;
  }
  return rows.map((item) => ({
    ...item,
    shaShort: item.shaShort || (item.sha ? String(item.sha).slice(0, 7) : ""),
    current: Boolean(chosen && item === chosen),
  }));
}

async function listGithubTags() {
  try {
    const rows = await fetchJson(`https://api.github.com/repos/${activeRepo()}/tags?per_page=50`);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      const name = String(row?.name || "").trim();
      if (!name || !/^v?\d+\.\d+/.test(name)) return null;
      const sha = row?.commit?.sha ? String(row.commit.sha) : "";
      const channel = isBetaName(name) ? "beta" : "stable";
      return {
        id: name,
        ref: name,
        sha,
        version: name.replace(/^v/, ""),
        channel,
        label: versionLabel(name, channel, sha),
        kind: "tag",
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function ensureRunningVersion(versions, state, localVer, localSha) {
  const ver = String(localVer || "").replace(/^v/i, "");
  if (!ver || isBetaName(ver) || state?.channel === "beta") return versions;
  if ((versions || []).some((item) => item.channel === "stable" && String(item.version || "").replace(/^v/i, "") === ver)) {
    return versions;
  }
  const ref = `local-${ver}`;
  return [{
    id: ref,
    ref,
    sha: localSha || "",
    version: ver,
    channel: "stable",
    label: versionLabel(ver, "stable", localSha),
    kind: "local",
    latest: !(versions || []).some((item) => item.channel === "stable" && item.latest),
  }, ...(versions || [])];
}

async function listRemoteVersions() {
  const state = readChannelState();
  const seen = new Set();
  const out = [];
  const add = (item) => {
    const next = rememberVersion(item, seen);
    if (next) out.push(next);
  };

  const [stableSha, betaSha, tags] = await Promise.all([
    remoteHeadSha(STABLE_REF),
    remoteHeadSha(BETA_REF),
    listGithubTags(),
  ]);

  if (stableSha) {
    const version = await remotePackageVersion(stableSha, STABLE_REF).catch(() => "");
    add({
      id: STABLE_REF,
      ref: STABLE_REF,
      sha: stableSha,
      version: version || "",
      channel: "stable",
      label: `${versionLabel(version, "stable", stableSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  if (betaSha) {
    const version = await remotePackageVersion(betaSha, BETA_REF).catch(() => "");
    add({
      id: BETA_REF,
      ref: BETA_REF,
      sha: betaSha,
      version: version || "",
      channel: "beta",
      label: `${versionLabel(version, "beta", betaSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  for (const tag of tags) {
    if (!withdrawnVersion(tag)) add(tag);
  }
  for (const item of readHistory()) {
    if (!item || !item.ref || withdrawnVersion(item)) continue;
    add({
      ...item,
      label: item.label || versionLabel(item.version, item.channel, item.sha),
      kind: item.kind || "history",
    });
  }

  const localVer = localVersion();
  const localSha = (gitOk() ? gitHead(PLUGIN_ROOT) : "") || readStamp();
  const withLocal = ensureRunningVersion(out, state, localVer, localSha);
  const ceiling = latestStableVersion([
    ...withLocal,
    localVer && !isBetaName(localVer) ? { channel: "stable", version: localVer } : null,
  ].filter(Boolean));
  const visible = withLocal.filter((item) => !hideListedVersion(item, ceiling));
  return {
    versions: markCurrent(visible, state, localVer, localSha),
    hasBeta: Boolean(betaSha),
    stableSha,
    betaSha: betaSha || "",
  };
}

function describeLane(id, listed, state, localVer, localRev) {
  const sha = id === "beta" ? listed.betaSha : listed.stableSha;
  const versions = listed.versions.filter((item) => item.channel === id);
  // 本机这一条（kind: "local"）是 ensureRunningVersion 补出来的，不代表远端读到了东西。
  // 早先 hasRemote 直接把 versions.length 也算进来，于是远端全 404 时仍然判成"有远端"，
  // 面板拿本地版本号当 remoteVersion 报"已是最新"—— 更新源整个挂掉看起来像一切正常。
  const remoteVersions = versions.filter((item) => item.kind !== "local");
  const latest = remoteVersions.find((item) => item.latest);
  // head 那条的版本号要单独去 package.json 取（remotePackageVersion）。取不到时它是空字符串，
  // 上层 `remoteVersion: lane.version || lane.sha` 就会把一个提交号当版本号报给面板。
  // 所以这里补一层：head 没版本号时，退到同频道里最新的 tag 的版本号。
  let newestTagVersion = "";
  for (const item of remoteVersions) {
    if (item.kind !== "tag") continue;
    const ver = String(item.version || "").replace(/^v/i, "");
    if (!/^\d/.test(ver)) continue;
    if (!newestTagVersion || versionIsNewer(ver, newestTagVersion)) newestTagVersion = ver;
  }
  const version = latest?.version || newestTagVersion || "";
  const onLane = state.channel === id;
  const matchesHead = Boolean(localRev && sha && sameRev(localRev, sha));
  const current = matchesHead || versions.some((item) => item.current && (item.latest || (state.pin && item.ref === state.pin)));
  let hasUpdate = false;
  if (onLane && state.pin) {
    hasUpdate = Boolean(sha && localRev && !sameRev(localRev, sha));
  } else if (onLane && versionIsNewer(version, localVer)) {
    // 只跟版本号。提交号对不上就再 add --force，会在 dsh 杀掉宿主后形成无限重启。
    hasUpdate = true;
  } else if (onLane && !localVer && sha && localRev && !sameRev(localRev, sha)) {
    hasUpdate = true;
  }
  return {
    id,
    ref: CHANNELS[id].ref,
    version,
    sha: sha ? String(sha).slice(0, 7) : "",
    current,
    hasUpdate,
    hasRemote: Boolean(sha || remoteVersions.length),
  };
}

function lanesOf(listed, state, localVer, localRev) {
  return {
    stable: describeLane("stable", listed, state, localVer, localRev),
    beta: describeLane("beta", listed, state, localVer, localRev),
  };
}

export async function checkUpdate() {
  let state = readChannelState();
  const localVer = localVersion();
  const listed = await listRemoteVersions();
  const gitSha = gitOk() ? gitHead(PLUGIN_ROOT) : "";
  const stamp = readStamp();
  const localRev = gitSha || stamp;
  listed.versions = markCurrent(listed.versions, state, localVer, localRev);
  const channelRef = currentChannelRef(state);
  const lanes = lanesOf(listed, state, localVer, localRev);
  const lane = lanes[state.channel] || lanes.stable;
  if (!lane.hasRemote && state.channel === "beta") {
    return rememberUpdate({
      ok: true,
      hasUpdate: false,
      hasBeta: false,
      error: "还没有测试版",
      localVersion: localVer,
      remoteVersion: "",
      localSha: localRev ? localRev.slice(0, 7) : "",
      remoteSha: "",
      updateTarget: channelRef,
      via: detectVia(),
      versions: listed.versions,
      lanes,
      ...readRepoOverride(),
      ...channelPublic(state),
    });
  }
  if (!lanes.stable.hasRemote) {
    // 离线 / API 限流 / 仓库消失时不要把整块更新面板打成 500。
    // 取不到远端就只报状态，不提供任何可切换目标；但要说清到底是网络还是仓库本身。
    const probe = await probeRepo().catch((e) => ({ state: "offline", status: 0, repo: activeRepo(), error: String(e) }));
    return rememberUpdate({
      ok: true,
      hasUpdate: false,
      hasBeta: false,
      error: describeProbe(probe),
      probe,
      remoteUnreadable: true,
      localVersion: localVer,
      remoteVersion: "",
      localSha: localRev ? localRev.slice(0, 7) : "",
      remoteSha: "",
      updateTarget: channelRef,
      via: detectVia(),
      versions: listed.versions,
      lanes,
      ...readRepoOverride(),
      ...channelPublic(state),
    });
  }
  const result = {
    ok: true,
    hasUpdate: Boolean(lane.hasUpdate),
    hasBeta: listed.hasBeta,
    updateTarget: channelRef,
    pinned: Boolean(state.pin),
    localVersion: localVer,
    remoteVersion: lane.version || lane.sha,
    localSha: localRev ? localRev.slice(0, 7) : "",
    remoteSha: lane.sha,
    via: detectVia(),
    versions: listed.versions,
    lanes,
    ...readRepoOverride(),
    ...channelPublic(state),
  };
  rememberUpdate(result);
  return result;
}

function gitTrackedDirty(dir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "status", "--porcelain", "--untracked-files=no", "--", ...COPY_NAMES],
      HIDDEN,
    ).trim();
    return Boolean(out);
  } catch {
    return true;
  }
}

let lastUpdate = null;

function rememberUpdate(result) {
  lastUpdate = result && typeof result === "object" ? result : lastUpdate;
  return lastUpdate;
}

export function lastUpdateResult() {
  return lastUpdate;
}

function runGit(dir, args, timeout = 20000) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout,
    });
  } catch (e) {
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n").trim();
    throw new Error(detail || `git ${args.join(" ")}`);
  }
}

function gitResetTo(dir, ref, { force = false } = {}) {
  if (!force && gitTrackedDirty(dir)) {
    throw new Error("本地插件文件有未提交改动，未覆盖");
  }
  const target = safeUpdateRef(ref || STABLE_REF);
  if (!target) throw new Error("未知版本");
  try {
    runGit(dir, ["fetch", "origin", "--tags"], 60000);
  } catch {
    runGit(dir, ["fetch", "origin", "--tags", target], 60000);
  }
  if (target === STABLE_REF || target === BETA_REF) {
    try {
      runGit(dir, ["checkout", "-B", target, `origin/${target}`]);
      return;
    } catch {
      runGit(dir, ["reset", "--hard", `origin/${target}`]);
      return;
    }
  }
  try {
    runGit(dir, ["fetch", "origin", "--tags", target], 60000);
  } catch {
    // 上面已经 fetch 过全部分支。
  }
  runGit(dir, ["reset", "--hard", target]);
}

function extractZip(zip, dest) {
  // win32：tar(bsdtar) → powershell。darwin/linux：tar → unzip → python3 → bsdtar。
  // 外部工具都不可用时用 Node 解 zip，Linux 不会再去调用 powershell。
  extractZipArchive(zip, dest);
}

async function overlayFromZip(dests, ref = STABLE_REF) {
  const unique = [...new Set(dests.filter(Boolean).map((d) => realPath(d)))];
  if (!unique.length) return;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "dsh-purge-upd-"));
  try {
    const zip = path.join(tmp, "plugin.zip");
    const res = await fetchRes(archiveZipUrl(ref), 45000);
    await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    extractZip(zip, tmp);
    const names = await fsp.readdir(tmp);
    const unpacked = names
      .map((n) => path.join(tmp, n))
      .find((p) => fs.existsSync(path.join(p, "package.json")));
    if (!unpacked) throw new Error("zip 里没有 package.json");
    for (const dest of unique) {
      for (const name of COPY_NAMES) {
        const from = path.join(unpacked, name);
        const to = path.join(dest, name);
        if (!fs.existsSync(from)) continue;
        if (name === "lib" || name === "docs" || name === "bin") {
          try {
            await fsp.rm(to, { recursive: true, force: true });
          } catch (e) {
            // 删不掉说明文件被进程占用。继续 cp 会写出一半新文件一半旧文件的半升级,
            // 让 host 和插件的版本不一致。宁可抛错让用户彻底退出宿主再重试。
            throw new Error(
              `覆盖 ${to} 失败(${e.message || e})。可能被进程占用,请完全退出宿主后重试。`,
            );
          }
        }
        await fsp.cp(from, to, { recursive: true, force: true });
      }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function parseReapplyOutput(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 用刚写好的插件文件在新进程里还原并重打，避免还在跑旧补丁列表。 */
function runReapplyChild() {
  const cli = path.join(PLUGIN_ROOT, "lib", "reapply-cli.js");
  if (!fs.existsSync(cli)) return { ok: false, error: "缺少重新应用脚本" };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.DSH_PURGE_RESTART;
  let run;
  try {
    run = spawnSync(process.execPath, ["--expose-internals", cli], {
      cwd: PLUGIN_ROOT,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  const parsed = parseReapplyOutput(`${run.stdout || ""}\n${run.stderr || ""}`);
  if (parsed) return parsed;
  const detail = String(run.stderr || run.stdout || (run.error && run.error.message) || "重新应用失败").trim();
  return { ok: false, error: detail.slice(0, 500) || "重新应用失败" };
}

let applyUpdateInflight = null;

export async function applyUpdate(jobs = planUpdates(), options = {}) {
  // 同一时刻只能有一次 applyUpdate 在跑。第二次调用在第一次完成前共享同一个 Promise,
  // 避免两条 overlayFromZip 同时往同一目录写出一半文件,或两次 writeStamp 竞争。
  if (applyUpdateInflight) return applyUpdateInflight;
  applyUpdateInflight = (async () => {
    try {
      return await _applyUpdateImpl(jobs, options);
    } finally {
      applyUpdateInflight = null;
    }
  })();
  return applyUpdateInflight;
}

async function _applyUpdateImpl(jobs, options) {
  if (!Array.isArray(jobs)) {
    options = jobs && typeof jobs === "object" ? jobs : {};
    jobs = planUpdates();
  }
  const state = readChannelState();
  const ref = safeUpdateRef(options.ref || currentChannelRef(state) || STABLE_REF);
  if (!ref) throw new Error("未知版本");
  const force = options.force !== false;
  const pin = options.pin === false ? "" : (options.pin || state.pin || "");
  const channel = normalizeChannel(options.channel || state.channel);
  const zipDirs = [];
  const specProfiles = [];
  const vias = new Set();
  for (const job of jobs) {
    if (job.kind === "git") {
      try {
        gitResetTo(job.dir, ref, { force });
        vias.add("git");
        continue;
      } catch (e) {
        if (!force && /未提交改动/.test(String(e && e.message))) throw e;
        zipDirs.push(job.dir);
      }
      continue;
    }
    if (job.kind === "dsh") {
      // exe 和 web 都走 dsh plugin add → pnpm。pnpm 拉 GitHub 包会 302 或 fetch failed，
      // 而且 add --force 会先杀掉宿主。这里改为自己下载再覆盖。
      if (job.dir) zipDirs.push(job.dir);
      if (job.profileDir) specProfiles.push(job.profileDir);
      continue;
    }
    zipDirs.push(job.dir);
  }
  if (zipDirs.length) {
    await overlayFromZip(zipDirs, ref);
    vias.add("zip");
  }
  for (const dir of specProfiles) pinInstalledSpec(dir, ref);
  const sha = (gitOk() ? gitHead(PLUGIN_ROOT) : "") || (await remoteHeadSha(ref).catch(() => ""));
  const via = vias.size > 1 ? "mixed" : [...vias][0] || detectVia();
  const saved = writeChannelState({ channel, pin });
  const localVer = localVersion();
  const listed = await listRemoteVersions().catch(() => ({ versions: [], hasBeta: saved.channel === "beta" }));
  const reapplied = runReapplyChild();
  // reapply 真的成功才能承认这次升级：写 stamp / guard / history。
  // 失败就不写,下次 checkUpdate 还能发现没完成的升级,而不是误标为"已是最新"。
  if (reapplied.ok === true) {
    if (sha) markAutoUpdateGuard(ref, sha);
    if (sha) writeStamp(sha);
    pushHistory({
      ref,
      sha: sha || "",
      version: localVer,
      channel,
      label: versionLabel(localVer, channel, sha),
      at: new Date().toISOString(),
    });
  }
  const restartAfter = reapplied.ok === true && !reapplied.needsFullQuit;
  const needsFullQuit = reapplied.ok === true && Boolean(reapplied.needsFullQuit);
  return rememberUpdate({
    ok: reapplied.ok !== false,
    applied: reapplied.ok === true,
    hasUpdate: reapplied.ok !== true,
    hasBeta: listed.hasBeta,
    pinned: Boolean(saved.pin),
    localVersion: localVer,
    remoteVersion: localVer,
    localSha: sha ? String(sha).slice(0, 7) : "",
    remoteSha: sha ? String(sha).slice(0, 7) : "",
    needRestart: false,
    reloadClient: !restartAfter && !needsFullQuit,
    restartAfter,
    needsFullQuit,
    reapplied: reapplied.ok === true,
    needsRetry: reapplied.ok === false,
    error: reapplied.ok === false ? `文件已更新，但还原并重新应用失败: ${reapplied.error || "未知错误"}` : undefined,
    via,
    versions: listed.versions,
    lanes: lanesOf(listed, saved, localVer, sha),
    ...channelPublic(saved),
  });
}

export async function switchChannel(channel, { apply = true } = {}) {
  const next = normalizeChannel(channel);
  if (!apply) {
    writeChannelState({ channel: next, pin: "" });
    return checkUpdate();
  }
  return applyUpdate(planUpdates(), { ref: CHANNELS[next].ref, channel: next, pin: false, force: true });
}

function listedUpdateRef(target, listed) {
  const safe = safeUpdateRef(target);
  if (!safe) return "";
  const hit = (listed?.versions || []).find((item) => (
    item.ref === safe
    || item.id === safe
    || item.sha === safe
    || (item.sha && safe.length >= 7 && (item.sha.startsWith(safe) || safe.startsWith(item.sha)))
  ));
  return safeUpdateRef(hit?.ref || "");
}

export async function switchVersion(ref) {
  const raw = String(ref || "").trim();
  if (withdrawnVersion({ ref: raw, version: raw })) throw new Error("该版本已下线");
  const target = safeUpdateRef(raw);
  if (!target) throw new Error("请选择要回退的版本");
  const listed = await listRemoteVersions();
  const resolved = listedUpdateRef(target, listed);
  if (!resolved) throw new Error("未知版本");
  const hit = listed.versions.find((item) => item.ref === resolved);
  const channel = hit?.channel || readChannelState().channel;
  const pin = hit?.latest ? "" : resolved;
  return applyUpdate(planUpdates(), { ref: resolved, channel, pin, force: true });
}

export async function handleUpdateOp(body = {}) {
  const op = String(body.op || (body.auto ? "auto" : "apply")).toLowerCase();
  if (op === "check" || op === "status" || op === "versions") return checkUpdate();
  if (op === "repo") {
    // 只改更新源，不动已装好的文件。改完立刻重新探一次，面板能马上看到新源通不通。
    const saved = writeRepoOverride(body.repo);
    const next = await checkUpdate();
    return { ...next, ...saved, repoChanged: true };
  }
  if (op === "channel") return switchChannel(body.channel, { apply: body.apply !== false });
  if (op === "switch" || op === "rollback") return switchVersion(body.ref || body.version || body.id);
  if (op === "auto") return autoUpdateIfNeeded();
  const state = readChannelState();
  const requested = body.ref || currentChannelRef(state);
  const ref = safeUpdateRef(requested);
  if (!ref) throw new Error("未知版本");
  if (ref !== BETA_REF && isBetaName(ref)) throw new Error("该测试标签已不再提供");
  if (ref !== STABLE_REF && ref !== BETA_REF) {
    const listed = await listRemoteVersions();
    if (!listedUpdateRef(ref, listed)) throw new Error("未知版本");
  }
  const channel = ref === BETA_REF ? "beta" : (ref === STABLE_REF ? "stable" : normalizeChannel(body.channel || state.channel));
  return applyUpdate(planUpdates(), { ref, channel, pin: false, force: true });
}

export async function autoUpdateIfNeeded() {
  // 插件只允许用户在面板手动更新；启动路径永不自动升（版本适配依赖本机宿主）。
  return rememberUpdate({
    auto: true,
    skipped: "manual-only",
    hasUpdate: false,
    error: "",
    ...readRepoOverride(),
    ...channelPublic(),
  });
}
