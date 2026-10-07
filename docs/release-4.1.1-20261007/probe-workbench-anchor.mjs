/**
 * 为「拆书库 chunk」找一个只属于该组件的定位锚点。
 *
 * 背景：verify-in-exe.mjs 原本用「证据索引」定位，但 4.1.1 的更新日志
 * 条目里也写了「证据索引下沉到每张卡片」，于是承载更新日志的 settings-view
 * chunk 被一起选中，随即被要求不含「待确认/已入库」—— 而条目正文恰好含
 * 「已入库/待确认」状态徽标，产生两项**假失败**。
 *
 * 锚点必须是组件独有的结构记号，不能是可能出现在文案里的业务词。
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

const assetsDir = resolve(process.cwd(), "dist/assets")
const js = readdirSync(assetsDir).filter((f) => f.endsWith(".js"))
const text = new Map(js.map((f) => [f, readFileSync(resolve(assetsDir, f), "utf8")]))

const candidates = [
  "证据索引",              // 旧锚点（会被更新日志命中）
  "wb-skill-grid",
  "wb-card-list",
  "wb-card-actions",
  "wb-results-bar",
  "wb-view-switch",
  "data-ui=\"book-analysis-workbench\"",
]

console.log("锚点候选 → 命中它的 chunk（拆书库组件应当是唯一/少数）\n")
for (const c of candidates) {
  const hits = js.filter((f) => text.get(f).includes(c))
  const flag = hits.length === 1 ? "唯一" : `${hits.length} 个`
  console.log(`  ${c}`)
  console.log(`    ${flag}: ${hits.slice(0, 6).join(", ")}${hits.length > 6 ? ` 等` : ""}`)
}

console.log("\n另：更新日志所在的 chunk 是哪个")
for (const f of js) {
  if (text.get(f).includes("拆书结果面板精简")) console.log(`  ${f}`)
}
