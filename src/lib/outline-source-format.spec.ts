import { describe, expect, it } from "vitest"
import { applyOutlineSourceFormat, outlineExtensionHtml } from "./outline-source-format"

describe("outline source format", () => {
  it("writes the seven annotation formats as source text", () => {
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "color", { color: "#112233" }).text).toContain("color:#112233")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "color", { color: "red" }).text).toContain("color:#b42318")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "underline").text).toBe("<u>甲</u>乙")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "highlight").text).toBe("==甲==乙")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "align", { align: "center" }).text).toContain('text-align:center')
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "footnote", { note: "伏笔" }).text).toContain("[^1]: 伏笔")
    expect(applyOutlineSourceFormat("甲[^1]\n\n[^1]: 旧", 0, 1, "footnote", { note: "新" }).text).toContain("[^2]: 新")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "superscript").text).toBe("<sup>甲</sup>乙")
    expect(applyOutlineSourceFormat("甲乙", 0, 1, "subscript").text).toBe("<sub>甲</sub>乙")
  })

  it("keeps math and mermaid as source instead of editor nodes", () => {
    expect(applyOutlineSourceFormat("甲", 0, 1, "math").text).toBe("$甲$")
    expect(applyOutlineSourceFormat("甲", 1, 1, "mermaid").text).toContain("```mermaid")
  })

  it("renders only the allowlisted annotation markup", () => {
    const html = outlineExtensionHtml('<span style="color:#112233">甲</span><u>乙</u>==丙==<p style="text-align:right">丁</p><sup>戊</sup><sub>己</sub><script>alert(1)</script><span onclick="bad">庚</span>')
    expect(html).toContain("⟨color:#112233⟩")
    expect(html).toContain("⟨u⟩乙⟨/u⟩⟨mark⟩丙⟨/mark⟩")
    expect(html).toContain("⟨align:right⟩")
    expect(html).toContain("⟨sup⟩戊⟨/sup⟩⟨sub⟩己⟨/sub⟩")
    expect(html).not.toContain("<script>")
    expect(html).not.toContain("onclick")
  })
})
