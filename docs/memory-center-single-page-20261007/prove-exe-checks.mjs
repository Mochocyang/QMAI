/**
 * 证明 verify-in-exe.mjs 里第四轮（记忆中心）那 18 项断言**不是恒真的**。
 *
 * 做法：直接在**真实 dist 产物**上做变异 —— 改坏构建结果，重跑真的校验脚本，
 * 确认它确实变红，然后原样恢复。
 *
 * 为什么必须做：本项目已经踩过两次同类坑 ——
 *   1) prove-exe-check-nonvacuous.mjs 第一版读源码 CSS 没去注释，
 *      自己写的说明把检查喂饱了；
 *   2) 本轮 verify-in-exe.mjs 的记忆中心 CSS 断言第一版 4 项全红，
 *      原因是拿带引号的选择器去查产物（lightningcss 会去掉引号）。
 * 两次都说明"看着很合理的断言"完全可能既不对、又恒真。
 *
 * 用法: node docs/memory-center-single-page-20261007/prove-exe-checks.mjs
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, "..", "..")
const assetsDir = join(repo, "dist/assets")
const checker = join(repo, "docs/skill-card-and-chapter-dot-20261007/verify-in-exe.mjs")

const backup = mkdtempSync(join(tmpdir(), "qmai-dist-"))
cpSync(assetsDir, backup, { recursive: true })

function runChecker() {
  const result = spawnSync("node", [checker], { cwd: repo, encoding: "utf8" })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  const failed = [...output.matchAll(/^\s+FAIL (.+)$/gm)].map((m) => m[1].trim())
  return { status: result.status, failed, output }
}

function restore() {
  rmSync(assetsDir, { recursive: true, force: true })
  cpSync(backup, assetsDir, { recursive: true })
}

/**
 * 找到包含某个 needle 的资源文件，交给 mutate 改写，返回是否命中。
 *
 * mutate 返回 null 表示"这个文件不是我要找的，继续看下一个" —— **必须 continue**。
 * 第一版这里写成 `return false`，于是 P1~P4 全部"变异没落地"：
 * 选择器字符串 `memory-tabs` 同时出现在 JS chunk 和 CSS 里，
 * 而 readdirSync 先撞上 JS chunk（它含选择器名、但不含 `flex-wrap:nowrap`），
 * 一遇 null 就放弃，根本没走到真正该改的 CSS。
 */
function mutateAsset(needle, mutate) {
  for (const f of readdirSync(assetsDir)) {
    const path = join(assetsDir, f)
    const text = readFileSync(path, "utf8")
    if (!text.includes(needle)) continue
    const next = mutate(text)
    if (next === null) continue
    if (next === text) return false
    writeFileSync(path, next, "utf8")
    return true
  }
  return false
}

/**
 * 在**指定选择器的规则块内部**做替换。
 *
 * 不能用 `text.replace(fromFragment, toFragment)`：压缩后的 CSS 是一整行，
 * `flex-direction:column` 这样的声明在文件里出现很多次，replace 只会改到**第一个**，
 * 而那多半属于别的规则 —— P4 第一版就是这么"变异没落地"的
 * （校验仍全绿，看起来像断言被喂饱，其实是变异根本没改到目标）。
 */
function mutateRule(selectorFragment, fromFragment, toFragment) {
  return mutateAsset(selectorFragment, (text) => {
    const selectorIndex = text.indexOf(selectorFragment)
    if (selectorIndex < 0) return null
    const open = text.indexOf("{", selectorIndex)
    const close = text.indexOf("}", open)
    if (open < 0 || close < 0) return null
    const block = text.slice(open + 1, close)
    if (!block.includes(fromFragment)) return null
    const nextBlock = block.replace(fromFragment, toFragment)
    return text.slice(0, open + 1) + nextBlock + text.slice(close)
  })
}

const baseline = runChecker()
console.log(`基线：通过 ${(/通过 (\d+) 项/.exec(baseline.output) ?? [])[1]} 项，失败 ${baseline.failed.length} 项`)
if (baseline.status !== 0) {
  console.log("基线就不是全绿，先修基线再谈非恒真。")
  console.log(baseline.failed.join("\n"))
  restore()
  rmSync(backup, { recursive: true, force: true })
  process.exit(1)
}

const MUTATIONS = [
  {
    name: "P1 标签条 nowrap 改回 wrap（标签会折成两排）",
    apply: () => mutateRule("memory-tabs", "flex-wrap:nowrap", "flex-wrap:wrap"),
    expect: "flex-wrap:nowrap",
  },
  {
    name: "P2 标签条横向滚动去掉（overflow 只留 hidden）",
    apply: () => mutateRule("memory-tabs", "overflow:auto hidden", "overflow:hidden"),
    expect: "overflow-x:auto",
  },
  {
    name: "P3 统计条 nowrap 改回 wrap",
    apply: () => mutateRule("memory-stats", "flex-wrap:nowrap", "flex-wrap:wrap"),
    expect: "flex-wrap:nowrap",
  },
  {
    name: "P4 快照集合退回横向（双栏的排布方式）",
    apply: () => mutateRule("memory-snapshot-collection", "flex-direction:column", "flex-direction:row"),
    expect: "flex-direction:column",
  },
  {
    name: "P5 把内层双栏的章节竖栏选择器放回 CSS",
    apply: () => mutateAsset("memory-tabs", (text) => `${text}\n.ui-test-root [data-ui=memory-snapshots]{height:auto}`),
    expect: "memory-snapshots",
  },
  {
    name: "P6 把双栏握手字段写回 JS",
    apply: () => mutateAsset("快照总数", (text) => `${text}\nvar selectedMemoryCenterEntry=null;`),
    expect: "selectedMemoryCenterEntry",
  },
  {
    name: "P7 删掉「快照总数」文案（统计条退回旧口径）",
    apply: () => mutateAsset("快照总数", (text) => text.replace("快照总数", "章节快照")),
    expect: "快照总数",
  },
  {
    name: "P8 删掉「显示更多」（渐进披露消失）",
    apply: () => mutateAsset("显示更多", (text) => text.replace("显示更多", "展开")),
    expect: "显示更多",
  },
]

let problems = 0
for (const mutation of MUTATIONS) {
  const applied = mutation.apply()
  if (!applied) {
    console.log(`  跳过（变异没落地，脚本需更新）: ${mutation.name}`)
    problems += 1
    restore()
    continue
  }

  const after = runChecker()
  restore()

  // 期望至少有一条 FAIL 命中该变异对应的判据
  const hit = after.failed.some((line) => line.includes(mutation.expect))
  const becameRed = after.status !== 0
  if (becameRed && hit) {
    console.log(`  通过  ${mutation.name}`)
    console.log(`        校验如期变红，命中判据「${mutation.expect}」`)
  } else {
    problems += 1
    console.log(`  失败  ${mutation.name}`)
    console.log(`        变红=${becameRed} 命中判据=${hit} —— 这条断言抓不到该缺陷`)
    console.log(`        实际 FAIL: ${after.failed.slice(0, 3).join(" | ") || "（无）"}`)
  }
}

// 确认恢复后仍全绿
const final = runChecker()
if (final.status !== 0) {
  problems += 1
  console.log(`  失败  恢复后基线不再全绿 —— dist 被变异污染了`)
  console.log(final.failed.join("\n"))
} else {
  console.log(`  通过  全部变异已恢复，基线仍全绿`)
}

rmSync(backup, { recursive: true, force: true })
console.log(`\n共校验 ${MUTATIONS.length} 个变异，问题 ${problems} 个`)
process.exitCode = problems === 0 ? 0 : 1
