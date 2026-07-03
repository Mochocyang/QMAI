import { describe, expect, it, vi, beforeEach } from "vitest"
import { createWriteChapterTool } from "./write-chapter"
import { createWriteMemoryTool } from "./write-memory"
import { createApplySkillTool } from "./apply-skill"

vi.mock("@/commands/fs", () => ({ readFile: vi.fn(), writeFile: vi.fn(), fileExists: vi.fn(), createDirectory: vi.fn() }))
vi.mock("@/lib/novel/de-ai-skill-library", () => ({
  getAllDeAiSkills: vi.fn(),
}))

import { readFile, writeFile, fileExists, createDirectory } from "@/commands/fs"
import { getAllDeAiSkills } from "@/lib/novel/de-ai-skill-library"

describe("write tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(createDirectory).mockResolvedValue()
  })

  it("write_chapter writes content to chapters dir", async () => {
    vi.mocked(writeFile).mockResolvedValue()
    vi.mocked(readFile).mockResolvedValue("chapter body")
    const tool = createWriteChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章", content: "chapter body" })
    expect(result).toContain("已写入")
    expect(result).toContain("读回验证通过")
    expect(writeFile).toHaveBeenCalledWith("/project/wiki/chapters/第1章.md", "chapter body")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/chapters/第1章.md")
  })

  it("write_chapter reports error on failure", async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error("permission denied"))
    const tool = createWriteChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章", content: "x" })
    expect(result).toContain("错误")
  })

  it("write_memory writes to memory dir", async () => {
    vi.mocked(writeFile).mockResolvedValue()
    vi.mocked(readFile).mockResolvedValue("desc")
    const tool = createWriteMemoryTool("/project/wiki/memory")
    const result = await tool.execute({ name: "曙光", content: "desc" })
    expect(writeFile).toHaveBeenCalledWith("/project/wiki/memory/曙光.md", "desc")
    expect(readFile).toHaveBeenCalledWith("/project/wiki/memory/曙光.md")
    expect(result).toContain("读回验证通过")
  })

  it("write tools report verification failures after writing", async () => {
    vi.mocked(writeFile).mockResolvedValue()
    vi.mocked(readFile).mockResolvedValue("different content")
    const tool = createWriteChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章", content: "chapter body" })
    expect(result).toContain("警告：写入后读回验证失败")
  })

  it("apply_skill returns skill content", async () => {
    vi.mocked(getAllDeAiSkills).mockReturnValue([
      { id: "s1", name: "去AI味", content: "skill content text" },
    ] as any)
    const tool = createApplySkillTool(() => ({ defaultSkillId: "s1", projectSkills: [], builtInSkillOverrides: [], disabledSkillIds: [], version: 1, lastChapterDeAiSkillId: null }) as any)
    const result = await tool.execute({ skillName: "去AI味" })
    expect(result).toContain("skill content text")
  })

  it("apply_skill reports error for unknown skill", async () => {
    vi.mocked(getAllDeAiSkills).mockReturnValue([])
    const tool = createApplySkillTool(() => ({ defaultSkillId: "", projectSkills: [], builtInSkillOverrides: [], disabledSkillIds: [], version: 1, lastChapterDeAiSkillId: null }) as any)
    const result = await tool.execute({ skillName: "unknown" })
    expect(result).toContain("未找到")
  })

  it("apply_skill can return generic user skill content", async () => {
    vi.mocked(getAllDeAiSkills).mockReturnValue([])
    const tool = createApplySkillTool(
      () => null,
      () => [
        {
          id: "project:three-four",
          name: "三翻四抖",
          description: "",
          kind: ["structure"],
          stages: ["drafting"],
          modes: ["standard"],
          content: "三次转折，四次震惊。",
          source: "project",
        },
      ] as any,
    )

    const result = await tool.execute({ skillName: "三翻四抖" })

    expect(result).toContain("三次转折，四次震惊。")
  })
})
