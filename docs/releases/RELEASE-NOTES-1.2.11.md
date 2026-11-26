# v1.2.11 — 插话能用了

**一句话**：点「插话发送」真的会插进当前回合，不再被排到下一轮。顺带修了两个同源问题。

---

## 一、插话被改成了排队

DSH 原生的插话链路：

```
前端 mode="steer"
  → session.prompt({ mode: "steer", ... })
    → agent.steer(message)
      → inbox["next-step"]     ← 当前回合的下一步就能读到
```

1.2.7 加的两条补丁把这条路掐断了。

| 补丁 | 位置 | 改成了什么 |
|---|---|---|
| `#85 SESSION_PROMPT_ALWAYS_FOLLOWUP` | `dsh-api-session-controller/lib/index.js` 的 `prompt()` | `if (request.mode === "steer") agent.steer(...)` → 只剩 `agent.followup(message)` |
| `#86 SESSION_STEER_ALWAYS_FOLLOWUP` | 同文件的队列 `case "steer"` | `agent.steer(message)` → `agent.followup(message)` |

`followup()` 的实现是 `send(input, "next-turn", true)` —— **下一轮**。

所以：界面上点「插话发送」、按 Ctrl+Enter，前端照样发 `mode="steer"`，后端把它当排队消息扔进 `next-turn`。表现就是插话发不出去，要等这一轮跑完才轮到它。

### 原来的动机

两条补丁是为了消一个竞态：回合刚收尾那一瞬插话会落到 `next-step`，然后被丢弃。

这个竞态是真的。但代价是把插话功能整个废掉 —— 不划算。

### 现在

改回带守卫的形态：

```js
// [dsh-purge-85] steer only while running; otherwise next-turn
if (request.mode === "steer" && agent.status === "running") agent.steer(message);
else agent.followup(message);
```

- 回合在跑（`agent.status === "running"`）→ `agent.steer` 进 `next-step`，真插话。
- 已经收尾 → `agent.followup` 进 `next-turn`，排队。

竞态还在防，插话也还在。`agent.status` 的取值定义在 `dsh-agent-loop/lib/index.js:565`：

```js
get status() {
  return this.phase.kind === "idle" || this.phase.kind === "maintenance" ? "idle" : "running";
}
```

队列那条（#86）同理：

```js
case "steer":
  agent.inbox.remove(request.itemId);
  // [dsh-purge-86] queue steer only while running; otherwise next-turn
  if (agent.status === "running") agent.steer(message);
  else agent.followup(message);
  break;
```

### 迁移

老版本已经把「一律 followup」写进了磁盘。两条补丁都加了第二条 replacement，专门认这个形态：

```js
pattern: "\t\t\t\t\tagent.followup(message); // [dsh-purge-85] user prompt always next-turn (kill steer→next-step race)",
```

升级后点一次「应用」就自动改回来，不用手改宿主文件。旧形态还进了 `forbid`，避免被误判成「已应用」。

---

## 二、反问压到 1 秒，等于没人答得完

`#89 ASK_USER_NO_BLOCK` 原本：

```js
const timeout = 1; // [dsh-purge] ask_user_question never blocks a turn
```

1 秒内没人能看完问题点选项。所以每次调用必然超时、必然返回 `pending` + `pendingNotice`。用户体感是「问了也不等我」，工具层面是一堆无意义的 pending 记录。

现在：

```js
// [dsh-purge-89] 上限 90 秒：-1（无限等）也收成 90 秒，够人回一句又不拖死回合
const asked = validateTimeout(args.timeout ?? defaultTimeout);
const timeout = asked === -1 ? 90 : Math.min(asked, 90);
```

90 秒够人看一眼回一句，又不至于把回合拖死。超时后照样返回 `pending` + `pendingNotice`，模型继续往下做，用户还能在界面里补答。

出厂默认是 120 秒（`dsh-tool-ask-user/lib/index.js:64` 的 `registerTimedAskUser(ctx, timeout = 120)`），模型还能传 `-1` 无限等 —— 这两个口子都收在 90 秒。

---

## 三、面板 chip 不再插进宿主的 React 树

这是「新建对话选了工作区又弹回去」的疑似根因。

老的挂法：

```js
const row = document.querySelector('[data-dsh-hero-workspace-row]') || ...;
let el = row.querySelector(":scope > .dshp-hero-chip");
if (!el) {
  el = document.createElement("div");
  el.className = "dshp-hero-chip";
  row.appendChild(el);          // ← 往 React 管的子树里插
}
```

React 每次 commit 重建那块 DOM 时，多出来的子节点让它的 diff 对不上，首页状态被回退成初始态。现象就是：选完工作区、1 秒后又弹回「选择一个工作区开始」，而服务端其实已经把会话建出来了。

那次排查留下的证据：`C:\Users\devin\.dsh\sessions\--C-Users-devin-Documents-deepseek-harness-default-workspace--` 下有 13 个只有 350 字节的空会话，时间分 4 批（21:50 四个、21:52 三个、22:01 四个、22:33 两个），每批正好对应一次点击。

现在容器挂在 `document.body` 上：

```js
el.className = "dshp-float-chip " + className;
document.body.appendChild(el);
// place(): 用 anchor.getBoundingClientRect() 算 top/left，fixed 定位
```

CSS：

```css
.dshp-float-chip{position:fixed;z-index:10038;transform:translateY(-50%);display:inline-flex;align-items:center;pointer-events:auto}
```

滚动和缩放不会触发 `MutationObserver`，所以额外绑了 `scroll`（capture）和 `resize` 做重排。宿主怎么重渲染都不碰我们的节点，`row.appendChild` 整个删掉了。

页面跳转、切到别的会话时锚点消失，`place()` 里检测到 `rect.width === 0 && rect.height === 0` 就把自己设成 `visibility: hidden`，不会留一个飘在错位置的按钮。

---

## 自检

`verify-rc217` 从 546 项加到 **573 项**，新增两组。

**5e 插话链路不能被改成排队**（17 项）

```
ok("#85 不把 prompt 的 steer 改成排队", ...)
ok("#85 保留 steer 分支", /agent\.steer\(message\)/.test(repsOf(p85)))
ok("#85 带 running 守卫", /agent\.status === "running"/.test(repsOf(p85)))
ok("#85 把旧形态列进 forbid", ...)
ok("#85 能识别旧形态并改回来", ...)
ok("#86 不把队列 steer 改成排队", ...)
ok("#86 保留 steer 分支", ...)
ok("#86 带 running 守卫", ...)
ok("#86 把旧形态列进 forbid", ...)
ok("#86 仍保证 agent-loop 的 steer() 是 next-step", ...)
ok("#89 不再把 timeout 写死成 1", ...)
ok("#89 有上限钳制", /Math\.min\(/.test(repsOf(p89)))
ok("#89 处理 -1 无限等", /=== -1/.test(repsOf(p89)))
ok("#89 把 1 秒形态列进 forbid", ...)
ok("i18n 里 #85 不再写「一律新 turn」", ...)
ok("i18n 里 #89 不再写「等 1 秒」", ...)
```

**5f 浮动挂件不能往宿主 React 子树插节点**（8 项）

```
ok("有 mountFloatChip", ...)
ok("有 unmountFloatChip", ...)
ok("不往宿主行 appendChild", !/row\.appendChild\(/.test(clientSrc))
ok("容器挂到 document.body", /document\.body\.appendChild\(el\)/.test(clientSrc))
ok("容器用 fixed 定位", ...)
ok("有滚动/缩放重排", ...)
ok("两处都走 mountFloatChip", ...)
ok("卸载时清掉浮动节点", ...)
```

全量 9 组 **793 项**全过：

```
verify-migration-yaml    8
verify-migration         21
verify-rc120             22
verify-rc213             26
verify-rc214              6
verify-rc2142             9
verify-rc215             64
verify-rc216             64
verify-rc217            573
```

另外对 92 个被改过的宿主文件逐个跑了 `node --check`，0 个语法错；对 8 个关键包做了 `import()`，全部加载成功。

---

## 安装

```bash
pnpm add ./dsh-purge-022-1.2.11.tgz
```

**同版本号复装注意**：`pnpm install --offline` 会认为已就绪而不换文件，必须先删目录：

```bash
rm -rf node_modules/dsh-purge-022
pnpm install --offline --force
```

## 生效

装完之后**点一次「应用」**，让 #85 / #86 / #89 的新形态写进宿主文件。已经在磁盘上的旧形态会被迁移认出来改回去。

宿主需要重启才加载新代码（托盘右键 → 退出 DeepSeek Harness）。但**插话的修复不需要等重启** —— 它改的是 `dsh-api-session-controller`，那是宿主进程里的模块，重启后生效。

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.10.tgz
```

注意：回滚到 1.2.10 会让插话问题回来。如果只是想退回 chip 的老挂法，把 `C:\Users\devin\.dsh\dsh-purge\tuning.json` 的 `chips` 设成 `false` 即可，不用换版本。
