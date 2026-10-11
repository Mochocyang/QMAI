/**
 * 按提交类型导出 v4.1.0..HEAD 的标题，供人工整理发布说明。
 * 让 node 直接写文件：经 PowerShell 重定向会带上 BOM 与控制台编码问题。
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const SEP = "\u0001"
const out = execFileSync("git", ["log", "v4.1.0..HEAD", `--format=%h${SEP}%s`], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})

const groups = { feat: [], fix: [], perf: [], refactor: [], style: [], docs: [], test: [], chore: [], other: [] }
for (const line of out.split("\n").filter(Boolean)) {
  const [hash, subject] = line.split(SEP)
  const match = /^([a-z]+)(\([^)]*\))?!?:/.exec(subject)
  const type = match && groups[match[1]] ? match[1] : "other"
  groups[type].push(`${hash}  ${subject}`)
}

const lines = []
for (const key of ["feat", "fix", "perf", "refactor", "style", "docs", "test", "chore", "other"]) {
  lines.push(`\n===== ${key.toUpperCase()} (${groups[key].length}) =====`)
  for (const item of groups[key]) lines.push(`  ${item}`)
}

const target = process.argv[2]
writeFileSync(target, lines.join("\n"), "utf8")
console.log(`已写出 ${out.split("\n").filter(Boolean).length} 个标题到 ${target}`)
