// 用用户真实项目的数据检查过滤规则：人名不能被误杀，垃圾名必须被拦住。
//
// 数据来源：
//  - 用户截图里出现的条目（实体页名 + 大纲小标题）
//  - D:\QM-BOOK\他，只想活着\QM\entities 下的真实实体页名（39 个）
//  - 该作品大纲里的真实章节/群体标题
// 词表不手抄，直接从 bindable-characters-filter.ts 里抠出来，避免脚本与实现失真。
//
// 运行：node docs/soul-binding-perf-20261006/verify-real-data.mjs
import { readFileSync } from "node:fs"

const src = readFileSync("src/lib/novel/bindable-characters-filter.ts", "utf8")
const exact = src.match(/const EXACT_NON_CHARACTER_NAMES = \[([^\]]+)\]/)[1]
  .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)
const suffix = src.match(/const NON_CHARACTER_NAME_SUFFIXES = \[([\s\S]*?)\]/)[1]
  .split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean)

console.log("整词规则:", exact.join(" / "))
console.log("后缀规则:", suffix.join(" / "))
console.log("")

const isJunk = (name) => {
  const t = name.trim()
  if (!t) return false
  if (exact.includes(t)) return true
  return suffix.some((s) => t.endsWith(s))
}

const fromScreenshot = [
  "编号派通用手段", "编号体执行群", "成长或崩坏路径", "冲突点", "当前状态",
  "城中百姓", "城中兵士", "城中老人", "城中孩童", "城中孩子/普通少女",
  "城防统领", "陈十七", "白依", "阿禾", "阿七", "092",
]
const realEntities = [
  "095男孩", "临水镇", "临水镇停云庄", "回收者", "回收者092", "回收者094", "回收者095",
  "回收者组织", "大林村南废墙", "姑姑", "宿泽镇", "宿泽镇义庄", "密道", "岔路口", "布偶",
  "布偶防御力量", "废弃矿道", "归元箓", "杨妙萍", "杨寒", "林子", "林小晚", "林小满",
  "林秀云", "枯枝", "横道", "水碗", "洞口", "灌木丛", "石头", "石室", "窄沟", "纸条",
  "荒地", "采药老人", "铁门", "镰刀", "陶碗", "黑塔",
]
const realOutlineTitles = ["陈玄", "赵无极一脉残部", "魔教七杀堂小队", "核心家庭线", "敌对压迫线"]

const expectedJunk = ["编号派通用手段", "编号体执行群", "成长或崩坏路径", "冲突点", "当前状态"]
const mustSurvive = [
  "城中百姓", "城中兵士", "城中老人", "城中孩童", "采药老人",
  "许七安", "林小满", "杨妙萍", "杨寒", "阿禾", "阿七", "白依", "陈十七", "城防统领",
]

const failures = []
const missed = expectedJunk.filter((n) => !isJunk(n))
if (missed.length) failures.push("该拦下却没拦下: " + missed.join(", "))
const killed = [...realEntities, ...realOutlineTitles, ...mustSurvive].filter(isJunk)
if (killed.length) failures.push("误杀真实名字: " + [...new Set(killed)].join(", "))

console.log("=== 截图条目判定 ===")
for (const n of fromScreenshot) console.log(`  ${isJunk(n) ? "拦下" : "保留"}  ${n}`)
console.log(`\n真实实体页 ${realEntities.length} 个 + 大纲标题 ${realOutlineTitles.length} 个 + 必须存活 ${mustSurvive.length} 个`)
console.log(`误杀数：${new Set([...realEntities, ...realOutlineTitles, ...mustSurvive].filter(isJunk)).size}`)

if (failures.length) {
  console.log("\n失败项 " + failures.length + "：")
  failures.forEach((f) => console.log("  FAIL " + f))
  process.exit(1)
}
console.log("\n失败项 0")
