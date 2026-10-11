/**
 * 全量套件 A/B 比对：新增失败文件必须为 0。
 *
 * vitest 的 json reporter 对每个文件给 status。这里比「文件的通过/失败状态」，
 * 而不是比总用例数 —— 因为基线本来就带一批既有失败，用例数还会因新增测试而变。
 *
 * 运行：node docs/workbench-simplify-20261007/ab-compare.mjs <基线json> <本次json>
 */
import { readFileSync } from "node:fs"

const [, , basePath, newPath] = process.argv
if (!basePath || !newPath) { console.error("用法: node ab-compare.mjs <基线json> <本次json>"); process.exit(2) }

const load = (p) => {
  const j = JSON.parse(readFileSync(p, "utf8"))
  const files = new Map()
  for (const r of j.testResults) {
    const failed = r.assertionResults.filter((a) => a.status === "failed").length
    files.set(r.name.replace(/\\/g, "/"), { failed, status: r.status, total: r.assertionResults.length })
  }
  return { files, total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests }
}

const base = load(basePath)
const now = load(newPath)

const newlyFailing = []
const newlyPassing = []
const changedCount = []
for (const [f, n] of now.files) {
  const b = base.files.get(f)
  if (!b) { if (n.failed > 0) newlyFailing.push({ f, note: "本次新增文件且失败", n }) ; continue }
  if (b.failed === 0 && n.failed > 0) newlyFailing.push({ f, note: `基线 0 失败 → 本次 ${n.failed}`, n })
  if (b.failed > 0 && n.failed === 0) newlyPassing.push({ f, note: `基线 ${b.failed} 失败 → 本次 0` })
  if (b.failed !== n.failed && !(b.failed === 0 && n.failed > 0) && !(b.failed > 0 && n.failed === 0)) {
    changedCount.push({ f, note: `${b.failed} → ${n.failed}` })
  }
}
const disappeared = [...base.files.keys()].filter((f) => !now.files.has(f))

console.log("=== 全量 A/B ===")
console.log(`  基线: ${base.total} 用例 / ${base.passed} 通过 / ${base.failed} 失败 / ${base.files.size} 文件`)
console.log(`  本次: ${now.total} 用例 / ${now.passed} 通过 / ${now.failed} 失败 / ${now.files.size} 文件`)
console.log(`  失败的基线文件数: ${[...base.files.values()].filter((v) => v.failed > 0).length}`)
console.log(`  失败的本次文件数: ${[...now.files.values()].filter((v) => v.failed > 0).length}`)

console.log(`\n【新增失败文件】${newlyFailing.length} 个 —— 必须为 0`)
for (const x of newlyFailing) console.log(`  ✗ ${x.f}   ${x.note}`)

console.log(`\n【新转为全绿的文件】${newlyPassing.length} 个`)
for (const x of newlyPassing) console.log(`  + ${x.f}   ${x.note}`)

console.log(`\n【失败数变化的文件】${changedCount.length} 个`)
for (const x of changedCount) console.log(`  ~ ${x.f}   ${x.note}`)

console.log(`\n【本次没跑到的基线文件】${disappeared.length} 个`)
for (const f of disappeared.slice(0, 20)) console.log(`  - ${f}`)

process.exit(newlyFailing.length === 0 ? 0 : 1)
