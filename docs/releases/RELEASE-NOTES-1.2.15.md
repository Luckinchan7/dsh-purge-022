# dsh-purge-022 v1.2.15

**shim 的 `cmd` 红点是误报。** 那个文件没坏，是读数读错了；顺带发现 shim 注入一直没跑过。

## 你看到的

面板 shim 那一格里 `cmd` 是红点，`ps1` / `unix` 是灰的（missing）。

## 根因

`lib/core.js` 的 `isTextShim()` 用 `fs.openSync` + `fs.readSync` 读文件头，但这里的 `fs` 不是 `node:fs`，是 `lib/extract-asar.js:158` 导出的 `hostFs` 包装层。那一层只代理了 `openSync`：

```
openSync:  function
readSync:  undefined
closeSync: undefined
```

`fs.readSync` 是 `undefined`，一调就抛 `TypeError`，被 `catch { return false }` 吃掉 —— **每一个** shim 都被判成 `binary`。`shimFileStatus()` 于是返回 `"binary"`，`shimKind("binary")` 落进 `bad` 分支，圆点变红。

## 不只是颜色

`lib/core.js:8136` 的 shim 注入逻辑遇到同一个判断会走：

```js
if (!isTextShim(fp)) {
  result[fname] = "skipped_binary";
  continue;
}
```

也就是说 shim 注入这一整支在真机上**从来没跑过**，且不报错、不留痕。

## 改法

三处 `fs.` 换成 `nodeFs.`（`import nodeFs from "node:fs"`，`lib/core.js:1` 已有）。这里只是读本地文件头，不需要 asar 路由。

真机复测（`resourcesPath` 指到 `D:\DSH_DESKTOP\resources`）：

```
dsh.cmd -> original    （之前 binary）
dsh.ps1 -> missing
dsh     -> missing
```

`original` = 文件正常、只是还没打补丁，对应黄色提示，不是错误。`missing` 表示这一端本来就没有那个文件，也是对的。

## 自检

`tests/verify-rc218.mjs` 新增第 6 组 5 项：`isTextShim` 必须用 `nodeFs.openSync/readSync/closeSync`，且不许再出现 `fs.readSync`。

全量 10 组 **848 项 0 失败**。

## 安装

```bash
dsh plugin install ./dsh-purge-022-1.2.15.tgz
```

同版本号但 tarball 变过时，`pnpm install --offline` 不换文件，要先 `rm -rf node_modules/dsh-purge-022` 再 `--force`。

## 回滚

```bash
dsh plugin install ./dsh-purge-022-1.2.14.tgz
```

红点会回来，其余功能不受影响。
