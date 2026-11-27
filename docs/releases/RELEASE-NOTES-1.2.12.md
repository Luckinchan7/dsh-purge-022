# v1.2.12 — 面板回到设置页

**一句话**：关掉右下角那个悬浮按钮之后，面板还能从「设置 → dsh-purge」进去。

---

## 你看到的

面板没了。右下角那个 `dsh-purge` 药丸不见了之后，找不到任何地方能点开它。

## 原因

1.2.9 加了两个开关 —— `tuning.launcher`（右下角悬浮按钮）和 `tuning.chips`（首页模式旁、对话标签旁的小挂件），理由是那两个东西挡视线。

但面板只挂在悬浮按钮上：

```js
function PurgeLauncher() {
  const t = useT();
  const st = useDock();
  const entries = useEntries();
  if (entries.launcher === false) return null;   // ← 面板入口跟着一起没了
  return h("button", { className: "dshp-launch", onClick: () => toggleDock() }, t("dock.newSession"));
}
```

`C:\Users\devin\.dsh\dsh-purge\tuning.json` 里 `"launcher": false` 之后：

```json
{
  "boost": true,
  "probe": false,
  "tailAnchor": true,
  "askNoBlock": true,
  "refusalRetry": true,
  "refusalDecompose": true,
  "refusalHistoryStrip": true,
  "refusalWarmSampling": true,
  "launcher": false,
  "chips": false
}
```

唯一的入口消失。要改回来只能手改这个 JSON —— 而那个文件在哪、叫什么，界面上一个字都没说。

这不叫「可关」，叫「一关就回不来」。

## 改法

把面板接进设置页。宿主有 `settings.section` 这个 slot，设置页左侧的导航项就注册在这上面：

```js
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "dsh-purge",
  order: 60,
  label: () => t("settings.nav"),
  locale: NS,
}, (p) => h(PurgeSettingsSection, { t: p && typeof p.t === "function" ? p.t : t })));
```

组件复用同一个 `SettingsRoot`：

```js
function PurgeSettingsSection(props) {
  const t = typeof props?.t === "function" ? props.t : ((key) => key);
  return h("div", { className: "dshp-root dshp-settings-section" },
    h("style", null, PURGE_CSS),
    h(SettingsRoot, { t }),
  );
}
```

所以设置页里那段和原来面板里的内容完全一样 —— 主题、提示词、规则、技能、补丁表、更新，一个不少。

CSS 加一条，让它在设置页里不撑满整屏：

```css
.dshp-settings-section{max-width:none;padding:0;gap:16px}
```

## 现在有几个入口

| 入口 | 关掉 `launcher` 之后 | 说明 |
|---|---|---|
| 右下角悬浮按钮 | 消失 | 由 `tuning.launcher` 控制 |
| 设置 → dsh-purge | **仍在** | 新增，不受任何开关影响 |
| 首页模式旁的 chip | 由 `tuning.chips` 控制 | 与面板入口无关 |

`settings.nav` 这个标签走 i18n，中英两个块都加了（值都是 `dsh-purge`），所以语言切换不影响。

老宿主如果没有 `settings.section` 这个 slot，注册会抛错 —— 外面包了 `try/catch`，只是少一个入口，不会把插件带崩。

## 本机已改

`C:\Users\devin\.dsh\dsh-purge\tuning.json` 的 `launcher` 已改回 `true`。你现在两个入口都有：

- 右下角那颗药丸（点开面板）
- 设置 → dsh-purge

`chips` 保持 `false`（那个还带着首页挂载的旧问题，见 1.2.11）。

## 自检

`verify-rc217` 从 573 项加到 **579 项**，新增「5g 关掉悬浮按钮之后还得有别的入口」：

```
ok("有 PurgeSettingsSection 组件", ...)
ok("注册到 settings.section", /slots\.inject\("settings\.section"/.test(clientSrc))
ok("settings.section 带 label", ...)
ok("settings.section 用 i18n 标签", /label: \(\) => t\("settings\.nav"\)/.test(clientSrc))
ok("i18n 两个块都有 settings.nav", (clientSrc.match(/"settings\.nav":/g) || []).length === 2)
ok("settings 段复用 SettingsRoot", ...)
```

全量 9 组 **799 项**全过：

```
verify-migration-yaml    8
verify-migration         21
verify-rc120             22
verify-rc213             26
verify-rc214              6
verify-rc2142             9
verify-rc215             64
verify-rc216             64
verify-rc217            579
```

## 安装

```bash
pnpm add ./dsh-purge-022-1.2.12.tgz
```

**同版本号复装注意**：先 `rm -rf node_modules/dsh-purge-022` 再 `pnpm install --offline --force`，否则 pnpm 认为已就绪不换文件。

## 生效

设置页的那一项是插件注册的 slot，装完刷新页面（Ctrl+F5）就能看到，不用重启宿主。

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.11.tgz
```

回滚后如果 `launcher` 还是 `false`，面板会再次没有入口 —— 记得把它改回 `true`。
