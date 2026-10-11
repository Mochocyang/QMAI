/**
 * 精简覆盖度检查：确认 28 条原始事实在精简版里都有落点，没有静默丢失。
 *
 * 为什么必须做：精简的失败模式不是"文字不好"，而是**悄悄少了一条**。
 * 我自己就差点丢掉【角色识别可重试】——合并时视线全在"往哪并"，
 * 不在"哪些还没被认领"。人眼审 28→14 的映射不可靠，必须机器过一遍。
 *
 * 判据设计：每条原始事实给一组**关键短语**（任一命中即算已覆盖），
 * 短语取自精简版里实际会出现的词，而不是原始条目的原文 ——
 * 用原文匹配的话，合并改写过措辞就会假报丢失。
 *
 * 用法: node docs/release-4.1.1-20261007/check-condense-coverage.mjs
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractArray } from "./parse-changelog-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, "changelog-entry-4.1.1.txt"), "utf8")

const zh = extractArray(source, "zh")
const en = extractArray(source, "en")
const zhAll = zh.join("\n")
const enAll = en.join("\n")

/**
 * 28 条原始事实 → 关键短语（任一命中即算覆盖）。
 * key 是给人看的编号 + 简称，便于报错时定位。
 */
const FACTS = [
  { id: 1, label: "面板删 6 项 UI", zh: ["版本下拉", "导出结果"], en: ["version dropdown", "export"] },
  { id: 2, label: "自动入库", zh: ["自动发布尚未入库"], en: ["automatically publishes"] },
  { id: 3, label: "对象可删除", zh: ["新增删除按钮"], en: ["delete button"] },
  { id: 4, label: "版本合并为一份列表", zh: ["合并为一份连续列表"], en: ["merged into one continuous list"] },
  { id: 5, label: "证据索引下沉", zh: ["证据索引下沉"], en: ["evidence index moves into each card"] },
  { id: 6, label: "清理冗余标记", zh: ["已入库/待确认"], en: ["in library / pending"] },
  { id: 7, label: "绑定对话框", zh: ["每行 5 个"], en: ["five items per row"] },
  { id: 8, label: "旧版角色整合", zh: ["历史导图"], en: ["Historical Map"] },
  { id: 9, label: "删除作品", zh: ["均可删除"], en: ["can now be deleted"] },
  { id: 10, label: "识别失败可重试", zh: ["开始分析」不再被锁死"], en: ["locks the \"Start Analysis\""] },
  { id: 11, label: "不再等 3 分钟", zh: ["不再等 3 分钟"], en: ["Three-Minute Wait"] },
  { id: 12, label: "人物名单缓存", zh: ["文件指纹缓存"], en: ["cached by file fingerprint"] },
  { id: 13, label: "精修结果被抹掉", zh: ["不再覆盖已落盘的精修结果"], en: ["no longer overwritten"] },
  { id: 14, label: "「已精修」误标", zh: ["永久标记为「已精修」"], en: ["permanently marked as done"] },
  { id: 15, label: "人名永久消失", zh: ["使人名永久消失"], en: ["vanish for good"] },
  { id: 16, label: "记忆中心单页重构", zh: ["拆掉嵌套的两层双栏"], en: ["nested two-column layouts are gone"] },
  { id: 17, label: "大纲快照可查看", zh: ["从不渲染，实际无法打开"], en: ["never rendered"] },
  { id: 18, label: "快照计数不符", zh: ["显示 9 而实际 10"], en: ["shown 9 while there were 10"] },
  { id: 19, label: "章节目录绿点", zh: ["灰点脉冲"], en: ["pulsing gray dot"] },
  { id: 20, label: "HTML 永久置灰", zh: ["必然产出无 HTML 的请求"], en: ["no HTML"] },
  { id: 21, label: "需求分析浮层", zh: ["锚定浮层"], en: ["anchored inside the panel"] },
  { id: 22, label: "档案文档配色体系", zh: ["配色令牌"], en: ["color tokens"] },
  { id: 23, label: "分区导航跳空白页", zh: ["跳空白页"], en: ["blank-page navigation"] },
  { id: 24, label: "深色皮肤对比度", zh: ["三套皮肤均达 WCAG AA"], en: ["WCAG AA"] },
  { id: 25, label: "回复时间带日期", zh: ["补月日与年月日"], en: ["month and day"] },
  { id: 26, label: "等待文案整段显示", zh: ["不再忽隐忽现"], en: ["no longer flickers"] },
  { id: 27, label: "记忆提示不被遮挡", zh: ["提示不再被正文盖住"], en: ["no longer covered"] },
  { id: 28, label: "模型限额选择器", zh: ["统一预设选择器"], en: ["preset selectors"] },
]

const missing = []
const covered = []
for (const fact of FACTS) {
  const zhHit = fact.zh.some((needle) => zhAll.includes(needle))
  const enHit = fact.en.some((needle) => enAll.includes(needle))
  if (zhHit && enHit) covered.push(fact.id)
  else missing.push(`${String(fact.id).padStart(2)} ${fact.label}  (zh:${zhHit ? "有" : "缺"} en:${enHit ? "有" : "缺"})`)
}

console.log(`原始事实 ${FACTS.length} 条 → 精简后 ${zh.length} 条`)
console.log(`已覆盖 ${covered.length} 条`)
if (missing.length) {
  console.log(`\n未覆盖 ${missing.length} 条：`)
  for (const line of missing) console.log(`  ${line}`)
  process.exitCode = 1
} else {
  console.log(`\n全部覆盖：28 条原始事实均能在精简版中找到落点`)
}

// 顺带做几项结构性检查
const problems = []
if (zh.length !== en.length) problems.push(`中英条数不一致 zh=${zh.length} en=${en.length}`)
for (const [i, line] of zh.entries()) {
  if (!/^【[^】]+】/.test(line)) problems.push(`中文第 ${i + 1} 条缺少【】前缀`)
  if (/[。；]$/.test(line)) problems.push(`中文第 ${i + 1} 条以句号/分号结尾（既有体例不这样写）`)
}
for (const [i, line] of en.entries()) {
  if (!/^\[[^\]]+\]/.test(line)) problems.push(`英文第 ${i + 1} 条缺少 [ ] 前缀`)
  if (!line.endsWith(".")) problems.push(`英文第 ${i + 1} 条未以句号结尾`)
}
// 与既有版本规模对比：v4.1.0 是 21 条
console.log(`\n规模对比：v4.1.0 = 21 条，本版 = ${zh.length} 条`)
if (problems.length) {
  console.log(`\n体例问题 ${problems.length} 处：`)
  for (const p of problems) console.log(`  ${p}`)
  process.exitCode = 1
} else {
  console.log(`体例检查通过（【】前缀、无句末标点、中英条数一致）`)
}
