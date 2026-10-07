/**
 * 导出 v4.1.0..HEAD 的提交清单，供人工整理发布说明。
 * 为什么不用 cmd：`git log --format=` 里的 `|` 会被 cmd 当管道，
 * `%cd` 会被当变量展开，中文还会被控制台编码搞乱。
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const SEP = "\u0001"
const out = execFileSync(
  "git",
  ["log", "v4.1.0..HEAD", `--format=%h${SEP}%s${SEP}%b${SEP}---`],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
)

const entries = out.split(`${SEP}---\n`).filter((block) => block.trim())
const lines = []
let n = 0
for (const block of entries) {
  const [hash, subject, ...bodyParts] = block.split(SEP)
  n += 1
  lines.push(`${String(n).padStart(3)} ${hash}  ${subject}`)
  const body = bodyParts.join(SEP).trim()
  if (body) {
    for (const line of body.split("\n").slice(0, 12)) lines.push(`      | ${line}`)
  }
  lines.push("")
}
const target = process.argv[2] ?? "commits.txt"
writeFileSync(target, `共 ${n} 个提交\n\n${lines.join("\n")}`, "utf8")
console.log(`已写出 ${n} 个提交到 ${target}`)
