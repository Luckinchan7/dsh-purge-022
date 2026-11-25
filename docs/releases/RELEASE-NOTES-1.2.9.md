# v1.2.9 — 右下角那个胶囊可以关掉了

**一句话**：悬浮的 `dsh-purge` 按钮现在能在面板里关掉，`$DSH_HOME/dsh-purge/tuning.json` 里对应 `launcher: false`。

---

## 它是什么

`PurgeLauncher` 注册在 `shell.overlay` 槽上，样式是：

```css
.dshp-launch{position:fixed;right:16px;bottom:16px;z-index:10040;...border-radius:999px;...}
```

只要面板没开，它就一直浮在窗口右下角，正好压在发送按钮上方一点的位置。设计意图是「不用进任何菜单就能打开面板」，代价是常驻遮挡。

## 怎么关

### 面板里关

打开面板 → 往下滚到「界面入口」一节 → 取消勾选「右下角悬浮按钮」。勾完立刻消失，不用重启。

### 直接改文件

```bash
# 路径
%USERPROFILE%\.dsh\dsh-purge\tuning.json
```

```json
{
  "launcher": false,
  "chips": true
}
```

`tuning.json` 是这个插件自己的运行开关文件，不写在 profile 的 cordis config 里——改行为不该需要编辑 DSH 的文件，也不该需要重启 profile。

## 两个开关分开

| 键 | 默认 | 关掉后 |
|---|---|---|
| `launcher` | `true` | 右下角悬浮按钮消失 |
| `chips` | `true` | 首页模式行、对话标签栏的小挂件消失 |

分开是因为诉求不一样：多数人只是嫌悬浮球挡事，`launcher:false` 就够；想彻底清干净页内入口的人再关 `chips`。

## 关掉之后还能不能打开面板

**能。** 三个入口互相独立：

1. `launcher:true` 的悬浮按钮
2. `chips:true` 的首页模式行 chip 与对话标签栏 chip
3. `/purge` 斜杠命令，以及 `/dsh-purge/status` 接口

只关第一个时，第 2 条还在，点 chip 照样开面板。两个 UI 入口都关掉时，第 3 条仍可用——这是刻意留的，不给自己挖「关了就再也点不开」的坑。

## 实现

### `useEntries()`

```js
let entriesCache = { launcher: true, chips: true };
function useEntries() {
  const [cfg, setCfg] = useState(entriesCache);
  useEffect(() => {
    // 读一次 /dsh-purge/tuning；之后靠 "dsh-purge:entries" 事件刷新
  }, []);
  return cfg;
}
```

面板保存时 `window.dispatchEvent(new CustomEvent("dsh-purge:entries"))`，三个入口组件同时刷新，不必等轮询。

**读失败当作「开」**。宁可多画一个按钮，也不要因为接口抽风把入口弄丢——这是个可以被反复触发的失败路径，方向必须偏保守。

### 关掉要真摘节点

`HeroNewSessionMount` 和 `TabRowPurgeMount` 不渲染在 React 树里，而是 `createPortal` 到宿主自己的 DOM 节点上。只让组件 `return null` 会留下一个空壳占位（那排按钮的间距还在），所以两个 `ensure()` 里都加了：

```js
const live = document.querySelector(".dshp-tab-chip");
if (live && live.parentNode) live.parentNode.removeChild(live);
```

effect 的依赖改成 `[entries.chips]`，勾选变化会重启 `ensure` 循环。

### status 附带 tuning

`/dsh-purge/status` 现在带 `tuning` 字段，面板不必为了这两个开关再单独拉一次 `/dsh-purge/tuning`：

```js
tuning: (() => { try { return readTuning(core.findDshHome()); } catch { return null; } })(),
```

## 自检

`verify-rc217` 新增 10 项：

```
ok("tuning 有 launcher 开关", /launcher: true/.test(tuningSrc))
ok("tuning 有 chips 开关", /chips: true/.test(tuningSrc))
ok("status 载荷带 tuning", ...)
ok("client 有 useEntries 钩子", ...)
ok("PurgeLauncher 读 launcher 开关", ...)
ok("Hero mount 读 chips 开关", ...)
ok("TabRow mount 读 chips 开关", ...)
ok("关掉后会把已挂的节点摘掉", /live\.parentNode\.removeChild\(live\)/.test(clientSrc))
ok("面板有 UiEntrySection", ...)
ok("保存后派发刷新事件", /dsh-purge:entries/.test(clientSrc))
```

`verify-rc217` 从 532 加到 **542 项**，全量 9 组 **762 项**全过。

## 安装

```bash
rm -rf node_modules/dsh-purge-022
pnpm install --offline --force
```

（同版本号复装必须先删目录，pnpm 否则认为已就绪不换文件。）

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.8.tgz
```

`tuning.json` 里多出来的 `launcher` / `chips` 两个键在旧版会被忽略（`readTuning` 只取 `TUNING_DEFAULTS` 里有的键），不会报错。

## 生效

面板要显示「界面入口」这一节，需要完全退出客户端再重开一次。装好 1.2.9 之后，改这两项开关不用重启——勾选即刻生效。
