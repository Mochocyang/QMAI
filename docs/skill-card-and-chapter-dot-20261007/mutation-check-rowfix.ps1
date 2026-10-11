# 变异验证（第二轮：证据索引改同行+弹窗、章节目录绿点占位对齐）。
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File docs/skill-card-and-chapter-dot-20261007/mutation-check-rowfix.ps1
#
# 与第一轮脚本的差别：本轮改动落在**两个**文件上，所以这里做成多文件版。
# 沿用第一轮的三条防护，理由见 mutation-check.ps1 顶部注释：
#   1) 不用 $ErrorActionPreference="Stop"（npx 的 npm 警告会被当成终止性错误）；
#   2) 还原放 finally；
#   3) 开头先证明起点干净（否则"还原成功"是拿变异后的内容当基线，会谎报）。
$ErrorActionPreference = "Continue"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
Set-Location $root

$excludes = @("--exclude", "**/.codex-temp/**", "--exclude", "**/.claude/**", "--exclude", "**/.worktrees/**")

# 每个目标：源码文件 + 它的用例文件（+ 需要一起跑的关联用例）。
$targets = @(
  @{
    Path  = "src\components\novel\book-analysis-workbench.tsx"
    Specs = @("src/components/novel/book-analysis-workbench.spec.tsx")
  },
  @{
    Path  = "src\components\layout\knowledge-tree.tsx"
    Specs = @("src/components/layout/knowledge-tree.memory-dot.spec.tsx", "src/components/layout/knowledge-tree.real-data.spec.tsx")
  }
)

# 起点自检：所有目标都必须与 HEAD 一致。
foreach ($t in $targets) {
  $dirty = git diff --name-only HEAD -- $t.Path
  if ($dirty) {
    Write-Output "起始状态不是干净的（$($t.Path) 与 HEAD 有差异），先还原再跑。"
    exit 2
  }
}

function To-Crlf([string]$s) { return ($s -replace "`r`n", "`n") -replace "`n", "`r`n" }

function Invoke-Mutation {
  param([string]$Path, [string[]]$Specs, [string]$Name, [string]$Old, [string]$New, [string]$ExpectFailing)

  # 每次都重新从磁盘读：上一个变异已被 finally 还原，读到的必是原始内容。
  $bytes = [System.IO.File]::ReadAllBytes("$root\$Path")
  $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
  $encoding = New-Object System.Text.UTF8Encoding($hasBom)
  $original = $encoding.GetString($bytes)
  $originalHash = (Get-FileHash "$root\$Path" -Algorithm SHA256).Hash

  $Old = To-Crlf $Old
  $New = To-Crlf $New
  if (-not $original.Contains($Old)) { Write-Output "  [跳过] $Name —— 锚点没找到"; return }
  $mutated = $original.Replace($Old, $New)
  if ($mutated -eq $original) { Write-Output "  [跳过] $Name —— 替换没生效"; return }

  $out = ""
  try {
    [System.IO.File]::WriteAllText("$root\$Path", $mutated, $encoding)
    $out = & npx vitest run @Specs @excludes 2>&1 | Out-String
  } finally {
    [System.IO.File]::WriteAllBytes("$root\$Path", $bytes)
  }

  $restored = (Get-FileHash "$root\$Path" -Algorithm SHA256).Hash
  $ok = $restored -eq $originalHash

  $m = [regex]::Match($out, "Tests\s+(.+)")
  $failed = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "(没解析到)" }
  Write-Output "  $Name"
  Write-Output "     结果: $failed"
  Write-Output "     期望: $ExpectFailing"
  $names = [regex]::Matches($out, "(?m)^\s*FAIL\s+\S+\s+>\s+(.+)$") | ForEach-Object { $_.Groups[1].Value.Trim() }
  if ($names.Count) { $names | Select-Object -Unique | ForEach-Object { Write-Output "     变红: $_" } }
  Write-Output "     还原校验: $ok"
}

$wb = "src\components\novel\book-analysis-workbench.tsx"
$wbSpec = @("src/components/novel/book-analysis-workbench.spec.tsx")
$tree = "src\components\layout\knowledge-tree.tsx"
$treeSpec = @("src/components/layout/knowledge-tree.memory-dot.spec.tsx", "src/components/layout/knowledge-tree.real-data.spec.tsx")

Write-Output "`n=== 变异 A：统计那行挪出 .wb-card-meta（回到"各占一行"）==="
# 去掉行容器、把统计放回它前面：这正是"左右排列"被改回"上下排列"的现实写法。
Invoke-Mutation -Path $wb -Specs $wbSpec -Name "统计行移出同一行容器" `
  -Old @'
      <div className="wb-card-meta">
        <small>{item.rules.length}条规则 · {new Set(item.rules.flatMap((rule) => rule.evidenceIds)).size}条依据</small>
'@ `
  -New @'
      <small>{item.rules.length}条规则 · {new Set(item.rules.flatMap((rule) => rule.evidenceIds)).size}条依据</small>
      <div className="wb-card-meta">
'@ `
  -ExpectFailing "「同一行」用例变红（行容器里找不到那行统计）"

Write-Output "`n=== 变异 B：把证据索引挪出卡片（回到版本级独占一行）==="
Invoke-Mutation -Path $wb -Specs $wbSpec -Name "证据索引不再挂在 .wb-card-meta 里" `
  -Old '        <button
          type="button"
          className="wb-card-evidence"' `
  -New '        <button
          type="button"
          className="wb-card-evidence-off-row"' `
  -ExpectFailing "「同一行」用例变红（行容器里找不到证据索引入口）"

Write-Output "`n=== 变异 C：点击不打开弹窗（按钮接错线）==="
# 这是"点击之后以弹窗形式打开"最直接的回归：按钮还在、但不弹。
Invoke-Mutation -Path $wb -Specs $wbSpec -Name "onClick 改成 setEvidenceOpen(false)" `
  -Old '          onClick={() => setEvidenceOpen(true)}' `
  -New '          onClick={() => setEvidenceOpen(false)}' `
  -ExpectFailing "「点击后弹出证据索引」用例变红"

Write-Output "`n=== 变异 D：弹窗里改为列出整版证据（复用第一轮的判据，改用例后仍须承重）==="
Invoke-Mutation -Path $wb -Specs $wbSpec -Name "itemEvidence 改用整版 revision.evidence" `
  -Old 'const itemEvidence = [...new Set(item.rules.flatMap((rule) => rule.evidenceIds))]' `
  -New 'const itemEvidence = revision.evidence' `
  -ExpectFailing "「弹窗只列该成果引用的原文」用例变红"

Write-Output "`n=== 变异 E：占位点不占宽度（留位失效）==="
# 用户反馈的正是这个：占位没占住，标题左边界就会参差。
Invoke-Mutation -Path $tree -Specs $treeSpec -Name "占位点 className 改成空串" `
  -Old @'
              <span
                aria-hidden="true"
                data-ui-tree-memory-dot-spacer="true"
                className={MEMORY_DOT_SLOT_CLASS}
              />
'@ `
  -New @'
              <span
                aria-hidden="true"
                data-ui-tree-memory-dot-spacer="true"
                className=""
              />
'@ `
  -ExpectFailing "「占位与真点等宽」用例变红"

Write-Output "`n=== 变异 F：占位点带上 title（被读成「已提取」声明）==="
Invoke-Mutation -Path $tree -Specs $treeSpec -Name "占位点加上 title" `
  -Old @'
                aria-hidden="true"
                data-ui-tree-memory-dot-spacer="true"
'@ `
  -New @'
                aria-hidden="true"
                title="已提取记忆"
                data-ui-tree-memory-dot-spacer="true"
'@ `
  -ExpectFailing "「占位对悬停不可见」用例变红"

Write-Output "`n=== 变异 G：真点与占位不再共用尺寸常量（改歪一处）==="
Invoke-Mutation -Path $tree -Specs $treeSpec -Name "真点改用写死的 class" `
  -Old '                className={`${MEMORY_DOT_SLOT_CLASS} ${
                  memoryDotState === "done" ? "bg-emerald-500" : "animate-pulse bg-muted-foreground/60"
                }`}' `
  -New '                className={`h-2 w-2 shrink-0 rounded-full ${
                  memoryDotState === "done" ? "bg-emerald-500" : "animate-pulse bg-muted-foreground/60"
                }`}' `
  -ExpectFailing "「占位与真点等宽」用例变红（真点被改成 h-2 w-2）"

Write-Output "`n=== 结束：再次确认两个文件都与 HEAD 一致 ==="
foreach ($t in $targets) {
  $d = git diff --name-only HEAD -- $t.Path
  Write-Output "  $($t.Path): $(if ($d) { '仍然脏！' } else { '干净' })"
}
