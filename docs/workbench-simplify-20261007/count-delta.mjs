/** 只看本次改动的相关文件在两份 json 里的用例数变化，确认 +N 都来自我新增的测试。 */
import { readFileSync } from "node:fs"

const [, , a, b] = process.argv
const load = (p) => {
  const j = JSON.parse(readFileSync(p, "utf8"))
  const m = new Map()
  for (const r of j.testResults) m.set(r.name.replace(/\\/g, "/"), r.assertionResults.length)
  return { m, total: j.numTotalTests }
}
const base = load(a)
const now = load(b)
const interesting = [
  "workbench-remove.spec.ts",
  "book-analysis-workbench.spec.tsx",
  "book-analysis-activity-store.spec.ts",
  "workbench-concurrency.spec.ts",
  "workbench-publish.spec.ts",
]
for (const key of interesting) {
  const bf = [...base.m.keys()].find((k) => k.endsWith(key))
  const nf = [...now.m.keys()].find((k) => k.endsWith(key))
  console.log(`${key}: ${bf ? base.m.get(bf) : "-"} → ${nf ? now.m.get(nf) : "-"}`)
}
// 找出所有用例数变多的文件，看是否都在预期内
const grew = []
for (const [f, n] of now.m) {
  const bv = base.m.get(f)
  if (bv !== undefined && n > bv) grew.push(`${f.split("/").pop()}: ${bv} → ${n}`)
}
console.log(`\n用例数变多的文件（共 ${grew.length} 个，总计 +${grew.reduce((s, x) => s + Number(x.split("→ ")[1]) - Number(x.split(": ")[1].split(" →")[0]), 0)}）`)
for (const g of grew) console.log("  " + g)
