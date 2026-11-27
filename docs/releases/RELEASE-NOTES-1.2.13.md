# v1.2.13 — 挂件不再压住「…」

**一句话**：页内那个 `dsh-purge` 挂件不再和标签栏末尾的「…」按钮叠在一起。

---

## 你看到的

```
对话   轨迹   画廊   上下文  dsh-purge ⋯
                          ↑ 和「…」重位了
```

## 原因

1.2.11 把页内挂件从「插进宿主 DOM」改成「挂 `document.body` + `position:fixed` 跟随锚点」，定位算的是锚点矩形的右边缘 +8px：

```js
const r = anchor.getBoundingClientRect();
let left = Math.round(r.right + 8);
```

锚点取的是：

```js
const row =
  document.querySelector("[data-conversation-tabs]") ||
  document.querySelector("[data-conversation-tabrow]") ||
  document.querySelector("[role='tablist'][aria-label*='对话' i]") ||
  document.querySelector("[class*='conversation' i][class*='tab' i][class*='row' i]");
```

`[data-conversation-tabs]` 在宿主里的定义（`dsh-client-ui-conversation/lib/client.js`）：

```js
className: ConversationRoot_module_css_default.viewTabs, role: `tablist`, "data-conversation-tabs": ``
```

而它的 CSS 是：

```css
.an3WzG_viewTabs{flex-wrap:wrap;gap:32px;min-width:0;min-height:25px;display:flex}
```

父行是 `width:100%` 的 flex 容器。所以 `r.right` 是**整行的右边**，不是最后一个标签的右边。「对话 / 轨迹 / 画廊 / 上下文」四个标签只占左边一小段，右边全空 —— 但「…」按钮（`ViewsMoreMenu`）就排在那附近，两者叠上了。

## 改法

### 一、锚点换成内容区

优先用行内的 `[role="tablist"]`，它的宽度跟着标签走：

```js
const anchorEl = row
  ? (row.querySelector("[role='tablist']") || row)
  : null;
```

原来那个 `[data-conversation-tabs]` 就是这个 tablist 本身，但为了兼容宿主改版保留了 `|| row` 兜底。

### 二、量出「…」按钮的右边缘

`mountFloatChip` 新增第四个参数 `opts.afterSelector`：

```js
function mountFloatChip(anchor, className, testId, opts) {
```

定位时先看锚点的父容器 —— 那个「…」按钮是锚点的**兄弟**，不在锚点里面：

```js
let baseRight = r.right;
if (opts && opts.afterSelector) {
  const scope = anchor.parentElement || document;
  const after = scope.querySelector(opts.afterSelector) || document.querySelector(opts.afterSelector);
  if (after && after !== anchor) {
    const ar = after.getBoundingClientRect();
    if ((ar.width > 0 || ar.height > 0) && Math.abs(ar.top - r.top) < r.height + 8) {
      baseRight = Math.max(baseRight, ar.right);
    }
  }
}
```

`Math.abs(ar.top - r.top) < r.height + 8` 是行内校验：上下差太多说明 `querySelector` 抓到的是别的区域的菜单按钮（页面上 `[aria-haspopup='menu']` 不止一个），不认。

调用处：

```js
const mounted = mountFloatChip(anchorEl, "dshp-tab-chip", "dsh-purge-tab-chip", {
  afterSelector: "[aria-haspopup='menu']",
});
```

### 三、挤不下就藏起来

原来右边界超出视口时会往左退：

```js
if (w && left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - w);
```

但往左退正好压住「…」—— 那正是要避免的。现在改成直接隐藏：

```js
const left = Math.round(baseRight + 8);
const w = el.offsetWidth || 0;
if (w && left + w > window.innerWidth - 8) {
  el.style.visibility = "hidden";
  return;
}
```

少一个挂件，但不会挡住别人的按钮。

## 现在的行为

| 情况 | 行为 |
|---|---|
| 标签栏有空间 | 挂在「…」右边 |
| 窗口太窄，右边放不下 | 挂件隐藏（不压「…」） |
| 切到没标签栏的视图 | 锚点消失 → 挂件隐藏 |
| `tuning.chips = false` | 挂件整个不挂 |

面板入口不受影响：设置 → dsh-purge 一直在（1.2.12），右下角悬浮按钮由 `tuning.launcher` 控制。

## 自检

`verify-rc217` 从 579 项加到 **586 项**，新增「5h 浮动挂件不能压住行尾的『…』按钮」：

```
ok("mountFloatChip 支持 afterSelector", ...)
ok("afterSelector 取父容器里的兄弟", /anchor\.parentElement \|\| document/.test(clientSrc))
ok("afterSelector 校验同一行", /Math\.abs\(ar\.top - r\.top\)/.test(clientSrc))
ok("基准取 max(锚点右, 按钮右)", /baseRight = Math\.max\(baseRight, ar\.right\)/.test(clientSrc))
ok("挤不下时隐藏而不是左移", ...)
ok("TabRow 传 afterSelector", ...)
ok("TabRow 锚点优先 tablist", ...)
```

全量 9 组 **806 项**全过：

```
verify-migration-yaml    8
verify-migration         21
verify-rc120             22
verify-rc213             26
verify-rc214              6
verify-rc2142             9
verify-rc215             64
verify-rc216             64
verify-rc217            586
```

## 安装

```bash
pnpm add ./dsh-purge-022-1.2.13.tgz
```

同版本号复装注意：先 `rm -rf node_modules/dsh-purge-022` 再 `pnpm install --offline --force`。

## 生效

刷新页面（Ctrl+F5）即可 —— 这是纯前端改动，不用重启宿主。

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.12.tgz
```

回滚后那个挂件会重新压住「…」，或者把 `C:\Users\devin\.dsh\dsh-purge\tuning.json` 的 `chips` 设成 `false` 也行。
