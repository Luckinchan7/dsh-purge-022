# v1.2.10 — 红队模式回来了

**一句话**：1.2.0 改包名时漏改的两行插件引用，让整份红队预设挂不起来；这一版补上，并让自愈逻辑认得出这种形态。

---

## 你看到的

模式下拉里只剩「标准 / PTC / 极简 / 创造 / OPS / 无限制 / 无限制·子任务」，红队模式不见了。

## 根因

`presets/redteam/agent.cordis.yml` 里有两行写死裸包名：

```yaml
- id: persona
  name: 'dsh-purge/redteam/persona'

- id: redteam-tools
  name: dsh-purge/redteam/tools
```

1.2.0 把 npm 包名从 `dsh-purge` 改成 `dsh-purge-022`，`package.json` 的 `exports` key 随之变成 `./redteam/persona`、`./redteam/tools`。这两行写死在 YAML 里，不在任何自动改写路径上——从 1.1.71-rc2.3 起一直就是这样。

实测解析：

```
✗ dsh-purge/redteam/persona → MODULE_NOT_FOUND
✗ dsh-purge/redteam/tools   → MODULE_NOT_FOUND
✓ dsh-purge-022/redteam/persona
✓ dsh-purge-022/redteam/tools
```

Cordis 挂载预设时只要一个插件名解析不了，整份预设就 `never started`，registry 标成 broken，下拉里自然没有它。

`$DSH_HOME/redteam/preset-declare.json` 的证据：

```json
{ "ok": false, "phase": "registered-broken", "id": "redteam", "plugins": 19,
  "broken": "persona (dsh-purge/redteam/persona): never started\nredteam-tools (dsh-purge/redteam/tools): never started" }
```

同一份文件里 `nolimit` 是 `"ok": true, "phase": "registered"` ——不是权限、不是 registry 不可用，就是这份预设自己挂不起来。

## 为什么自愈没救回来

`lib/redteam/index.js` 里的 `renderToolsPackage()` 负责改写旧包名，但它只认更早的独立包名：

```js
if (!text.includes('dsh-redteam-mode/tools')) {
  return { text, changed: false };   // ← 裸 dsh-purge/ 从这里直接返回
}
```

`dsh-purge/redteam/tools` 不含 `dsh-redteam-mode/tools`，被当成「已经改好了」原样放行。persona 那行从来没有任何代码碰过。

## 改法

1. 预设两行改成 `dsh-purge-022/...`。
2. `renderToolsPackage()` 重写：新增 `selfPackageName()` 从 `package.json` 读真名，除了 `dsh-redteam-mode/` 之外多认一条 `\bdsh-purge\/(redteam\/[a-z-]+)` → 当前包名。下次再改名，磁盘上的老预设会被自动对齐。
3. `lib/redteam/tools.js` 的报错文案同步。

## 已在本机修复

不用重装。把改动同步进 profile 后跑一次 `installPreset()`，走的是 `action: 'repaired'` 那条自愈分支：

```
预设里的插件包名已对齐到 dsh-purge-022
{ "action": "repaired", "repaired": "tools-package", "skills": 23 }
```

再跑一次返回 `{"action":"kept"}`（幂等）。现在预设解析出 `plugins: 19`、残留旧名 0。

## 自检

`verify-rc217` 新增 4 项：

```
ok("预设里没有裸 dsh-purge/ 前缀", !/\bdsh-purge\/redteam/.test(presetSrc))
ok("persona 行用当前包名", presetSrc.includes(`name: '${pkg.name}/redteam/persona'`))
ok("tools 行用当前包名", presetSrc.includes(`name: ${pkg.name}/redteam/tools`))
ok("renderToolsPackage 从 package.json 读名字", /function selfPackageName\(\)/.test(...))
```

542 → **546 项**，全量 9 组 **766 项**全过。

## 生效

预设是宿主启动时注册的。改完要**完全退出客户端再重开**（托盘右键 → 退出 DeepSeek Harness），下拉里才会重新出现「红队模式」。

## 回滚

```bash
pnpm add ./dsh-purge-022-1.2.9.tgz
```
