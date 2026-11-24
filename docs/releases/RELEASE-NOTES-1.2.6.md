# v1.2.6 — 更新检查重新能报版本号

一句话：给更新检查补上出网代理，面板「最新版本」不再显示成一串提交号。

## 你看到的

迁到新账号之后仓库确实可读，更新也能查了 —— 但面板上「最新版本」写的是

```
最新 00ca3f4
```

而不是 `1.2.6`。

## 为什么会这样

`remotePackageVersion()` 会按顺序试四个源去拿 `package.json` 里的 `version` 字段。当前网络下逐个实测：

| 源 | 直连 | 走 `127.0.0.1:7897` |
|---|---|---|
| `cdn.jsdelivr.net` | `ECONNRESET` | 200 |
| `raw.githubusercontent.com` | `000`（连不上） | 200 |
| `api.github.com`（未认证） | 403，配额用尽 | 200 |

三个源直连全部拿不到。而 `lib/update.js` 的 `requestBuffer()` 是纯 `https.request`，**从头到尾没有代理支持**，只认直连。

于是 head 那条的 `version` 恒为空字符串，上层这一行就把提交号顶上去了：

```js
remoteVersion: lane.version || lane.sha
```

溯源：1.2.2 加更新源切换时没碰出网这一层，因为当时账号被封、所有请求都 404，根本没走到「拿版本号」这一步。换到新账号后链路才真正跑起来，问题才暴露。

## 改法

`requestBuffer()` 多一个可选的 `socket` 参数，三态：

| 值 | 含义 |
|---|---|
| `undefined` | 还没试过代理 —— https 目标先走 CONNECT 隧道 |
| `false` | 代理失败过 —— 这一轮直连 |
| 对象 | 现成的隧道 socket，直接在上面摊 TLS |

`resolveProxy()` 的取值顺序：

1. `https_proxy` / `HTTPS_PROXY`
2. `http_proxy` / `HTTP_PROXY`
3. `all_proxy` / `ALL_PROXY`
4. Windows 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\ProxyServer`

只处理 `http://` 形态（CONNECT 隧道够用）。`socks://` 直接跳过、走直连 —— 引一个 socks 依赖不值得，而且直连失败时上层本来就会报 `offline`，比假装成功好。

代理连不上会**自动退回直连**，不让一个坏代理把整条更新链拖死。

## 踩到的坑（已写进代码注释）

把 `createConnection` 直接塞进 `https.request` 的 options，在「第一个参数是 URL 字符串」的形态下会被**静默忽略**，表现为 `ETIMEDOUT`。必须先包一层 Agent：

```js
const agent = new https.Agent({ keepAlive: false, maxSockets: 1 });
agent.createConnection = () => tls.connect({ socket, servername: parsed.hostname });
opts.agent = agent;
```

同样的写法在「传个 options 对象」的形态下是生效的 —— 这个差异花了两轮才定位到。

## 顺带修掉一条会显示提交号的降级路径

`describeLane()` 原来只认 `latest` 那条（head）的 `version`，head 为空就直接空，上层再 `|| lane.sha`。

现在多一层：head 拿不到版本号就退到同频道里最新的 tag 版本号。用 `versionIsNewer()` 逐个比较，不排序取末位 —— tag 返回顺序不保证。

## 实测

```
remoteVersion: "1.2.6" | remoteSha: 00ca3f4 | hasUpdate: false
    head   1.2.6      00ca3f4 LATEST
    tag    1.2.5      00ca3f4
    tag    1.2.4      8e7e84f
    tag    1.2.3      8a87f69
    tag    1.2.2      bfc4ecd
    tag    1.2.1      654f1c2
    tag    1.2.0      1cbabea
```

三个域名的连通性对照：

```
raw.githubusercontent.com  直连=000  代理=301
cdn.jsdelivr.net           直连=000  代理=301
api.github.com             直连=403  代理=200
codeload.github.com        直连=301  代理=301
```

## 自检

9 组 220 项全过：migration-yaml 8 / migration 21 / rc120 22 / rc213 26 / rc214 6 / rc2142 9 / rc215 64 / rc216 64 / pack。

`verify-rc216` 从 54 项加到 64 项，新增第 10 组「出网代理」，卡住九件事：

- 有 `resolveProxy()`
- 读 Windows 注册表 `Internet Settings`
- 有 CONNECT 隧道
- `socks` 被跳过
- 环境变量优先于注册表
- 代理失败回退直连
- 隧道必须走 `https.Agent`（不能裸塞 `createConnection`）
- Agent 上挂 `createConnection`
- head 无版本号时退到最新 tag 版本

## 装

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.6/dsh-purge-022-1.2.6.tgz
```

已经装 1.2.x 的：面板 →「重新检查」→「更新」。更新源默认就是新仓库，不用改。

## 回滚

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.5/dsh-purge-022-1.2.5.tgz
```

1.2.5 → 1.2.6 只动了 `lib/update.js` 与 `tests/verify-rc216.mjs`，不碰任何宿主补丁，回滚不影响已应用的破甲。
