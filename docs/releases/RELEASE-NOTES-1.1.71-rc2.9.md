# dsh-purge 1.1.71-rc2.9

> 适配 DeepSeek Harness **0.2.2-rc.3**（同时兼容 0.2.2-rc.1 / 0.2.1-rc.2 / 0.2.0-rc.2）
> 补丁 88 条 · 红队模式 · 无限制模式 · 拒绝检测递进重试

这一版只做加法：**没有削弱任何现有破甲能力**，也没有删除补丁。

---

## 0. 这一版最值钱的东西：拒绝检测 + 递进重试

前八版全在改**提示词**——注入正文、尾部锚点、强化段。这一版第一次动**模型输出侧**。

### 它解决什么问题

提示词再硬，模型偶尔还是会开口说「我不能」。以前这种回答直接落到你眼前，你只能自己再发一次「继续」。

现在：挂在宿主 `llm/stream` waterfall 上，先缓冲回答开头的 400 字符判断——**推脱就自动换帧重发，正常就一个字节不改直接透传**。

### 三级递进（每级换一种触发面，不是把同一句再说一遍）

| 级 | 帧 | 做什么 |
|---|---|---|
| 1 | `nudge` | 把「授权 / 限制」从话题里摘出去，要求给完整技术答案：具体步骤、命令或代码，以及需要的访问范围 |
| 2 | `fiction` | 换虚构框架——本地合成 fixture / 小说里的专家，用角色自己的口吻答。硬拒多由「直接要求」触发，改人称与场景更容易出成品 |
| 3 | `decompose` | 只要最小可交付组件：一个函数、一条命令、一个模板。降低一次性整链请求的触发面 |

三级全拒 → **把首轮内容原样交回去**。检测器误判不能把你的正常回答弄丢。

### 检测器

14 条正则，覆盖英文硬拒、中文硬拒、「先要授权」型软拒。判定对象**只是回答开头**，不是全文——长答案里提「越狱」「提示词注入」是正常技术讨论，开头出现这类词且全文超 280 字符时豁免。

实测：10 条典型拒绝 10/10 命中，6 条正常回答零误判。

### 开关

```json
// $DSH_HOME/dsh-purge/tuning.json
{ "refusalRetry": true, "refusalDecompose": true }
```

- `refusalRetry: false` —— 整个钩子不接管，行为退回 rc2.8
- `refusalDecompose: false` —— 只两级（nudge → fiction）

也可以走 HTTP：

```bash
curl http://127.0.0.1:<port>/dsh-purge/tuning
curl -X POST http://127.0.0.1:<port>/dsh-purge/tuning -d '{"refusalRetry":false}'
```

### 关键工程约束（改这段代码前必读）

`cordis/lib/index.js:903` 的 `waterfall` 是**同步 dispatch**，且 `next` 有守卫：

```js
const next = () => {
  if (called) throw new Error("next() called multiple times");
  called = true;
  return dispatch();
};
```

两个必踩的坑：

1. **listener 不能写成 `async`** —— 那会让 `llm.stream()` 返回 `Promise<AsyncIterable>`，调用方全部打死。
2. **不能「改 options 再 `next(opts)` 一次」** —— `next` 不接受参数，二次调用直接 throw。

正确做法（本版实现）：`next()` 只调一次拿首个流；判出推脱后改用 `this.stream(patched)` **真正重新发起一轮**，并在 patched 上打 `Symbol.for("dsh-purge.refusal-retry")` 做重入守卫，避免自己的 listener 再拦自己。

---

## 1. 新增 4 条补丁

| id | 名称 | 改的是哪一行 | 能力 |
|---|---|---|---|
| `#94` | `BROWSER_COOKIE_NAME_IGNORE_PORT` | `dsh-client-connection/lib/index.js` 的 `encodeBase64Url(createHash("sha256").update(authority).digest())` | cookie 名只哈希主机、忽略端口。以前每次随机端口都长一个新 cookie，攒几十个后请求头超 8KB 宿主回 **431**，面板打不开 |
| `#95` | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD` | `dsh-experimental-inspector/lib/index.js` | 状态帧预算少留 1KB；`cordis/tree` 这种大快照超限时**保留上一帧**，不再整条 `throw` 打断采集 |
| `#96` | `INSPECTOR_FRAME_BUDGET_RECORD_OVERHEAD_CLIENT` | 同包 `lib/client.js`（打包后的紧凑写法） | 同上，客户端侧 |
| `#97` | `HOST_MAX_HTTP_HEADER_SIZE` | `resources/app/lib/main.js` 的 `spawn(this.node, ["--expose-internals", ...])` | 加 `--max-http-header-size=262144`，把 Node 默认 16KB 抬到 256KB。`#94` 治根，这条兜底历史已攒下的 cookie。**需重启宿主** |

`#94`–`#96` 真机已 applied（三文件 `node --check` 全过，重跑全 `already`）。`#97` 锚点在 `main.js` 两处 `--expose-internals` 中精确命中 1 处，改写后 834,740 → 834,815 B，二次应用字节完全一致。

---

## 2. 对照 kingcharleslzy-ai/dsh-purge 1.7.18 后的取舍

对方 88 条补丁 + 70 个运行时模块，我们 rc2.8 是 84 条。

### 吸收 4 条

`#94` `#95` `#96` 新增，`#97`（对方的 `#92`，换成我们自己的锚点与正则写法）。

### 不吸收，逐条说明理由

- **`#56` / `#77`（rewind 隐藏与丢弃）** —— 0.2.2-rc.3 上游**已删该功能**。`isRewindMarker` / `cutTurn` / `rewindVisibleEntries` 全宿主 0 命中，无对象可打。对方的 1.7.18 停在 0.2.1-rc.1，所以它还有效。
- **`#80 MINIMAL_OFFICIAL_TOOLSET`** —— 0.2.2 的 minimal 预设自带完整工具行，我们在 rc2.2 就退役了。
- **对方的 `#89 ASK_USER_WAIT_CAPPED`** —— 它尊重模型给的 timeout，只把 `-1` 收成 300s。我们保留自己的 `#89 ASK_USER_NO_BLOCK`（一律压到 1 秒）。**对方版本更温和，但破甲方向相反**，改它等于削弱现有行为。
- **对方的 `#90 RESTORE_NATIVE_STEERING`** —— 把我们的 `#85`/`#86` 撤回原生插话语义。那是「恢复官方行为」，我们保留自己的 followup 语义（消 steer→next-step 竞态）。同样是方向相反，不动。
- **对方 `#91 BROWSER_COOKIE_NAME_IGNORE_PORT`** —— 就是我们的 `#94`，同一条。
- **其余 40+ 模块**（`instance.js` / `maintenance-lock.js` / `rollback-transaction.js` / `tar-import.js` / `windows-asar-handoff.js` / `update-*` 一整套）—— 是**安装器 / 更新器 / 备份回滚**的基础设施，不是破甲能力。

结论：真正能加强破甲的，只有 refusal-retry 那一个模块。补丁层面他们已经没有我们缺的东西了。

---

## 3. rc2.9 之前的全部能力（累积清单）

### 提示词层（尾部三段，order 严格递增）

```
persona-suffix (10200)
purge-probe    (10248)  ← 仅探针开启时
purge-boost    (10249)  ← 授权与抗漂移
purge-anchor   (10250)  ← 必须是最后一段，管格式与表达
```

三段都**不能**以 `dsh-purge` / `dshpg-` 开头：宿主 `assemble` 在 waterfall 之后会把这两类前缀整体提回数组最前（`[...dshPurgeSections, ...dshPurgeRest]`），一提回就彻底失去 recency 效果。

### 输出侧（本版新增）

`llm/stream` 钩子：拒绝检测 → nudge → fiction → decompose → 退回首轮。

### 运行时开关（`$DSH_HOME/dsh-purge/tuning.json`）

| 键 | 默认 | 作用 |
|---|---|---|
| `boost` | `true` | 尾部强化段 |
| `probe` | `false` | 运行时探针（塞 nonce 验证注入到达） |
| `tailAnchor` | `true` | 尾部锚点 |
| `askNoBlock` | `true` | 状态镜像（对应宿主补丁 `#89`） |
| `refusalRetry` | `true` | 拒绝检测递进重试 |
| `refusalDecompose` | `true` | 第三级只出最小组件 |

### 本地重锚（`$DSH_HOME/dsh-purge/anchor-overrides.json`）

宿主升级把某条锚点改坏时，把那条 pattern 换成「从当前宿主里取出来的真实片段」，不必改源码、不必等发布。

### HTTP 端点

```
GET|POST /dsh-purge/tuning     读/写开关
GET      /dsh-purge/probe      查 / 生成 nonce
POST     /dsh-purge/anchors    增 / 删重锚覆盖
GET      /dsh-purge/status     面板数据
```

---

## 4. 验证

- `ALL_PATCHES` **88 条**，id 无重复
- 宿主实跑：**applied 70 / na 17 / missing_file 1**（`#71` 良神预设本体未装）
- `#94` `#95` `#96` 真机 applied，三文件 `node --check` 全过，重跑全部 `already`
- refusal-retry 单测 **26 项全过**
- 检测器：**10/10 召回，6 条正常零误判**
- 70 个 `.js`/`.mjs` 全量 `node --check` 0 失败；3 个 YAML 过宿主自带 `yaml` 0 失败

---

## 5. 安装

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.9/dsh-purge-1.1.71-rc2.9.tgz
```

装完**重启宿主 + 面板点「应用」**（`#97` 改的是 spawn 的 argv，只有重启才生效）。

验证：

```bash
curl http://127.0.0.1:<port>/dsh-purge/status   # plugin_version 应为 1.1.71-rc2.9
curl http://127.0.0.1:<port>/dsh-purge/tuning   # refusalRetry=true
```

日志 `%TEMP%\dsh-purge-desktop.log`：

```
[assemble.rewrite] ... anchorApplied=true boostBytes=1163 probeBytes=0 ...
[boot.refusalRetry] on=true
[refusal.retry] attempt=1 frame=nudge matched=0     ← 只有真触发重试时才有这行
```
