# 变异验证：逐条把本次修复改坏，确认对应用例确实变红，再按字节还原。
# 用法: pwsh -File docs/skill-card-and-chapter-dot-20261007/mutation-check.ps1
# 不能用 Stop：npx 会把 npm 警告写到 stderr，在 PS 5.1 里会被当成终止性错误，
# 于是第一次变异跑完就整个脚本退出（实测过）。
$ErrorActionPreference = "Continue"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

$target = "src\components\novel\book-analysis-workbench.tsx"
$spec = "src/components/novel/book-analysis-workbench.spec.tsx"
$excludes = @("--exclude", "**/.codex-temp/**", "--exclude", "**/.claude/**", "--exclude", "**/.worktrees/**")

# 按字节备份，还原时字节级一致（含 BOM 与行尾）。
$bytes = [System.IO.File]::ReadAllBytes("$root\$target")
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$encoding = New-Object System.Text.UTF8Encoding($hasBom)
$original = $encoding.GetString($bytes)
$originalHash = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
Write-Output "原文件 SHA256 = $originalHash  (BOM=$hasBom)"

function Invoke-Mutation {
  param([string]$Name, [string]$Old, [string]$New, [string]$ExpectFailing)

  if (-not $original.Contains($Old)) { Write-Output "  [跳过] $Name —— 锚点没找到"; return }
  $mutated = $original.Replace($Old, $New)
  if ($mutated -eq $original) { Write-Output "  [跳过] $Name —— 替换没生效"; return }
  [System.IO.File]::WriteAllText("$root\$target", $mutated, $encoding)

  $out = & npx vitest run $spec @excludes 2>&1 | Out-String
  [System.IO.File]::WriteAllBytes("$root\$target", $bytes)
  $restored = (Get-FileHash "$root\$target" -Algorithm SHA256).Hash
  $ok = $restored -eq $originalHash

  $m = [regex]::Match($out, "Tests\s+(.+)")
  $failed = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "(没解析到)" }
  Write-Output "  $Name"
  Write-Output "     结果: $failed"
  Write-Output "     期望: $ExpectFailing"
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
