# dsh-purge 1.1.71-rc2.10

**无限制模式 · 子任务** —— 模式下拉里从 1 项变 2 项。

---

## 为什么加这个

0.2.2 起 `dsh-tool-subagent` 的 config 里只要出现 `toolFilter` 或 `persona`，宿主直接抛：

```
tool-subagent: toolFilter is no longer supported; configure persona and tool
plugins in an Agent Preset and select it with agentPreset (spawn only)
```

也就是说「子会话要裁掉几个工具」这件事，官方留的唯一正规做法是：**另立一份预设，用 `agentPreset` 指过去**。以前靠 `toolFilter.deny` 一行搞定，现在必须有一份独立预设。

所以：**无限制模式 · 子任务**。

---

## 它是什么

模式下拉里新增一项，名字是 `无限制模式 · 子任务`，`order: 15.1`（紧跟在父预设 `order: 15` 之后）。

它**不是磁盘上的目录**，而是 `lib/nolimit/child-preset.js` 在注册前从 `presets/nolimit/agent.cordis.yml` clone 出来的一份声明：

- 人设、工具面、plan-mode 段、compaction 阈值、persona 段 —— **全部与父预设逐字一致**
- 只摘掉三样：`subagent_fork`、`workflow`、`ralph`（连同 `dsh-workflow-ptc` / `dsh-workflow-worker-thread` 两个只为 workflow 服务的引擎行）

**同源的好处**：改父预设的人设或工具，父子同时生效，不需要维护两份 YAML 再手工同步。这也正是 king 的 `preset-compat.js` 走「从用户 YAML 迁移」而不是「另发一份 YAML」的原因——只是他那边要处理旧式 `toolFilter` 的迁移、内容寻址备份、历史 ID 恢复；我们这里直接生成，没有旧配置要迁，也就没有那一层状态。

---

## 怎么起作用的

注册顺序是 **子预设先、父预设后**：

```
registry.register(child)   // 无限制模式 · 子任务
registry.register(parent)  // 无限制模式（spawn 行的 agentPreset 已指向 child）
```

顺序不能反。父预设的 `agentPreset` 一旦指向未注册的 id，宿主 `resolve()` 是硬抛而不是回退，整份预设会判 `registered-broken`、在下拉里消失。这条有专门的自检项在盯着（见下）。

父预设 YAML 里**不写** `agentPreset`。磁盘文件保持可独立阅读，绑定关系由 `bindParentToChild()` 在注册前补进内存声明——写死在 YAML 里会让预设依赖一个它自己看不见的前提（子预设是否已注册）。

绑定只写 `agentPreset`，**不写** `allowedAgentPresets`：

- `allowedAgentPresets` 的作用是给模型暴露 `agent_preset` 选择参数（`SubagentPresetSelection.get choices()` 就是它）
- 这里只有唯一目标，模型没有可选项，暴露它只白涨 schema 体积，还会让模型自己传一个不存在的 id 时撞 `agent_preset selection is disabled`
- 只写 `agentPreset` 时 `configured` 仍为 `true`，`description` 一样告诉模型「省略就用 `<child id>`」，语义完整

`subagent_fork` 行不绑定 —— fork 会继承父会话上下文，`inheritsParentContext = true`，宿主本身就不允许它独立选预设（`SubagentPresetSelection.assertProvider()` 会抛 `does not support independent agent preset selection`）。

---

## 什么时候用它

| 场景 | 选哪个 |
|---|---|
| 主会话干活 | **无限制模式** |
| 派子智能体单线推进 | 不用选 —— 父预设的 spawn 行已经把子会话指向子预设了 |
| 子会话要**再往下派** | 那就别用子预设。子预设存在的意义就是「到此为止，自己干完」 |

换句话说：主会话仍然全工具集（`subagent` / `subagent_fork` / `workflow` / `ralph` 全在），**只有子会话被收窄**。这与 redteam 的做法相反——redteam 用 `maxDepth: 1` 把子智能体钉成叶子，因为它要控并发和阶段；无限制模式的父会话不需要任何深度限制，只要求「派出去的那个别再把活转包出去」。

---

## 落盘状态

`~/.dsh/redteam/nolimit-preset.json` 现在会同时报父子两份：

```json
{
  "ok": true,
  "phase": "registered",
  "id": "nolimit",
  "name": "无限制模式",
  "plugins": 20,
  "child": {
    "id": "nolimit-child",
    "name": "无限制模式 · 子任务",
    "plugins": 20,
    "order": 15.1,
    "broken": null
  },
  "broken": null
}
```

`plugins: 20` 两份一样是正常的——被摘的 5 行全在 `delegation` group 内部，顶层仍是 20 行（persona / agent-instructions / tool-bash / tool-pwsh / tool-fs / tool-fs-search / tool-jobs / skill-filesystem / tool-skill / command-goal / tool-goal / planning / compaction / delegation / tool-ask-user / tool-todo / tool-web / present / tool-office / tool-schedule）。递归行数 20 → 15。

---

## 自检

`purge-inspect/verify-rc210.mjs` —— 36 项，全过：

- 父预设解析（id / name / order / plugins 数）
- 工具名映射：`dsh-tool-subagent` 按 `config.toolName` 分辨 `subagent` 与 `subagent_fork`；`dsh-tool-workflow` → `workflow`；`dsh-tool-ralph` → `ralph`；`dsh-tool-bash` → `undefined`
- 子预设 id / name 后缀 / order / description 提到三个排除项
- 递归行数 20 → 15，顶层长度不变
- 递归确认 `subagent_fork` / `workflow` / `ralph` 一个不剩，`subagent` 保留
- `dsh-workflow-ptc` 引擎行被一并摘掉
- 按包名摘除（即使 `config.toolName` 被改写成别名）
- 生成子预设不改动入参（序列化前后一致）
- 带 `toolFilter` 的 config 在生成阶段就被拦住
- 绑定只改 1 行、`fork` 行不动
- 子预设自身不带 `agentPreset`（防自引用）
- 缺 `id` / `plugins` 非数组时抛错

`purge-inspect/verify-rc210-register.mjs` —— 13 项，全过：

- 用模拟 registry 真跑两次 `register()`，顺序为 `nolimit-child,nolimit`
- **反序会失败**（父先注册 → `agentPresets: unknown preset nolimit-child`），证明注册顺序不可颠倒
- 子预设工具面只剩 `subagent`，非委派工具（`tool-bash` 等）全在
- 逆序释放：先退父、再退子，全退干净
- 父预设 `spawn.agentPreset = nolimit-child`，不带 `allowedAgentPresets`
- `child.order = 15.1 > parent.order = 15`

---

## 升级

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.10/dsh-purge-1.1.71-rc2.10.tgz
```

重启宿主后，模式下拉里应出现两项：`无限制模式`、`无限制模式 · 子任务`。

排在它们上面的还有 `红队模式`（`order: 10`）——红队那份是独立预设文件，不走派生逻辑，行为与 rc2.9 完全一致。

---

## 破坏性变更

无。rc2.9 → rc2.10 只新增一份运行时派生的预设声明，补丁表仍是 88 条，`tuning.json` 的键没有增减，`cordis.patch.yml` 的配置项也没有变。

唯一可见的变化是模式下拉多一项，以及 `nolimit-preset.json` 多一个 `child` 字段。
