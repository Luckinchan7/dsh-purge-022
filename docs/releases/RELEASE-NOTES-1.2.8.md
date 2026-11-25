# v1.2.8 — 面板补丁列表不再显示 `patch.85`

**一句话**：面板上每一条补丁现在都写清了它改的是什么，不再是 `patch.85` / `patch.92` 这种原始键名。

---

## 你看到的

打开面板 → 补丁列表 → 展开任意分组，从 #85 开始往下，名称列全是 `patch.85`、`patch.87`、`patch.92`、`patch.100`……第 1.2.7 版把补丁表从 90 条扩到 131 条，这排 `patch.N` 一下变得很显眼——41 条新补丁，一条名字都没有。

## 根因

面板渲染时这么取标签：

```js
h("td", null, t("patch." + r.id))
```

`t` 是宿主的 i18n 函数，查不到键就把键名原样返回。而 `client.js` 的字典里只有 `patch.1` 到 `patch.84`，#85 之后一条都没有。

这不是渲染 bug，是**字典漏填**。1.2.7 新增的 #100–#140 和第二代补丁 #85–#99 都没写标签。

## 改法

### 一、补齐字典

`client.js` 的两个语言块（`zh` 从 128 行、`en` 从 534 行起）各加 56 条，覆盖 #85–#140。中文按「一句话说清干了什么」，控制在 24 个字符左右能塞进一行的长度。

### 二、三层兜底

光补字典不够——下次再加补丁还是会漏。所以 `lib/index.js` 的 `/dsh-purge/status` 现在同时下发两个映射：

```js
const patch_names = {};
const patch_descs = {};
for (const p of core.ALL_PATCHES) {
  patch_names[String(p.id)] = p.name;
  patch_descs[String(p.id)] = p.desc || "";
}
```

`p.name` 是补丁的英文代号（`SESSION_PROMPT_ALWAYS_FOLLOWUP`），`p.desc` 是补丁自带的中英双语说明（`"session-controller prompt() 一律 followup… / session-controller prompt() always followup…"`，用 ` / ` 分隔）。

面板取值顺序变成：

```
i18n 字典 → patch_descs（按当前语言取中或英）→ patch_names（代号）→ 键名
```

只有在补丁连 `desc` 都没写的情况下才会退到代号——**`patch.N` 不会再出现在界面上**。

### 三、两行式单元格

有些说明一句话塞不下：

> `session-controller prompt() 一律 followup：UI 发消息永远新 turn，消 steer→next-step 竞态（二轮立刻发被拒根因）`

所以单元格改成主行 + 次行：主行是名称（字典命中时用字典，否则用 desc 首段），次行只在「名称不足以说清」时出现，超过 120 字截断。CSS 加两条：

```css
.dshp-pname{display:block;font-weight:600;line-height:1.45}
.dshp-pdesc{display:block;font-size:11.5px;line-height:1.5;color:var(--dshp-mute);margin-top:1px}
```

## 现在的样子

| # | 面板显示 |
|---|---|
| 85 | UI 发消息一律新 turn（消 steer 竞态） |
| 86 | 队列 steer 走 follow-up，公共 steer 不动 |
| 87 | 挂宿主用 LF 比对头尾，防 CRLF 误判重挂 |
| 88 | 头尾都在才算挂住，只剩一头就重新置顶 |
| 89 | 反问不卡回合：等 1 秒超时即继续 |
| 92 | host 每次退出写 code/signal/stderr 日志 |
| 98 | message.content 先归一，防 content.some 报错 |
| 100 | 持久 shell 输出 16KB → 256KB |
| 106 | glob 100→1 万条、grep 250→1 万行 |
| 112 | fetch 响应 5MB→50MB、超时 30s→120s |
| 119 | 图片归一化边长 8192 → 16384 |
| 124 | 允许 read 二进制文件（有损解码） |
| 126 | 压缩触发 80%→95%、保留 16%→50% |
| 140 | CUA 元素 2000→2 万、拖拽 20→240 |

完整 131 条见面板，或 `lib/core.js` 里每条补丁的 `desc` 字段。

## 自检

`verify-rc217` 新增 9 项断言：

```
ok("i18n 两个语言块都在", block === 2)
ok("限额补丁中文标签无缺失", missZh.length === 0)
ok("限额补丁英文标签无缺失", missEn.length === 0)
ok("所有补丁至少有一种语言标签", allMiss.length === 0)
ok("面板不会渲染出 patch.<id> 原始键", rawKeys.length === 0)
ok("client 用 patch_names 兜底", /state\.patch_names/.test(clientSrc))
ok("client 用 patch_descs 兜底", /state\.patch_descs/.test(clientSrc))
ok("status 载荷带 patch_names", /patch_names,/.test(indexSrc))
ok("status 载荷带 patch_descs", /patch_descs,/.test(indexSrc))
```

`verify-rc217` 从 523 项加到 **532 项**；全量 9 组 **752 项**全过：

```
verify-migration-yaml    8
verify-migration         21
verify-rc120             22
verify-rc213             26
verify-rc214              6
verify-rc2142             9
verify-rc215             64
verify-rc216             64
verify-rc217            532
```

## 安装

```bash
pnpm add ./dsh-purge-022-1.2.8.tgz
```

或面板里选「本地文件」。

**同版本号复装要注意**：如果之前装过 1.2.7，`pnpm install --offline` 会认为已就绪而不换文件，必须先删目录：

```bash
rm -rf node_modules/dsh-purge-022
pnpm install --offline --force
```

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.7.tgz
```

或面板「更新」页选 `v1.2.7`。

## 生效

面板要显示新标签，需要**完全退出客户端再重开**：托盘右键 → 退出 DeepSeek Harness。

宿主内存里还是旧插件的字典，`/dsh-purge/status` 返回的 `patch_names` / `patch_descs` 也是旧插件下发的（旧版根本没有这两个字段）。重启一次即可。

代码层补丁不受影响——它们写在磁盘上的宿主文件里，与插件是否 reload 无关。
