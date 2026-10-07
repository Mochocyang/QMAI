/**
 * 校验 annotated 标签 v4.1.2 解引用后指向发版提交。
 *
 * 为什么用脚本：`git rev-parse v4.1.2^{}` 里的 `^` 会被 cmd 当转义符吃掉，
 * `{}` 也会被 PowerShell 当脚本块解析，两层 shell 下来参数已经不是原本那个。
 * execFileSync 直接传 argv，不经过 shell。
 */
import { execFileSync } from "node:child_process"

const TAG = process.argv[2] ?? "v4.1.2"
const EXPECTED = process.argv[3]

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim()
}

const type = git("cat-file", "-t", TAG)
const tagObject = git("rev-parse", TAG)
const peeled = git("rev-parse", `${TAG}^{}`)
const commitType = git("cat-file", "-t", peeled)

console.log(`  标签            : ${TAG}`)
console.log(`  对象类型        : ${type}          (tag = annotated)`)
console.log(`  标签对象 SHA    : ${tagObject}`)
console.log(`  解引用后 commit : ${peeled}`)
console.log(`  解引用对象类型  : ${commitType}    (commit)`)
if (EXPECTED) console.log(`  期望 commit     : ${EXPECTED}`)

const problems = []
if (type !== "tag") problems.push(`标签不是 annotated（对象类型 ${type}，应为 tag）`)
if (commitType !== "commit") problems.push(`解引用后不是 commit（${commitType}）`)
if (tagObject === peeled) problems.push("标签对象与解引用结果相同，说明是轻量标签")
if (EXPECTED && peeled !== EXPECTED) problems.push(`解引用目标与期望不符`)

console.log()
if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`)
  process.exitCode = 1
} else {
  console.log("  OK annotated 标签解引用指向正确的发版提交")
}
