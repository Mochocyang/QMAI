/**
 * 确认「拆书库」相关代码在 v4.1.0 之前是否已存在。
 * 这决定 4.1.1 的定性：是「既有功能的打磨」还是「全新功能域」。
 */
import { execFileSync } from "node:child_process"

const sh = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim()
  } catch {
    return ""
  }
}

console.log("=== v4.1.0 时点，拆书库相关文件是否存在 ===")
for (const pattern of [
  "src/components/book-analysis/*",
  "src/lib/book-analysis*",
  "src/stores/book-analysis*",
]) {
  const atTag = sh(["ls-tree", "-r", "v4.1.0", "--name-only", "--", pattern])
  const count = atTag ? atTag.split("\n").filter(Boolean).length : 0
  console.log(`  ${pattern.padEnd(42)} v4.1.0: ${String(count).padStart(3)} 个`)
}
const nowCount = sh(["ls-tree", "-r", "HEAD", "--name-only", "--", "src/components/book-analysis/*"])
console.log(`  ${"src/components/book-analysis/*".padEnd(42)} HEAD  : ${String(nowCount.split("\n").filter(Boolean).length).padStart(3)} 个`)

console.log("\n=== v4.1.0 之前，拆书库最后一次提交 ===")
const beforeTag = sh(["log", "-1", "--format=%h %ad %s", "--date=short", "v4.1.0", "--", "src/components/book-analysis"])
console.log("  " + (beforeTag || "(该路径在 v4.1.0 时不存在)"))
const beforeAny = sh(["log", "-1", "--format=%h %ad %s", "--date=short", "v4.1.0", "--", "src/lib/book-analysis-activity-store.ts"])
console.log("  " + (beforeAny || "(该文件在 v4.1.0 时不存在)"))

console.log("\n=== v4.1.0 的 changelog 是否提到拆书 ===")
const changelogAtTag = sh(["show", "v4.1.0:src/lib/changelog.ts"])
const mentions = ["拆书", "book analysis", "Book Analysis", "工作台", "workbench"]
for (const word of mentions) {
  const hit = changelogAtTag.includes(word)
  console.log(`  ${word.padEnd(16)} ${hit ? "提到" : "未提到"}`)
}
