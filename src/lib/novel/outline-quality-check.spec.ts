import { describe, expect, it } from "vitest"
import {
  extractChapterOutlineStatus,
  isLikelyChapterOutline,
  runChapterOutlineQualityCheck,
  summarizeChapterOutlineQuality,
} from "./outline-quality-check"
import { getChapterOutlineTemplate } from "./outline-templates"

describe("章纲质量检查", () => {
  it("完整章纲模板应通过关键质量检查", () => {
    const content = getChapterOutlineTemplate(1, "账号交接")
    const summary = summarizeChapterOutlineQuality(content)

    expect(summary.valid).toBe(true)
    expect(summary.errors).toEqual([])
    expect(summary.items.some((item) => item.category === "核心事件" && item.status === "pass")).toBe(true)
    expect(summary.items.some((item) => item.category === "场景顺序" && item.status === "pass")).toBe(true)
  })

  it("核心事件不足应返回错误", () => {
    const content = getChapterOutlineTemplate(1, "账号交接").replace(
      /- 事件3：[\s\S]*?- 事件6：[\s\S]*?(?=\n\n## 场景顺序)/,
      "",
    )
    const result = runChapterOutlineQualityCheck(content)

    expect(result.find((item) => item.category === "核心事件")?.status).toBe("error")
    expect(result.find((item) => item.category === "核心事件")?.details?.join("\n")).toContain("至少需要 6 条")
  })

  it("缺少 CBN、CPNs、CEN 结构节点应返回错误", () => {
    const content = getChapterOutlineTemplate(1, "账号交接")
      .replace(/## 结构节点[\s\S]*?(?=\n\n## 章首钩子)/, "")
    const result = runChapterOutlineQualityCheck(content)

    expect(result.find((item) => item.category === "结构节点")?.status).toBe("error")
    expect(result.find((item) => item.category === "结构节点")?.details?.join("\n")).toContain("CBN")
    expect(result.find((item) => item.category === "结构节点")?.details?.join("\n")).toContain("CPNs")
    expect(result.find((item) => item.category === "结构节点")?.details?.join("\n")).toContain("CEN")
  })

  it("缺少时间锚点、章内时间跨度和与上章时间差应返回错误", () => {
    const content = getChapterOutlineTemplate(1, "账号交接")
      .replace("- 时间锚点：", "")
      .replace("- 章内时间跨度：", "")
      .replace("- 与上章时间差：", "")
    const result = runChapterOutlineQualityCheck(content)

    expect(result.find((item) => item.category === "时间承接")?.status).toBe("error")
    expect(result.find((item) => item.category === "时间承接")?.details?.join("\n")).toContain("时间锚点")
    expect(result.find((item) => item.category === "时间承接")?.details?.join("\n")).toContain("章内时间跨度")
    expect(result.find((item) => item.category === "时间承接")?.details?.join("\n")).toContain("与上章时间差")
  })

  it("缺少必须覆盖节点和本章禁区应返回错误", () => {
    const content = getChapterOutlineTemplate(1, "账号交接")
      .replace(/## 执行约束[\s\S]*?(?=\n\n## 人物状态)/, "")
    const result = runChapterOutlineQualityCheck(content)

    expect(result.find((item) => item.category === "执行约束")?.status).toBe("error")
    expect(result.find((item) => item.category === "执行约束")?.details?.join("\n")).toContain("必须覆盖节点")
    expect(result.find((item) => item.category === "执行约束")?.details?.join("\n")).toContain("本章禁区")
  })

  it("能识别章纲和当前状态", () => {
    const content = getChapterOutlineTemplate(12, "反转")

    expect(isLikelyChapterOutline(content, "章纲-第012章.md")).toBe(true)
    expect(extractChapterOutlineStatus(content)).toBe("草稿")
    expect(extractChapterOutlineStatus(content.replace("当前状态：草稿", "当前状态：已确认"))).toBe("已确认")
  })

})
