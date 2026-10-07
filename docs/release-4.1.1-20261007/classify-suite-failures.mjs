// 判定 `npm run test:mocks` 的失败是否全部来自 `.claude/worktrees/` 下的重复副本。
//
// 背景：test:mocks 的排除列表写的是 `**/.worktrees/**`（路径段须恰好为
// `.worktrees`），匹配不到 `.claude/worktrees/`，于是本地 worktree 遗留的
// 测试副本被一起执行，文件数从 689 涨到 1316、失败从 197 涨到 451。
//
// 要给出的结论是"这些额外失败与我本次发版改动无关"，所以必须按路径归类，
// 而不是只说"多了很多"。
import { readFileSync } from "node:fs"

const path = process.argv[2]
const baselinePath = process.argv[3]

const data = JSON.parse(readFileSync(path, "utf8"))
const results = data.testResults ?? []

let total = 0
let failed = 0
let claudeFailed = 0
let claudeTotal = 0
let otherFailed = 0
const claudeFailedFiles = []
const otherFailedFiles = []

for (const r of results) {
  const file = (r.name ?? r.testFilePath ?? "").replace(/\\/g, "/")
  const isClaude = /\/\.claude\//.test(file)
  const asserts = r.assertionResults ?? []
  for (const a of asserts) {
    total += 1
    if (isClaude) claudeTotal += 1
    if (a.status === "failed") {
      failed += 1
      if (isClaude) claudeFailed += 1
      else otherFailed += 1
    }
  }
  if (r.status === "failed") {
    if (isClaude) claudeFailedFiles.push(file)
    else otherFailedFiles.push(file)
  }
}

console.log(`=== ${path} ===`)
console.log(`  文件 ${results.length}，用例 ${total}，失败 ${failed}`)
console.log(`  其中 .claude/ 下：文件 ${results.filter((r) => /\/\.claude\//.test((r.name ?? "").replace(/\\/g, "/"))).length}，用例 ${claudeTotal}，失败 ${claudeFailed}`)
console.log(`  非 .claude/：失败 ${otherFailed}`)

if (baselinePath) {
  const base = JSON.parse(readFileSync(baselinePath, "utf8"))
  const baseResults = base.testResults ?? []
  const baseOtherFailedFiles = new Set(
    baseResults
      .filter((r) => r.status === "failed")
      .map((r) => (r.name ?? r.testFilePath ?? "").replace(/\\/g, "/")),
  )
  const baseFailed = baseResults.reduce(
    (n, r) => n + (r.assertionResults ?? []).filter((a) => a.status === "failed").length,
    0,
  )
  console.log(`\n=== 对照基线 ${baselinePath} ===`)
  console.log(`  基线失败用例 ${baseFailed}，失败文件 ${baseOtherFailedFiles.size}`)
  console.log(`  test:mocks 的非 .claude 失败用例 ${otherFailed} vs 基线 ${baseFailed}`)

  const newlyFailed = otherFailedFiles.filter((f) => !baseOtherFailedFiles.has(f))
  const newlyGreen = [...baseOtherFailedFiles].filter((f) => !otherFailedFiles.includes(f))
  console.log(`\n  非 .claude 的新增失败文件 ${newlyFailed.length} 个`)
  for (const f of newlyFailed.slice(0, 10)) console.log(`    + ${f}`)
  console.log(`  非 .claude 的新转全绿文件 ${newlyGreen.length} 个`)
  for (const f of newlyGreen.slice(0, 10)) console.log(`    - ${f}`)
}

console.log(`\n=== 非 .claude 的失败文件（前 30）===`)
for (const f of otherFailedFiles.slice(0, 30)) console.log(`  ${f.replace(/^.*QMAI-main\//, "")}`)
