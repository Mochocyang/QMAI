/** 导出指定提交的完整正文，供人工核对发布说明是否失真。 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const hashes = process.argv.slice(2, -1)
const target = process.argv[process.argv.length - 1]

const lines = []
for (const hash of hashes) {
  const body = execFileSync("git", ["log", "-1", "--format=%B", hash], { encoding: "utf8" })
  lines.push(`\n${"=".repeat(70)}\n=== ${hash} ===\n${"=".repeat(70)}`)
  lines.push(body.trim())
}
writeFileSync(target, lines.join("\n"), "utf8")
console.log(`已写出 ${hashes.length} 个提交的正文`)
