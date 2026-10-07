# 变异验证：逐条把本次修复改坏，确认对应用例确实变红，再按字节还原。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File docs/skill-card-and-chapter-dot-20261007/mutation-check.ps1
#
# 两条踩过的坑，别改回去：
# 1) 不能用 $ErrorActionPreference="Stop"：npx 把 npm 警告写到 stderr，在 PS 5.1 里会被
#    当成终止性错误，于是第一次变异跑完整个脚本就退出，**并且把变异留在磁盘上**。
# 2) 还原必须放在 finally 里。上面那次崩溃的后果是：源码带着变异进入下一轮，
#    而下一轮的「还原校验」拿到的「原始值」其实已经是变异后的内容，于是谎报 True。
#    所以除了 finally，还要在开头先证明起点是干净的。
$ErrorActionPreference = "Continue"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

$target = "src\components\novel\book-analysis-workbench.tsx"
$spec = "src/components/novel/book-analysis-workbench.spec.tsx"
$excludes = @("--exclude", "**/.codex-temp/**", "--exclude", "**/.claude/**", "--exclude", "**/.worktrees/**")

# 起点自检：必须与 HEAD 一致，否则我们是在拿一个已被改坏的版本当基线。
$dirty = git diff --name-only HEAD -- $target
if ($dirty) {
  Write-Output "起始状态不是干净的（$target 与 HEAD 有差异），先还原再跑。"
  exit 2
}

# 按字节备份，还原时字节级一致（含 BOM 与行尾）。
$bytes = [System.IO.File]::ReadAllBytes("$root\$target")
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$encoding = New-Object System.Text.UTF8Encoding($hasBom)
$original = $encoding.GetString($bytes)
$originalHash = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
Write-Output "原文件 SHA256 = $originalHash  (BOM=$hasBom)"

# 本脚本用 LF 保存，而目标源码是 CRLF：多行锚点必须统一成 CRLF 才找得到
# （这条也是实测踩出来的 —— 两个多行变异一度全部「锚点没找到」而被静默跳过）。
function To-Crlf([string]$s) { return ($s -replace "`r`n", "`n") -replace "`n", "`r`n" }

function Invoke-Mutation {
  param([string]$Name, [string]$Old, [string]$New, [string]$ExpectFailing)

  $Old = To-Crlf $Old
  $New = To-Crlf $New
  if (-not $original.Contains($Old)) { Write-Output "  [跳过] $Name —— 锚点没找到"; return }
  $mutated = $original.Replace($Old, $New)
  if ($mutated -eq $original) { Write-Output "  [跳过] $Name —— 替换没生效"; return }

  $out = ""
  try {
    [System.IO.File]::WriteAllText("$root\$target", $mutated, $encoding)
    $out = & npx vitest run $spec @excludes 2>&1 | Out-String
  } finally {
    # 无论 vitest 成功、失败还是抛错，都必须回到原始字节。
    [System.IO.File]::WriteAllBytes("$root\$target", $bytes)
  }

  $restored = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
  $ok = $restored -eq $originalHash

  $m = [regex]::Match($out, "Tests\s+(.+)")
  $failed = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "(没解析到)" }
  Write-Output "  $Name"
  Write-Output "     结果: $failed"
  Write-Output "     期望: $ExpectFailing"
  # 只报数量不够：必须证明**该失败的那条**失败了，而不是碰巧把别的用例弄红。
  $names = [regex]::Matches($out, "(?m)^\s*FAIL\s+\S+\s+>\s+(.+)$") | ForEach-Object { $_.Groups[1].Value.Trim() }
  if ($names.Count) { $names | Select-Object -Unique | ForEach-Object { Write-Output "     变红: $_" } }
  Write-Output "     还原校验: $ok"
}

Write-Output "`n=== 变异 1：把「未入库也显示启用按钮」改回去（恢复 confirmedAt 门禁）==="
Invoke-Mutation -Name "重新加上 !revision.confirmedAt 提前返回" `
  -Old 'if (revision.skill !== "style") return' `
  -New 'if (revision.skill !== "style" || !revision.confirmedAt) return' `
  -ExpectFailing "「未入库的文风版本也必须有启用此文风」变红"

Write-Output "`n=== 变异 2：把「未入库」误判成「已被替换」 ==="
Invoke-Mutation -Name "unpublished 退化成 replaced" `
  -Old 'if (!preset) { setStyleState({ kind: "unpublished" }); return }' `
  -New 'if (!preset) { setStyleState({ kind: "replaced" }); return }' `
  -ExpectFailing "未入库用例变红（按钮消失且出现「已被替换」）"

Write-Output "`n=== 变异 3：把状态徽标加回来 ==="
$badgeOld = @'
        <h3>{item.subject}{itemDate && <small className="wb-card-date">{` · ${itemDate}`}</small>}</h3>
      </div>
'@
$badgeNew = @'
        <h3>{item.subject}{itemDate && <small className="wb-card-date">{` · ${itemDate}`}</small>}</h3>
        <span className="wb-card-status">{revision.confirmedAt ? "已入库" : "待确认"}</span>
      </div>
'@
Invoke-Mutation -Name "卡片上重新渲染 .wb-card-status" `
  -Old $badgeOld -New $badgeNew `
  -ExpectFailing "「卡片上不再有状态徽标」变红"

Write-Output "`n=== 变异 3b：把旧版来源标签加回来 ==="
$tagOld = @'
    {revision.skill === "characters" && <div className="wb-soul-actions" data-testid={`wb-soul-actions-${item.subject}`}>
'@
$tagNew = @'
    {revision.skill === "characters" && <div className="wb-soul-actions" data-testid={`wb-soul-actions-${item.subject}`}>
      {revision.origin === "legacy" && <span className="wb-origin-tag">旧版资料导入 · 无结构化规则</span>}
'@
Invoke-Mutation -Name "卡片上重新渲染 .wb-origin-tag" `
  -Old $tagOld -New $tagNew `
  -ExpectFailing "「不再显示旧版来源标签」变红"

Write-Output "`n=== 变异 4：卡片证据索引改成列出整版证据 ==="
Invoke-Mutation -Name "itemEvidence 改用整版 revision.evidence" `
  -Old 'const itemEvidence = [...new Set(item.rules.flatMap((rule) => rule.evidenceIds))]' `
  -New 'const itemEvidence = revision.evidence' `
  -ExpectFailing "「证据索引只列该成果引用的原文」变红"

Write-Output "`n=== 变异 5：把版本级证据索引整块加回来 ==="
Invoke-Mutation -Name "版本级重新渲染「证据索引与实际覆盖」" `
  -Old '    {previous && <details className="wb-result"><summary>与上一版本的变化</summary>' `
  -New '    <details className="wb-result"><summary>证据索引与实际覆盖</summary><p className="wb-muted">自动核验仍需人工复核。</p></details>
    {previous && <details className="wb-result"><summary>与上一版本的变化</summary>' `
  -ExpectFailing "「版本级那一块不再存在」变红"

$finalHash = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
Write-Output "`n=== 全部变异结束，文件 SHA256 = $finalHash ==="
Write-Output "与原始一致: $($finalHash -eq $originalHash)"
