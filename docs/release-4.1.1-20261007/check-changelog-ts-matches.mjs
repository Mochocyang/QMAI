/**
 * 确认 src/lib/changelog.ts 里新增的 4.1.1 条目与已校验的条目文件逐字一致。
 *
 * 为什么需要：覆盖度检查（check-condense-coverage.mjs）读的是
 * changelog-entry-4.1.1.txt，而真正发布的是 changelog.ts。条目是我手工
 * 誊写进 TS 的 —— 誊写错一个字，覆盖度结论就与"实际发布的内容"脱钩，
 * 而两者都各自"通过检查"。必须把两个来源钉在一起。
 *
 * 用法: node docs/release-4.1.1-20261007/check-changelog-ts-matches.mjs
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractArray, normalizeNewlines } from "./parse-changelog-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")

const draftPath = resolve(here, "changelog-entry-4.1.1.txt")
const draft = readFileSync(draftPath, "utf8")
const draftZh = extractArray(draft, "zh")
const draftEn = extractArray(draft, "en")

const tsPath = resolve(root, "src/lib/changelog.ts")
// 归一化行尾：changelog.ts 是 CRLF，草稿是 LF
const ts = normalizeNewlines(readFileSync(tsPath, "utf8"))

// 只截取 4.1.1 那一段，避免匹配到 4.1.0
const entryStart = ts.indexOf("const FOUR_POINT_ONE_ONE_CHANGELOG")
if (entryStart < 0) throw new Error("changelog.ts 里找不到 FOUR_POINT_ONE_ONE_CHANGELOG")
const entryEnd = ts.indexOf("const FOUR_POINT_ONE_ZERO_CHANGELOG", entryStart)
if (entryEnd < 0) throw new Error("找不到 4.1.1 条目的结束位置")
const entry = ts.slice(entryStart, entryEnd)

const tsZh = extractArray(entry, "zh")
const tsEn = extractArray(entry, "en")

const problems = []
if (tsZh.length !== draftZh.length) problems.push(`中文条数：ts=${tsZh.length} 文件=${draftZh.length}`)
if (tsEn.length !== draftEn.length) problems.push(`英文条数：ts=${tsEn.length} 文件=${draftEn.length}`)

for (let i = 0; i < Math.max(tsZh.length, draftZh.length); i += 1) {
  if (tsZh[i] !== draftZh[i]) {
    problems.push(`中文第 ${i + 1} 条不一致\n    ts  : ${String(tsZh[i]).slice(0, 70)}\n    文件: ${String(draftZh[i]).slice(0, 70)}`)
  }
}
for (let i = 0; i < Math.max(tsEn.length, draftEn.length); i += 1) {
  if (tsEn[i] !== draftEn[i]) {
    problems.push(`英文第 ${i + 1} 条不一致\n    ts  : ${String(tsEn[i]).slice(0, 70)}\n    文件: ${String(draftEn[i]).slice(0, 70)}`)
  }
}

// 顺带确认三个接线点都在
const wiring = [
  ["currentVersionChangelog 分支", /if \(version === FOUR_POINT_ONE_ONE_CHANGELOG\.version\)/],
  ["currentVersionChangelog 返回", /return \[FOUR_POINT_ONE_ONE_CHANGELOG\];/],
  ["allChangelog 首位", /return \[\s*\n\s*FOUR_POINT_ONE_ONE_CHANGELOG,/],
  ["版本号 4.1.1", /version: "4\.1\.1"/],
  ["日期 2026-10-07", /date: "2026-10-07"/],
]
for (const [label, re] of wiring) {
  if (!re.test(ts)) problems.push(`接线缺失：${label}`)
}

console.log(`changelog.ts 4.1.1 条目：中文 ${tsZh.length} 条 / 英文 ${tsEn.length} 条`)
console.log(`条目文件：          中文 ${draftZh.length} 条 / 英文 ${draftEn.length} 条`)
console.log(`接线检查：${wiring.length} 项`)
if (problems.length) {
  console.log(`\n不一致 ${problems.length} 处：`)
  for (const p of problems) console.log(`  ${p}`)
  process.exitCode = 1
} else {
  console.log(`\n逐字一致，且 5 处接线齐全`)
}
