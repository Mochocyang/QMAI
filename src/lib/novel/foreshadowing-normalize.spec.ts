import { describe, expect, it } from "vitest"
import {
  findForeshadowingByNormalizedName,
  isActiveForeshadowingStatus,
  normalizeForeshadowingName,
  parseForeshadowingChange,
} from "./foreshadowing-normalize"

describe("parseForeshadowingChange", () => {
  it("parses full-width and half-width colons", () => {
    const full = parseForeshadowingChange("新增：苏式来源疑云成为美苏双方追查的核心伏笔。")
    expect(full?.kind).toBe("plant")
    expect(full?.name).toBeTruthy()

    const half = parseForeshadowingChange("新增:外部人员可能通过车辙追踪苏式阵地")
    expect(half?.kind).toBe("plant")
  })

  it("parses with and without 伏笔 suffix", () => {
    const withWord = parseForeshadowingChange("推进伏笔：灰门仍未断")
    expect(withWord?.kind).toBe("advance")
    expect(withWord?.name).toContain("灰门")

    const without = parseForeshadowingChange("推进：世界敌意值上升")
    expect(without?.kind).toBe("advance")
  })

  it("parses resolve prefixes", () => {
    const a = parseForeshadowingChange("回收伏笔：莱拉的真实本质")
    expect(a?.kind).toBe("resolve")
    const b = parseForeshadowingChange("回收：苏式来源疑云")
    expect(b?.kind).toBe("resolve")
  })

  it("treats no-prefix lines as advance instead of dropping", () => {
    const parsed = parseForeshadowingChange(
      "底格里斯神经一期建设启动，为后续战场指挥融合埋下伏笔。",
    )
    expect(parsed?.kind).toBe("advance")
    expect(parsed?.name).toBeTruthy()
  })

  it("returns null for empty input", () => {
    expect(parseForeshadowingChange("   ")).toBeNull()
  })
})

describe("normalizeForeshadowingName", () => {
  it("prefers quoted names", () => {
    const { name } = normalizeForeshadowingName('推进伏笔：代号“灰门”与旧网联络链浮出水面')
    expect(name).toBe("灰门")
  })

  it("truncates long names to 18 chars", () => {
    const long =
      "科威特措辞与经贸附件适用范围待元首会谈前外交渠道正式答复并且还要继续写很长很长"
    const { name } = normalizeForeshadowingName(`新增伏笔：${long}`)
    expect(name.length).toBeLessThanOrEqual(18)
  })

  it("splits on keyword or punctuation for name/description", () => {
    const { name, description } = normalizeForeshadowingName(
      "新增伏笔：世界敌意值上升，预示非常规渗透事件即将触发",
    )
    // keyword split on「预示」wins before punctuation cleanup
    expect(name.startsWith("世界敌意值上升")).toBe(true)
    expect(name.length).toBeLessThanOrEqual(18)
    expect(description.length).toBeGreaterThan(name.length)
  })
})

describe("findForeshadowingByNormalizedName", () => {
  const items = [
    { id: "1", name: "世界敌意值上升" },
    { id: "2", name: "灰门" },
    { id: "3", name: "短" },
  ]

  it("matches exact name", () => {
    expect(findForeshadowingByNormalizedName(items, "灰门")?.id).toBe("2")
  })

  it("matches prefix when both names are long enough", () => {
    expect(findForeshadowingByNormalizedName(items, "世界敌意值上升预示")?.id).toBe("1")
  })

  it("does not use short bidirectional includes", () => {
    expect(findForeshadowingByNormalizedName(items, "短名扩展很多字")).toBeUndefined()
  })
})

describe("isActiveForeshadowingStatus", () => {
  it("excludes resolved and abandoned", () => {
    expect(isActiveForeshadowingStatus("planted")).toBe(true)
    expect(isActiveForeshadowingStatus("advanced")).toBe(true)
    expect(isActiveForeshadowingStatus("resolved")).toBe(false)
    expect(isActiveForeshadowingStatus("abandoned")).toBe(false)
  })
})
