/**
 * 从 vitest 的 json 报告里读出失败文件清单。
 * 为什么不用 ConvertFrom-Json：本仓库的报告文件很大，PS 5.1 会失败。
 * 用法: node docs/memory-center-single-page-20261007/suite-failures.mjs <json> [<json>...]
 */
import { readFileSync } from "node:fs"

for (const path of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(path, "utf8"))
  const failed = report.testResults.filter((suite) => suite.status === "failed")
  const total = report.numTotalTests
  const passed = report.numPassedTests
  console.log(`\n=== ${path} ===`)
  console.log(`  文件 ${report.testResults.length} 个，用例 ${total} 个，通过 ${passed}，失败 ${report.numFailedTests}`)
  console.log(`  失败文件 ${failed.length} 个：`)
  for (const suite of failed) {
    const rel = suite.name.replace(/\\/g, "/").split("/src/").pop()
    const count = suite.assertionResults.filter((a) => a.status === "failed").length
    console.log(`    ${String(count).padStart(3)} × src/${rel}`)
  }
}
