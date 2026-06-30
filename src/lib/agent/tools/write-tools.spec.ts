import { describe, expect, it, vi, beforeEach } from "vitest"
import { createWriteChapterTool } from "./write-chapter"
import { createWriteMemoryTool } from "./write-memory"
import { createApplySkillTool } from "./apply-skill"

vi.mock("@/commands/fs", () => ({ writeFile: vi.fn() }))
vi.mock("@/lib/novel/de-ai-skill-library", () => ({
  getAllDeAiSkills: vi.fn(),
}))

import { writeFile } from "@/commands/fs"
import { getAllDeAiSkills } from "@/lib/novel/de-ai-skill-library"

describe("write tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("write_chapter writes content to chapters dir", async () => {
    vi.mocked(writeFile).mockResolvedValue()
    const tool = createWriteChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章", content: "chapter body" })
    expect(result).toContain("已写入")
    expect(writeFile).toHaveBeenCalledWith("/project/wiki/chapters/第1章.md", "chapter body")
  })

  it("write_chapter reports error on failure", async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error("permission denied"))
    const tool = createWriteChapterTool("/project/wiki/chapters")
    const result = await tool.execute({ name: "第1章", content: "x" })
    expect(result).toContain("错误")
  })

  it("write_memory writes to memory dir", async () => {
    vi.mocked(writeFile).mockResolvedValue()
    const tool = createWriteMemoryTool("/project/wiki/memory")
    await tool.execute({ name: "曙光", content: "desc" })
    expect(writeFile).toHaveBeenCalledWith("/project/wiki/memory/曙光.md", "desc")
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
})
