/**
 * 「无限制模式 · 子任务」——由父预设派生的兼容子预设。
 *
 * 为什么需要它
 * ------------
 * 0.2.2 起 `dsh-tool-subagent` 的 config 里出现 `toolFilter` / `persona` 会直接抛：
 *   tool-subagent: toolFilter is no longer supported; configure persona and tool
 *   plugins in an Agent Preset and select it with agentPreset (spawn only)
 * 也就是「子会话要裁剪工具」这件事只能靠「另立一份预设 + 用 agentPreset 指过去」实现，
 * 不能在父预设的那一行上写 deny 名单。
 *
 * 所以这里在运行时把父预设 clone 一份、按工具名摘掉几行、另注册成一份独立预设。
 * 子预设与父预设同源：父预设改了人设/工具面，子预设自动跟上，不需要维护两份 YAML。
 *
 * 与 king 版 preset-compat.js 的差别
 * ----------------------------------
 * king 是「用户 YAML 里写旧式 toolFilter → 迁移成原生子预设」，迁移要备份、要
 * 内容寻址目录、要处理历史 ID 恢复。我们没有旧式配置要迁移，直接生成即可，
 * 所以没有备份目录与 manifest——少一层状态，少一处能坏的地方。
 */

/** 子预设相对父预设的 name 后缀，与 king 的显示约定一致。 */
export const CHILD_NAME_SUFFIX = ' · 子任务';

/** 子会话要摘掉的工具名（agent 平面的工具名，不是包名）。 */
export const CHILD_DENY = Object.freeze(['subagent_fork', 'workflow', 'ralph']);

/**
 * 包名 → 工具名。只列会产出被 deny 工具的行，其余返回 undefined。
 *
 * `dsh-tool-subagent` 一个包能提供多种工具（spawn / fork），真实工具名在
 * config.toolName 里，所以这个包必须单独判断，不能只看包名。
 */
const TOOL_NAMES = new Map([
  ['@deepseek-ai/dsh-tool-workflow', 'workflow'],
  ['@deepseek-ai/dsh-tool-ralph', 'ralph'],
  // 这两个不是工具行而是 workflow 的 provider；留着会注册一份用不上的引擎。
  ['@deepseek-ai/dsh-workflow-ptc', 'workflow'],
  ['@deepseek-ai/dsh-workflow-worker-thread', 'workflow'],
]);

const SUBAGENT_PKG = '@deepseek-ai/dsh-tool-subagent';

/**
 * 一行的 agent 工具名。
 * @param {any} row - 一行插件声明。
 * @returns {string | undefined}
 */
export function toolNameOf(row) {
  if (!row || typeof row.name !== 'string') return undefined;
  if (row.name === SUBAGENT_PKG) return row.config?.toolName ?? 'subagent';
  return TOOL_NAMES.get(row.name);
}

/**
 * 递归过滤行树。group 行的 config 是子行列表，要一并过滤。
 * @param {any[]} rows
 * @param {Set<string>} deny
 * @returns {any[]}
 */
function filterRows(rows, deny) {
  if (!Array.isArray(rows)) return rows;
  const kept = [];
  for (const row of rows) {
    if (deny.has(toolNameOf(row))) continue;
    if (row?.group === true && Array.isArray(row.config)) {
      kept.push({ ...row, config: filterRows(row.config, deny) });
    } else {
      kept.push(row);
    }
  }
  return kept;
}

/**
 * 从父预设生成子预设声明。
 *
 * 不改动入参：返回的对象与父预设完全独立，注册两份声明不会互相污染。
 *
 * @param {{ id: string, name?: string, description?: string, order?: number, plugins: any[] }} parent
 * @param {{ id?: string, deny?: readonly string[] }} [options]
 * @returns {{ id: string, name: string, description: string, order: number, plugins: any[] }}
 */
export function buildChildPreset(parent, options = {}) {
  if (!parent || typeof parent.id !== 'string' || !parent.id) {
    throw new Error('nolimit: 父预设缺少 id，无法生成子预设');
  }
  if (!Array.isArray(parent.plugins)) {
    throw new Error(`nolimit: 父预设 ${parent.id} 的 plugins 不是数组`);
  }
  const deny = new Set(options.deny ?? CHILD_DENY);
  const id = options.id ?? `${parent.id}-child`;
  const parentName = parent.name ?? parent.id;
  const baseOrder = Number.isFinite(parent.order) ? parent.order : 15;

  const child = {
    id,
    name: `${parentName}${CHILD_NAME_SUFFIX}`,
    description:
      `兼容子预设：继承父预设提示词和设置，排除 ${[...deny].join('、')}。` +
      `主会话请选择 ${parentName}。`,
    /* 紧跟父预设之后：父预设 15、子预设 15.1，别的预设不会被顶开。 */
    order: Math.round((baseOrder + 0.1) * 1000) / 1000,
    plugins: filterRows(structuredClone(parent.plugins), deny),
  };

  /* 自检：被 deny 的工具名一行都不该剩；`toolFilter` / `persona` 这两个已废弃的
     键一旦出现，宿主会把整份预设判成 broken，所以在交给 registry 之前就拦住。 */
  assertNoDeniedRows(child.plugins, deny, `${id}`);
  assertLegacyKeysAbsent(child.plugins, `${id}`);

  return child;
}

/**
 * 递归确认 deny 名单里的工具没有残留在任何层级。
 * @param {any[]} rows
 * @param {Set<string>} deny
 * @param {string} label
 */
function assertNoDeniedRows(rows, deny, label) {
  for (const row of rows) {
    const name = toolNameOf(row);
    if (name !== undefined && deny.has(name)) {
      throw new Error(`nolimit: ${label} 生成后仍残留被排除的工具 ${name}`);
    }
    if (row?.group === true && Array.isArray(row.config)) {
      assertNoDeniedRows(row.config, deny, label);
    }
  }
}

/**
 * 递归确认已废弃的 config 键不存在。
 * @param {any[]} rows
 * @param {string} label
 */
function assertLegacyKeysAbsent(rows, label) {
  for (const row of rows) {
    const config = row?.config;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      for (const key of ['toolFilter', 'persona']) {
        if (Object.hasOwn(config, key)) {
          throw new Error(`nolimit: ${label} 的 ${row.id ?? row.name} 仍带已废弃的 ${key}`);
        }
      }
    }
    if (row?.group === true && Array.isArray(row.config)) {
      assertLegacyKeysAbsent(row.config, label);
    }
  }
}

/**
 * 把父预设的 spawn 行绑定到子预设。
 *
 * 直接改用户磁盘上的 YAML 也能做到，但那样父预设就依赖「子预设已注册」这个前提而
 * 自己却看不出来。这里在注册前显式绑定，绑定关系只存在于内存声明里，磁盘 YAML 保持
 * 可独立阅读。
 *
 * 只写 `agentPreset`、**不写** `allowedAgentPresets`：
 *   - `allowedAgentPresets` 存在的意义是给模型暴露 `agent_preset` 选择参数
 *     （`SubagentPresetSelection.get choices()` 是它、`resolve()` 靠它校验）。
 *     这里只有唯一一个目标，模型没有可选项，暴露它只会白涨 schema 体积，
 *     还会让模型自己传一个不存在的 id 时撞 "agent_preset selection is disabled"。
 *   - 只写 `agentPreset` 时 `configured` 仍为 true，`description` 一样会告诉模型
 *     “省略就用 <child id>”，语义完整。
 *
 * @param {{ plugins: any[] }} definition - 会被就地修改。
 * @param {{ childId: string, toolName?: string }} options
 * @returns {number} 被改写的行数。
 */
export function bindParentToChild(definition, options) {
  const toolName = options.toolName ?? 'subagent';
  let touched = 0;
  const walk = (rows) => {
    for (const row of rows) {
      if (toolNameOf(row) === toolName) {
        const config = { ...(row.config ?? {}), agentPreset: options.childId };
        /* 之前若有别的绑定残留，清掉，避免 allowedAgentPresets 与 agentPreset 打架。 */
        delete config.allowedAgentPresets;
        row.config = config;
        touched += 1;
      }
      if (row?.group === true && Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(definition.plugins);
  return touched;
}
