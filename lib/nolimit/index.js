/**
 * 无限制模式（nolimit）：预设安装 + 注册。
 *
 * 与 redteam 的关系：两者互不依赖。redteam 有自己的 presets/redteam 与
 * skills/redteam，无限制模式只借它的技能文件（同样是一批可执行步骤），
 * 不借它的流程。
 *
 * 这个模块做两件事：
 *   1. 首次把 `presets/nolimit` 落到 `$DSH_HOME/.agent-presets/nolimit/`
 *   2. 向 agentPresets 注册，让模式下拉里出现"无限制模式"
 *
 * 为什么不用扫磁盘：Web 0.1.7+ 的模式下拉只认 agent-presets registry.register()，
 * 光把目录放到 .agent-presets 下不会出现在下拉里（红队那边踩过同一个坑）。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPresetDefinition } from '../redteam/preset-composition.js';
import { buildChildPreset, bindParentToChild } from './child-preset.js';

export const name = 'dsh-purge-nolimit';
export const inject = [];

const NOLIMIT_PRESET_ID = 'nolimit';
/** 由父预设派生的兼容子预设 id，与 `release/presets/nolimit` 无关，纯运行时生成。 */
const NOLIMIT_CHILD_ID = `${NOLIMIT_PRESET_ID}-child`;

/** 插件根目录（lib/nolimit → 上两级）。 */
export function packagePaths() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..');
  return {
    root,
    presetDir: join(root, 'presets', 'nolimit'),
  };
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** 用户 preset 根（与 dsh-agent-presets 的 USER_PRESET_DIR 保持一致）。 */
export function userPresetRoot() {
  return join(dshHome(), '.agent-presets');
}

/**
 * 把包内 presets/nolimit 落到用户 preset 目录。
 *
 * 只在目标不存在、或显式 force 时覆盖：用户自己改过的人设不该被插件启动覆盖掉。
 * 覆盖入口是环境变量 NOLIMIT_PRESET_REFRESH=1。
 *
 * @param {{ force?: boolean, log?: (msg: string) => void }} [options]
 * @returns {{ action: 'installed' | 'updated' | 'kept' | 'failed', dir: string, error?: string }}
 */
export function installPreset(options = {}) {
  const paths = packagePaths();
  const target = join(userPresetRoot(), NOLIMIT_PRESET_ID);
  const log = options.log ?? (() => {});
  const presetFile = join(target, 'agent.cordis.yml');

  if (!existsSync(paths.presetDir)) {
    return { action: 'failed', dir: target, error: '包内 presets/nolimit 不存在' };
  }

  const force = options.force === true;
  if (existsSync(presetFile) && !force) {
    /* 自愈：文件在但不是这一版（缺 persona.mjs / 缺 preset.yml）→ 补齐缺的那几个。 */
    let repaired = false;
    for (const file of readdirSync(paths.presetDir)) {
      const to = join(target, file);
      if (existsSync(to)) continue;
      try {
        cpSync(join(paths.presetDir, file), to);
        repaired = true;
      } catch (error) {
        log(`补齐 ${file} 失败：${error?.message ?? String(error)}`);
      }
    }
    if (repaired) {
      log(`无限制模式预设已补齐缺失文件：${target}`);
      return { action: 'updated', dir: target };
    }
    return { action: 'kept', dir: target };
  }

  try {
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(paths.presetDir)) {
      const text = readFileSync(join(paths.presetDir, file), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      writeFileSync(join(target, file), text, 'utf8');
    }
  } catch (error) {
    return { action: 'failed', dir: target, error: error?.message ?? String(error) };
  }
  log(`无限制模式预设已安装到 ${target}`);
  return { action: 'installed', dir: target };
}

/** 状态文件，与红队那份并列，便于面板/排错看。 */
function statusFile() {
  return join(dshHome(), 'redteam', 'nolimit-preset.json');
}

function writeStatus(patch, log) {
  try {
    const file = statusFile();
    mkdirSync(dirname(file), { recursive: true });
    let prev = {};
    try {
      prev = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      /* first write */
    }
    writeFileSync(file, JSON.stringify({ ...prev, ...patch, at: new Date().toISOString() }, null, 2), 'utf8');
  } catch (error) {
    log?.(`写入状态失败：${error?.message ?? String(error)}`);
  }
}

export function apply(ctx) {
  const log = (msg) => ctx.logger?.info?.('nolimit-mode: ' + msg);

  let result;
  try {
    result = installPreset({
      force: process.env.NOLIMIT_PRESET_REFRESH === '1',
      log,
    });
  } catch (error) {
    ctx.logger?.error?.('nolimit-mode: 预设安装失败：%s', error?.message ?? String(error));
    result = { action: 'failed', dir: join(userPresetRoot(), NOLIMIT_PRESET_ID) };
  }

  writeStatus({ ok: false, phase: 'apply-start', presetDir: result.dir }, log);

  /* 与 redteam 同款：agentPresets 可能比本插件晚就绪，重试到出现为止。 */
  /** 已注册声明的 disposer 列表，长度 0/1/2（子预设 + 父预设）。 */
  let releaseDeclared;
  let closed = false;

  const softRegistry = () => {
    try {
      const reg = ctx.get('agentPresets');
      if (reg && typeof reg.register === 'function') return reg;
    } catch {
      /* missing */
    }
    try {
      if (ctx.agentPresets && typeof ctx.agentPresets.register === 'function') return ctx.agentPresets;
    } catch {
      /* without inject */
    }
    return null;
  };

  const undeclare = async () => {
    const disposers = releaseDeclared;
    releaseDeclared = undefined;
    if (!disposers || !disposers.length) return;
    /* 逆序释放：父预设先注册、子预设后注册，退的时候先退父，避免父的
       agentPreset 指向一个已经消失的 id。 */
    for (const dispose of disposers) {
      try {
        await dispose();
      } catch (error) {
        ctx.logger?.warn?.('nolimit-mode: undeclare failed: %s', error?.message ?? String(error));
      }
    }
  };

  const buildDefinition = () => {
    const fromDisk = join(userPresetRoot(), NOLIMIT_PRESET_ID);
    if (!existsSync(join(fromDisk, 'agent.cordis.yml'))) {
      installPreset({ force: false, log: () => {} });
    }
    const readyDir = existsSync(join(fromDisk, 'agent.cordis.yml'))
      ? fromDisk
      : packagePaths().presetDir;
    return readPresetDefinition(NOLIMIT_PRESET_ID, readyDir);
  };

  const registerOnce = (registry) => {
    let definition;
    let child;
    try {
      definition = buildDefinition();
      /* 先派生再绑定：child 必须从「还没有 agentPreset」的父体克隆出来，
         否则 child 的 spawn 行会指向 child 自己，eager registration 时自引用。 */
      child = buildChildPreset(definition, { id: NOLIMIT_CHILD_ID });
      const bound = bindParentToChild(definition, { childId: child.id });
      if (bound === 0 && process.env.NOLIMIT_REQUIRE_CHILD === '1') {
        throw new Error('父预设里没有 spawn 行可绑定子预设');
      }
    } catch (error) {
      writeStatus({ ok: false, phase: 'read-failed', error: error?.message ?? String(error) }, log);
      ctx.logger?.warn?.('nolimit-mode: read preset failed: %s', error?.message ?? String(error));
      return;
    }
    writeStatus({
      ok: false,
      phase: 'registering',
      id: definition.id,
      name: definition.name,
      plugins: Array.isArray(definition.plugins) ? definition.plugins.length : -1,
      child: { id: child.id, name: child.name, plugins: child.plugins.length, order: child.order },
    }, log);
    Promise.resolve()
      .then(async () => {
        await undeclare();
        /* 子预设先注册：父预设的 agentPreset 指向它，反过来的话父先落地会短暂指向
           一个尚未存在的 id（宿主 resolve() 对未知预设是硬抛）。 */
        const disposers = [];
        disposers.push(await registry.register(child));
        disposers.push(await registry.register(definition));
        releaseDeclared = disposers;
        let broken = null;
        let childBroken = null;
        try {
          const rows = await registry.list();
          broken = rows.find((p) => p.id === NOLIMIT_PRESET_ID)?.broken || null;
          childBroken = rows.find((p) => p.id === child.id)?.broken || null;
        } catch {
          /* ignore */
        }
        const failed = broken || childBroken;
        writeStatus({
          ok: !failed,
          phase: failed ? 'registered-broken' : 'registered',
          id: definition.id,
          name: definition.name,
          plugins: Array.isArray(definition.plugins) ? definition.plugins.length : -1,
          child: {
            id: child.id,
            name: child.name,
            plugins: child.plugins.length,
            order: child.order,
            broken: childBroken,
          },
          broken,
        }, log);
        if (failed) ctx.logger?.warn?.('nolimit-mode: declared but broken: %s', failed);
        else log(`已注册到模式下拉：${definition.name || NOLIMIT_PRESET_ID} + ${child.name}`);
      })
      .catch((error) => {
        writeStatus({ ok: false, phase: 'register-failed', error: error?.message ?? String(error) }, log);
        ctx.logger?.warn?.('nolimit-mode: register failed: %s', error?.message ?? String(error));
      });
  };

  ctx.effect(() => {
    let tries = 0;
    const tick = () => {
      if (closed) return true;
      tries += 1;
      const registry = softRegistry();
      if (!registry) {
        writeStatus({ ok: false, phase: 'waiting-registry', tries }, log);
        return false;
      }
      registerOnce(registry);
      return true;
    };
    let timer;
    let stop;
    if (!tick()) {
      timer = setInterval(() => {
        if (tick()) {
          clearInterval(timer);
          timer = undefined;
          if (stop) clearTimeout(stop);
        }
      }, 400);
      if (typeof timer.unref === 'function') timer.unref();
      stop = setTimeout(() => {
        if (timer) {
          clearInterval(timer);
          timer = undefined;
          writeStatus({ ok: false, phase: 'timeout-waiting-registry', tries }, log);
        }
      }, 45000);
      try {
        stop.unref?.();
      } catch {
        /* ignore */
      }
    }
    return () => {
      closed = true;
      if (timer) clearInterval(timer);
      if (stop) clearTimeout(stop);
      void undeclare();
    };
  }, 'dsh-purge-nolimit: declare agent preset');

  ctx.provide('nolimitMode', Object.freeze({ preset: result }));
  log(`就绪（预设目录 ${result.dir}）`);
}

export default { name, inject, apply };
