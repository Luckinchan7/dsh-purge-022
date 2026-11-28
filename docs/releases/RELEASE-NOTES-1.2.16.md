# dsh-purge-022 v1.2.16

**回退不再往会话列表里加东西。** 之前每点一次「回退」，列表就多一条。

## 你看到的

回退一次，默认工作区里多一条「默认对话」。回退两次就多两条。

## 根因

1.2.14 把回退改成在边界处 `fork` 出一个截断的子会话 —— 因为客户端不认 `surfaceOp: replace`，原地打标记只会清掉模型历史、屏幕上一条不少。

但 `fork` 必然新建会话，父会话默认还留在列表里。每回退一次，列表净增一条。

## 改法

fork 成功后调宿主的 `workspaceController.archiveSession(sessionId, { stopActivity: true })` 把父会话收进归档。历史不删、随时能反归档找回，只是不再占列表。

`stopActivity: true` 是必须的。不带这一项，宿主会先查 `workspace/session-activity`，只要那一轮还在跑就抛 `WorkspaceActiveSessionError`。

归档失败不抛 —— 回退本身已经成功，归档只是收拾现场。

## 实测

两次连续回退：

```
回退1: sid c1, archived true, 归档集合 [p1]
回退2: sid c2, archived true, 归档集合 [p1, c1]
会话总数 3，已归档 2 → 列表净增 0
```

## 自检

`tests/verify-rc218.mjs` 新增 4 条源码断言（存在 `retireParentSession`、fork 成功后调用它、带 `stopActivity`、`archived` 反映归档结果）与 2 条行为断言（父会话必须真的进归档集合）。

全量 10 组 **840 项 0 失败**。

## 安装

```bash
dsh plugin install ./dsh-purge-022-1.2.16.tgz
```

同版本号但 tarball 变过时，`pnpm install --offline` 不换文件，要先 `rm -rf node_modules/dsh-purge-022` 再 `--force`。

## 回滚

```bash
dsh plugin install ./dsh-purge-022-1.2.15.tgz
```

回退会重新开始往列表里加会话。
