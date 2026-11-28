# dsh-purge-022 v1.2.17

**1.2.16 没修好。** 归档调用每次都静默失败，所以回退一次还是多一个会话。

## 根因

两个入口的签名相反（`D:\DSH_DESKTOP\resources\app\dsh\node_modules\@deepseek-ai\`）：

```js
// dsh-workspace/lib/types/index.js
archiveSession(sessionId, options = {})          // 位置参数

// dsh-api-workspace-controller/lib/index.js
async archiveSession(request)                     // 请求对象
```

1.2.16 调的是 controller，却按位置参数传：

```js
await controller.archiveSession(sessionId, { stopActivity: true });
```

`request` 因此是字符串，`request.sessionId` 是 `undefined`，注册表拿 `WorkspaceUnknownSessionError` 拒绝 —— 被 `catch { return false }` 吞掉。回退照样报成功，父会话一条没动。

## 改法

不再靠「调用没抛异常」当成功。逐个形态试，每试一次就**回读 `archivedSessionIds` 确认**：

```js
const isArchived = () => {
  const list = service(ctx, "workspaceRegistry")?.archivedSessionIds;
  return Array.isArray(list) && list.includes(sessionId);
};
```

试的顺序：

1. `registry.archiveSession(id, { stopActivity: true })`
2. `registry.archiveSession({ sessionId: id, stopActivity: true })`
3. `controller.archiveSession({ sessionId: id, stopActivity: true })`
4. `controller.archiveSession(id, { stopActivity: true })`

任一形态让 `isArchived()` 变真就返回 `true`；四个都不行返回 `false`（回退本身仍然成功）。

## 为什么之前测不出来

离线测试里的 mock 是我按自己错误的理解写的 —— 我以为 controller 收位置参数，mock 就照着错的样子放行，测试因此 36 项全绿。

现在 mock 照抄真实签名：registry 收位置参数且真的把 id 加进 `archivedSessionIds`，controller 收请求对象、收到字符串就抛 `WorkspaceUnknownSessionError`。这样再写反就会立刻红。

## 真机证据

用户回退两次后，两个父会话都没进归档：

```
parent d8022bf3   events 596   archived: false
child  3e5dba53   events 476   archived: false   ← 前 474 条与父会话逐条相同
```

前 474 条 `type + seq` 逐条相同的两段序列，就是 fork 留下的父子对。

## 自检

`tests/verify-rc218.mjs` 36 项，新增 3 条：先试 registry、兼容 controller 的请求对象、必须回读确认。

全量 10 组 **844 项 0 失败**。

## 安装

```bash
dsh plugin install ./dsh-purge-022-1.2.17.tgz
```

同版本号但 tarball 变过时 `pnpm install --offline` 不换文件，要先 `rm -rf node_modules/dsh-purge-022` 再 `--force`。

## 回滚

```bash
dsh plugin install ./dsh-purge-022-1.2.16.tgz
```

回滚后回退会重新往列表里加会话。
