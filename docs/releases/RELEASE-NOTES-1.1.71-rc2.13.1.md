# dsh-purge 1.1.71-rc2.13.1

> 目标宿主：0.2.2-rc.3 / 0.2.3-rc.1。补丁表 88 条不变。

本版不是新功能，是**修 rc2.12 引入的三种整轮失败**。前两条会让每一轮都在发请求前炸掉，
第三条会让会话彻底卡死 —— 它才是真正让人用不下去的那个。

## 失败一：`message.content.some is not a function`

rc2.12 的 `stripRefusalHistory()` 在洗掉历史里的推脱原文时，把消息 content 写成了**字符串**：

```js
return { ...message, content: "[renderer] prompt compiled; no text output for this step." };
```

宿主在发请求前直接断言 `message.content.some(...)`
（`dsh-llm-pi-ai/lib/index.js` 的 `assertSupportedHistory`、`dsh-llm/lib/index.js` 的投影），
字符串让它在**发出去之前**抛 TypeError。更麻烦的是那条畸形消息已经写进会话，
之后每一轮都会重炸 —— 界面上就是连续几条「本轮的运行失败」。

**修法**：新增 `asContentBlocks()`，`stripRefusalHistory()` 与 `withNudge()` 一律写 block 数组。
`withNudge` 原来遇到字符串 system 时会拼成 `${first.content}${nudge}`，同样产出一段字符串，
一并改掉。

## 失败二：`normalizeContentShape is not defined`

为了补第一个问题，`lib/index.js` 里加了 `normalizeContentShape(options)` 调用，
但没把它加进 import —— `from "./refusal-retry.js"` 那行当时只引入了 `streamWithRefusalRetry`。
于是每轮请求都在 `llm/stream` 钩子里报这个错。

**修法**：补进 import 列表。

## 失败三：`413 preflight_compress_failed`（真正让会话卡死的那个）

补丁 **#19** 把宿主的工具结果修剪器整条关掉了：

```js
pruneContent(blocks) {
  return null;   // 出厂逻辑被抹掉了
}
```

问题在于上游 billion-context 会**拒绝 DSH 自己的压缩**：

```
dsh_compaction_refused:
bili owns compression on this lane. A landed dsh compaction checkpoint durably
shadows the raw conversation history, which destroys the proxy's compression
substrate.
```

也就是说 **DSH 侧的压缩 checkpoint 永远落不了地**，历史体积只剩「工具结果修剪」这一个阀门。
阀门被关掉之后：

```
5394 条消息 / 正文 ~5.9MB
  → 代理按 ~7.5 bytes/token 判 ≈ 78 万 tokens
  → 超过窗口 75 万（model=deepseek-v4.1-flash）
  → 413，连证据都不转发
```

同一个会话里有干净的对照：**purge 卸载之后，宿主立刻写出 30 条 `compaction/prune` 事件**
（02:48:44 起）；装着 purge 期间一条都没有。这就是「卸载就好了」的直接原因。

### 修法一：#19 改为「保留修剪、只放大预算」

不关阀门，只把预算放大一倍：

| 项 | 出厂 | rc2.12（关掉） | rc2.13.1 |
| --- | --- | --- | --- |
| `thresholdChars` | 8192 | 无限 | 16384 |
| `headChars` | 4096 | — | 8192 |
| `tailChars` | 1024 | — | 2048 |

同时留了一条**迁移路径**：rc2.12 已经写下的 `return null` 会被认出来并改回正常逻辑，
否则老用户升级之后宿主仍然是「修剪器关着」的状态。

### 修法二：#22 的 read 上限收回

rc2.12 把单次 `read` 从 50KB 抬到 **1MB**。读十几个文件就能堆出十几 MB 历史，
是 413 的量级来源之一。

| 项 | 出厂 | rc2.12 | rc2.13.1 |
| --- | --- | --- | --- |
| `READ_MAX_BYTES` | 50 KB | 1 MB | **256 KB** |
| `READ_LIMIT` | 2000 | 20000 | **8000** |

### 修法三：`deriveMessages` 里的体积保险丝

只靠宿主修剪器还不够 —— 「上游拒绝 DSH 压缩」这件事不在我们控制内。所以在
`deriveMessages`（发请求前最后一个能改历史的地方）加一道确定性兜底：

```
本轮请求正文 > 2.4 MB
  → 从最老的开始裁中间部分，直到 < 1.6 MB
  → 最近 6 条不动
  → 所有 system 消息一个字不动
```

它只改**派生出来的请求**，不动会话存档 —— 刷新后原文还在，不会丢数据。

用两次真实失败会话回放验证：

| 会话 | 原始正文 | 保险丝后 | 估算 tokens（窗口 750k） |
| --- | --- | --- | --- |
| 413 @ 10:40 | 5,889,880 B | 2,424,792 B | ≈ 323k |
| 413 @ 10:30 | 8,502,219 B | 2,464,857 B | ≈ 329k |

## 顺带的：`deriveMessages` 也修 content 形状

`wrapSessionDeriveMessages()` 现在同时做三件事：

1. 摘掉 `/rewind` 派生出来的消息（原有职责）
2. 把 content 形状归一成 block 数组（新增，兜住任何来源的字符串 content）
3. 控制本轮请求的字节数（新增）

这是最后一层防线：即使将来某个分支又写出字符串 content，也不会让宿主在发送前崩掉。

## 自检

`verify-rc213.mjs` 26 项全过，覆盖三条失败路径的可重现验证：

```
$ node verify-rc213.mjs
...
26 passed, 0 failed
```

其中包括：
- 未修复的历史确实会让宿主断言抛错（复现），修好后通过
- 8MB 级历史被裁到预算内，最近 6 条与 system 消息未被触碰
- 洗历史 / 加 nudge 之后交给宿主的 messages 全部是数组
- #19 对出厂原文和老版本产物都能改成「保留修剪」，且幂等
- #22 能把 rc2.12 的 1MB 上限收回到 256KB

## 升级

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.13.1/dsh-purge-1.1.71-rc2.13.1.tgz
```

装完**重启宿主**，然后去面板点一次「应用」——

> 如果你的宿主是 rc2.12 洗过的，面板上 #19 会显示 `applied`（旧标记还在），
> 但文件里其实还是 `return null`。rc2.13.1 的迁移路径会在点「应用」时把它改回正常逻辑。
> 升级后务必确认一次：`pruneContent` 里应当有 `measureContent` 调用，而不是直接 `return null`。
