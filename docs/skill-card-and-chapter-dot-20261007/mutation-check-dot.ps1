# 变异验证（绿点取号）：把取号规则改成"标题优先"或"文件名优先"，
# 确认 knowledge-tree.real-data.spec.tsx 会变红，再按字节还原。
#
# 与 mutation-check.ps1 同样的两条纪律：
#   - 不用 $ErrorActionPreference="Stop"（npx 的 npm 警告走 stderr，会被 PS 5.1 当终止性错误，
#     导致变异留在磁盘上）；
#   - 还原放 finally，且开头用 git diff 证明起点干净（否则"原始值"本身就是坏的，会谎报成功）。
$ErrorActionPreference = "Continue"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

$target = "src\components\layout\knowledge-tree.tsx"
$spec = "src/components/layout/knowledge-tree.real-data.spec.tsx"
$excludes = @("--exclude", "**/.codex-temp/**", "--exclude", "**/.claude/**", "--exclude", "**/.worktrees/**")

if (git diff --name-only HEAD -- $target) {
  Write-Output "起始状态不干净（$target 与 HEAD 有差异），先还原再跑。"
  exit 2
}

$bytes = [System.IO.File]::ReadAllBytes("$root\$target")
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$encoding = New-Object System.Text.UTF8Encoding($hasBom)
$original = $encoding.GetString($bytes)
$originalHash = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
Write-Output "原文件 SHA256 = $originalHash  (BOM=$hasBom)"

function To-Crlf([string]$s) { return ($s -replace "`r`n", "`n") -replace "`n", "`r`n" }

function Invoke-Mutation {
  param([string]$Name, [string]$Old, [string]$New, [string]$ExpectFailing)
  $Old = To-Crlf $Old; $New = To-Crlf $New
  if (-not $original.Contains($Old)) { Write-Output "  [跳过] $Name —— 锚点没找到"; return }

  $out = ""
  try {
    [System.IO.File]::WriteAllText("$root\$target", $original.Replace($Old, $New), $encoding)
    $out = & npx vitest run $spec @excludes 2>&1 | Out-String
  } finally {
    [System.IO.File]::WriteAllBytes("$root\$target", $bytes)
  }

  $restored = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
  $m = [regex]::Match($out, "Tests\s+(.+)")
  $names = [regex]::Matches($out, "(?m)^\s*FAIL\s+\S+\s+>\s+(.+)$") | ForEach-Object { $_.Groups[1].Value.Trim() }
  Write-Output "  $Name"
  Write-Output "     结果: $(if ($m.Success) { $m.Groups[1].Value.Trim() } else { '(没解析到)' })"
  Write-Output "     期望: $ExpectFailing"
  if ($names.Count) { $names | Select-Object -Unique | ForEach-Object { Write-Output "     变红: $_" } }
  Write-Output "     还原校验: $($restored -eq $originalHash)"
}

Write-Output "`n=== 变异 A：取号改成「标题优先」 ==="
Invoke-Mutation -Name "chapterNumber 改为 title ?? frontmatter" `
  -Old '? (extractChapterNumberFromContent(content) ?? extractPageOrderFromTitle(title) ?? undefined)' `
  -New '? (extractPageOrderFromTitle(title) ?? extractChapterNumberFromContent(content) ?? undefined)' `
  -ExpectFailing "真实数据的「frontmatter 优先」用例变红（chapter-018 的标题写第2章）"

Write-Output "`n=== 变异 B：green dot 不再回退到文件名（用守护它的那个 spec 跑）==="
# 本 spec 的 5 个真实文件**都有** frontmatter，所以拿掉回退它们照样亮 —— 这条变异在本 spec 上
# 必须"不红"，否则说明本 spec 在偷偷依赖回退。回退能力由 memory-dot.spec 的 009.md 用例守护，
# 所以这里换成那个 spec 跑，证明回退真的有人管（否则就是无人覆盖的死代码）。
$specB = "src/components/layout/knowledge-tree.memory-dot.spec.tsx"
$outB = ""
try {
  [System.IO.File]::WriteAllText("$root\$target",
    $original.Replace((To-Crlf '? (extractChapterNumber(fileName.replace(/\.md$/i, "")) ?? undefined)'), (To-Crlf '? undefined')), $encoding)
  $outB = & npx vitest run $specB @excludes 2>&1 | Out-String
} finally {
  [System.IO.File]::WriteAllBytes("$root\$target", $bytes)
}
$namesB = [regex]::Matches($outB, "(?m)^\s*FAIL\s+\S+\s+>\s+(.+)$") | ForEach-Object { $_.Groups[1].Value.Trim() }
$mB = [regex]::Match($outB, "Tests\s+(.+)")
Write-Output "  fileChapterNumber 恒为 undefined"
Write-Output "     结果: $(if ($mB.Success) { $mB.Groups[1].Value.Trim() } else { '(没解析到)' })"
Write-Output "     期望: 文件名回退用例变红"
if ($namesB.Count) { $namesB | Select-Object -Unique | ForEach-Object { Write-Output "     变红: $_" } }
Write-Output "     还原校验: $((Get-FileHash "$root\$target" -Algorithm SHA256).Hash -eq $originalHash)"

$final = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
Write-Output "`n=== 结束，SHA256 = $final  与原始一致: $($final -eq $originalHash) ==="
