/**
 * 守卫覆盖度验证：把 `census-computed-font.mjs` 里的每个守卫代号逐条短路，
 * 再跑 `census-guards.spec.mjs`，看用例是否变红。
 *
 * ── 为什么需要这个脚本（而不是再加几条用例）──
 * 对抗性审查实测：把 `D1 D2 E E2 E3 E4 F G J` 九个守卫**整条禁用**后，
 * 当时的 23 条用例**全部通过**。也就是说这九个可以在无人察觉的情况下被删掉。
 * 原因是那些用例只断言"输出里含 GUARD-FAIL 字样"，而 17 个代号都印这五个字母
 * —— 一个用例可以被**错误的守卫**满足。修补办法有两层：
 *   1. 用例显式声明预期代号（`expectFailure(..., "GUARD-FAIL", "E3")`）；
 *   2. 用本脚本证明"每个代号失效时至少有一条用例变红"。
 * 第 2 层才是真判据：第 1 层只说明断言写对了，不说明覆盖是全的。
 *
 * ── 安全性 ──
 * 本脚本会临时改写工作区里的工具源码。原始内容存在内存里，
 * 并在 `finally` 中无条件还原（进程被 Ctrl-C 中断时也走 finally）。
 * 另外运行前后各校验一次"残留短路处数"。
 *
 * 用法：
 *   node docs/font-scaling-fix-20261007/verify-guard-coverage.mjs
 *   node docs/font-scaling-fix-20261007/verify-guard-coverage.mjs --code E3   # 只测一个
 *
 * 退出码：0 = 全部代号都有覆盖；1 = 存在无覆盖代号（并列出它们）。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..", "..")
const TOOL = join(HERE, "census-computed-font.mjs")
const SPEC = join(HERE, "census-guards.spec.mjs")

/** 工具实际会发出的全部守卫代号。新增守卫时必须同步此表，否则覆盖度会假绿。 */
const CODES = ["A", "B", "C", "D", "D1", "D2", "D3", "E", "E2", "E3", "E4", "F", "G", "H", "I", "I0", "J"]

const SHORT_CIRCUIT = "void 0 && "
const only = process.argv.includes("--code") ? process.argv[process.argv.indexOf("--code") + 1] : null

const original = readFileSync(TOOL, "utf8")

/**
 * 把一个代号的**全部** `fail("X/...")` 调用短路成永不执行。
 *
 * ⚠️ 必须处理同一代号有多个 fail 点：实测 `D` 有两个分支
 * （「元素消失」与「新增超出放行额度」）。只短路第一个时会得出
 * "D 无覆盖"的**错误结论** —— 判断有没有覆盖的前提是整个代号失效。
 */
function disableAll(source, code) {
  const needle = `fail("${code}/`
  const lines = source.split("\n")
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue
    const indent = /^[ \t]*/.exec(lines[i])[0]
    lines[i] = indent + SHORT_CIRCUIT + lines[i].slice(indent.length)
    count++
  }
  return { source: lines.join("\n"), count }
}

/** 统计工作区工具文件里的残留短路处数（应为 0）。 */
const residualCount = (src) => src.split("\n").filter((l) => l.includes(SHORT_CIRCUIT)).length

function runSpec() {
  const r = spawnSync(
    "npx",
    ["vitest", "run", SPEC, "--exclude", "**/.claude/**", "--exclude", "**/.codex-temp/**", "--exclude", "**/.worktrees/**"],
    { cwd: REPO_ROOT, encoding: "utf8", shell: true, timeout: 900_000 },
  )
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`
  const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed/.exec(out)
  // 解析失败时按"没有失败"处理会掩盖问题，故显式标记
  const parsed = m !== null
  return { failed: m?.[1] ? Number(m[1]) : 0, passed: m?.[2] ? Number(m[2]) : 0, parsed, out }
}

const before = residualCount(original)
if (before !== 0) {
  console.error(`✗ 工具源码里已有 ${before} 处 "${SHORT_CIRCUIT}" 残留 —— 请先还原后再运行本脚本`)
  process.exit(2)
}

const targets = only ? CODES.filter((c) => c === only) : CODES
if (only && targets.length === 0) {
  console.error(`✗ 未知代号 ${only}；已知: ${CODES.join(", ")}`)
  process.exit(2)
}

console.log(`══ 守卫覆盖度验证：逐条短路 ${targets.length} 个代号，看用例是否变红 ══`)
console.log("（工具源码会被临时改写，结束后无条件还原）\n")

/*
 * 基线检查放在 try 之外：`process.exit()` 不会执行 finally 块，
 * 若在 try 内退出且此刻已改写源码，工具就会被留在残缺状态。
 * 所有"需要提前退出"的检查都必须在第一次 writeFileSync 之前完成。
 */
const base = runSpec()
if (!base.parsed) {
  console.error("✗ 无法解析基线运行的用例统计 —— 套件可能根本没跑起来")
  console.error(base.out.slice(-2000))
  process.exit(2)
}
console.log(`  基线（未改动）: 失败 ${base.failed} / 通过 ${base.passed}`)
if (base.failed !== 0) {
  console.error(`✗ 基线就有 ${base.failed} 条失败 —— 请先让套件全绿，否则无法判断"禁用后变红"是否由禁用引起`)
  process.exit(2)
}
console.log("")

const results = []
let exitCode = 0
try {
  for (const code of targets) {
    const d = disableAll(original, code)
    if (d.count === 0) {
      results.push({ code, verdict: `未找到 "${code}/" 的 fail 调用` })
      console.log(`  ${code.padEnd(4)} ⚠️ 源码里找不到该代号的 fail(...) —— 代号表可能过期`)
      exitCode = 1
      continue
    }
    writeFileSync(TOOL, d.source)
    const r = runSpec()
    const covered = r.parsed && r.failed > 0
    results.push({ code, sites: d.count, failed: r.failed, passed: r.passed, covered })
    console.log(
      `  ${code.padEnd(4)} 短路 ${String(d.count).padStart(2)} 处  失败 ${String(r.failed).padStart(2)} / 通过 ${String(r.passed).padStart(2)}  ` +
      (covered ? "✓ 有覆盖（禁用后变红）" : "✗ 无覆盖（禁用后仍全绿）"),
    )
    if (!covered) exitCode = 1
  }
} finally {
  writeFileSync(TOOL, original)
  const after = residualCount(readFileSync(TOOL, "utf8"))
  console.log(`\n  工具源码已还原（残留短路处数：${after}，应为 0）`)
  if (after !== 0) {
    console.error(`✗ 还原失败，工具源码仍是残缺的！请执行 git checkout -- ${TOOL}`)
    process.exitCode = 2
  }
}

const blind = results.filter((r) => r.covered === false || r.verdict)
console.log("")
if (blind.length === 0) {
  console.log(`  ✓ ${targets.length} 个代号全部有测试覆盖（禁用任意一个都会让套件变红）`)
} else {
  console.log(`  ✗ ${targets.length} 个代号中，${blind.length} 个无覆盖：${blind.map((b) => b.code).join(", ")}`)
  console.log(`    含义：这些守卫可以被整条删掉而没有任何用例发现。`)
  console.log(`    修法：为每个代号加一条用例，并用 expectFailure(res, "GUARD-FAIL", "<代号>") 钉死它。`)
}
process.exit(exitCode)
