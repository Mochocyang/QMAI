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
 * 从工具源码里**实际**提取它会发出的守卫代号。
 *
 * 为什么必须有这一步：`CODES` 是一份手写清单，一旦它与代码脱节，
 * 覆盖度就会假绿（漏掉的代号永远不会被短路，于是"没被发现无覆盖"）。
 * 这不是假设 —— 历史上工具源码的文档注释只列了 A–J 十个"组"，
 * 而代码实际发出 17 个代号，且 `J` 的语义在文档里（未解释 = 0）与
 * 代码里（内容指纹丢失）**不一致**。声明与实现不一致时，
 * **以代码为准**并让脚本直接失败，比让人去比对两份清单可靠。
 */
function emittedCodes(source) {
  const codes = new Set()
  // 引号形式都接受：现有代码统一写 fail("A/...")，但反引号/单引号同样合法。
  // 只认双引号时，用反引号写的守卫会被**静默漏掉**，一致性检查就白设了
  // （实测：注入 fail(`Z/…`) 时旧正则检测不到）。
  for (const m of source.matchAll(/fail\(\s*[`"']([A-Z][A-Z0-9]*)\//g)) codes.add(m[1])
  return [...codes].sort()
}

{
  const actual = emittedCodes(original)
  const declared = [...CODES].sort()
  const missing = actual.filter((c) => !declared.includes(c))   // 代码发了但清单没写
  const extra = declared.filter((c) => !actual.includes(c))     // 清单写了但代码没有
  if (missing.length || extra.length) {
    console.error("✗ CODES 与工具源码实际发出的代号不一致 —— 覆盖度会假绿，故拒绝运行：")
    if (missing.length) console.error(`    代码有、CODES 缺: ${missing.join(", ")}`)
    if (extra.length) console.error(`    CODES 有、代码缺: ${extra.join(", ")}`)
    console.error(`    代码实际发出（${actual.length} 个）: ${actual.join(", ")}`)
    console.error(`    CODES 声明  （${declared.length} 个）: ${declared.join(", ")}`)
    console.error("    修法：更新 CODES，并为新增代号补一条 expectFailure(res, \"GUARD-FAIL\", \"<代号>\") 用例。")
    process.exit(2)
  }
  console.log(`ⓘ CODES 与工具源码一致（${actual.length} 个代号）\n`)
}

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

/*
 * ── 本工具的**已知盲区**（对抗性审查 P3-③）──
 *
 * 只报"全部有覆盖"而不说清覆盖范围，会让人以为**所有**守卫都被测到了。
 * 事实是：本工具只能覆盖 --compare 路径上的代号，因为它们靠"改源码 → 重跑
 * census-guards.spec.mjs 看是否变红"来验证。而 census-computed-font.mjs 的
 * **采集模式**（capture mode）另有一组防线，它们需要真实浏览器 + dist 产物，
 * 无法用同一套机制验证，故不在 CODES 里、也不受本工具检查：
 *
 *   K/根字号未生效   写后回读根字号，防应用 useEffect 覆盖导致整档数据错档
 *   L/根字号被覆盖   采完 11 个分区后再回读，防采集中途被改掉
 *   M/空采集         键数为 0 时必须失败，绝不写出空 census
 *   N/元素被遮蔽     同键换成不同元素时必须失败
 *   O/分区未到达     有分区没点到时必须失败（缺分区会低估分母）
 *   P/起始分区未到达 起始分区没到达时必须失败
 *
 * 它们的验证方式是**集成运行**而不是变异测试：
 *   1. 正常采集 → 必须退出 0 且写出 1117 键（已验证）
 *   2. 变异（把回读值 +5px）→ 必须退出 1 且**不写出**产物（已验证）
 * 新增采集模式守卫时，请同步在上面的清单里登记，并各做一次集成验证。
 */
console.log(`
  ⓘ 本工具的覆盖范围：仅 --compare 判定路径上的 ${targets.length} 个代号。
    census-computed-font.mjs 的**采集模式**另有 6 条防线（K/L/M/N/O/P：根字号回读、
    采集中回读、空采集、元素被遮蔽、分区未到达、起始分区未到达），
    它们需要真实浏览器，靠**集成运行**验证（正常采集须退出 0，变异后须退出 1 且不写产物），
    不在本工具检查范围内 —— 不要因为本工具打印"全部有覆盖"就认为采集模式也被覆盖了。`)
process.exit(exitCode)
