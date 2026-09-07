import { splitOutlineFindProtocolForCache } from "./outline-find-protocol"
import { describe, expect, it } from "vitest"
import {
  buildOutlineFindProtocol,
  formatTargetChapterLine,
  shouldIncludeOutlineFindProtocol,
  stripOutlineFindProtocol,
} from "./outline-find-protocol"

describe("outline-find-protocol", () => {
  it("includes explicit target chapter when provided", () => {
    const text = buildOutlineFindProtocol(167)
    expect(text).toContain("本次写作目标：第 167 章")
    expect(text).toContain("list_outlines")
    expect(text).toContain("优先扫 folder")
    expect(text).toContain("按文件夹分流（主路径")
    expect(text).toContain("章纲：本章主候选")
    expect(text).toContain("设定：写作硬约束")
    expect(text).toContain("兼容（非强制）")
    expect(text).toContain("overview≈大纲")
    expect(text).toContain("read_outline")
    expect(text).toContain("禁止只凭文件名")
    expect(text).toContain("必须调用 run_chapter_workflow")
    expect(text).toContain("禁止直接输出终稿正文")
    expect(text).not.toContain("再写作或调用")
    expect(text).not.toContain("先扫一遍有哪些 overview / concept / outline")
  })

  it("asks model to resolve chapter number when missing", () => {
    const text = buildOutlineFindProtocol()
    expect(text).toContain("必须先明确本次要写的目标章号")
    expect(text).not.toContain("本次写作目标：第")
  })

  it("formats target chapter line", () => {
    expect(formatTargetChapterLine(104)).toBe("本次写作目标：第 104 章。")
  })

  it("only enables protocol for chapter writing intents", () => {
    expect(shouldIncludeOutlineFindProtocol("write_chapter")).toBe(true)
    expect(shouldIncludeOutlineFindProtocol("polish_chapter")).toBe(true)
    expect(shouldIncludeOutlineFindProtocol("generate_outline")).toBe(false)
    expect(shouldIncludeOutlineFindProtocol("character_query")).toBe(false)
    expect(shouldIncludeOutlineFindProtocol(undefined)).toBe(false)
  })

  it("strips outline find protocol block without removing following sections", () => {
    const prompt = [
      "base rules",
      "",
      buildOutlineFindProtocol(10),
      "",
      "## 其它规则",
      "keep me",
    ].join("\n")
    const stripped = stripOutlineFindProtocol(prompt)
    expect(stripped).toContain("base rules")
    expect(stripped).toContain("## 其它规则")
    expect(stripped).toContain("keep me")
    expect(stripped).not.toContain("大纲定位协议")
    expect(stripped).not.toContain("list_outlines")
  })
})


describe("快速写作定位协议缓存分离", () => {
  it("仅移动定位协议，保留其后快速模式和权限要求", () => {
    const make = (chapter: number) => `固定软件规则\n${buildOutlineFindProtocol(chapter)}\n快速模式仍只输出正文。\n禁止未确认写入。`
    const first = splitOutlineFindProtocolForCache(make(1), 1)
    const second = splitOutlineFindProtocolForCache(make(2), 2)
    expect(first.stableRules).toBe(second.stableRules)
    expect(first.stableRules).toContain("快速模式仍只输出正文")
    expect(first.stableRules).toContain("禁止未确认写入")
    expect(first.stableRules).not.toContain("本次写作目标")
    expect(first.dynamicRules).toBe(buildOutlineFindProtocol(1))
    expect(second.dynamicRules).toBe(buildOutlineFindProtocol(2))
  })

  it("已由插件分离的规则不重复添加定位协议", () => {
    expect(splitOutlineFindProtocolForCache("固定规则", 2)).toEqual({ stableRules: "固定规则", dynamicRules: "" })
  })
})
