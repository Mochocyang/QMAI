/**
 * 证明 check-condense-coverage.mjs 不是恒真。
 *
 * 直觉上"它能报出全部覆盖"就说明它有效 —— 但一个永远输出"全部覆盖"的
 * 脚本同样会这么说。所以必须真的删掉一条事实的关键短语，看它是否变红。
 *
 * 逐条变异、逐条验证，不用一次批量，避免"某一条没落地"被另一条的
 * 命中掩盖成"反正红了"。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, "changelog-entry-4.1.1.txt")
const check = resolve(here, "check-condense-coverage.mjs")

const original = readFileSync(target, "utf8")
const before = createHash("sha256").update(original).digest("hex")

/** 每种变异：把某条事实的关键短语改写掉，模拟"精简时把它丢了"。 */
const MUTATIONS = [
  { name: "丢掉【识别失败可重试】", from: "识别失败后「开始分析」不再被锁死", to: "（已删除）" },
  { name: "丢掉【人名永久消失】", from: "使人名永久消失", to: "（已删除）" },
  { name: "丢掉【快照计数不符】", from: "显示 9 而实际 10", to: "（已删除）" },
  { name: "丢掉【记忆提示不被遮挡】", from: "提示不再被正文盖住", to: "（已删除）" },
  { name: "丢掉英文【WCAG AA】", from: "all three skins now meet WCAG AA", to: "all three skins are fine" },
]

let red = 0
const results = []
try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.from)) {
      results.push(`  ?? ${m.name} —— 锚点未找到，变异没落地`)
      continue
    }
    writeFileSync(target, original.replace(m.from, m.to), "utf8")
    let failed = false
    try {
      execFileSync(process.execPath, [check], { stdio: "pipe" })
    } catch {
      failed = true
    }
    // 还原
    writeFileSync(target, original, "utf8")
    results.push(`  ${failed ? "变红" : "仍绿 ← 空话!"} ${m.name}`)
    if (failed) red += 1
  }
} finally {
  writeFileSync(target, original, "utf8")
}

console.log(results.join("\n"))
console.log(`\n变异 ${MUTATIONS.length} 项，如期变红 ${red} 项`)

const after = createHash("sha256").update(readFileSync(target, "utf8")).digest("hex")
console.log(`还原校验：${before === after ? "SHA256 一致，文件已按字节还原" : "不一致! 文件可能残留变异"}`)
if (red !== MUTATIONS.length || before !== after) process.exitCode = 1
