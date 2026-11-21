# GitHub 账号 devin667 停用 · 申诉操作手册

> **状态：你已经在这个页面上了，直接按第三节填即可。**
> 页面：`GitHub reinstatement request`
> 地址：<https://support.github.com/contact/reinstatement>
> 不需要登录 —— 实测直接可填（截图已确认）。

## 一、先纠正我上一版的判断

上一版手册让你**先去** `contact/cannot_sign_in` 验证邮箱，**这个顺序对你不适用**。

实测结果：

| 地址 | 结果 |
|---|---|
| `support.github.com/contact/cannot_sign_in` | 200，免登录，可验证邮箱 |
| `support.github.com/contact/reinstatement` | **302 → `help.github.com/request/landing`（只给登录按钮）** |
| 你截图里那个 reinstatement 表单页 | **能打开、能填、不要求登录** |

同一路径在 curl（无 cookie、无 JS）下 302，在真人浏览器里正常渲染。
差别在 cookie 与 JS，不是权限。**所以你现在看到的就是正确入口，不用再走 cannot_sign_in。**

`cannot_sign_in` 现在降级成**备用通道**：只有当 reinstatement 页面打不开、
或者表单提交后被要求"先验证邮箱归属"时才用它。

## 二、备用通道（当前不需要）

如果 reinstatement 页打不开，或提交后提示要验证邮箱：

```
https://support.github.com/contact/cannot_sign_in
```

- 电子邮箱：`deving.2456@qq.com`（你的注册邮箱）
- 原因单选：**「账号被锁定：我的账号已被锁定或停用」**
  （英文 `Account locked: My account has been locked or suspended`）

提交后去 QQ 邮箱收验证信（发件人 `noreply@github.com`，**记得翻垃圾邮件**），
点链接验证。验证完成后 reinstatement 表单会放行更多字段。

## 三、复权表单逐项填法（实测字段，照抄）

页面标题「GitHub reinstatement request」，面包屑
`Help / 支持 / 您需要什么帮助? / Reinstatement request / GitHub reinstatement request`。
**不要求登录**，直接可填。

| 字段 | 必填 | 填什么 |
|---|---|---|
| **主题** | 是 | `Reinstatement request for suspended account devin667` （49 字符，上限 80） |
| 您是否愿意提供一些额外的信息或背景情况 | 否 | **粘贴下面第四节的英文全文**（这是全表唯一的正文框，申诉内容全放这里） |
| 您的主张是否涉及 GitHub 或 npm.js 上的内容? | 是 | 选 **GitHub** |
| 受影响的用户名以及存储库或包名称是什么? | 是 | `devin667, devin667/dsh-purge-022` |
| 您为何申请恢复? | 是 | 选 **我的帐户已禁用，我无法登录** |
| 您之前是否已就这一主张联系过 GitHub? | 是 | 选 **否** |
| 我已查阅并了解 GitHub 的可接受使用政策和社区准则 | 勾选框 | **必须勾**，否则「继续」按钮不走 |
| 继续 | — | 点绿色「继续」 |

**四个「您为何申请恢复」选项的对应关系**（别选错）：

| 选项 | 适用情况 | 你选它吗 |
|---|---|---|
| 我的帐户已禁用，我无法登录 | 账号被停用 / 无法登录 | **✓ 选这个** |
| 我能登录，但我的个人资料和贡献对他人不可见 | 能登录、只是内容被隐藏 | 不选 |
| 您禁用或删除了我的某条内容或评论 | 单条内容被判违规 | 不选 |
| 您对我的存储库添加了内容通知，或者限制了谁可以查看我的存储库 | 仓库被加限制标记 | 不选 |

关于「受影响的用户名以及存储库或包名称」：这格要同时写**用户名**和**仓库全名**，
只写用户名会让审核多问一轮。写成 `devin667, devin667/dsh-purge-022` 一次到位。

关于「您之前是否已就这一主张联系过 GitHub」：选 **否**。
你发过的那两封邮件都被网关退了（Spamhaus / Message blocked），**没有送达**，
所以对你来说确实没有联系过。不要选「是」——那会让系统去关联一张不存在的工单，
反而卡住。若将来收到回执后再补充材料，第二次提交才选「是」。

## 四、额外信息框里粘贴的英文全文（1594 字符）

```
Hello GitHub Support,

I am requesting reinstatement of the account "devin667" (repository devin667/dsh-purge-022), which I can no longer sign in to.

Cause I understand: the repository contains a directory skills/redteam/ with 23 Markdown documents added on 2026-11-13. They describe red-team workflow, and several contain ready-to-run commands - reverse-shell one-liners in vps-reverse-shell.md and shell-handler.md, a Redis cron-injection payload in unauth-exploit.md, and a webshell deployment guide in webshell-toolkit.md.

I am not disputing that this is operationally usable material. If it violates the Acceptable Use Policies, that determination is yours and I accept it.

My commitments:

1. I will delete the entire skills/redteam/ directory (23 files, ~136 KB) from the working tree and from history before reinstatement, if that is the remedy you require. I can do it in one history rewrite.
2. I will not re-upload equivalent content to GitHub in any form.
3. The rest of the repository is a local-only desktop client plugin. It rewrites the system prompt an AI desktop client sends to its model, and patches that client own install directory on the user machine. No server component, no hosted service. Full history contains no binaries (0 .exe/.dll/.so/.jar/.bin) and no credentials or tokens (full-history scan for GitHub tokens, PATs and sk- keys: zero matches). I am the only contributor, 24 commits.

I would rather lose that directory than lose the account. Please tell me which remedy you require and I will complete it immediately.

Thank you,
devin667
deving.2456@qq.com
```

**必须原样保留的三句**：

1. `I am not disputing that this is operationally usable material.` —— 承认事实，不辩解
2. `I would rather lose that directory than lose the account.` —— 表态优先级
3. 三条编号承诺 —— 给审核一个可执行的整改路径

**必须删掉的说法**：`these are just documents` / `not executable` / `no working payloads`。
审核打开 `vps-reverse-shell.md` 第 77 行就是一条可直接复制的反连一行，写这种话等于自证不诚实。

## 四之二、第二页「创建工单」（Name / CCs）怎么填

点完第一页的「继续」，会进到这个页面 —— 标题「创建工单」，
说明文字「请在下方填写您的详细信息以创建支持工单。我们会审核您的信息，并尽快与您联系。」

页面上只有三个东西：

| 字段 | 填什么 |
|---|---|
| **Name** | `devin667` （你的 GitHub 用户名，不要填实名） |
| **CCs** | `deving.2456@qq.com` （必须有，这是回信地址） |
| **Submit** | 点绿色按钮提交 |

**Name 为什么填用户名**：审核要拿它去库里匹配被停用的账号。
填真名会让匹配多一轮，填用户名一步到位。想加实名就写 `devin667 (real name)`，但前半截必须是 `devin667`。

**CCs 为什么一定要填**：这一页没有单独的「邮箱」输入框，
抄送地址就是收回复的地方。不填 → 审核回复发不出去 → 工单等于白交。
最多可填 10 个，用逗号分隔；只填一个就够。

**提交前再确认一遍**：第一页那个大文本框里的英文正文有没有粘上。
这一页没有正文框，如果第一页忘了粘，提交出去的工单只有一句主题，必然被打回。

## 四之三、Submit 之后会发生什么

1. 页面变成确认页（「您的工单已提交」之类）
2. `deving.2456@qq.com` 收到一封确认信，含工单号 —— **这封信就是唯一凭据，存好**
3. 之后审核若需补充材料，会在这个邮件线程里回复
4. 人工决定通常 3–10 个工作日

**如果 Submit 后没收到确认信**：先翻 QQ 邮箱垃圾邮件；还没有就说明工单没真正落地，
改用第二节的 `cannot_sign_in` 备用通道重新走一遍。

## 五、为什么换通道（邮件走不通的实测）

| 通道 | 结果 |
|---|---|
| `support@github.com` SMTP 直连 | `550 5.7.1 Service unavailable, Client host [120.235.59.115] blocked using Spamhaus` |
| QQ 邮箱发 `support@github.com` | **Message blocked**（收件方策略拒绝，`support.google.com/a/answer/172179`） |
| `support.github.com/contact/*` 各种路径 | 全部 302 到 `help.github.com/request/landing`，只给「Sign in with GitHub」 |
| `support.github.com/contact/reinstatement`（**验证邮箱前**） | 302 → `help.github.com/request/landing`，只给「Sign in with GitHub」，标题 `Sign in for Software Support` |
| `github.com/signup`、`/password_reset` | 403，但**是 DataDome 反爬**（响应体 770 字节，`captcha-delivery.com` + `Please enable JS`），不是 IP 封禁 |
| `github.com/login` | 200，正常 HTML 45KB（页面本身能开，登录提交才 403） |
| **`support.github.com/contact/cannot_sign_in`** | **200，无登录要求，含「Account locked / suspended」选项** |

更正一条之前的判断：`signup` 与 `password_reset` 返回 403 曾被当成「IP 段被封」，
实际是 DataDome 对无 JS 客户端的机器人拦截。真人浏览器打开是正常的。

## 六、时间与预期

- 邮箱验证信：几分钟内
- 复权表单提交后：自动回执立即，人工决定通常 3–10 个工作日
- 窗口期：GitHub 只在**决定后 6 个月内**受理复权/申诉，过期可拒
- 所有 Appeal 决定由人工做出，不是自动判定

## 七、账号恢复后

```powershell
cd C:\Users\devin\Documents\deepseek-harness\default-workspace\release
git push origin main --tags
```

本地待推送（一直在，没丢）：

```
commit  bfc4ecd   fix: 1.2.2 — 更新源可切换，且仓库消失不再假报已是最新
tag     v1.2.2
包      dist/dsh-purge-022-1.2.2.tgz   909,726 B
sha256  ba1936311d4b7b025232db90c5d86fbc8cc631f88f200bb3d6aed083e046cc57
自检    9 组 182 项全过
```

Release 资产需要在网页或 API 上补传（`git push` 不带资产）。上传后 `checkUpdate()` 立刻恢复。

## 八、本机不受影响

`dsh-purge-022 1.2.2` 已装在 `~/.dsh/profiles/desktop`，90 条补丁表、`apply`、`inject: ["systemPrompt","tools"]` 全部正常，
只是暂时查不到更新。1.2.2 已把更新源做成面板可填的 `owner/repo`，将来换仓库或镜像不用改代码。
