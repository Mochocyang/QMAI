#!/usr/bin/env node
/**
 * 正文字号「单一来源」静态校验 —— 任务 7 的主要验收手段。
 *
 * 为什么必须是主要手段（不是辅助）：
 * 实测遍历设置页 11 个分区后，编辑器 DOM `.ui-test-editor-body = 0`、
 * `.ProseMirror = 0`；点遍页面上所有可达按钮后仍为 0。
 * 基线里 300 条 `::marker` **全部来自更新日志分区的 li**（14px，本来就是 rem），
 * **0 条**来自编辑器那两条规则。所以：改 `li::marker` / `ol > li::marker`
 * 与文档标题字号，**计算样式普查发现不了**。
 * 本校验与真实 exe 实测，是这些规则**唯一**的验证途径：
 *   · 本脚本（静态：写法对不对）
 *   · verify-real-exe.mjs（真实 exe 读 li::marker 的计算值）
 *   · verify-real-exe-settings-save.mjs（真实 exe 走设置界面保存后，正文与标记的像素值）
 *
 * 任务 10 实测后补记的一条更精确的边界：这两条 `li::marker` 规则
 * **小说章节根本走不到** —— 章节是 `immersiveWriting`，正文为 `<textarea>`，
 * 不可能产生 `li`。唯一可达的消费者是**非章节文档**（大纲/设定页）走 Milkdown 的
 * `.ProseMirror`。详见 ui-test-editor.css 正文注释块与 findings.md。
 *
 * 被检对象：正文四处的字号必须来自同一个变量。
 * 「单一来源」是正确性要求而非优化：[data-find-highlights] 是覆盖在
 * textarea 之上的查找高亮层，字号/行高必须与输入层逐像素对齐；
 * 两处各写一份数字，今天相同、明天改一处就错位。
 *
 * 用法：
 *   node verify-body-font-single-source.mjs            # 校验真实文件
 *   node verify-body-font-single-source.mjs --selftest # 只跑自检（校验器本身可信吗）
 *
 * ── 本次改造（rem × 倍数 → 绝对 px）后契约的形状 ──
 *   · 字号是「App 写的 px 间接层」：--qmai-body-font-size: var(--qmai-body-font-px, 18px)
 *   · 列表 / 标记由字号**按精确比例派生**（沿用改造前 16/18 = 8/9、12/18 = 2/3），
 *     不再各写一份字面量 —— 改字号时漏改一条会让列表与正文不同步。
 *   · 行高仍是**无单位**数字，只是取值改成 var(--qmai-body-leading, 1.95)。
 *   · App 独占的 5 个变量（px / leading / letter-spacing / margin-x / safe-bottom）
 *     在 ui-test.css 里**不得**再声明字面量：本文件的变量宿主 .ui-test-root 比 html
 *     更近，声明一份就会盖掉 documentElement 行内样式（"设置保存了但界面不变"）。
 *   四条不变量一条都没放松：四处同源、高亮层与输入层逐字节一致、
 *   行高必须无单位、变量只在 ui-test.css 定义一处。
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import postcss from "postcss"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, "..", "..")
const EDITOR_CSS = resolve(REPO, "src/components/uitest/ui-test-editor.css")
const UITEST_CSS = resolve(REPO, "src/components/uitest/ui-test.css")

export const BODY_SIZE_VAR = "--qmai-body-font-size"
export const BODY_LINE_VAR = "--qmai-body-line-height"
export const BODY_LIST_VAR = "--qmai-body-font-list"
export const BODY_MARKER_VAR = "--qmai-body-font-marker"
/*
 * ⚠ 这里曾导出 `BODY_SCALE_VAR = "--qmai-body-font-scale"`，已删除（代码质量审查 M-5）。
 *
 * 它是改造前百分比模型留下的常量。`git show e473dd6` 显示：本次 px 改造
 * 删掉了它的**最后一处使用**，却把 `export const` 留了下来 ——
 * 于是成了一个"看起来像契约的一部分、实际没有任何代码读它"的遗物。
 * 后果不是报错，而是**误导读代码的人**：他会以为守卫还在管
 * `--qmai-body-font-scale` 这个变量（px 模型下它已不该存在）。
 * 这类"删了用途、留下名字"的残留会让契约的边界看起来比实际宽。
 */

/* ─────────────────────────── 解析辅助 ─────────────────────────── */

/** 把 CSS 解析成规则表：[{ selector, selectors[], decls: Map, line }] */
function rulesOf(css) {
  const out = []
  postcss.parse(css).walkRules((rule) => {
    const decls = new Map()
    rule.walkDecls((d) => { decls.set(d.prop.trim(), { value: d.value.trim(), line: d.source?.start?.line ?? 0 }) })
    out.push({
      selector: rule.selector.trim(),
      selectors: rule.selectors.map((s) => s.trim()),
      decls,
      line: rule.source?.start?.line ?? 0,
    })
  })
  return out
}

/** 找出「选择器列表恰好包含这些选择器」的规则（顺序无关，数量必须一致）。 */
function ruleWith(selectors, ruleList) {
  const want = [...selectors].sort().join(" || ")
  return ruleList.filter((r) => [...r.selectors].sort().join(" || ") === want)
}

function declOf(selectors, prop, ruleList) {
  for (const r of ruleWith(selectors, ruleList)) {
    const d = r.decls.get(prop)
    if (d) return { ...d, selector: r.selector, line: r.line }
  }
  return null
}

/** 从 `font: <weight> <size>/<line> <family>` 里取 size 与 line 表达式。 */
export function splitFontShorthand(value) {
  if (typeof value !== "string" || value.trim() === "") return null
  const m = value.match(/^(?:[^/]*?)(?<size>[^/\s]+)\s*\/\s*(?<line>[^\s]+)\s+(?<family>.+)$/s)
  if (!m?.groups) return null
  return { size: m.groups.size.trim(), line: m.groups.line.trim(), family: m.groups.family.trim() }
}

function hasPx(value) { return /(^|[^\w.])-?\d*\.?\d+px\b/.test(value ?? "") }
function hasEmUnit(value) { return /(^|[^\w.])-?\d*\.?\d+em\b/.test(value ?? "") }

/** `var(--qmai-body-font-px, <数字>px)` —— 字号间接层。 */
function isPxIndirection(value, expectedPx) {
  if (typeof value !== "string") return false
  const flat = value.replace(/\s+/g, " ").trim()
  const m = flat.match(/^var\(\s*--qmai-body-font-px\s*,\s*(-?\d*\.?\d+)px\s*\)$/)
  if (!m) return false
  return Number(m[1]) === expectedPx
}

/** `calc(var(--qmai-body-font-size) * <分子> / <分母>)` —— 从属尺寸由字号派生。 */
function isDerivedRatio(value, numerator, denominator) {
  if (typeof value !== "string") return false
  const flat = value.replace(/\s+/g, " ").trim()
  const m = flat.match(/^calc\(\s*var\(\s*--qmai-body-font-size\s*\)\s*\*\s*(-?\d*\.?\d+)\s*\/\s*(-?\d*\.?\d+)\s*\)$/)
  if (!m) return false
  return Number(m[1]) === numerator && Number(m[2]) === denominator
}

/* ─────────────────────────── 校验主体 ─────────────────────────── */

const EDITOR_SELECTORS = {
  body: ".ui-test-root .ui-test-editor-body",
  input: [
    ".ui-test-root .ui-test-editor-body .ProseMirror",
    ".ui-test-root .ui-test-editor-body [dir][lang]",
    ".ui-test-root .ui-test-editor-body [data-writing-editor] textarea",
  ],
  highlights: ".ui-test-root .ui-test-editor-body [data-find-highlights]",
  para: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) > p",
  headings: ".ui-test-root .ui-test-editor-body :is(h2, h3, h4, h5, h6)",
  list: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) :is(ul, ol)",
  li: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li",
  liP: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li p",
  marker: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li::marker",
  olMarker: ".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) ol > li::marker",
}

/**
 * 纯函数式校验：输入两段 CSS 文本，输出问题列表。
 * 抽成纯函数是为了能用构造的 CSS 做正/负向自检 —— 一个只会说"没问题"的
 * 校验器比没有校验器更危险。
 */
export function verify(editorCss, uitestCss) {
  const problems = []
  const bad = (rule, detail) => problems.push({ rule, detail })
  const editorRules = rulesOf(editorCss)
  const uitestRules = rulesOf(uitestCss)

  /* 0) 四个变量必须在 ui-test.css 里有唯一定义，且作用域限定在 UI 测试根内。
        注意：本文件的变量宿主不是 `:root`，而是
        `.ui-test-root, html[data-ui-test-skin]`。若把变量定义到全局 `:root`，
        会污染正式版（正式版没有匹配选择器，正是靠这层作用域隔离）。
        --qmai-body-font-px / --qmai-body-leading 由 App 写到 documentElement
        行内样式，沿 DOM 树向下继承，故 .ui-test-root 这里能读到 ——
        不必也不应改成 :root。（正因为 .ui-test-root 比 html 更近，
        这 5 个 App 独占变量在这里**不得**再声明一份，见下面 0b。） */
  const varHosts = []
  for (const r of uitestRules) {
    const names = [...r.decls.keys()].filter((p) =>
      [BODY_SIZE_VAR, BODY_LINE_VAR, BODY_LIST_VAR, BODY_MARKER_VAR].includes(p))
    if (names.length > 0) varHosts.push({ rule: r, names })
  }
  if (varHosts.length === 0) {
    bad("变量定义", `四个正文尺寸变量都没有定义（应在 ui-test.css 的 .ui-test-root 规则里）`)
  } else if (varHosts.length > 1) {
    bad("变量定义", `正文尺寸变量分散在 ${varHosts.length} 处规则里（L${varHosts.map((h) => h.rule.line).join(", L")}）—— 单一来源要求只定义一处`)
  } else {
    const host = varHosts[0].rule
    if (!host.selectors.some((s) => s.includes(".ui-test-root"))) {
      bad("变量定义", `变量宿主规则的选择器是「${host.selector}」，不含 .ui-test-root —— 定义到全局作用域会污染正式版`)
    }
  }
  const varDefs = new Map()
  if (varHosts.length === 1) {
    for (const [prop, d] of varHosts[0].rule.decls) {
      if ([BODY_SIZE_VAR, BODY_LINE_VAR, BODY_LIST_VAR, BODY_MARKER_VAR].includes(prop)) varDefs.set(prop, d)
    }
  }
  /*
   * 三个尺寸变量：字号是「App 写的 px 间接层」，列表与标记由字号按精确比例派生。
   * 为什么必须是按比例派生而不是各写一个 px：改造前三者是
   * 1.125rem / 1rem / 0.75rem 三个独立数字，改字号时漏改一条，
   * 列表与正文就会不同步。派生之后不可能漂移。
   * 比例沿用改造前的 16/18 = 8/9 与 12/18 = 2/3。
   */
  const sizeDef = varDefs.get(BODY_SIZE_VAR)
  if (!sizeDef) bad("变量定义", `${BODY_SIZE_VAR} 未在 ui-test.css 中定义（应为 var(--qmai-body-font-px, 18px)）`)
  else if (!isPxIndirection(sizeDef.value, 18)) {
    bad("变量定义", `${BODY_SIZE_VAR} 应为 var(--qmai-body-font-px, 18px)（18 是改造前 100% 档的字号），实际 ${sizeDef.value}`)
  }
  const listDef = varDefs.get(BODY_LIST_VAR)
  if (!listDef) bad("变量定义", `${BODY_LIST_VAR} 未定义（应为 calc(var(--qmai-body-font-size) * 8 / 9)，即改造前的列表 16px）`)
  else if (!isDerivedRatio(listDef.value, 8, 9)) {
    bad("变量定义", `${BODY_LIST_VAR} 不是由字号按 8/9 派生：${listDef.value}（改造前是 16/18）`)
  }
  const markerDef = varDefs.get(BODY_MARKER_VAR)
  if (!markerDef) bad("变量定义", `${BODY_MARKER_VAR} 未定义（应为 calc(var(--qmai-body-font-size) * 2 / 3)，即改造前的标记 12px）`)
  else if (!isDerivedRatio(markerDef.value, 2, 3)) {
    bad("变量定义", `${BODY_MARKER_VAR} 不是由字号按 2/3 派生：${markerDef.value}（改造前是 12/18）`)
  }
  {
    const d = varDefs.get(BODY_LINE_VAR)
    if (!d) bad("变量定义", `${BODY_LINE_VAR} 未定义（应为 var(--qmai-body-leading, 1.95)）`)
    /*
     * 行高仍必须是**无单位**数字：带单位会让行高不随字号变化，
     * 用户调大字号后行距被"吃掉"。这条与改造前一致，没有放松。
     * 变化的是取值来源：改由 App 写 --qmai-body-leading，默认 1.95。
     */
    else {
      const flat = d.value.replace(/\s+/g, "")
      const m = flat.match(/^var\(--qmai-body-leading,(-?\d*\.?\d+)\)$/)
      if (!m) bad("变量定义", `${BODY_LINE_VAR} 应为 var(--qmai-body-leading, 1.95)，实际 ${d.value}`)
      else if (Number(m[1]) !== 1.95) bad("变量定义", `${BODY_LINE_VAR} 的默认值应为 1.95（改造前的取值），实际 ${m[1]}`)
      /*
       * ⚠ 这里原本还有一条 `else if (hasPx(d.value))`，已删除（代码质量审查 F3/M-4）。
       *
       * 它是**不可达的死分支**：能走到这一行的前提是上面的正则命中了，
       * 而那个正则的固定部分（`var(--qmai-body-leading,` 与 `)`）不含字母 x，
       * 捕获组只能填数字与小数点 —— 命中时 `d.value` 里不可能出现 "px"，
       * 所以 `hasPx` 恒为 false。（构造性证明，不是"看着像"。）
       *
       * 带 px 的形态会落到上一条 `if (!m)` 报错，功能没有丢失 ——
       * 有夹具为证：反例⑳（默认值写成 1.9）。
       * 留着它的害处不是少报，而是让后来的人以为"带单位"这条路径已被单独覆盖。
       */
    }
  }

  /* 0b) App 独占的 5 个变量**不得**在 ui-test.css 里声明。
     这是本次改造新引入的风险：本文件的变量宿主是 .ui-test-root，
     它比 html 更近。App 把值写在 documentElement 的行内样式上，
     若这里也声明一份字面量默认值，就会把它盖掉 ——
     表现为「设置保存了但界面不变」，而且不会有任何报错。
     兜底只能写在使用点的 var(--x, 兜底值) 里。 */
  const APP_OWNED_VARS = [
    "--qmai-body-font-px",
    "--qmai-body-leading",
    "--qmai-body-letter-spacing",
    "--qmai-body-margin-x",
    "--qmai-body-safe-bottom",
  ]
  for (const r of uitestRules) {
    for (const [prop, d] of r.decls) {
      if (APP_OWNED_VARS.includes(prop)) {
        bad(`L${d.line} ${r.selector}`, `${prop} 是 App 独占变量，不得在 ui-test.css 里声明（会盖掉 documentElement 行内样式，设置将完全失效）`)
      }
    }
  }
  // 变量不得在编辑器文件里被重复定义（重复定义会让"单一来源"名存实亡）
  for (const [prop] of editorRules.flatMap((r) => [...r.decls])) {
    if ([BODY_SIZE_VAR, BODY_LINE_VAR, BODY_LIST_VAR, BODY_MARKER_VAR].includes(prop)) {
      bad("变量定义", `ui-test-editor.css 里也定义了 ${prop} —— 单一来源要求只在 ui-test.css 的 .ui-test-root 定义一处`)
    }
  }

  /* 1) 编辑器内不得再出现 px 字号 / px 行高 */
  for (const r of editorRules) {
    for (const [prop, d] of r.decls) {
      if (prop === "font-size" && hasPx(d.value)) bad(`L${d.line} ${r.selector}`, `font-size 仍是绝对单位：${d.value}`)
      if (prop === "line-height" && hasPx(d.value)) bad(`L${d.line} ${r.selector}`, `line-height 仍是绝对单位：${d.value}`)
      if (prop === "font") {
        const parts = splitFontShorthand(d.value)
        if (parts) {
          if (hasPx(parts.size)) bad(`L${d.line} ${r.selector}`, `font 简写的字号仍是绝对单位：${parts.size}`)
          if (hasPx(parts.line)) bad(`L${d.line} ${r.selector}`, `font 简写的行高仍是绝对单位：${parts.line}`)
        }
      }
    }
  }

  /* 2) 正文四处必须引用同一个字号变量 */
  const bodyFont = declOf([EDITOR_SELECTORS.body], "font", editorRules)
  if (!bodyFont) bad("正文基准", `${EDITOR_SELECTORS.body} 没有 font 声明（找不到字号来源）`)
  else {
    const parts = splitFontShorthand(bodyFont.value)
    if (!parts) bad("正文基准", `无法解析 ${EDITOR_SELECTORS.body} 的 font 简写：${bodyFont.value}`)
    else if (parts.size !== `var(${BODY_SIZE_VAR})`) {
      bad("正文基准", `${EDITOR_SELECTORS.body} 的字号应为 var(${BODY_SIZE_VAR})，实际 ${parts.size}`)
    }
    if (parts && parts.line !== `var(${BODY_LINE_VAR})`) {
      bad("正文基准", `${EDITOR_SELECTORS.body} 的行高应为 var(${BODY_LINE_VAR})，实际 ${parts.line}`)
    }
  }

  const inputFont = declOf(EDITOR_SELECTORS.input, "font", editorRules)
  if (!inputFont) bad("输入层", `输入层（.ProseMirror / [dir][lang] / textarea 三条）没有 font 声明`)
  else {
    const parts = splitFontShorthand(inputFont.value)
    if (!parts) bad("输入层", `无法解析输入层的 font 简写：${inputFont.value}`)
    else if (parts.size !== `var(${BODY_SIZE_VAR})`) bad("输入层", `输入层字号应为 var(${BODY_SIZE_VAR})，实际 ${parts.size}`)
  }

  const hlSize = declOf([EDITOR_SELECTORS.highlights], "font-size", editorRules)
  const hlLine = declOf([EDITOR_SELECTORS.highlights], "line-height", editorRules)
  if (!hlSize) bad("查找高亮层", `${EDITOR_SELECTORS.highlights} 没有 font-size 声明`)
  else if (hlSize.value !== `var(${BODY_SIZE_VAR})`) bad("查找高亮层", `字号应为 var(${BODY_SIZE_VAR})，实际 ${hlSize.value}`)
  if (!hlLine) bad("查找高亮层", `${EDITOR_SELECTORS.highlights} 没有 line-height 声明`)
  else if (hlLine.value !== `var(${BODY_LINE_VAR})`) bad("查找高亮层", `行高应为 var(${BODY_LINE_VAR})，实际 ${hlLine.value}`)

  /* 3) 高亮层与输入层的取值表达式必须完全相同（这是"单一来源"的核心） */
  if (inputFont && hlSize && hlLine) {
    const parts = splitFontShorthand(inputFont.value)
    if (parts) {
      if (parts.size !== hlSize.value) {
        bad("高亮层对齐", `输入层字号表达式 (${parts.size}) 与高亮层 (${hlSize.value}) 不同 —— 覆盖层会与输入文字错位`)
      }
      if (parts.line !== hlLine.value) {
        bad("高亮层对齐", `输入层行高表达式 (${parts.line}) 与高亮层 (${hlLine.value}) 不同 —— 覆盖层会与输入文字错位`)
      }
    }
  }

  const paraSize = declOf([EDITOR_SELECTORS.para], "font-size", editorRules)
  if (!paraSize) bad("段落", `${EDITOR_SELECTORS.para} 没有 font-size 声明`)
  else if (paraSize.value !== `var(${BODY_SIZE_VAR})`) bad("段落", `字号应为 var(${BODY_SIZE_VAR})，实际 ${paraSize.value}`)

  /* 4) 从属尺寸必须「由字号按精确比例派生」，不许用 em、不许另写一个独立数字 */
  for (const r of editorRules) {
    for (const [prop, d] of r.decls) {
      if (prop !== "font-size" && prop !== "line-height") continue
      if (hasEmUnit(d.value)) {
        bad(`L${d.line} ${r.selector}`, `${prop} 使用了 em：${d.value} —— em 的基准是所属元素（如 ::marker 相对 li 而非正文），会算错比例；应写 calc(var(${BODY_SIZE_VAR}) * 分子 / 分母) 或引用已派生的变量`)
      }
    }
  }

  /* 5) 六条规则逐条断言（缺一即失败） */
  const expectScaled = [
    ["列表容器", [EDITOR_SELECTORS.list], "font-size", BODY_LIST_VAR, 8, 9],
    ["列表项", [EDITOR_SELECTORS.li], "font-size", BODY_LIST_VAR, 8, 9],
    ["列表项内段落", [EDITOR_SELECTORS.liP], "font-size", BODY_LIST_VAR, 8, 9],
    ["无序标记", [EDITOR_SELECTORS.marker], "font-size", BODY_MARKER_VAR, 2, 3],
    ["有序标记", [EDITOR_SELECTORS.olMarker], "font-size", BODY_LIST_VAR, 8, 9],
  ]
  for (const [name, sel, prop, varName, num, den] of expectScaled) {
    const d = declOf(sel, prop, editorRules)
    if (!d) { bad(name, `${sel.join(" | ")} 缺少 ${prop} 声明`); continue }
    // 允许两种等价写法：calc(var(--qmai-body-font-size) * 分子 / 分母) 直接写，或引用已定义的变量
    const ok = d.value === `var(${varName})` || isDerivedRatio(d.value, num, den)
    if (!ok) bad(name, `${prop} 应为 var(${varName})（即 calc(var(${BODY_SIZE_VAR}) * ${num} / ${den})），实际 ${d.value}`)
  }

  // 文档标题：字号跟随倍数，字体按用户确认保持 var(--ui)
  const headFont = declOf([EDITOR_SELECTORS.headings], "font", editorRules)
  if (!headFont) bad("文档标题", `${EDITOR_SELECTORS.headings} 没有 font 声明`)
  else {
    const parts = splitFontShorthand(headFont.value)
    if (!parts) bad("文档标题", `无法解析文档标题的 font 简写：${headFont.value}`)
    else {
      if (parts.size !== `var(${BODY_SIZE_VAR})`) bad("文档标题", `字号应跟随正文字号 var(${BODY_SIZE_VAR})，实际 ${parts.size}`)
      if (parts.family !== "var(--ui)") bad("文档标题", `字体应保持 var(--ui)（用户确认：文档标题不跟随正文字体），实际 ${parts.family}`)
    }
  }

  return problems
}

/* ─────────────────────────── 自检 ─────────────────────────── */

const ROOT_OK = `.ui-test-root, html[data-ui-test-skin] {
  --qmai-body-font-size: var(--qmai-body-font-px, 18px);
  --qmai-body-font-list: calc(var(--qmai-body-font-size) * 8 / 9);
  --qmai-body-font-marker: calc(var(--qmai-body-font-size) * 2 / 3);
  --qmai-body-line-height: var(--qmai-body-leading, 1.95);
}`

const GOOD_EDITOR = `
.ui-test-root .ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }
.ui-test-root .ui-test-editor-body .ProseMirror,
.ui-test-root .ui-test-editor-body [dir][lang],
.ui-test-root .ui-test-editor-body [data-writing-editor] textarea { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }
.ui-test-root .ui-test-editor-body [data-find-highlights] { font-size: var(--qmai-body-font-size); line-height: var(--qmai-body-line-height); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) > p { font-size: var(--qmai-body-font-size); }
.ui-test-root .ui-test-editor-body :is(h2, h3, h4, h5, h6) { font: 600 var(--qmai-body-font-size)/1.6 var(--ui); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) :is(ul, ol) { font-size: var(--qmai-body-font-list); line-height: var(--qmai-body-line-height); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li { font-size: var(--qmai-body-font-list); line-height: var(--qmai-body-line-height); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li p { font-size: var(--qmai-body-font-list); line-height: var(--qmai-body-line-height); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li::marker { font-size: var(--qmai-body-font-marker); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) ol > li::marker { font-size: var(--qmai-body-font-list); }
`

/*
 * 夹具清单单独导出，而不是写在 selftest() 里面。
 *
 * ── 为什么（代码质量审查 F1 的根因）──
 * 审查实测出一个**系统性**盲区：19 条反例全部只断言"红/不红"，
 * 从不断言"**红在哪一条 rule**"。只要一条夹具一次改动多个分量，
 * 或者某条判据被另一条顺带挡下，分量级鉴别力就成了摆设 ——
 * 实测有 7 条独立判据、行高默认值判据、以及 5 个 App 独占变量里的 3 个，
 * 在被改成"永不触发"之后 **--selftest 仍然全绿**。
 *
 * 修法照审查的建议：把断言从"红了没"升级为"**红了几条、红在哪**"。
 * 要做到这一点，判据本身（count/includes）就够了，并不需要外部读夹具。
 *
 * ── 关于这个导出（代码质量审查 M-5 的更正）──
 * 原注释说「夹具清单必须能被外部读到（测量实际 rule 名、再由夹具声明期望），
 * 所以这里把它抽成独立导出」。那句话与实际不符：**全仓没有任何模块 import
 * 这个守卫**（另外 3 个脚本只在注释里提到它的文件名）。
 *
 * 保留导出的真实理由是**本机的本机探针在用**：
 *   · .codex-temp/measure-selftest-rules.mjs  打印每条夹具实际报出的 rule+detail
 *   · .codex-temp/measure-new-fixtures.mjs    量候选新夹具的 count/includes
 *   · .codex-temp/verify-t12-fixture-gap-closed.mjs  逐条把子判据改坏、看自检是否变红
 * 它的价值是"让夹具的期望可以被**量出来**而不是猜出来" ——
 * 这正是本轮补 ㉗–㊲ 时用的办法。若哪天没人再这么用，这个导出可以删。
 */
export function selftestCases() {
  const cases = []
  /*
   * ⚠ 第 5 个参数的名字必须是 `expect`，与 selftest() 里的判据一致。
   *
   * 这里踩过一次坑、而且正是靠反向控制才发现的：本函数第一次写成了
   * `expectRules`（存进 `c.expectRules`），而 selftest() 读的是 `c.expect` ——
   * 于是**所有 count/includes 判据一条都没生效**，自检照样打印 27/27 全绿。
   * 把子判据逐条改成"永不触发"的实验立刻暴露了它（8 处仍是全绿）。
   * 名字不一致不会有任何编译期报错，因为这是个普通对象属性。
   */
  const add = (name, css, css2, expectClean, expect) => cases.push({ name, css, css2, expectClean, expect })
  const mut = (from, to) => GOOD_EDITOR.replace(from, to)

  add("正例：完整合规片段", GOOD_EDITOR, ROOT_OK, true)
  add("反例①：正文仍是硬编码 18px",
    mut(".ui-test-root .ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      ".ui-test-root .ui-test-editor-body { font: 400 18px/1.95 var(--serif); }"), ROOT_OK, false, { count: 3, includes: ["font 简写的字号仍是绝对单位：18px","的字号应为 var(--qmai-body-font-size)，实际 18px","的行高应为 var(--qmai-body-line-height)，实际 1.95"] })
  add("反例②：正文未引用变量（仍是 codemod 的 rem）",
    mut("font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      "font: 400 1.125rem/1.95 var(--serif); }"), ROOT_OK, false, { count: 2, includes: ["的字号应为 var(--qmai-body-font-size)，实际 1.125rem","的行高应为 var(--qmai-body-line-height)，实际 1.95"] })
  add("反例③：高亮层与输入层表达式不同（字号写死）",
    mut("font-size: var(--qmai-body-font-size); line-height: var(--qmai-body-line-height); }",
      "font-size: 1.125rem; line-height: 1.95; }"), ROOT_OK, false, { count: 4, includes: ["查找高亮层","输入层字号表达式","输入层行高表达式"] })
  add("反例④：marker 用 em（比例基准错）",
    mut("li::marker { font-size: var(--qmai-body-font-marker); }",
      "li::marker { font-size: 0.6667em; }"), ROOT_OK, false, { count: 2, includes: ["font-size 使用了 em：0.6667em","应为 var(--qmai-body-font-marker)"] })
  add("反例⑤：marker 少乘倍数（直接用 rem）",
    mut("li::marker { font-size: var(--qmai-body-font-marker); }",
      "li::marker { font-size: 0.75rem; }"), ROOT_OK, false, { count: 1, includes: ["应为 var(--qmai-body-font-marker)（即 calc(var(--qmai-body-font-size) * 2 / 3)），实际 0.75rem"] })
  add("反例⑥：六条规则缺一条（有序标记）",
    mut(".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) ol > li::marker { font-size: var(--qmai-body-font-list); }", ""),
    ROOT_OK, false, { count: 1, includes: ["ol > li::marker 缺少 font-size 声明"] })
  add("反例⑦：文档标题字体被误改成正文字体",
    mut("font: 600 var(--qmai-body-font-size)/1.6 var(--ui);", "font: 600 var(--qmai-body-font-size)/1.6 var(--serif);"), ROOT_OK, false, { count: 1, includes: ["字体应保持 var(--ui)"] })
  add("反例⑧：变量定义里漏掉 px 间接层（写成裸 18px）",
    GOOD_EDITOR, ROOT_OK.replace("var(--qmai-body-font-px, 18px)", "18px"), false, { count: 1, includes: ["应为 var(--qmai-body-font-px, 18px)"] })
  add("反例⑨：变量派生比例写错（2/3 写成 3/4）",
    GOOD_EDITOR, ROOT_OK.replace("calc(var(--qmai-body-font-size) * 2 / 3)", "calc(var(--qmai-body-font-size) * 3 / 4)"), false, { count: 1, includes: ["不是由字号按 2/3 派生：calc(var(--qmai-body-font-size) * 3 / 4)"] })
  add("反例⑩：编辑器文件里重复定义变量（单一来源被破坏）",
    GOOD_EDITOR + "\n.ui-test-root { --qmai-body-font-size: 18px; }\n", ROOT_OK, false, { count: 1, includes: ["ui-test-editor.css 里也定义了 --qmai-body-font-size"] })
  add("反例⑪：px 行高漏网",
    mut("font-size: var(--qmai-body-font-list); line-height: var(--qmai-body-line-height); }\n.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li {",
      "font-size: var(--qmai-body-font-list); line-height: 26px; }\n.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li {"), ROOT_OK, false, { count: 1, includes: ["line-height 仍是绝对单位：26px"] })
  add("反例⑫：变量定义到全局 :root（会污染正式版）",
    GOOD_EDITOR, ROOT_OK.replace(".ui-test-root, html[data-ui-test-skin]", ":root"), false, { count: 1, includes: ["变量宿主规则的选择器是「:root」"] })
  add("反例⑬：变量被定义两处（单一来源名存实亡）",
    GOOD_EDITOR, ROOT_OK + "\n.ui-test-root { --qmai-body-font-marker: calc(var(--qmai-body-font-size) * 3 / 4); }", false, { count: 5, includes: ["分散在 2 处规则里","--qmai-body-font-size 未在 ui-test.css 中定义","--qmai-body-font-list 未定义","--qmai-body-font-marker 未定义","--qmai-body-line-height 未定义"] })

  /* 新增：App 独占变量被重复声明时必须报红 ——
     这是本次改造新引入的失败模式，必须有负向夹具证明守卫有效。
     注意必须用 add(...) 注册用例，不是 mut(...)：
     mut 只返回一个字符串、不注册任何用例，写成 mut 会静默不跑且自检照样打印通过。 */
  add("反例⑭：正文字号间接层被重复声明",
    GOOD_EDITOR,
    ROOT_OK + "\n.ui-test-root { --qmai-body-font-px: 18px; }", false, { count: 1, includes: ["--qmai-body-font-px 是 App 独占变量"] })
  add("反例⑮：行高间接层被重复声明",
    GOOD_EDITOR,
    ROOT_OK + "\n.ui-test-root { --qmai-body-leading: 1.95; }", false, { count: 1, includes: ["--qmai-body-leading 是 App 独占变量"] })
  add("反例⑯：从属尺寸不再是按比例派生",
    GOOD_EDITOR,
    ROOT_OK.replace("calc(var(--qmai-body-font-size) * 8 / 9)", "16px"), false, { count: 1, includes: ["不是由字号按 8/9 派生：16px"] })
  /*
   * 反例⑰ 是变异验证补出来的，不属于计划里原来那三条。
   *
   * 实测：把 isPxIndirection 的数值比较换成恒真（`Number(m[1]) === expectedPx` → `true`）
   * 之后自检**仍然全绿** —— 即"字号间接层的默认 px 写错"这一类反例没有任何夹具，
   * 而那个 18 正是本次改造"默认观感零变化"的锚点。
   * 真机上的守卫抓得住它（用真实 ui-test.css 做变异：18px → 20px 立即报红），
   * 缺的只是"证明校验器本身抓得住"这一层。补上，不放宽任何判据。
   */
  add("反例⑰：字号间接层的默认 px 写错（18px 写成 20px）",
    GOOD_EDITOR,
    ROOT_OK.replace("var(--qmai-body-font-px, 18px)", "var(--qmai-body-font-px, 20px)"), false, { count: 1, includes: ["应为 var(--qmai-body-font-px, 18px)","实际 var(--qmai-body-font-px, 20px)"] })
  /*
   * 反例⑱/⑲ 也是变异验证补出来的，同样不属于计划里的三条。
   *
   * 它们补的是 反例⑨ 留下的一个**结构性盲区**。isDerivedRatio 的收尾是
   *     Number(m[1]) === 分子 && Number(m[2]) === 分母
   * 两个合取项。而 反例⑨ 是 `2 / 3` → `3 / 4`：**分子和分母同时变了**，
   * 所以无论哪一半判据失效，它都还能靠另一半报红 ——
   * 也就是说它只证明了"**至少一个**合取项在起作用"，
   * 没有证明"**每一个**都在起作用"。
   *
   * 实测（父代理用独立脚本复核，改的是守卫自身再跑自检）：
   *   · 把**分母**那一半改成恒真 → 自检**仍然全绿**（17/17、18/18 都试过）
   *   · 把**分子**那一半改成恒真 → 自检**仍然全绿**
   * 两半**都没有**夹具覆盖。任务 12 的报告只提到了分母那一半，
   * 实际是**对称**的两处。
   *
   * 但这不是"守卫没有鉴别力"：拿**真实 ui-test.css** 做同样的语义变异
   * （列表 8/9 → 8/10，只动分母）**立即报红**：
   *     ✗ [变量定义] --qmai-body-font-list 不是由字号按 8/9 派生：
   *       calc(var(--qmai-body-font-size) * 8 / 10)（改造前是 16/18）
   * 缺的只是"证明校验器**自己**抓得住"这一层 —— 与 反例⑰ 的情形同类。
   *
   * ⑱ 只动**分母**（8/9 → 8/10），⑲ 只动**分子**（8/9 → 7/9）。
   * 补后两半各自有专属夹具：把任一半改成恒真，都会让对应那条变红。
   * 这是**收紧**，没有放宽任何既有判据。
   */
  add("反例⑱：派生比例的**分母**写错（8/9 写成 8/10，分子仍对）",
    GOOD_EDITOR,
    ROOT_OK.replace("calc(var(--qmai-body-font-size) * 8 / 9)", "calc(var(--qmai-body-font-size) * 8 / 10)"), false, { count: 1, includes: ["不是由字号按 8/9 派生：calc(var(--qmai-body-font-size) * 8 / 10)"] })
  add("反例⑲：派生比例的**分子**写错（8/9 写成 7/9，分母仍对）",
    GOOD_EDITOR,
    ROOT_OK.replace("calc(var(--qmai-body-font-size) * 8 / 9)", "calc(var(--qmai-body-font-size) * 7 / 9)"), false, { count: 1, includes: ["不是由字号按 8/9 派生：calc(var(--qmai-body-font-size) * 7 / 9)"] })

  /*
   * ── 反例⑳㉑㉒：代码质量审查 F1 实测出来的三处剩余盲区 ──
   *
   * 审查把每条判据逐个改成"永不触发"，发现自检仍然全绿，其中三处
   * 与**本次改造新引入的失败模式**直接相关，必须有夹具：
   *
   * ⑳ 行高默认值 1.95 的**数值**判据。
   *    实测：把 `Number(m[1]) !== 1.95` 改成永不触发 → 自检 20/20 全绿。
   *    为什么最该补：1.95 是"默认观感零变化"的锚点之一
   *    （列表 1.9 → 1.95 那 +2.6% 的观感变化就是靠它描述的），
   *    而且这是**唯一一处此前没有任何人登记**的缺口。
   *    真机上守卫抓得住（真实 CSS 1.95 → 1.9 立即报红），
   *    缺的只是"证明校验器自己抓得住"这一层。
   *    注意 ⑮ 抓的是 `--qmai-body-leading` 被**重复声明**，
   *    和"默认值写错"是两条不同的判据，⑮ 覆盖不到它。
   *
   * ㉑ ㉒ ㉓ App 独占变量的**另外三个**。
   *    实测：把 APP_OWNED_VARS 从 5 个缩到只剩 font-px 与 leading
   *    → 自检 20/20 全绿。也就是 letter-spacing / margin-x / safe-bottom
   *    这三个只靠"真 CSS 恰好没写错"兜着，没有任何夹具证明守卫抓得住它们。
   *    （⑭⑮ 已覆盖 font-px 与 leading 两个。）
   *
   * 判据是**收紧**：三处都只补夹具，不动任何既有判据。
   */
  add("反例⑳：行高间接层的默认值写错（1.95 写成 1.9）",
    GOOD_EDITOR,
    ROOT_OK.replace("var(--qmai-body-leading, 1.95)", "var(--qmai-body-leading, 1.9)"), false, { count: 1, includes: ["--qmai-body-line-height 的默认值应为 1.95","实际 1.9"] })
  add("反例㉑：字间距独占变量被重复声明",
    GOOD_EDITOR,
    ROOT_OK + "\n.ui-test-root { --qmai-body-letter-spacing: 0; }", false, { count: 1, includes: ["--qmai-body-letter-spacing 是 App 独占变量"] })
  add("反例㉒：左右边距独占变量被重复声明",
    GOOD_EDITOR,
    ROOT_OK + "\n.ui-test-root { --qmai-body-margin-x: 48px; }", false, { count: 1, includes: ["--qmai-body-margin-x 是 App 独占变量"] })
  add("反例㉓：底部安全距离独占变量被重复声明",
    GOOD_EDITOR,
    ROOT_OK + "\n.ui-test-root { --qmai-body-safe-bottom: 51px; }", false, { count: 1, includes: ["--qmai-body-safe-bottom 是 App 独占变量"] })

  /*
   * ── 反例㉔㉕㉖：三条**此前没有任何夹具**的子判据（审查 F1 实测）──
   *
   * 审查把每条子判据逐个改成"永不触发"，发现自检仍然全绿，其中这三条
   * 连一条碰它们的反例都没有：
   *   · 输入层（.ProseMirror / [dir][lang] / textarea）的字号
   *   · 段落（> p）的字号
   *   · 文档标题的字号
   * 真机上三条都有效（改坏立即报红），缺的只是"证明校验器自己抓得住"。
   *
   * 注意三条都刻意用 rem 而不是 px：用 px 会**顺带**触发那条
   * "font 简写的字号仍是绝对单位"的位置判据（反例① 里出现过），
   * 于是问题条数变成 2 而不是 1，"只动一个分量"就不成立了。
   * 这正是本轮反复强调的纪律：**一条夹具只动一个分量**。
   */
  add("反例㉔：输入层的字号写死（不动行高）",
    mut("textarea { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      "textarea { font: 400 1.125rem/var(--qmai-body-line-height) var(--serif); }"),
    ROOT_OK, false, { count: 2, includes: ["输入层字号应为", "输入层字号表达式"] })
  add("反例㉕：段落的字号写死",
    mut("> p { font-size: var(--qmai-body-font-size); }",
      "> p { font-size: 1.125rem; }"),
    ROOT_OK, false, { count: 1, includes: ["段落", "字号应为 var(--qmai-body-font-size)，实际 1.125rem"] })
  add("反例㉖：文档标题的字号写死（不动字体）",
    mut("font: 600 var(--qmai-body-font-size)/1.6 var(--ui);",
      "font: 600 1.5rem/1.6 var(--ui);"),
    ROOT_OK, false, { count: 1, includes: ["文档标题", "字号应跟随正文字号"] })

  /*
   * ── 反例㉗–㊲：代码质量审查实测出的**第二批**夹具盲区 ──
   *
   * 审查把守卫里**全部 40 个 bad() 调用点**逐个改成「永不触发」，
   * 结果有 **13 处**自检仍然全绿（其中 1 处是不可达的死分支，见下面 M-4 的修复）。
   * 剩下 **12 处可达**、且与上一轮已修的 10 处**不重叠**。
   *
   * 为什么这 12 处要紧（不是"凑覆盖率"）：
   *   · L248「编辑器里出现字面 px font-size」是这类回归的**唯一**防线 ——
   *     动态脚本发现不了它（我把它整条规则删掉，动态守卫 B 仍判"两者相等"，
   *     因为元素从 .ui-test-editor-body 继承了同一个字号）。静态这一条若被
   *     改坏而没人知道，这条回归就是**双侧失明**。
   *   · L254「font 简写的行高写成 px」与 L212「行高间接层漏兜底值」同类：
   *     漏兜底值会让 var() 在计算值阶段失效、行高静默退回 normal。
   *   · 7 处"结构缺失"分支（没有 font / 没有 font-size / 无法解析）是
   *     改错选择器时最先响的那批 —— 选择器写错是最常见的改动失误。
   *
   * 每条的 count 与 includes 都是**量出来的**（.codex-temp/measure-new-fixtures.mjs
   * 直接 import verify() 跑候选变异、打印全部 rule+detail），不是猜的。
   * 写法上坚持"一次只动一个分量"：㉗ 与 ㊱ 之所以改选择器/属性而不是改用 px，
   * 是为了避免同时触发位置判据（px 会多报一条 "绝对单位"）。
   */
  add("反例㉗：编辑器里新出现一条字面 px 字号（不碰任何既有规则）",
    GOOD_EDITOR + "\n.ui-test-root .ui-test-editor-body blockquote { font-size: 20px; }\n",
    ROOT_OK, false, { count: 1, includes: ["font-size 仍是绝对单位：20px"] })
  add("反例㉘：正文基准 font 简写里的**行高**写成 px（字号仍对）",
    mut(".ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      ".ui-test-editor-body { font: 400 var(--qmai-body-font-size)/26px var(--serif); }"),
    ROOT_OK, false, { count: 2, includes: ["font 简写的行高仍是绝对单位：26px", "的行高应为 var(--qmai-body-line-height)，实际 26px"] })
  add("反例㉙：行高间接层漏掉兜底值（var() 会失效、行高退回 normal）",
    GOOD_EDITOR,
    ROOT_OK.replace("var(--qmai-body-leading, 1.95)", "var(--qmai-body-leading)"), false, { count: 1, includes: ["--qmai-body-line-height 应为 var(--qmai-body-leading, 1.95)，实际 var(--qmai-body-leading)"] })
  add("反例㉚：删掉查找高亮层整条规则（字号与行高一起丢）",
    GOOD_EDITOR.split("\n").filter((l) => !l.includes("[data-find-highlights]")).join("\n"),
    ROOT_OK, false, { count: 2, includes: ["[data-find-highlights] 没有 font-size 声明", "[data-find-highlights] 没有 line-height 声明"] })
  add("反例㉛：正文基准整条 font 声明缺失（选择器写错的典型后果）",
    mut(".ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      ".ui-test-editor-body { color: red; }"),
    ROOT_OK, false, { count: 1, includes: ["没有 font 声明（找不到字号来源）"] })
  add("反例㉜：输入层整条 font 声明缺失",
    mut("textarea { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      "textarea { color: red; }"),
    ROOT_OK, false, { count: 1, includes: ["输入层（.ProseMirror / [dir][lang] / textarea 三条）没有 font 声明"] })
  add("反例㉝：段落 font-size 声明缺失",
    mut("> p { font-size: var(--qmai-body-font-size); }", "> p { color: red; }"),
    ROOT_OK, false, { count: 1, includes: ["没有 font-size 声明"] })
  add("反例㉞：文档标题整条 font 声明缺失",
    mut("{ font: 600 var(--qmai-body-font-size)/1.6 var(--ui); }", "{ color: red; }"),
    ROOT_OK, false, { count: 1, includes: [":is(h2, h3, h4, h5, h6) 没有 font 声明"] })
  add("反例㉟：正文基准的 font 简写无法解析（只写一个变量）",
    mut(".ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      ".ui-test-editor-body { font: var(--qmai-body-font-size); }"),
    ROOT_OK, false, { count: 1, includes: ["无法解析 .ui-test-root .ui-test-editor-body 的 font 简写：var(--qmai-body-font-size)"] })
  add("反例㊱：文档标题的 font 简写无法解析",
    mut("font: 600 var(--qmai-body-font-size)/1.6 var(--ui);", "font: var(--qmai-body-font-size);"),
    ROOT_OK, false, { count: 1, includes: ["无法解析文档标题的 font 简写：var(--qmai-body-font-size)"] })
  add("反例㊲：输入层的 font 简写无法解析",
    mut("textarea { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      "textarea { font: var(--qmai-body-font-size); }"),
    ROOT_OK, false, { count: 1, includes: ["无法解析输入层的 font 简写：var(--qmai-body-font-size)"] })
  /*
   * ㊳ 是本轮新写的 meta 守卫（.codex-temp/check-fixture-coverage.mjs）扫出来的，
   * **两轮人工审查都漏了它**。它覆盖"变量宿主整块消失"这条早期返回分支：
   * 变量一个都没定义时，后面四条"未定义"判据会各自补一条 ——
   * 所以这一条夹具一次证明 5 处判据都活着（第 173 行的分支 + 四条变量判据）。
   * 这也是"用脚本扫覆盖度"胜过"人工扫两轮"的直接证据。
   */
  add("反例㊳：变量宿主整块消失（四个尺寸变量都没定义）",
    GOOD_EDITOR,
    ".ui-test-root, html[data-ui-test-skin] {\n  color: red;\n}", false, {
      count: 5,
      includes: [
        "四个正文尺寸变量都没有定义（应在 ui-test.css 的 .ui-test-root 规则里）",
        "--qmai-body-font-size 未在 ui-test.css 中定义（应为 var(--qmai-body-font-px, 18px)）",
        "--qmai-body-font-list 未定义（应为 calc(var(--qmai-body-font-size) * 8 / 9)，即改造前的列表 16px）",
        "--qmai-body-font-marker 未定义（应为 calc(var(--qmai-body-font-size) * 2 / 3)，即改造前的标记 12px）",
        "--qmai-body-line-height 未定义（应为 var(--qmai-body-leading, 1.95)）",
      ],
    })

  return cases
}

/* ─────────────────────────── 自检 ─────────────────────────── */

export function selftest() {
  const cases = selftestCases()
  let pass = 0
  const lines = []
  for (const c of cases) {
    const problems = verify(c.css, c.css2)
    const clean = problems.length === 0
    let ok = clean === c.expectClean
    let extra = ""

    /*
     * ── 根因修复（审查 F1）：不只问"红了没"，还问"**红了几条、红在哪**" ──
     *
     * 只断言红/不红时，一条夹具若同时命中多条判据，任一判据失效它都还能
     * 靠别的判据报红 —— 分量级鉴别力被掩盖。实测有 7 条子判据在被改成
     * "永不触发"后自检**仍然全绿**。夹具现在必须声明 expect：
     *   · count    = 问题**条数**必须精确相符。这一条专治"多判据互相掩盖"：
     *                即使两条判据耦合、总是同时命中，任一条失效条数也会降。
     *   · includes = 每条片段都必须出现在某条问题的文本里（防止条数对、内容串了）。
     */
    if (ok && c.expect) {
      const text = problems.map((p) => `${p.rule} ${p.detail}`).join("\n")
      const missing = c.expect.includes.filter((s) => !text.includes(s))
      if (problems.length !== c.expect.count) {
        ok = false
        extra = `  → 期望报出 ${c.expect.count} 条问题，实际 ${problems.length} 条`
      } else if (missing.length > 0) {
        ok = false
        extra = `  → 期望问题文本里含 ${JSON.stringify(missing)}，实际报出的是 ${JSON.stringify(problems.map((p) => `${p.rule} ${p.detail}`))}`
      } else {
        extra = `  → ${problems.length} 条问题，内容与期望相符`
      }
    }

    /*
     * ── 反例**必须**声明 expect，否则判失败 ──
     *
     * 这是"守卫守卫自己"的那一层，补的是一个真实踩过的坑：
     * 上一轮加 count/includes 时把 add() 的第 5 个参数写成 `expectRules`，
     * 而这里读的是 `c.expect` —— 判据**一条都没执行**，自检照样打印
     * 「27/27 全绿」。当时是靠反向对照（把判据改坏后仍全绿）才发现的。
     *
     * 修完之后，那个修法本身**没有被任何东西守着**：删掉任一反例的 expect
     * 参数，它只是静默退回"只判红/不红"，自检仍然全绿 —— 同一个盲区
     * 会在下一条新夹具上原样复发。所以必须把"缺 expect"本身做成失败，
     * 而不是允许它退化。**反例的唯一价值就是精确说明它期望报出什么。**
     *
     * 只对反例（expectClean === false）要求：正例没有 problems，count 恒为 0，
     * 声明 expect 没有信息量，强制它只会制造噪声。
     */
    if (c.expectClean === false && !c.expect) {
      ok = false
      extra = "  → 反例未声明 expect（count/includes）：会退化成只判红/不红，必须补上"
    }

    if (ok) pass++
    lines.push(`    ${ok ? "✓" : "✗"} ${c.name}${ok ? extra : extra || `  → 期望${c.expectClean ? "通过" : "报错"}，实际${clean ? "通过" : `报错 ${problems.length} 条: ${problems[0]?.detail}`}`}`)
  }
  lines.push(`    自检结果: ${pass} 通过 / ${cases.length - pass} 失败（共 ${cases.length} 例）`)
  return { pass, total: cases.length, lines }
}

/* ─────────────────────────── 入口 ─────────────────────────── */

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))

if (isMain) {
  if (process.argv.includes("--selftest")) {
    /*
     * 反例数**从实际登记数推导**，不写死。
     * 原实现写死「正例 + 11 个反例」，实际已登记 13 个 —— 加反例时无人会想起改标题，
     * 于是报告的规模与实际不符（对抗性审查 P4）。这里的 ${total - 1} 让标题
     * 不可能再和 selftest() 里的 add() 条数脱节。
     */
    const { pass, total, lines } = selftest()
    console.log(`  ══ 校验器自检（正例 + ${total - 1} 个反例，共 ${total} 例）══`)
    for (const l of lines) console.log(l)
    console.log(`  结论: ${pass === total ? "✓ 校验器可信（能通过正例，且能逐类检出反例）" : "✗ 校验器本身有问题"}`)
    process.exit(pass === total ? 0 : 1)
  }

  console.log("  ══ 正文字号单一来源校验（ui-test-editor.css）══")
  const problems = verify(readFileSync(EDITOR_CSS, "utf8"), readFileSync(UITEST_CSS, "utf8"))
  if (problems.length === 0) {
    console.log("  ✓ 正文四处引用同一字号变量；从属尺寸由字号按比例派生；行高无单位；六条规则齐备")
    console.log("  提示：编辑器 DOM 在浏览器里不可达（章节正文是 textarea，li 只出现在")
    console.log("       非章节文档的 Milkdown .ProseMirror 里）。本校验只管「写法对不对」，")
    console.log("       还必须跑 verify-real-exe.mjs 与 verify-real-exe-settings-save.mjs 实测。")
    process.exit(0)
  }
  for (const p of problems) console.log(`  ✗ [${p.rule}] ${p.detail}`)
  console.log(`  结论: ${problems.length} 个问题 → ✗ 未通过`)
  process.exit(1)
}
