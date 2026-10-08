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
export const BODY_SCALE_VAR = "--qmai-body-font-scale"

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

/** `calc(<数字>rem * var(--qmai-body-font-scale, 1))` 是否合法且倍数正确。 */
function isScaledRem(value, expectedRem) {
  if (typeof value !== "string") return false
  const flat = value.replace(/\s+/g, " ").trim()
  const m = flat.match(/^calc\(\s*(-?\d*\.?\d+)rem\s*\*\s*var\(\s*--qmai-body-font-scale\s*,\s*1\s*\)\s*\)$/)
  if (!m) return false
  return Number(m[1]) === expectedRem
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
        --qmai-body-font-scale 由 App.tsx 写到 documentElement 行内样式，
        沿 DOM 树向下继承，故 .ui-test-root 这里能读到 —— 不必也不应改成 :root。 */
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
  const expectedVars = [
    [BODY_SIZE_VAR, 1.125, "正文 18px"],
    [BODY_LIST_VAR, 1, "列表 16px"],
    [BODY_MARKER_VAR, 0.75, "标记 12px"],
  ]
  for (const [name, rem, why] of expectedVars) {
    const d = varDefs.get(name)
    if (!d) { bad("变量定义", `${name} 未在 ui-test.css 中定义（应为 calc(${rem}rem * var(--qmai-body-font-scale, 1))，即改造前的${why}）`); continue }
    if (!isScaledRem(d.value, rem)) {
      bad("变量定义", `${name} 取值不是「精确 rem × 倍数」：${d.value}（应为 calc(${rem}rem * var(${BODY_SCALE_VAR}, 1))）`)
    }
  }
  {
    const d = varDefs.get(BODY_LINE_VAR)
    if (!d) bad("变量定义", `${BODY_LINE_VAR} 未定义（正文行高 1.95 应与字号同源，否则改一处就错位）`)
    else if (d.value.replace(/\s+/g, "") !== "1.95") bad("变量定义", `${BODY_LINE_VAR} 应为无单位 1.95（与改造前逐位相同，且不随字号变化），实际 ${d.value}`)
  }
  // 变量不得在编辑器文件里被重复定义（重复定义会让"单一来源"名存实亡）
  for (const [prop] of editorRules.flatMap((r) => [...r.decls])) {
    if ([BODY_SIZE_VAR, BODY_LINE_VAR, BODY_LIST_VAR, BODY_MARKER_VAR, BODY_SCALE_VAR].includes(prop)) {
      bad("变量定义", `ui-test-editor.css 里也定义了 ${prop} —— 单一来源要求只在 ui-test.css 的 :root 定义一处`)
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

  /* 4) 从属尺寸必须用「精确 rem × 倍数」，不许用 em、不许漏乘倍数 */
  for (const r of editorRules) {
    for (const [prop, d] of r.decls) {
      if (prop !== "font-size" && prop !== "line-height") continue
      if (hasEmUnit(d.value)) {
        bad(`L${d.line} ${r.selector}`, `${prop} 使用了 em：${d.value} —— em 的基准是所属元素（如 ::marker 相对 li 而非正文），会算错比例；应写 calc(<精确rem> * var(${BODY_SCALE_VAR}, 1))`)
      }
    }
  }

  /* 5) 六条规则逐条断言（缺一即失败） */
  const expectScaled = [
    ["列表容器", [EDITOR_SELECTORS.list], "font-size", BODY_LIST_VAR, 1],
    ["列表项", [EDITOR_SELECTORS.li], "font-size", BODY_LIST_VAR, 1],
    ["列表项内段落", [EDITOR_SELECTORS.liP], "font-size", BODY_LIST_VAR, 1],
    ["无序标记", [EDITOR_SELECTORS.marker], "font-size", BODY_MARKER_VAR, 0.75],
    ["有序标记", [EDITOR_SELECTORS.olMarker], "font-size", BODY_LIST_VAR, 1],
  ]
  for (const [name, sel, prop, varName, rem] of expectScaled) {
    const d = declOf(sel, prop, editorRules)
    if (!d) { bad(name, `${sel.join(" | ")} 缺少 ${prop} 声明`); continue }
    // 允许两种等价写法：calc(rem * var(...)) 直接写，或引用已定义的变量
    const ok = d.value === `var(${varName})` || isScaledRem(d.value, rem)
    if (!ok) bad(name, `${prop} 应为 var(${varName})（即 calc(${rem}rem * var(${BODY_SCALE_VAR}, 1))），实际 ${d.value}`)
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
  --qmai-body-font-size: calc(1.125rem * var(--qmai-body-font-scale, 1));
  --qmai-body-line-height: 1.95;
  --qmai-body-font-list: calc(1rem * var(--qmai-body-font-scale, 1));
  --qmai-body-font-marker: calc(0.75rem * var(--qmai-body-font-scale, 1));
}`

const GOOD_EDITOR = `
.ui-test-root .ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }
.ui-test-root .ui-test-editor-body .ProseMirror,
.ui-test-root .ui-test-editor-body [dir][lang],
.ui-test-root .ui-test-editor-body [data-writing-editor] textarea { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }
.ui-test-root .ui-test-editor-body [data-find-highlights] { font-size: var(--qmai-body-font-size); line-height: var(--qmai-body-line-height); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) > p { font-size: var(--qmai-body-font-size); }
.ui-test-root .ui-test-editor-body :is(h2, h3, h4, h5, h6) { font: 600 var(--qmai-body-font-size)/1.6 var(--ui); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) :is(ul, ol) { font-size: var(--qmai-body-font-list); line-height: 1.9; }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li { font-size: var(--qmai-body-font-list); line-height: 1.9; }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li p { font-size: var(--qmai-body-font-list); line-height: 1.9; }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li::marker { font-size: var(--qmai-body-font-marker); }
.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) ol > li::marker { font-size: var(--qmai-body-font-list); }
`

export function selftest() {
  const cases = []
  const add = (name, css, css2, expectClean) => cases.push({ name, css, css2, expectClean })
  const mut = (from, to) => GOOD_EDITOR.replace(from, to)

  add("正例：完整合规片段", GOOD_EDITOR, ROOT_OK, true)
  add("反例①：正文仍是硬编码 18px",
    mut(".ui-test-root .ui-test-editor-body { font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      ".ui-test-root .ui-test-editor-body { font: 400 18px/1.95 var(--serif); }"), ROOT_OK, false)
  add("反例②：正文未引用变量（仍是 codemod 的 rem）",
    mut("font: 400 var(--qmai-body-font-size)/var(--qmai-body-line-height) var(--serif); }",
      "font: 400 1.125rem/1.95 var(--serif); }"), ROOT_OK, false)
  add("反例③：高亮层与输入层表达式不同（字号写死）",
    mut("font-size: var(--qmai-body-font-size); line-height: var(--qmai-body-line-height); }",
      "font-size: 1.125rem; line-height: 1.95; }"), ROOT_OK, false)
  add("反例④：marker 用 em（比例基准错）",
    mut("li::marker { font-size: var(--qmai-body-font-marker); }",
      "li::marker { font-size: 0.6667em; }"), ROOT_OK, false)
  add("反例⑤：marker 少乘倍数（直接用 rem）",
    mut("li::marker { font-size: var(--qmai-body-font-marker); }",
      "li::marker { font-size: 0.75rem; }"), ROOT_OK, false)
  add("反例⑥：六条规则缺一条（有序标记）",
    mut(".ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) ol > li::marker { font-size: var(--qmai-body-font-list); }", ""),
    ROOT_OK, false)
  add("反例⑦：文档标题字体被误改成正文字体",
    mut("font: 600 var(--qmai-body-font-size)/1.6 var(--ui);", "font: 600 var(--qmai-body-font-size)/1.6 var(--serif);"), ROOT_OK, false)
  add("反例⑧：变量定义里漏乘倍数",
    GOOD_EDITOR, ROOT_OK.replace("calc(1.125rem * var(--qmai-body-font-scale, 1))", "1.125rem"), false)
  add("反例⑨：变量倍数写错（0.75 写成 0.8）",
    GOOD_EDITOR, ROOT_OK.replace("0.75rem", "0.8rem"), false)
  add("反例⑩：编辑器文件里重复定义变量（单一来源被破坏）",
    GOOD_EDITOR + "\n.ui-test-root { --qmai-body-font-size: 18px; }\n", ROOT_OK, false)
  add("反例⑪：px 行高漏网",
    mut("font-size: var(--qmai-body-font-list); line-height: 1.9; }\n.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li {",
      "font-size: var(--qmai-body-font-list); line-height: 26px; }\n.ui-test-root .ui-test-editor-body :is(.ProseMirror, [dir][lang]) li {"), ROOT_OK, false)
  add("反例⑫：变量定义到全局 :root（会污染正式版）",
    GOOD_EDITOR, ROOT_OK.replace(".ui-test-root, html[data-ui-test-skin]", ":root"), false)
  add("反例⑬：变量被定义两处（单一来源名存实亡）",
    GOOD_EDITOR, ROOT_OK + "\n.ui-test-root { --qmai-body-font-marker: calc(0.9rem * var(--qmai-body-font-scale, 1)); }", false)

  let pass = 0
  const lines = []
  for (const c of cases) {
    const problems = verify(c.css, c.css2)
    const clean = problems.length === 0
    const ok = clean === c.expectClean
    if (ok) pass++
    lines.push(`    ${ok ? "✓" : "✗"} ${c.name}${ok ? "" : `  → 期望${c.expectClean ? "通过" : "报错"}，实际${clean ? "通过" : `报错 ${problems.length} 条: ${problems[0]?.detail}`}`}`)
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
    console.log("  ✓ 正文四处引用同一字号变量；从属尺寸为「精确 rem × 倍数」；六条规则齐备")
    console.log("  提示：编辑器 DOM 在浏览器里不可达（章节正文是 textarea，li 只出现在")
    console.log("       非章节文档的 Milkdown .ProseMirror 里）。本校验只管「写法对不对」，")
    console.log("       还必须跑 verify-real-exe.mjs 与 verify-real-exe-settings-save.mjs 实测。")
    process.exit(0)
  }
  for (const p of problems) console.log(`  ✗ [${p.rule}] ${p.detail}`)
  console.log(`  结论: ${problems.length} 个问题 → ✗ 未通过`)
  process.exit(1)
}
