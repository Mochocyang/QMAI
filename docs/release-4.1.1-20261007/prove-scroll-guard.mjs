/**
 * 证明 memory-center-scroll-guard.spec.ts 的两类断言都承重：
 *   1) 去掉特性检测  → "不抛错"那几条必须变红
 *   2) 去掉实际调用  → "确实调用"那条必须变红
 * 只做 1) 的话，一个永远不调用 scrollIntoView 的实现也会全绿。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")
const target = resolve(root, "src/components/novel/memory-center-view.tsx")
const spec = "src/components/novel/memory-center-scroll-guard.spec.ts"

const original = readFileSync(target, "utf8")
const before = createHash("sha256").update(original).digest("hex")

const EXCLUDES = [
  "--exclude", "**/.codex-temp/**",
  "--exclude", "**/.claude/**",
  "--exclude", "**/.worktrees/**",
  "--exclude", "**/superpowers-main/**",
  "--exclude", "**/SKILL/**",
  "--exclude", "**/superpowers/**",
]

function runSpec() {
  try {
    execFileSync("npx.cmd", ["vitest", "run", spec, ...EXCLUDES], {
      cwd: root,
      stdio: "pipe",
      shell: true,
    })
    return true // 绿
  } catch {
    return false // 红
  }
}

const MUTATIONS = [
  {
    name: "去掉特性检测（直接调用 scrollIntoView）",
    from: `  if (!element) return
  if (typeof element.scrollIntoView !== "function") return
  element.scrollIntoView(options)`,
    to: `  if (!element) return
  element.scrollIntoView(options)`,
  },
  {
    name: "去掉实际调用（只做检测，什么都不滚）",
    from: "  element.scrollIntoView(options)",
    to: "  void options",
  },
]

const results = []
let red = 0
try {
  for (const m of MUTATIONS) {
    if (!original.includes(m.from)) {
      results.push(`  ?? ${m.name} —— 锚点未找到，变异没落地`)
      continue
    }
    writeFileSync(target, original.replace(m.from, m.to), "utf8")
    const green = runSpec()
    writeFileSync(target, original, "utf8")
    results.push(`  ${green ? "仍绿 ← 空话!" : "变红"} ${m.name}`)
    if (!green) red += 1
  }
} finally {
  writeFileSync(target, original, "utf8")
}

console.log(results.join("\n"))
console.log(`\n变异 ${MUTATIONS.length} 项，如期变红 ${red} 项`)

const after = createHash("sha256").update(readFileSync(target, "utf8")).digest("hex")
console.log(`还原校验：${before === after ? "SHA256 一致" : "不一致!"}`)
if (red !== MUTATIONS.length || before !== after) process.exitCode = 1
