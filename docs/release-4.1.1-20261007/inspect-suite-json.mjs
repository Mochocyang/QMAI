/**
 * 检查两份 vitest JSON：是否已存在 scrollIntoView 未处理错误，
 * 以及各自的用例/失败统计。避免只凭"现在报了错"就断言是本次引入的。
 */
import { readFileSync, existsSync } from "node:fs"

const files = process.argv.slice(2)
for (const path of files) {
  if (!existsSync(path)) {
    console.log(`\n=== ${path} ===\n  (不存在)`)
    continue
  }
  const raw = readFileSync(path, "utf8")
  let data
  try {
    data = JSON.parse(raw)
  } catch (err) {
    console.log(`\n=== ${path} ===\n  JSON 解析失败: ${err.message}`)
    continue
  }
  const results = data.testResults ?? []
  const failedFiles = results.filter((r) => r.status === "failed")
  let totalTests = 0
  let failedTests = 0
  for (const r of results) {
    for (const a of r.assertionResults ?? []) {
      totalTests += 1
      if (a.status === "failed") failedTests += 1
    }
  }
  const hits = []
  for (const r of results) {
    const text = JSON.stringify(r)
    if (text.includes("scrollIntoView")) hits.push(r.name ?? r.testFilePath ?? "(未命名)")
  }
  console.log(`\n=== ${path} ===`)
  console.log(`  文件 ${results.length}，失败文件 ${failedFiles.length}`)
  console.log(`  用例 ${totalTests}，失败 ${failedTests}`)
  console.log(`  "scrollIntoView" 出现的文件：${hits.length}`)
  for (const h of hits.slice(0, 8)) console.log(`    ${h}`)
}
