# v1.2.5 — 迁到新账号

## 一句话

原 GitHub 账号 `devin667` 被停用，仓库与 Release 全部对外 404。项目迁到
`Luckinchan7/dsh-purge-022`，更新源重新可达。

## 你可能会看到的症状（迁之前）

```
ok:true  hasUpdate:false  remoteUnreadable:true
error: 更新源 devin667/dsh-purge-022 打不开 HTTP 404：账号被停用或仓库已改名
```

面板显示「已是最新」，但那不是真的最新 —— 是远端根本读不到。
1.2.2 起会把这种情况明确报成 `remoteUnreadable` 而不是假报最新。

## 这次改了什么

更新源指向新仓库，共 6 个文件：

| 文件 | 改的位置 |
|---|---|
| `lib/update.js` | `const REPO` 常量、报错示例文案 |
| `lib/redteam/ui.js` | `githubRepoOf()` 兜底值 |
| `client.js` | `welcome.repo` 中英文两处 |
| `package.json` | `repository` / `homepage` / `bugs` / `publishConfig` 共 6 处 |
| `README.md` | badge、链接、「更新源现状」整段重写 |
| `README.zh-CN.md` | 安装命令、clone 地址、更新源说明共 9 处 |

`tests/verify-rc216.mjs` 的 8 处断言基线同步更新。

## 为什么换账号而不是等解封

申诉通道实测全部走不通，四层都堵着：

| 通道 | 实测结果 |
|---|---|
| `support@github.com` | `550 5.7.1 ... blocked using Spamhaus`（本机出口 IP 在名单里） |
| QQ 邮箱发信 | `Message blocked`，收件方策略拒收 |
| `support.github.com/contact/*` | 全 302 到 `help.github.com/request/landing`，该页只有「Sign in with GitHub」 |
| `github.com/signup` / `/password_reset` | 403（DataDome 反爬，不是封 IP） |

账号被停用 → 登录 403 → 申诉表单先要求登录 → 闭环。

唯一的非自助路径是用另一个有效账号登录后进 `support.github.com/contact/account-unblock`，
或者换网络出口发邮件。这两条都依赖外部条件，不适合作为发布流程的一环。

## 老用户怎么办

**什么都不用做。** 插件里 `readRepoOverride()` 读 `$DSH_HOME/dsh-purge/repo.json`，
没有该文件就走新常量。如果之前手动填过旧仓库名，面板「更新源」一栏清空
→「保存更新源」，回落默认。

已装版本的功能不受影响 —— 代码补丁、提示词改写、换包守卫都在本地跑，与远端仓库无关。

## 没改什么

内部标识全部保持原样，避免老用户本地状态失联：

- 配置目录 `$DSH_HOME/dsh-purge`（`tuning.json` / `unpacked-asar.json` / `refusal-log.jsonl`）
- 路由前缀 `/dsh-purge/*`
- Cordis section 名、组合 `id: dsh-purge*`
- npm 包名 `dsh-purge-022`

## 安装

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.5/dsh-purge-022-1.2.5.tgz
```

## 自检

9 组 210 项全过：migration-yaml 8 / migration 21 / rc120 22 / rc213 26 /
rc214 6 / rc2142 9 / rc215 64 / rc216 54 / pack。

`verify-rc216` 从 48 项加到 54 项。原先它把「本仓库必须不可读」写成硬断言
（`probe.state !== "ok"`），迁到新账号后这条恒假；改为探一个不存在的 fixture
仓库验错误路径，再单加一组验默认源可读、`remoteVersion === "1.2.5"`。

## 回滚

```bash
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/Luckinchan7/dsh-purge-022/releases/download/v1.2.4/dsh-purge-022-1.2.4.tgz
```

1.2.4 → 1.2.5 只改了字符串常量与文档，回滚不影响任何已应用的宿主补丁。
