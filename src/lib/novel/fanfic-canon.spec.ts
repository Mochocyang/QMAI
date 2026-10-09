import { describe, expect, it } from "vitest"
import {
  FANFIC_REFERENCE_SCOPE_NOTE,
  FANFIC_WRITING_RULES,
  buildFanficCanonDocument,
  buildFanficCanonChunkPrompt,
  buildFanficCanonMergePrompt,
  fanficCanonPath,
  formatFanficModeLabel,
  getFanficModeRequirement,
  parseFanficCanonMeta,
  splitFanficSourceMaterial,
  stripFanficCanonFrontmatter,
} from "./fanfic-canon"

const baseDoc = () =>
  buildFanficCanonDocument({
    mode: "au",
    sourceName: "斗破苍穹",
    allowedDeviations: ["时间线整体后移十年"],
    canonBody: "## 世界观\n\n- 斗气大陆，斗气分九段。",
    sourceChars: 12345,
    chunkCount: 1,
    compiledAt: "2026-10-09T00:00:00.000Z",
  })

describe("fanfic canon document", () => {
  it("落盘路径固定在 .novel/fanfic-canon.md，与项目既有资产同构", () => {
    expect(fanficCanonPath("E:/Novel")).toBe("E:/Novel/.novel/fanfic-canon.md")
    expect(fanficCanonPath("E:\\Novel\\")).toBe("E:/Novel/.novel/fanfic-canon.md")
  })

  it("写入模式、原作、容许偏离与六条硬规则", () => {
    const doc = baseDoc()
    expect(doc).toContain('fanfic_mode: "au"')
    expect(doc).toContain('source_name: "斗破苍穹"')
    expect(doc).toContain('  - "时间线整体后移十年"')
    expect(doc).toContain("# 同人正典（斗破苍穹）")
    expect(doc).toContain("架空世界（au）")
    for (const rule of FANFIC_WRITING_RULES) {
      expect(doc).toContain(rule)
    }
  })

  it("容许偏离为空时明确写出「无」，避免模型误以为可以随意改", () => {
    const doc = buildFanficCanonDocument({
      mode: "canon",
      sourceName: "X",
      canonBody: "body",
      sourceChars: 1,
      chunkCount: 1,
    })
    expect(doc).toContain("容许偏离：无（除所选模式本身外，一切按原作正典处理）")
  })

  it("compiled 省略时按分片数推导", () => {
    const single = buildFanficCanonDocument({
      mode: "canon",
      sourceName: "X",
      canonBody: "b",
      sourceChars: 10,
      chunkCount: 1,
    })
    const multi = buildFanficCanonDocument({
      mode: "canon",
      sourceName: "X",
      canonBody: "b",
      sourceChars: 10,
      chunkCount: 3,
    })
    expect(single).toContain("compiled: false")
    expect(multi).toContain("compiled: true")
    expect(multi).toContain("chunk_count: 3")
  })

  it("书名号/冒号/引号不会破坏 frontmatter", () => {
    const doc = buildFanficCanonDocument({
      mode: "canon",
      sourceName: '《A: "B" #C》',
      canonBody: "b",
      sourceChars: 1,
      chunkCount: 1,
    })
    expect(parseFanficCanonMeta(doc)?.sourceName).toBe('《A: "B" #C》')
  })
})

describe("fanfic canon meta round-trip", () => {
  it("回读出模式、原作、偏离、编译信息", () => {
    const meta = parseFanficCanonMeta(baseDoc())
    expect(meta).not.toBeNull()
    expect(meta!.mode).toBe("au")
    expect(meta!.sourceName).toBe("斗破苍穹")
    expect(meta!.allowedDeviations).toEqual(["时间线整体后移十年"])
    expect(meta!.sourceChars).toBe(12345)
    expect(meta!.chunkCount).toBe(1)
    expect(meta!.compiled).toBe(false)
    expect(meta!.compiledAt).toBe("2026-10-09T00:00:00.000Z")
  })

  it("容忍用户手改成行内数组", () => {
    const doc = baseDoc().replace(
      'allowed_deviations:\n  - "时间线整体后移十年"',
      'allowed_deviations: ["改了结局", "换视角"]',
    )
    expect(parseFanficCanonMeta(doc)?.allowedDeviations).toEqual(["改了结局", "换视角"])
  })

  it("容许偏离为空时回读出空数组", () => {
    const doc = buildFanficCanonDocument({
      mode: "canon",
      sourceName: "X",
      canonBody: "b",
      sourceChars: 1,
      chunkCount: 1,
    })
    expect(parseFanficCanonMeta(doc)?.allowedDeviations).toEqual([])
  })

  it("没有 frontmatter 时返回 null 而不是抛错", () => {
    expect(parseFanficCanonMeta("# 随便一份 markdown")).toBeNull()
  })

  it("缺 fanfic_mode 时返回 null，避免把普通文档当成同人正典", () => {
    expect(parseFanficCanonMeta('---\nsource_name: "X"\n---\nbody')).toBeNull()
  })

  it("去除 frontmatter 后得到可注入的正文", () => {
    const body = stripFanficCanonFrontmatter(baseDoc())
    expect(body.startsWith("# 同人正典（斗破苍穹）")).toBe(true)
    expect(body).not.toContain("fanfic_mode:")
  })

  it("写明与参考拆文的分工，避免两套相反规则同时生效", () => {
    const doc = baseDoc()

    expect(doc).toContain("## 与「参考拆文」的分工")
    // 参考拆文规则只约束范本作品，不包括本作原作
    expect(doc).toContain("不包括本作原作")
    // 本作原作的既成事实必须沿用
    expect(doc).toContain("既成事实必须沿用")
    // 但抄录原句仍然禁止
    expect(doc).toContain("禁止抄录原作语句")
    expect(stripFanficCanonFrontmatter(doc)).toContain(FANFIC_REFERENCE_SCOPE_NOTE)
  })
})

describe("fanfic mode labels", () => {
  it("内置模式渲染成中文标签加 key", () => {
    expect(formatFanficModeLabel("canon")).toBe("正典延续（canon）")
    expect(formatFanficModeLabel("au")).toBe("架空世界（au）")
    expect(formatFanficModeLabel("ooc")).toBe("性格重塑（ooc）")
    expect(formatFanficModeLabel("cp")).toBe("CP 向（cp）")
  })

  it("自定义模式原样保留，允许一句话边界", () => {
    const custom = "原作结局十年后的低魔日后谈"
    expect(formatFanficModeLabel(custom)).toBe(custom)
    expect(getFanficModeRequirement(custom)).toBe("")
  })

  it("每个内置模式都有必须交代的事项", () => {
    for (const mode of ["canon", "au", "ooc", "cp"]) {
      expect(getFanficModeRequirement(mode)).not.toBe("")
    }
  })

  it("空模式渲染为空串，便于上游判断未填", () => {
    expect(formatFanficModeLabel("   ")).toBe("")
  })
})

describe("splitFanficSourceMaterial", () => {
  it("短素材不切分", () => {
    expect(splitFanficSourceMaterial("短素材", 100)).toEqual(["短素材"])
  })

  it("空素材返回空数组", () => {
    expect(splitFanficSourceMaterial("   ")).toEqual([])
  })

  it("按段落边界切分，不切开段落", () => {
    const paragraphs = ["A".repeat(40), "B".repeat(40), "C".repeat(40)]
    const chunks = splitFanficSourceMaterial(paragraphs.join("\n\n"), 60)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // 每个分片内部应是若干完整段落，不出现被劈开的半段
      for (const part of chunk.split("\n\n")) {
        expect(paragraphs).toContain(part)
      }
    }
    expect(chunks.join("\n\n").replace(/\s+/g, "")).toBe(paragraphs.join("").replace(/\s+/g, ""))
  })

  it("单段落超限时硬切成不超限的分片", () => {
    const chunks = splitFanficSourceMaterial("X".repeat(250), 100)
    expect(chunks).toHaveLength(3)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(100)
  })

  it("分片后内容不丢失", () => {
    const text = Array.from({ length: 20 }, (_, i) => `第${i}段内容`.repeat(6)).join("\n\n")
    const chunks = splitFanficSourceMaterial(text, 120)
    expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""))
  })
})

describe("canon compile prompts", () => {
  it("分片提示词要求只保留有证据的内容", () => {
    const messages = buildFanficCanonChunkPrompt({
      sourceName: "X",
      mode: "au",
      chunk: "原文",
      index: 0,
      total: 1,
    })
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toContain("有明确证据")
    expect(messages[0].content).toContain("不要推测")
    expect(messages[0].content).toContain("不要发明原作里不存在的")
    expect(String(messages[1].content)).toContain("片段：1/1")
    expect(String(messages[1].content)).toContain("架空世界（au）")
  })

  it("分片提示词带出该模式的必须交代事项", () => {
    const messages = buildFanficCanonChunkPrompt({
      sourceName: "X",
      mode: "ooc",
      chunk: "原文",
      index: 1,
      total: 3,
    })
    expect(String(messages[1].content)).toContain("片段：2/3")
    expect(String(messages[1].content)).toContain(getFanficModeRequirement("ooc"))
  })

  it("合并提示词要求冲突时留证据更充分的一条", () => {
    const messages = buildFanficCanonMergePrompt({
      sourceName: "X",
      mode: "canon",
      allowedDeviations: ["改了结局"],
      chunkNotes: ["### 片段 1/2\n\nA", "### 片段 2/2\n\nB"],
    })
    expect(messages[0].content).toContain("冲突时保留证据更充分的一条")
    expect(String(messages[1].content)).toContain("容许偏离：改了结局")
    expect(String(messages[1].content)).toContain("片段 2/2")
  })
})
