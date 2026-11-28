# 1.2.19 发行说明

## 你看到的

设置 → dsh-purge，「正式版」那个版本下拉点开，一片白底，里面那行 `v1.2.18 · 当前` 只剩一点点灰影，得凑近才认得出。切到浅色主题就正常了。

## 为什么

同一个下拉，面板里是对的、设置页里是坏的，因为**两处的 CSS 作用域不是一个**。

面板（右下角那个悬浮窗）里所有下拉都在 `.dshp-dock` 底下，1.2.9 起的规则是：

```css
.dshp-dock[data-theme="dusk"] select.dshp-field option,
.dshp-dock[data-theme="dusk"] .dshp-field.dshp-ver option{background:#1b1d22;color:#f4f1ea}
```

设置页是 1.2.12 加的入口，`PurgeSettingsSection` 挂在 `settings.section`，容器只有 `.dshp-root dshp-settings-section`，**没有 `.dshp-dock`** —— 上一条规则一个字都不命中。

而 `<option>` 在 Chromium 里由系统画，不继承父级 `background`。没有显式规则时它落到浏览器默认的白底，`color` 却从 `.dshp-root` 承了主题色（深色下是 `#f4f1ea`，近白）→ 白底白字。

`select` 自己写了 `color-scheme:inherit`，从 `body` 拿不到 `dark`，原生弹层也不会自己变深。两个条件凑在一起就是截图那样。

## 改法

只加 CSS，不动逻辑：

```css
/* [dsh-purge-dropdown] 设置页（不在 .dshp-dock 里）的下拉也要跟主题走 */
.dshp-root[data-theme="dusk"] select.dshp-field,
.dshp-root[data-theme="dusk"] select.dshp-ver{color-scheme:dark}
.dshp-root[data-theme="dusk"] select.dshp-field option,
.dshp-root[data-theme="dusk"] select.dshp-ver option,
.dshp-root[data-theme="dusk"] .dshp-field.dshp-ver option{background:#1b1d22;color:#f4f1ea}
.dshp-root[data-theme="white"] select.dshp-field option,
.dshp-root[data-theme="white"] select.dshp-ver option,
.dshp-root[data-theme="white"] .dshp-field.dshp-ver option{background:#fff;color:#16140f}
```

选择器挂在 `.dshp-root[data-theme]` 上而不是 `.dshp-dock[data-theme]`，所以面板、设置页、以后任何挂 `.dshp-root` 的地方都吃这条。

顺带把设置页里另外三个下拉一起修了 —— `dshp-policy-select`（工具策略）、以及两处规则选择器，它们都带 `dshp-field`，同一个毛病，只是没人在意。

## 自检

`tests/verify-rc217.mjs` 新增「5i」组：

- 规则存在（`[dsh-purge-dropdown]` 标记）
- dusk 下 option 是深底浅字
- white 下 option 是白底深字
- dusk 下 select 声明 `color-scheme:dark`
- 设置页版本下拉仍带 `dshp-field dshp-ver`
- 规则不只挂在 `.dshp-dock` 上

`verify-rc217` 586 → 592。全量 **10 组 854 项 0 失败**。

## 装

```bash
dsh plugin install ./dsh-purge-022-1.2.19.tgz
```

或者照旧从更新源拉。装完**不需要重启客户端** —— 这是纯前端 CSS，点一下面板里的刷新，或者重开面板就生效；设置页要等下一次进入才重新渲染。

## 回滚

```bash
dsh plugin install ./dsh-purge-022-1.2.18.tgz
```

1.2.18 的包仍在 release 里。
