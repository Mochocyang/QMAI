import { describe, it, expect } from "vitest"
import { buildResultProtocolTrace, validateChapterContent, validateOutlineContent } from "@/lib/novel/result-parser"

describe("result-parser", () => {
  describe("validateChapterContent", () => {
    it("空内容应该返回 invalid", () => {
      const result = validateChapterContent("")
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it("只有 frontmatter 的内容应该检测到 frontmatter 但没有正文", () => {
      const content = "---\nchapter_number: 1\ntitle: \"测试章节\"\n---\n"
      const result = validateChapterContent(content)
      expect(result.hasFrontmatter).toBe(true)
      expect(result.chapterNumber).toBe(1)
      expect(result.title).toBe("测试章节")
      expect(result.hasBody).toBe(false)
    })

    it("完整章节内容应该通过校验", () => {
      const content = `---
chapter_number: 3
title: "第三章 初遇"
---

# 第三章 初遇

这是正文内容，有足够的字数来通过基本校验。
第二段落，继续增加字数。
第三段落，确保字数超过最低限制。
第四段落，再多一些内容。
第五段落，最后一段。`
      const result = validateChapterContent(content)
      expect(result.valid).toBe(true)
      expect(result.hasFrontmatter).toBe(true)
      expect(result.hasTitle).toBe(true)
      expect(result.hasBody).toBe(true)
      expect(result.chapterNumber).toBe(3)
      expect(result.wordCount).toBeGreaterThan(50)
    })

    it("无 frontmatter 的章节应该返回警告", () => {
      const content = "# 第一章\n\n这是正文内容，没有 frontmatter，但是有足够的字数。".repeat(10)
      const result = validateChapterContent(content)
      expect(result.valid).toBe(true)
      expect(result.hasFrontmatter).toBe(false)
      expect(result.warnings).toContain("缺少 frontmatter 元数据")
    })

    it("字数过少应该返回警告", () => {
      const content = "短文本"
      const result = validateChapterContent(content)
      expect(result.warnings.some((w) => w.includes("字数过少"))).toBe(true)
    })
  })

  describe("validateOutlineContent", () => {
    it("空内容应该返回 invalid", () => {
      const result = validateOutlineContent("")
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it("有多个标题的大纲应该通过校验", () => {
      const content = `# 故事大纲

## 第一卷 初入江湖

### 第一章 觉醒
### 第二章 拜师

## 第二卷 风云际会

### 第三章 下山
### 第四章 相遇`
      const result = validateOutlineContent(content)
      expect(result.valid).toBe(true)
      expect(result.hasStructure).toBe(true)
      expect(result.nodeCount).toBeGreaterThan(2)
    })

    it("只有一个标题的大纲应该返回警告", () => {
      const content = "# 单一大纲\n\n只有一个标题。"
      const result = validateOutlineContent(content)
      expect(result.warnings.some((w) => w.includes("节点过少"))).toBe(true)
    })

    it("没有标题结构的纯文本应该返回警告", () => {
      const content = "这是一段纯文本，没有任何标题结构。".repeat(5)
      const result = validateOutlineContent(content)
      expect(result.hasStructure).toBe(false)
      expect(result.warnings.some((w) => w.includes("未检测到标题结构"))).toBe(true)
    })
  })

  describe("buildResultProtocolTrace", () => {
    it("builds chapter protocol trace from chapter validation", () => {
      const content = `---
chapter_number: 3
title: "第三章 初遇"
---

# 第三章 初遇

这是正文内容，有足够的字数来通过基本校验。
第二段落，继续增加字数。
第三段落，确保字数超过最低限制。
第四段落，再多一些内容。
第五段落，最后一段。`

      const trace = buildResultProtocolTrace("chapter", content)

      expect(trace.type).toBe("chapter")
      expect(trace.valid).toBe(true)
      expect(trace.hasFrontmatter).toBe(true)
      expect(trace.hasTitle).toBe(true)
      expect(trace.wordCount).toBeGreaterThan(50)
      expect(trace.validatedAt).toBeGreaterThan(0)
    })

    it("builds outline protocol trace from outline validation", () => {
      const trace = buildResultProtocolTrace("outline", "# 大纲\n\n## 第一卷\n\n### 第一章\n### 第二章")

      expect(trace.type).toBe("outline")
      expect(trace.valid).toBe(true)
      expect(trace.nodeCount).toBe(4)
      expect(trace.validatedAt).toBeGreaterThan(0)
    })
  })
})
