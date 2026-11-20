# dsh-purge-022 1.2.0

> 目标宿主：**0.2.2-rc.5** / 0.2.2-rc.3 / 0.2.2-rc.1。补丁表 90 条。

这一版做一件事：**让插件能像普通 npm 包一样检查更新、一键升级**。
面板里那张「版本 / 重新检查 / 更新到 x.y.z」的卡片，从此对 dsh-purge 生效。

## 为什么要改名

DSH 的插件更新面板只认 **npm registry 上的包名**。源码里写死了：

```js
const parsed = parsedForRegistry(bundle.source);
if (parsed.kind !== "registry" || parsed.name !== bundle.name || parsed.range?.includes(":") === true)
  return `${bundle.name} is installed neither from a registry under its own name nor from a Git commit`;
```

也就是说：

| 安装形态 | 面板能不能查更新 |
| --- | --- |
| `"dsh-purge": "^1.2.0"`（registry + semver range） | ✅ 能 |
| `"dsh-purge": "file:./xxx.tgz"` | ❌ 只有「代码来源 / 当前版本」 |
| GitHub / `git+` | ❌ `is installed from Git, which lists no versions` |

而 `dsh-purge` 这个 npm 名**已经被别人占用**：

```
维护者：panda11445
唯一版本：0.0.0-stage（stub 占位包，2026-11-03 发布，2 个文件）
description: Temporary package placeholder for staged publishing
```

所以本包改名为 **`dsh-purge-022`**（与仓库同名，当前 404，可用）。

## 改了什么

### 一、包名 `dsh-purge` → `dsh-purge-022`

这里有两类 "dsh-purge"，处理方式不同：

| 类型 | 例子 | 处理 |
| --- | --- | --- |
| **包名 / Cordis 模块名** | `package.json` `name`、`cordis.patch.yml` 的 `name:`、profile `bundles`、`client.js` 模块 id、`bin` | **全部改成 `dsh-purge-022`** |
| **内部标识** | `$DSH_HOME/dsh-purge` 配置目录、section 名、HTTP 路由 `/dsh-purge/*`、组合 `id: dsh-purge*` | **保持原名不动** |

第二类不能改 —— 改了等于让老用户丢配置（`unpacked-asar.json`、`tuning.json`、
`refusal-log.jsonl` 都在 `$DSH_HOME/dsh-purge/` 下），而且 `id` 跟模块解析无关。

具体改动：

- `package.json`：`name`、`bin`、`dsh.install`
- `cordis.patch.yml`：5 处 `name:`（本体 + redteam + nolimit + store + ui）
- `lib/profile-insert.js`：`PURGE_NAME` 常量 + `INSERT_BLOCK`
- `client.js`：`__ModuleLoader__.load({ id })` + 内部 `name` 常量

### 二、版本号改成正式 semver：`1.1.71-rc2.14.2` → `1.2.0`

面板的过滤逻辑里有一条：

```
versionsNoneInstallableDetail: 新版本已弃用、为预发布版本或没有声明组合包
```

`1.1.71-rc2.14.2` 的 `rc2.14.2` 会被 semver 判成 prerelease，可能被过滤掉。
改成 `1.2.0` 这种干净的三段式，更新链才不会断。

以后发版按 `1.2.1` / `1.3.0` 递增。

### 三、补 `engines.dsh`

面板显示「需要 {peers}」和「新版本需要更新 DSH」靠这个字段：

```json
"engines": {
  "node": ">=18",
  "dsh": ">=0.2.2-rc.1 <0.2.3-0"
}
```

原来的 `dshTargets` 是自定义字段，DSH 面板不读。

### 四、postinstall 改成运行时自愈

npm/pnpm 默认**不执行**第三方包的 install 脚本（日志里是 `Ignored build scripts`）。
postinstall 里那两步「写 profile bundles + 写用户层 insert」经常没跑，
表现就是「装了但没生效，面板里看不到」。

新增 `lib/self-insert.js`，在 `apply()` 每次启动时检查并补：

- 缺 `bundles` 项 → 补
- 缺 `cordis.patch.yml` 的本体 insert → 补
- 都已经在 → 什么都不做（零写入）

`scripts/ensure-profile-bundle.mjs` 保留，但不再是唯一入口。

### 五、旧包名自动迁移

老用户升级时 profile 里会**新旧并存**：

```
dependencies: { "dsh-purge": "...", "dsh-purge-022": "1.2.0" }
bundles:      [ "dsh-purge", ..., "dsh-purge-022" ]
node_modules: dsh-purge/  dsh-purge-022/
```

两份都带 `id: dsh-purge` 的组合条目 —— Cordis 报 already queued，宿主起不来。

`removeLegacyRegistrations()` 在启动时清理：

- `bundles` / `dependencies` 里摘掉旧名
- `node_modules/dsh-purge` 目录删除
- `cordis.patch.yml` 里 `name: dsh-purge` **就地改成** `name: dsh-purge-022`

最后这条有个坑：最初写成「删掉整个 insert 行组」，实测把相邻的 `- insert:`
块也带走了，整份 YAML 报 `BLOCK_AS_IMPLICIT_KEY`，宿主启动直接失败。
改成「只替换 name 的值」后结构不变，`id: dsh-purge` 保留，不会 already queued。

清理前先 `fs.copyFileSync` 留 `.bak-legacy-<时间戳>`，任何一步失败都保持原文件不动。

## 验证

六组自检，92 项全过：

```
verify-rc213.mjs           26 passed    内容形状 / 体积保险丝 / 修剪器
verify-rc214.mjs            6 passed    #73 marker 冲突修复
verify-rc2142.mjs           9 passed    面板口径（softSettle / optional）
verify-rc120.mjs           22 passed    改名完整性（包名 5 处 / id 不变 / 内部标识不变）
verify-migration.mjs       21 passed    旧包名迁移（识别 / dryRun / 真删 / 幂等 / 不误删新名）
verify-migration-yaml.mjs   8 passed    迁移后 YAML 结构完整性（含大 JSON 块场景）
```

真机验证（本机 profile）：

```
装前：bundles=[dsh-purge]  deps=dsh-purge@1.1.71-rc2.14.2  node_modules/dsh-purge
装后：bundles=[...,dsh-purge-022]  deps=dsh-purge-022@1.2.0  node_modules/dsh-purge-022
迁移：removed package.json / cordis.patch.yml / node_modules/dsh-purge
YAML：20 条目解析正常，insert = dsh-purge->dsh-purge-022 / comfy / undici-guard
```

`pnpm pack` 产物 121 文件 / 3.5 MB，`.bak`、`verify-rc*`、`SHA256SUMS`、
`RELEASE-NOTES`、`.tgz` 均被 `.npmignore` 排除。

## 发布步骤

需要你来做，因为本机没有 npm 登录凭据（`~/.npmrc` 只有镜像源，无 token）：

```bash
# 1. 登录（一次性）
npm login

# 2. 发布
cd ~/Documents/deepseek-harness/default-workspace/release
npm publish --access public

# 3. 之后用户这样装（注意不是 dsh-purge）
dsh plugin --profile desktop add dsh-purge-022
```

发布后确认：

```bash
npm view dsh-purge-022 version          # 应显示 1.2.0
npm view dsh-purge-022 dsh             # 应有 bundle.patch
npm view dsh-purge-022 engines         # 应有 dsh 范围
```

## 升级注意

rc.5 把 `resources/app/` 删了，只剩密封 `app.asar`。装好之后**必须点一次「应用」**：

```
点应用 → resolveOfficialAiBase(forApply:true)
       → openSealedDesktopHost()  把 app.asar 解到 resources/app/
       → targetFiles() 重新指向解包目录
       → 打补丁
```

不点的话所有代码补丁都不会生效（面板显示 `pending`）。

## 安装

```bash
# 发布后（推荐：能查更新、能一键升级）
dsh plugin --profile desktop add dsh-purge-022

# 或从 GitHub Release 装（不能查更新）
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.2.0/dsh-purge-022-1.2.0.tgz
```
