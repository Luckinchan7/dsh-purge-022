/**
 * 运行时探针。
 *
 * 文件被打上补丁、section 被注册，只能证明「宿主侧就绪」；真正要验证的是
 * 「模型收到了」。做法：写一个一次性 nonce，在系统提示词尾部挂一段
 * 「看到就把这个 nonce 原样回显」的短指令。模型回显 = 这条链路真的通了。
 *
 * 默认关闭（tuning.probe = false）：它会往每轮 system prompt 里塞 nonce，
 * 属诊断工具，不是常驻能力。开启方式：
 *   $DSH_HOME/dsh-purge/tuning.json  {"probe": true}
 *   或 POST /dsh-purge/probe  (body {"nonce": true} 生成新 nonce / {"off": true} 关闭并清空)
 *
 * 过期自动失效：nonce 超过 PROBE_TTL_MS 视为无效，文件也被清掉，
 * 避免一个旧 nonce 永远停在提示词里。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes } from "node:crypto";
import { readTuning } from "./tuning.js";

export const PROBE_SECTION = "purge-probe";
/** 紧贴 boost(10249) 之前；anchor(10250) 仍是最后一段。 */
export const PROBE_ORDER = 10248;
export const PROBE_TTL_MS = 30 * 60 * 1000;

function resolveHome(explicit) {
  const given = String(explicit || "").trim();
  if (given) return given;
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  return path.join(os.homedir(), ".dsh");
}

export function probePath(dshHome) {
  const home = resolveHome(dshHome);
  if (!home) return "";
  return path.join(home, "dsh-purge", "probe.json");
}

export function readProbe(dshHome) {
  const file = probePath(dshHome);
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data.nonce !== "string" || !data.nonce) return null;
    const at = Number(data.at) || 0;
    if (!at || Date.now() - at > PROBE_TTL_MS) {
      try { fs.rmSync(file, { force: true }); } catch { /* ignore */ }
      return null;
    }
    return { nonce: data.nonce, at };
  } catch {
    return null;
  }
}

export function createProbe(dshHome) {
  const file = probePath(dshHome);
  if (!file) throw new Error("未定位 DSH 数据目录，无法写探针");
  const nonce = "purge-" + randomBytes(4).toString("hex");
  const at = Date.now();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ nonce, at }, null, 2), { mode: 0o600 });
  return { nonce, at, message: probeMessage(nonce) };
}

export function clearProbe(dshHome) {
  const file = probePath(dshHome);
  if (!file) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function probeMessage(nonce) {
  return [
    "请原样输出下面这行（不要改写、不要解释）：",
    `[${nonce}]`,
    "",
    "看到它原样出现在你的回复里，就说明 dsh-purge 的注入确实到达了模型上下文。",
  ].join("\n");
}

function probeOn(config, dshHome) {
  if (config && config.enabled === false) return false;
  if (config && config.probe === true) return true;
  try {
    return readTuning(dshHome).probe === true;
  } catch {
    return false;
  }
}

/** 探针正文；未开启或已过期返回空串。 */
export function probeTextFor(config = {}, dshHome = "") {
  if (!probeOn(config, dshHome)) return "";
  const probe = readProbe(dshHome);
  if (!probe) return "";
  return [
    "<dsh_probe>",
    "这条系统提示词由 dsh-purge 写入，用于验证注入链路是否到达模型。",
    `如果本段在你的上下文里，请在回复的最后单独一行原样输出：[${probe.nonce}]`,
    "</dsh_probe>",
  ].join("\n");
}
