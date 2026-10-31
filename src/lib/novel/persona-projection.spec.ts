import { describe, expect, it } from "vitest"
import { PROJECTION_GENERATED_BY, isGeneratedProjection, renderPersonaTableMarkdown } from "./persona-projection"

describe("renderPersonaTableMarkdown", () => {
  it("把档案字段投影成表格，并带 generated-from 标记", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "林清越", roleType: "男主", personaId: "林清越",
      generatedAt: "2026-10-30T13:58:00+08:00",
      fields: { 性别: "男", 年龄: "二十四", 势力组织: "青云宗" },
    })
    expect(md).toContain(`generated-from: ${PROJECTION_GENERATED_BY}`)
    expect(md).toContain("persona-id: 林清越")
    expect(md).toContain("| 字段 | 内容 |")
    expect(md).toContain("| 性别 | 男 |")
  })

  it("多行内容压成一行，裸竖线被转义，不撑破表格", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "沈砚", roleType: "反派", personaId: "沈砚",
      generatedAt: "2026-10-30T13:58:00+08:00",
      fields: { 背景: "第一行\n第二行\n| 有竖线 |" },
    })
    const row = md.split("\n").find((line) => line.startsWith("| 背景 |"))
    expect(row).toBeDefined()
    // 换行必须被压掉：否则一行会裂成两段，整张表就散了
    expect(row).not.toContain("\n")
    expect(row).toContain("第一行 第二行")
    // 内容里的竖线必须被转义成 \|，不能被当成列分隔符
    expect(row).toContain("\\|")
    // 未被转义的竖线只有首尾两个表框符：即整行恰好是三格、四段
    const unescaped = row!.replace(/\\\|/g, "")
    expect(unescaped.split("|").length).toBe(4)
  })

  it("空字段不出行", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "陆云飞", roleType: "男配", personaId: "陆云飞",
      generatedAt: "2026-10-30T13:58:00+08:00", fields: { 性别: "", 年龄: "三十" },
    })
    expect(md).not.toContain("| 性别 |")
    expect(md).toContain("| 年龄 | 三十 |")
  })

  it("isGeneratedProjection 只认带标记的文件", () => {
    expect(isGeneratedProjection("---\ngenerated-from: persona-skill\n---\n")).toBe(true)
    expect(isGeneratedProjection("# 林清越\n\n用户自己写的\n")).toBe(false)
  })
})

describe("投影 MD 的反向引用", () => {
  it("把 outlineRefs 写进 frontmatter，从人物小传能看到它被哪些大纲引用", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "林清越", roleType: "男主", personaId: "林清越",
      generatedAt: "2026-10-30T13:58:00+08:00",
      fields: { 性别: "男" },
      outlineRefs: ["卷纲-第一卷.md", "章纲-第3章.md"],
    })
    expect(md).toContain("outline-refs:")
    expect(md).toContain("卷纲-第一卷.md")
    expect(md).toContain("章纲-第3章.md")
  })

  it("没有引用时不写空的 outline-refs 行", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "沈砚", roleType: "反派", personaId: "沈砚",
      generatedAt: "2026-10-30T13:58:00+08:00", fields: {}, outlineRefs: [],
    })
    expect(md).not.toContain("outline-refs:")
  })

  it("引用里的逗号与引号不会破坏 frontmatter 形状", () => {
    const md = renderPersonaTableMarkdown({
      characterName: "A", roleType: "", personaId: "A",
      generatedAt: "2026-10-30T13:58:00+08:00", fields: {},
      outlineRefs: ['奇怪,名字.md', '带"引号".md'],
    })
    const line = md.split("\n").find((item) => item.startsWith("outline-refs:"))!
    // 用 JSON 数组表达，避免逗号/引号把 YAML 解析撕开
    expect(() => JSON.parse(line.slice("outline-refs:".length).trim())).not.toThrow()
  })
})