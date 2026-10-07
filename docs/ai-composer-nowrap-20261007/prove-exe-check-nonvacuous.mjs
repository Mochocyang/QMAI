/**
 * 非空性证明：verify-in-exe.mjs 里第三轮那条「旧写法已清除」的判据
 * 在**改动之前**必须能命中 —— 否则它只是句恒真的空话。
 *
 * 做法：从 git 里取出改动前/后的 ui-test-ai.css，用与 verify-in-exe.mjs **同一个**
 * 规则块解析器跑一遍，确认旧值当时确实在、现在确实没了。
 *
 * ⚠️ 两个必须做的归一化（第一版没做，于是误报"判据是空话"，实际是脚本自己错）：
 *   1) **去掉注释**。我在源码里写了解释性注释，注释里**原样引用了旧值**
 *      （如「旧写法的 min-width: min(100%, max-content) 正是换行的根因」）。
 *      不剥注释的话，全局子串检查会命中自己的注释，永远报"仍然存在"。
 *      产物 CSS 里注释已被剥离，所以 verify-in-exe.mjs 查产物时不受影响 ——
 *      这也说明**该查产物、不该查源码**。
 *   2) **压缩空白**。源码是 `flex-wrap: wrap`、`> div:last-child`（带空格），
 *      产物是 `flex-wrap:wrap`、`>div:last-child`（无空格）。判据是按产物形式写的，
 *      拿源码直接比会全部匹配不上。
 *
 * 用法: node docs/ai-composer-nowrap-20261007/prove-exe-check-nonvacuous.mjs
 */
import { execFileSync } from "node:child_process"

const repo = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
const file = "src/components/uitest/ui-test-ai.css"

/*
 * 不要写死 `HEAD~1`。第一版就是写死的，结果我在证明脚本之后又提交了一个
 * 与 CSS 无关的 chore 提交，`HEAD~1` 就变成了"同样含新写法的那个提交"，
 * before 与 after 一样，于是三条判据全部报"改动前命中=false"、
 * 被误判成"判据是空话"。
 * 正确做法：让 git 自己找出**最后一次改动这个文件的提交**，比它的父提交。
 * 这样这个脚本在任何后续提交之后都仍然成立。
 */
const cssCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", file],
  { cwd: repo, encoding: "utf8" }).trim()
const cssParent = execFileSync("git", ["rev-parse", `${cssCommit}^`],
  { cwd: repo, encoding: "utf8" }).trim()
console.log(`改动 CSS 的提交: ${cssCommit.slice(0, 7)}  其父提交: ${cssParent.slice(0, 7)}\n`)

const before = execFileSync("git", ["show", `${cssParent}:${file}`], { cwd: repo, encoding: "utf8" })
const after = execFileSync("git", ["show", `${cssCommit}:${file}`], { cwd: repo, encoding: "utf8" })

/** 剥注释 + 压缩空白，逼近产物形态。 */
const normalize = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, "")      // 去注释
  .replace(/\s*\{\s*/g, "{")
  .replace(/\s*\}\s*/g, "}")
  .replace(/\s*:\s*/g, ":")
  .replace(/\s*;\s*/g, ";")
  .replace(/\s*>\s*/g, ">")
  .replace(/\s*,\s*/g, ",")
  .replace(/\s+/g, " ")

/** 与 verify-in-exe.mjs 里同一个解析器（保持同步，否则证明的不是同一件事）。 */
function cssRuleDecls(text, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")
  const blocks = []
  let m
  while ((m = re.exec(text)) !== null) blocks.push(m[1])
  return blocks
}

const beforeN = normalize(before)
const afterN = normalize(after)

const footerRule = "[data-ui-ai-composer] [data-reference-input-footer]"
const rightRule = "[data-ui-ai-composer] [data-reference-input-footer]>div:last-child"

const oldChecks = [
  { sel: footerRule, decl: "flex-wrap:wrap" },
  { sel: rightRule, decl: "flex:1 0 auto" },
  { sel: rightRule, decl: "min-width:min(100%,max-content)" },
]

let allNonVacuous = true
for (const { sel, decl } of oldChecks) {
  const inBefore = cssRuleDecls(beforeN, sel).some((b) => b.includes(decl))
  const inAfter = cssRuleDecls(afterN, sel).some((b) => b.includes(decl))
  // 关键：两边都必须能解析出规则块，否则"查不到"可能只是因为选择器根本没匹配上。
  const selFoundBefore = cssRuleDecls(beforeN, sel).length > 0
  const selFoundAfter = cssRuleDecls(afterN, sel).length > 0
  const ok = inBefore && !inAfter && selFoundBefore && selFoundAfter
  if (!ok) allNonVacuous = false
  console.log(`${ok ? "OK  " : "FAIL"} ${sel} 里的 ${decl}`)
  console.log(`       改动前命中=${inBefore}（选择器可解析=${selFoundBefore}）  改动后命中=${inAfter}（可解析=${selFoundAfter}）`)
}

const minWidthBefore = beforeN.includes("min-width:min(100%,max-content)")
const minWidthAfter = afterN.includes("min-width:min(100%,max-content)")
const minOk = minWidthBefore && !minWidthAfter
if (!minOk) allNonVacuous = false
console.log(`${minOk ? "OK  " : "FAIL"} 全局 min-width:min(100%,max-content)  改动前=${minWidthBefore}  改动后=${minWidthAfter}`)

// 新写法必须在改动后出现（否则"旧的没了"可能是把整条规则删了了事）
const newPresent = ["flex-wrap:nowrap", "flex:0 1000 auto"].every((d) => afterN.includes(d))
if (!newPresent) allNonVacuous = false
console.log(`${newPresent ? "OK  " : "FAIL"} 改动后新写法已写入（flex-wrap:nowrap / flex:0 1000 auto）`)

console.log(`\n结论: ${allNonVacuous ? "判据非空 —— 旧写法确实存在过、现在确实没了，且新写法在位" : "有判据是空话，需要修"}`)
process.exitCode = allNonVacuous ? 0 : 1
