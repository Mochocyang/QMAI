// 取指定测试文件在 JSON 报告里的失败用例名与错误消息。
import { readFileSync } from "node:fs"

const jsonPath = process.argv[2]
const needle = process.argv[3] ?? "ui-test-isolation"

const d = JSON.parse(readFileSync(jsonPath, "utf8"))
const files = (d.testResults ?? []).filter((r) => (r.name ?? "").includes(needle))

if (files.length === 0) {
  console.log(`  没有找到匹配 "${needle}" 的文件`)
  process.exit(0)
}

for (const f of files) {
  console.log(`\n文件: ${f.name}`)
  console.log(`  状态: ${f.status}`)
  const asserts = f.assertionResults ?? []
  console.log(`  用例: ${asserts.length}，失败: ${asserts.filter((a) => a.status === "failed").length}`)
  for (const a of asserts) {
    if (a.status !== "failed") continue
    console.log(`\n  FAIL: ${a.fullName ?? a.title}`)
    const msg = (a.failureMessages ?? []).join("\n---\n")
    console.log(`  消息:\n${msg.slice(0, 1500)}`)
  }
}
