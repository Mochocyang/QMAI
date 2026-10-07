/**
 * 从一份 vitest json 报告里查某个文件的失败用例。
 *
 * 为什么单独写文件：本项目的 shell 里 `node -e` 的长输出会被吞掉，
 * 得到空白却分不清"没问题"和"没执行"。`ConvertFrom-Json` 也解析不了大报告。
 *
 * 用法: node docs/ai-composer-nowrap-20261007/query-suite.mjs <报告.json> <文件名片段>
 */
import { readFileSync } from "node:fs"

const [reportPath, needle] = process.argv.slice(2)
if (!reportPath || !needle) {
  console.error("用法: node query-suite.mjs <report.json> <文件名片段>")
  process.exit(2)
}
const report = JSON.parse(readFileSync(reportPath, "utf8"))
const file = report.testResults.find((t) => t.name.includes(needle))
if (!file) {
  console.log(`报告里没有匹配「${needle}」的文件`)
  process.exit(0)
}
const failed = file.assertionResults.filter((a) => a.status === "failed")
const passed = file.assertionResults.filter((a) => a.status === "passed")
console.log(`文件: ${file.name}`)
console.log(`状态: ${file.status}  通过 ${passed.length}  失败 ${failed.length}`)
for (const a of failed) console.log(`  × ${a.fullName}`)
