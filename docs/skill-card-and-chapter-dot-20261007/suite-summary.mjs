// 汇总 vitest json 报告里的通过/失败，并列出失败用例。
// 为什么不用 ConvertFrom-Json / node -e：报告很大，PS 解析会失败；-e 里的引号在 PS 里也很脆。
import { readFileSync } from "node:fs"

const file = process.argv[2]
const r = JSON.parse(readFileSync(file, "utf8"))
const t = r.testResults || []
let pass = 0, fail = 0, skip = 0
const failedFiles = []
for (const f of t) {
  const a = f.assertionResults || []
  const bad = a.filter((x) => x.status === "failed")
  pass += a.filter((x) => x.status === "passed").length
  fail += bad.length
  skip += a.filter((x) => x.status === "skipped" || x.status === "pending").length
  if (bad.length) failedFiles.push([f.name.replace(/^.*[\\/]QMAI-main[\\/]/, ""), bad])
}
console.log(`Test Files: ${t.length}  (有失败的文件: ${failedFiles.length})`)
console.log(`Tests: passed=${pass} failed=${fail} skipped=${skip}`)
if (failedFiles.length) {
  console.log("\n失败用例:")
  for (const [name, bad] of failedFiles) {
    console.log(`  ${name}  (${bad.length})`)
    for (const x of bad.slice(0, 4)) console.log(`      - ${x.title}`)
    if (bad.length > 4) console.log(`      … 另有 ${bad.length - 4} 条`)
  }
}
