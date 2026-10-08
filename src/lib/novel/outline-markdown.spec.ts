import { describe, expect, it } from "vitest"
import { buildPureOutlineMarkdown, stripOutlineFrontmatter } from "./outline-markdown"

describe("纯 Markdown 大纲", () => {
  it("移除历史 YAML 并保留正文 Markdown 符号", () => {
    const result = stripOutlineFrontmatter([
      "---",
      "type: outline",
      "outline_type: chapter-outline",
      "source_intent: \"生成章纲\"",
      "---",
      "",
      "# 第001章章纲",
      "",
      "- 主角进入旧城",
      "- **关键伏笔**浮现",
    ].join("\n"))

    expect(result).toBe("# 第001章章纲\n\n- 主角进入旧城\n- **关键伏笔**浮现\n")
    expect(result).not.toContain("type: outline")
    expect(result).not.toContain("---")
  })

  it("正文没有一级标题时补充标题", () => {
    expect(buildPureOutlineMarkdown("故事总纲", "## 第一卷\n\n正文")).toBe(
      "# 故事总纲\n\n## 第一卷\n\n正文\n",
    )
  })

  it("正文已有一级标题时不重复添加", () => {
    expect(buildPureOutlineMarkdown("不会重复", "# 已有标题\n\n正文\n\n")).toBe(
      "# 已有标题\n\n正文\n",
    )
  })
})

// 回归：导入设定集时正文被吃掉一整节。
//
// 现场证据（E:\高人一等\修改方案\00-设定集.md → D:\QM-BOOK\楚白\QM\outlines\00-设定集.md）：
// 原文件 427 行 / 17401 字符，导入后 404 行 / 16684 字符，正文直接从 `## 1. 金手指` 开始。
// 丢掉的 23 行正是文首的一级标题、`> 用途` 说明，以及 `# 标题 / 说明 / --- / ## 0. 定位 /
// …表格… / ---` 这一段——因为那条 `---` 是**分隔线**，却被 parseFrontmatter 的
// 「围栏前允许夹 6 行」的容错分支当成了 frontmatter 开栏。
//
// 下面这份样本按真实文件的**行号**复刻，这一点是关键：
// 真实文件里的 `---` 落在第 6 行，而容错分支的门槛是
// `lineNumberAt() > 6` —— 6 > 6 为假，于是放行。
// 如果 `---` 落在第 7 行就会被拒绝，所以样本必须把分隔线放在第 6 行，
// 否则这个回归用例根本触发不到 bug。
const SETTING_DOC = [
  "# 《高人一等》设定集（修订版 v1）", // 1
  "", // 2
  "> 用途：这是往下写每一章都要对照的“宪法”。", // 3
  "> 适用范围：番茄/七猫签约向男频爽文。", // 4
  "", // 5
  "---", // 6  ← 分隔线，不是 frontmatter 围栏（真实文件就在这一行）
  "", // 7
  "## 0. 定位", // 8
  "",
  "| 项 | 设定 |",
  "| --- | --- |",
  "| 题材 | 都市脑洞 |",
  "| 主角 | 楚白 |",
  "",
  "**全书纪律（三条）**",
  "",
  "1. 金手指不能提前暴露。",
  "2. 配角不许抢戏。",
  "3. 每章留钩子。",
  "",
  "---",
  "",
  "## 1. 金手指：高人一等令牌（重订）",
  "",
  "| 项 | 设定 |",
  "| --- | --- |",
  "| 来源 | 祖传 |",
  "",
].join("\n")

describe("导入大纲不再丢掉正文（正文里的 --- 是分隔线，不是 frontmatter）", () => {
  it("正文里的 --- 分隔线不会被当成 frontmatter 切掉", () => {
    const stripped = stripOutlineFrontmatter(SETTING_DOC)

    // 一节都不能少。
    expect(stripped).toContain("# 《高人一等》设定集（修订版 v1）")
    expect(stripped).toContain("> 用途：这是往下写每一章都要对照的“宪法”。")
    expect(stripped).toContain("> 适用范围：番茄/七猫签约向男频爽文。")
    expect(stripped).toContain("## 0. 定位")
    expect(stripped).toContain("| 题材 | 都市脑洞 |")
    expect(stripped).toContain("**全书纪律（三条）**")
    expect(stripped).toContain("1. 金手指不能提前暴露。")
    expect(stripped).toContain("## 1. 金手指：高人一等令牌（重订）")

    // 除首尾空行归一化外，内容与原文逐字符相同。
    expect(stripped).toBe(`${SETTING_DOC.trim()}\n`)
  })

  it("导入后保留文档自带的一级标题，不被文件名替换掉", () => {
    const imported = buildPureOutlineMarkdown("00-设定集", SETTING_DOC)

    expect(imported.startsWith("# 《高人一等》设定集（修订版 v1）")).toBe(true)
    expect(imported).not.toContain("# 00-设定集")
    expect(imported).toContain("## 0. 定位")
    // 两个 `---` 分隔线和它们之间的内容都还在。
    expect(imported.match(/^---$/gm)).toHaveLength(2)
  })

  it("文首确实有 frontmatter 时照旧剥掉，且不影响正文里的分隔线", () => {
    const withFrontmatter = [
      "---",
      "type: outline",
      "outline_type: chapter-outline",
      "---",
      "",
      "# 第001章章纲",
      "",
      "---",
      "",
      "## 后半段",
      "",
    ].join("\n")

    const stripped = stripOutlineFrontmatter(withFrontmatter)
    expect(stripped).not.toContain("outline_type")
    expect(stripped).toBe("# 第001章章纲\n\n---\n\n## 后半段\n")
  })

  it("正文里更靠前的分隔线也不会被误判（不依赖第 6 行这个巧合）", () => {
    const doc = ["# 标题", "", "---", "", "## 一节", "", "正文", ""].join("\n")
    expect(stripOutlineFrontmatter(doc)).toBe("# 标题\n\n---\n\n## 一节\n\n正文\n")
  })
})
