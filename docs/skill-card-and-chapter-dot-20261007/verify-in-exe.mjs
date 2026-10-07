// 验证打进便携版 exe 的前端资源确实是本次改动后的版本。
//
// 为什么不能直接在 exe 里搜中文：Tauri 会把嵌入资源 gzip 压缩，
// 对 exe 做明文 grep 一定搜不到中文（会得到"缺失"的假结论）。
// 所以分两步：
//   1) 在 exe 的 ASCII 字节里找**内容哈希资源名**（dist/assets/*.js 的文件名），
//      证明这个 chunk 真的被打进去了；
//   2) 把那个 chunk 当 UTF-8 读出来，搜中文文案，证明内容是新版。
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const exe = readFileSync(join(repo, "release-portable/QMaiWrite.exe"))

// exe 里的 ASCII 字节（资源名都是 ASCII，gzip 后的中文不会有明文，但文件名是清单的一部分）。
const ascii = exe.toString("latin1")
const assets = readdirSync(join(repo, "dist/assets")).filter((f) => f.endsWith(".js"))
const cssAssets = readdirSync(join(repo, "dist/assets")).filter((f) => f.endsWith(".css"))

const failures = []
const notes = []
const check = (ok, label, detail = "") => {
  if (ok) notes.push(`  OK   ${label}${detail ? `  — ${detail}` : ""}`)
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ""}`)
}

// 1) 每个 JS/CSS 资源名都要能在 exe 字节里找到。
const missing = [...assets, ...cssAssets].filter((f) => !ascii.includes(f))
check(missing.length === 0, "所有 dist 资源名都出现在 exe 里",
  missing.length ? `缺失 ${missing.length} 个: ${missing.slice(0, 5).join(", ")}` : `${assets.length} 个 js + ${cssAssets.length} 个 css`)

// 2) 找到装了本次改动的那个 chunk，按 UTF-8 读出来核对文案。
const mustExist = ["证据索引", "启用此文风", "这份成果没有引用原文", "此历史版本已被替换", "已提取记忆", "正在提取记忆"]
/*
 * 全局必须消失的文案：只放**本次改动专有**的字符串。
 *
 * 刻意不放「待确认」和「已入库」：这两个词在别的功能里本来就有（outline 提示词里的
 * 「等待确认」、写作档案页脚、knowledge-tree 大纲任务的「 · 待确认」状态、
 * agent 工具时间线、以及 context-hub 的「第N章正文已入库」）。当全局词查会被它们误报 ——
 * 实测就撞到过一次（chat-panel chunk 里的「已入库」来自 chapter-body-injection）。
 * 这两个词的清除改由下面的「承载 chunk 内 0 次」来断言，那才是精确的判据。
 */
const mustBeGone = ["证据索引与实际覆盖", "自动核验仍需人工复核", "旧版资料导入", "无结构化规则"]

/*
 * 第二轮改动的结构标记。文案（如「证据索引」）不足以证明结构变了 ——
 * 文案没变但结构可能悄悄回到旧的 <details> 独占一行写法，所以这里直接钉结构：
 *   - wb-card-meta：承载「统计 + 证据索引」的那一行 flex 容器；
 *   - data-ui-tree-memory-dot-spacer：没提取过记忆的章节所占的那一格；
 *   - aria-label 模板「的证据索引」：入口是按钮而不是 <summary>。
 * 以及删掉的结构不许回来：旧 CSS 里的 `.wb-card-evidence>summary` 选择器。
 */
const mustExistStructural = [
  { needle: "wb-card-meta", why: "承载「统计 + 证据索引」的同行容器" },
  { needle: "data-ui-tree-memory-dot-spacer", why: "章节行里没记忆时占位的那一格" },
  { needle: "的证据索引", why: "证据索引入口的 aria-label 模板（按钮而非 summary）" },
]
const mustBeGoneStructural = [
  { needle: ".wb-card-evidence>summary", why: "旧版 <details> 的 summary 样式选择器" },
  { needle: "wb-card-evidence summary", why: "旧版 <details> 的 summary 样式选择器（紧凑写法）" },
  { needle: "min-width:min(100%,max-content)", why: "右组旧的不可压缩写法（换行的直接根因）" },
]
/**
 * 第三轮（AI 输入框底栏）标记。
 *
 * 这里**不能**用「选择器 + 紧跟某个属性」的子串匹配：lightningcss 会重排属性，
 * 实测产物里是 `…{border:0;flex-wrap:nowrap;justify-content:flex-start;…}` ——
 * `border:0` 被提到最前，把 `{flex-wrap:nowrap` 这个子串打断了（这条断言第一版就因此误报）。
 * 正确做法是先按选择器取出整条规则块，再在块内查属性 ——
 * 与「不要按属性顺序断言产物 CSS」这条既有教训一致。
 *
 * 存在与消失**两边都要**用块内判定：消失那边用子串更危险 ——
 * 旧规则若带着重排后的属性顺序存在，子串匹配不到，就会**假通过**。
 */
const composerFooterRule = "[data-ui-ai-composer] [data-reference-input-footer]"
const composerLeftRule = "[data-ui-ai-panel] [data-reference-input-footer]>div:first-child"
const composerRightRule = "[data-ui-ai-composer] [data-reference-input-footer]>div:last-child"

const mustExistComposer = [
  { selector: composerFooterRule, decls: ["flex-wrap:nowrap"], why: "底栏不换行" },
  { selector: composerLeftRule, decls: ["flex-wrap:nowrap"], why: "左组不换行" },
  { selector: composerRightRule, decls: ["flex:0 1000 auto"], why: "右组在底栏这一层优先让位" },
  { selector: "text-overflow:ellipsis", decls: [], why: "模型名的省略号（收窄的证据）" },
]
/** 底栏这些规则块内**不得**再出现旧写法。 */
const mustNotContainComposer = [
  { selector: composerFooterRule, decls: ["flex-wrap:wrap"], why: "底栏旧的换行写法" },
  { selector: composerRightRule, decls: ["flex:1 0 auto"], why: "右组旧的只长不缩写法" },
]

/**
 * 这些词只在**承载拆书库卡片**的 chunk 里要求消失。
 *
 * 不能对整个 index chunk 要求，因为它是共享 bundle：index 里确实有「待确认」，
 * 但那来自 knowledge-tree.tsx:2377 大纲任务的「 · 待确认」状态、以及大纲提示词里的
 * 「等待确认」，和本次删掉的卡片徽标是两回事（实测：对 index 断言会误报 FAIL）。
 * 拆书库卡片在 book-analysis-view chunk 里，用「证据索引」定位它才精确。
 */
/**
 * 第四轮（记忆中心单页重构）标记。
 *
 * 这一轮的命题几乎全是**结构消失**，所以"旧写法已清除"那一侧才是主判据，
 * 而且必须同时覆盖 JS 与 CSS：
 *   - JS 侧：双栏握手字段 selectedMemoryCenterEntry、中间栏列表组件、占位文案；
 *   - CSS 侧：内层双栏的两个选择器（[data-ui="memory-snapshots"] 是双栏里的章节竖栏、
 *     [data-ui="memory-chapter-filter"] 是它的区间搜索）。
 *
 * needle 必须用**复数** memory-snapshots：卡片本身的选择器
 * [data-ui="memory-snapshot"]（单数）改造后仍然存在（保留了原有视觉），
 * 用单数会把它误判成"旧结构还在"。
 */
const mustExistMemoryCenter = [
  { needle: "快照总数", why: "统计条首个 chip：与「章节快照」标签区分，避免 11 vs 1 的同名歧义" },
  { needle: "显示更多", why: "快照页的渐进披露按钮" },
  { needle: "暂无章节快照", why: "章节快照空态" },
  { needle: "暂无大纲快照", why: "大纲快照空态" },
  { needle: "清除区间", why: "区间筛选的复位入口" },
  { needle: "memory-tabs", why: "标签条容器标记（替代原中间栏列表）" },
  { needle: "memory-stats", why: "统计条容器标记" },
  { needle: "memory-snapshot-collection", why: "全宽流式快照集合" },
  { needle: "outline-snapshots", why: "大纲快照标签 key" },
]
const mustBeGoneMemoryCenter = [
  { needle: "selectedMemoryCenterEntry", why: "双栏握手字段（已降级为页面内 useState）" },
  { needle: "MemoryCenterListButton", why: "中间栏的记忆分类列表组件" },
  { needle: "请先从左侧记忆列表选择一个项目", why: "中间栏占位文案（左侧列表已不存在）" },
  { needle: "memory-snapshots", why: "内层双栏的章节竖栏选择器（注意是复数）" },
  { needle: "memory-chapter-filter", why: "内层双栏的区间搜索容器选择器" },
]
/** 记忆中心三条规则按块内声明判定（产物会被 lightningcss 重排属性顺序）。 */
const mustExistMemoryCenterCss = [
  { selector: '[data-ui="memory-tabs"]', decls: ["flex-wrap:nowrap"], why: "标签条单排不换行" },
  { selector: '[data-ui="memory-tabs"]', overflowX: true, why: "标签条靠横向滚动承载" },
  { selector: '[data-ui="memory-stats"]', decls: ["flex-wrap:nowrap"], why: "统计条单排不换行" },
  { selector: '[data-ui="memory-snapshot-collection"]', decls: ["flex-direction:column"], why: "快照全宽纵向堆叠" },
]

const mustBeGoneInWorkbench = ["wb-card-status", "wb-origin-tag", "待确认", "已入库"]

const carriers = []
for (const f of assets) {
  const text = readFileSync(join(repo, "dist/assets", f), "utf8")
  for (const n of mustExist) if (text.includes(n)) carriers.push(f)
}
const uniqueCarriers = [...new Set(carriers)]
check(uniqueCarriers.length > 0, "本次新增文案在某个 dist chunk 里", uniqueCarriers.join(", "))

// 拆书库卡片所在的 chunk：以本次新文案「证据索引」为锚点定位。
const workbenchChunks = assets.filter((f) => readFileSync(join(repo, "dist/assets", f), "utf8").includes("证据索引"))
check(workbenchChunks.length > 0, "定位到承载拆书库卡片的 chunk", workbenchChunks.join(", "))

// 打包后的 chunk 也必须是 exe 里那一个（用资源名证明同一份文件，不是"另有一份"）。
for (const f of uniqueCarriers) check(ascii.includes(f), `承载改动的 chunk 已打进 exe: ${f}`)

for (const n of mustExist) {
  const inDist = assets.filter((f) => readFileSync(join(repo, "dist/assets", f), "utf8").includes(n))
  check(inDist.length > 0, `新增文案存在: ${n}`, inDist.length ? inDist.join(", ") : "任何 chunk 里都没有")
}
for (const n of mustBeGone) {
  const inDist = assets.filter((f) => readFileSync(join(repo, "dist/assets", f), "utf8").includes(n))
  check(inDist.length === 0, `删除的文案已清除: ${n}`, inDist.length ? `仍在 ${inDist.join(", ")}` : "")
}
// 拆书库卡片所在 chunk 里，徽标与来源标签必须一个字都不剩。
for (const f of workbenchChunks) {
  const text = readFileSync(join(repo, "dist/assets", f), "utf8")
  for (const n of mustBeGoneInWorkbench) {
    check(!text.includes(n), `拆书库 chunk 内已清除: ${n}`, `在 ${f}`)
  }
}

// 4) 结构与样式标记：文案/行为没变但 CSS 可能悄悄回退，所以这里直接钉选择器与取值。
// CSS 也要一起查 —— 这些选择器只会留在 CSS 里，JS 里搜不到。
const allText = [...assets, ...cssAssets].map((f) => readFileSync(join(repo, "dist/assets", f), "utf8"))
for (const { needle, why } of mustExistStructural) {
  const hits = [...assets, ...cssAssets].filter((f, i) => allText[i].includes(needle))
  check(hits.length > 0, `结构标记存在: ${needle}（${why}）`, hits.length ? hits.join(", ") : "任何资源里都没有")
}
/**
 * 取出一条 CSS 规则块的声明文本（顺序无关）。
 * 选择器里的 `[`、`]`、`(`、`)` 都要转义；块内容不含 `}`（压缩后是扁平的）。
 *
 * **必须先把属性选择器里的引号去掉**：lightningcss 会输出
 * `[data-ui=memory-tabs]`，而源码写的是 `[data-ui="memory-tabs"]`。
 * 拿带引号的选择器去查产物，永远查不到 —— 这条断言第一版就因此 4 项全红，
 * 而且红得很有欺骗性（看起来像"规则没进产物"）。
 */
function normalizeSelector(selector) {
  return selector.replace(/(\[[\w-]+=)"([^"]*)"/g, "$1$2")
}

function cssRuleDecls(text, selector) {
  const escaped = normalizeSelector(selector).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g")
  const blocks = []
  let m
  while ((m = re.exec(text)) !== null) blocks.push(m[1])
  return blocks
}

/**
 * `overflow-x: auto` 与 `overflow-y: hidden` 会被合并成 `overflow: auto hidden` 简写，
 * 所以不能按 `overflow-x:auto` 这个子串断言。这里按语义判定：
 * 取出 overflow / overflow-x 声明，看横向分量是不是 auto。
 */
function overflowXAuto(block) {
  const match = block.match(/overflow(?:-x)?\s*:\s*([^;}]+)/)
  if (!match) return false
  const parts = match[1].trim().split(/\s+/)
  return parts[0] === "auto" || parts[0] === "scroll"
}

for (const { selector, decls, why } of mustExistComposer) {
  const hits = []
  for (let i = 0; i < allText.length; i++) {
    if (!selector.startsWith("[")) {
      // 纯属性标记（如 text-overflow:ellipsis）按子串查即可。
      if (allText[i].includes(selector)) hits.push([...assets, ...cssAssets][i])
      continue
    }
    const blocks = cssRuleDecls(allText[i], selector)
    if (blocks.some((b) => decls.every((d) => b.includes(d)))) hits.push([...assets, ...cssAssets][i])
  }
  check(hits.length > 0, `底栏新样式存在: ${selector} 含 ${decls.join("+")}（${why}）`,
    hits.length ? hits.join(", ") : "任何资源里都没找到这条规则")
}
for (const { selector, decls, why } of mustNotContainComposer) {
  const hits = []
  for (let i = 0; i < allText.length; i++) {
    const blocks = cssRuleDecls(allText[i], selector)
    if (blocks.some((b) => decls.every((d) => b.includes(d)))) hits.push([...assets, ...cssAssets][i])
  }
  check(hits.length === 0, `底栏旧写法已清除: ${selector} 不含 ${decls.join("+")}（${why}）`,
    hits.length ? `仍在 ${hits.join(", ")}` : "")
}
for (const { needle, why } of mustBeGoneStructural) {
  const hits = [...assets, ...cssAssets].filter((f, i) => allText[i].includes(needle))
  check(hits.length === 0, `旧结构已清除: ${needle}（${why}）`, hits.length ? `仍在 ${hits.join(", ")}` : "")
}

/*
 * 第四轮：记忆中心单页重构。
 *
 * 存在侧与消失侧都跨 JS + CSS 全量查。"消失"是本轮的主判据 ——
 * 双栏结构、握手字段、旧选择器都必须在打包产物里一个字都不剩，
 * 否则单页只是"新页面叠在旧结构上"，用户仍会看到左侧那根竖栏。
 */
for (const { needle, why } of mustExistMemoryCenter) {
  const hits = [...assets, ...cssAssets].filter((f, i) => allText[i].includes(needle))
  check(hits.length > 0, `记忆中心新标记存在: ${needle}（${why}）`,
    hits.length ? hits.join(", ") : "任何资源里都没有")
}
for (const { needle, why } of mustBeGoneMemoryCenter) {
  const hits = [...assets, ...cssAssets].filter((f, i) => allText[i].includes(needle))
  check(hits.length === 0, `记忆中心旧结构已清除: ${needle}（${why}）`,
    hits.length ? `仍在 ${hits.join(", ")}` : "")
}
for (const { selector, decls, overflowX, why } of mustExistMemoryCenterCss) {
  const hits = []
  for (let i = 0; i < allText.length; i++) {
    const blocks = cssRuleDecls(allText[i], selector)
    const ok = blocks.some((b) => (overflowX ? overflowXAuto(b) : decls.every((d) => b.includes(d))))
    if (ok) hits.push([...assets, ...cssAssets][i])
  }
  const want = overflowX ? "overflow-x:auto（含简写 overflow:auto hidden）" : decls.join("+")
  check(hits.length > 0, `记忆中心新样式存在: ${selector} 含 ${want}（${why}）`,
    hits.length ? hits.join(", ") : "任何资源里都没找到这条规则")
}

// 3) 真机校验：exe 大小与 version-info 一致（防止"复制了旧文件却报告成功"）。
const info = JSON.parse(readFileSync(join(repo, "release-portable/version-info.json"), "utf8"))
check(exe.length === info.exeBytes, "exe 字节数与 version-info 一致", `${exe.length} vs ${info.exeBytes}`)

const report = [...notes, ...(failures.length ? ["", ...failures] : [])].join("\n")
console.log(report)
console.log(`\n通过 ${notes.length} 项，失败 ${failures.length} 项`)
process.exit(failures.length ? 1 : 0)
