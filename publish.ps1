#!/usr/bin/env pwsh
# 把 dsh-purge 1.1.71-rc2.3 发布到 GitHub。
#   prepare : 本地建仓 + 打 tag + 打印后续手动步骤（不联网）
#   push    : 推到已存在的远程仓库（需要 gh 已登录）
#   release : 建仓 + 推 tag + 上传 release 资产（需要 gh 已登录）
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -Mode prepare
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\publish.ps1 -Mode release -Repo 你的用户名/dsh-purge-022

param(
  [ValidateSet('prepare', 'push', 'release')]
  [string]$Mode = 'prepare',

  [string]$Repo = '',

  [string]$Tag = 'v1.1.71-rc2.3',

  [string]$ReleaseDir = $PSScriptRoot
)

# 原生命令（git/gh）会把进度写到 stderr，Stop 会让脚本误判成致命错误。
$ErrorActionPreference = 'Continue'

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }
function Fail($msg) { Write-Host ('ERROR: ' + $msg) -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host ''; Write-Host ('== ' + $msg + ' ==') -ForegroundColor Cyan }
function G([string[]]$cmdArgs, [switch]$Quiet) {
  $out = & git @cmdArgs 2>&1
  $code = $LASTEXITCODE
  if (-not $Quiet) { $out | ForEach-Object { Write-Host ('  ' + $_) -ForegroundColor DarkGray } }
  return $code
}

# ---------- 0. 前置检查 ----------
Step '检查环境'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git 未安装' }
Say ('  git   : ' + ((git --version) 2>&1))

$hasGh = [bool](Get-Command gh -ErrorAction SilentlyContinue)
if ($hasGh) { Say ('  gh    : ' + (((gh --version) 2>&1) | Select-Object -First 1)) }
else { Say '  gh    : 未安装（只有 release 模式需要）' }

if (-not (Test-Path $ReleaseDir)) { Fail ('发布目录不存在：' + $ReleaseDir) }
Set-Location $ReleaseDir

$tgz = Get-ChildItem -Filter '*.tgz' -File | Select-Object -First 1
if (-not $tgz) { Fail '找不到 .tgz 资产' }
Say ('  资产  : ' + $tgz.Name + ' (' + [math]::Round($tgz.Length / 1MB, 2) + ' MB)')

$sums = Get-ChildItem -Filter 'SHA256SUMS-*' -File | Select-Object -First 1
if ($sums) { Say ('  校验  : ' + $sums.Name) } else { Say '  校验  : SHA256SUMS 缺失' }

# ---------- 1. git 全局配置 ----------
Step '配置 git（代理 / TLS / 换行）'

$proxyPort = $null
foreach ($p in @(7897, 7890, 7891, 10809, 1080, 2080)) {
  $hit = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $p -and $_.LocalAddress -eq '127.0.0.1' } |
    Select-Object -First 1
  if ($hit) { $proxyPort = $p; break }
}

if ($proxyPort) {
  Say ('  发现本地代理端口 ' + $proxyPort)
  $null = git config --global 'http.https://github.com.proxy' ('http://127.0.0.1:' + $proxyPort) 2>&1
  Say '  已写入 git 配置（只对 github.com 生效）' Green
} else {
  Say '  未发现本地代理，直连；若卡住请先开代理' Yellow
}

$null = git config --global http.sslBackend openssl 2>&1
$null = git config --global core.autocrlf false 2>&1
Say '  sslBackend = openssl, autocrlf = false'

# ---------- 2. 本地仓库 ----------
Step '初始化仓库'

if (-not (Test-Path '.git')) {
  $null = git init -b main 2>&1
  Say '  git init -b main'
} else {
  Say '  已有 .git，跳过 init'
}

@('node_modules/', '*.log', '.DS_Store', 'Thumbs.db') | Set-Content '.gitignore' -Encoding ASCII

$null = git add -A 2>&1
$pending = (git status --porcelain 2>&1 | Measure-Object).Count
if ($pending -gt 0) {
  $null = git -c user.name=dsh-purge -c user.email=noreply@localhost commit -q -m 'dsh-purge 1.1.71-rc2.3: DeepSeek Harness 0.2.2-rc.1 compat' 2>&1
  Say ('  已提交 (' + $pending + ' 个文件)')
} else {
  Say '  工作区干净，无新提交'
}

if (-not (git tag --list $Tag)) {
  $null = git -c user.name=dsh-purge -c user.email=noreply@localhost tag -a $Tag -m '1.1.71-rc2.3 -- 0.2.2-rc.1 compat' 2>&1
  Say ('  已打 tag ' + $Tag)
} else {
  Say ('  tag ' + $Tag + ' 已存在')
}

$fileCount = (Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\\.git\\' }).Count
Step '本地状态'
Say ('  文件数 : ' + $fileCount)
Say ('  commit : ' + ((git rev-parse --short HEAD) 2>&1))
Say ('  tag    : ' + ((git tag --list $Tag) -join ' '))

if ($Mode -eq 'prepare') {
  Step '准备完成'
  Say '下一步二选一：' White
  Say ''
  Say '  A) 用 gh（推荐，能一键建仓 + 发 release）'
  Say '     1. winget install --id GitHub.cli'
  Say '     2. 重开一个 PowerShell，运行：gh auth login'
  Say '     3. 回来跑：publish.ps1 -Mode release -Repo 你的用户名/仓库名'
  Say ''
  Say '  B) 手动（不用 gh）'
  Say '     1. 浏览器打开 https://github.com/new ，建空仓库（不勾 README/gitignore）'
  Say '     2. git remote add origin https://github.com/你的用户名/仓库名.git'
  Say '     3. git push -u origin main --tags'
  Say '     4. 打开 https://github.com/你的用户名/仓库名/releases/new'
  Say ('        - Choose a tag: ' + $Tag)
  Say '        - 标题：1.1.71-rc2.3 — 0.2.2-rc.1 适配'
  Say '        - 说明：粘贴 RELEASE-NOTES-1.1.71-rc2.3.md'
  Say ('        - 附件：拖入 ' + $tgz.Name)
  Say ''
  exit 0
}

# ---------- 3. 推送 ----------
if (-not $Repo) { Fail 'push / release 模式需要 -Repo 用户名/仓库名' }
if (-not $hasGh) { Fail 'push / release 模式需要 gh CLI：winget install --id GitHub.cli' }

Step '检查 gh 登录状态'
$null = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
  Fail 'gh 未登录。先运行 gh auth login（GitHub.com -> HTTPS -> Login with a web browser），登录后重跑。'
}
Say '  已登录' Green

$remoteUrl = (git remote get-url origin 2>&1)
if ($LASTEXITCODE -eq 0 -and $remoteUrl) {
  Say ('  已有 origin: ' + $remoteUrl)
} else {
  Step ('创建并关联远程仓库 ' + $Repo)
  $null = gh repo view $Repo 2>&1
  if ($LASTEXITCODE -ne 0) {
    gh repo create $Repo --public --description 'dsh-purge 1.1.71 for DeepSeek Harness 0.2.2-rc.1' --source . --remote origin --push 2>&1 |
      ForEach-Object { Say ('  ' + $_) }
  } else {
    $null = git remote add origin ('https://github.com/' + $Repo + '.git') 2>&1
  }
}

Step '推送 main 与 tag'
git push -u origin main --tags 2>&1 | ForEach-Object { Say ('  ' + $_) }

if ($Mode -eq 'push') {
  Step '推送完成'
  Say ('  去网页建 release：https://github.com/' + $Repo + '/releases/new?tag=' + $Tag)
  exit 0
}

# ---------- 4. 发 release ----------
Step ('创建 release ' + $Tag)

$notesFile = Get-ChildItem -Filter 'RELEASE-NOTES-*.md' -File | Select-Object -First 1
if (-not $notesFile) { Fail '找不到 RELEASE-NOTES-*.md' }

$assets = @($tgz.FullName)
if ($sums) { $assets += $sums.FullName }

gh release create $Tag @assets --title '1.1.71-rc2.3 — 0.2.2-rc.1 适配' --notes-file $notesFile.FullName --verify-tag 2>&1 |
  ForEach-Object { Say ('  ' + $_) }

if ($LASTEXITCODE -eq 0) {
  Step '发布成功'
  Say ('  https://github.com/' + $Repo + '/releases/tag/' + $Tag) Green
  Say ''
  Say '安装命令：'
  Say ('  dsh plugin --profile desktop add --ignore-scripts https://github.com/' + $Repo + '/releases/download/' + $Tag + '/' + $tgz.Name)
} else {
  Fail 'gh release create 失败，看上面的输出'
}
