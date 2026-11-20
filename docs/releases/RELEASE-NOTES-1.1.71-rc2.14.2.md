# dsh-purge 1.1.71-rc2.14.2

> 目标宿主：**0.2.2-rc.5** / 0.2.2-rc.3 / 0.2.2-rc.1。补丁表 90 条。

适配 DeepSeek Harness **0.2.2-rc.5**，并修掉三处让破甲能力或面板读数失真的问题。

## 一、rc.5 适配：锚点几乎没动

解包 rc.5 的 asar 逐条实测：

```
改写   70 条
未改动  5 条（都是「结果已在」的幂等状态）
目标缺失 15 条（宿主本来就没这些包，14 条带 optional 标记）
语法体检 1261 个 JS 文件全部通过
```

**rc.5 没有改动任何补丁锚点。** 这和 rc.1→rc.3 那次（12 条锚点失效）完全不同，
所以不需要新增 compat 层，只要把 `dshTargets` 加上 `"0.2.2-rc.5"`。

## 二、修 #73：marker 被 #70 顶掉，镜像句一直没删掉

这是**真缺陷**，rc2.13 及更早一直存在，而且面板一直显示「已应用」。

```js
// 修复前
{
  id: 73, name: "PRESET_BASH_MIRROR_LINE",
  skipIfMarked: true,
  markers: ["[dsh-purge] preset shell network"],   // ← 这是 #70 的 marker
  replacements: [{
    pattern: /\n[ \t]*\* Network access depends on the task environment\. Prefer configured mirrors\/proxies when they are available\.\n/,
    replace: "\n",
  }],
}
```

原注释说「这一行早被 #70 的整段 shell 重写一并吃掉了」。实测不成立：

- #70 改的是 `persistent-pwsh` 段
- 镜像句在 `persistent-bash` 段的 `description` 里，原封不动
- #70 先跑并写下 `[dsh-purge] preset shell network`
- #73 因 `skipIfMarked` 看到 marker → 跳过，且面板显示 `already`

于是 bash 工具描述里长期留着：

```
* Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.
```

这是宿主对工具行为的限制性说明。**面板说他打上了，其实没打**。

**修法**：

1. 去掉 `skipIfMarked` 和借来的 marker，无条件执行
2. 加 `softSettle: true`

第 2 点是必要的：这是一条**纯删除**，删完锚点自然消失、也不留 marker。
默认判定会把它算作 `skipped`（面板显示「跳过」，看起来又像没生效）。
`softSettle` 的语义正是「没有残留 pattern 就算完成」，正好对上。

修完之后 `patchStatus(73) === "applied"`，且文件里确实搜不到那句。

## 三、修 #71：宿主没有这个包，不该算「跳过」

梁神预设是第三方插件带的，官方宿主里没有 `dsh-preset-liangshen`。
原来 `optional` 缺席 + `strictFiles: true` 让它固定报 `missing_file`，
在面板上被计入「跳过」，看起来像少打了一条。

目标是「这个包不在就什么都不用做」，属于 `na` 而不是失败。加 `optional: true` 即可。

## 四、修：桌面 surface 不再去洗 npx 缓存里的另一套 dsh

这是让 rc2.14 **整体回滚**的那个问题。

`applyPatchesAllHosts()` 会把 `enumeratePatchAiBases()` 找到的所有宿主一起洗。
其中 `findAiBaseWeb()` 会顺着 profile 里的 dsh-purge 向上 `require.resolve`，落到：

```
%LOCALAPPDATA%\npm-cache\_npx\<hash>\node_modules\@deepseek-ai
```

那是另一套独立安装（0.1.0-rc.6，8 月的遗留），和桌面版差好几个大版本。后果是连锁的：

```
npx 那份锚点对不上 → #43 / #70 报 pattern_not_found（硬失败）
  → 整体判 clean=false
  → 连桌面那份一起回滚（restoreSealedExtract）
  → 桌面一条补丁都留不下来
```

实测日志：

```
ok: false, error: "清洗没有完成，已放回上一份解开目录"
applied: 61, failed: 2      ← 2 条全在 npx 那份上
```

**修法**：`applyPatchesAllHosts()` 在桌面 surface 下只处理 `desktop.isInsideDesktopInstall()`
为真的宿主。两份安装互不相干，洗错对象只会制造假失败。

修完之后同一个操作：`hosts: 1`、`applied: 76`、`failed: 0`、`ok: true`。

## 面板读数

修复前后（桌面端）：

| | 修复前 | 修复后 |
| --- | --- | --- |
| 总数 | 74（含 1 条假 applied、1 条假跳过） | 67 |
| 已应用 | 72 | 67 |
| 跳过 | 2 | **0** |

数字变小是因为：`#71` 归入 `na`（不进分母），`#73` 从「假 applied」变成真的 applied。
**每一项现在都是真的**。

## 真机验证

对 `D:\DSH_DESKTOP\resources\app` 做完整 apply 后的体检：

```
语法体检：1263 个 JS 全部通过
破甲能力：11/11 项到位
带 [dsh-purge] 痕迹的文件：47 个
```

| 能力 | 状态 |
| --- | --- |
| 审批默认 never | ✔ |
| 审批邀请语清除 | ✔ |
| 沙箱拒绝改放行 | ✔ |
| 沙箱策略中性 | ✔ |
| fs 观察闸门关闭 | ✔ |
| fs 沙箱围栏拆除 | ✔ |
| 重复工具提醒禁用 | ✔ |
| web 工具 untrusted 中性 | ✔ |
| system-prompt 身份清空 | ✔ |
| persona 前缀清空 | ✔ |
| agent-loop 钩子 | ✔ |

关键口径：修剪器保留 + 预算 16384/8192/2048、read 上限 256KB、
content 形状兜底两处、bash 镜像句已删、minimal / web 身份已清空。

## 自检

```
verify-rc213.mjs    26 passed, 0 failed
verify-rc214.mjs     6 passed, 0 failed
verify-rc2142.mjs    9 passed, 0 failed
```

`verify-rc2142.mjs` 专测这次的面板口径修复：

```
PASS 73a #73 有 softSettle
PASS 73b #73 不再 skipIfMarked
PASS 73c #73 不挂别人的 marker
PASS 71a #71 标为 optional
PASS 3a 干净文件无需改动（changed=false）
PASS 3b 脏文件能删掉镜像句
PASS 4a 重复应用幂等
PASS 5a na 的 #71 不进面板
PASS 5b applied 的 #73 进面板
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
dsh plugin --profile desktop add --ignore-scripts \
  https://github.com/devin667/dsh-purge-022/releases/download/v1.1.71-rc2.14.2/dsh-purge-1.1.71-rc2.14.2.tgz
```
