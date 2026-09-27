import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  createDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}))

import { createDirectory, deleteFile, fileExists, readFile, writeFile } from "@/commands/fs"
import {
  buildChapterOutlineResumePrompt,
  clearChapterOutlineDraft,
  readChapterOutlineDraft,
  writeChapterOutlineDraft,
  type ChapterOutlineDraft,
} from "./chapter-outline-draft"
import { normalizeChapterOutlineData } from "./chapter-outline-template"

const PROJECT = "/book"
const DRAFT_PATH = "/book/.qmai/章纲草稿.json"

function chapterData(from: number, to: number, range = "第 1–10 章") {
  const data = normalizeChapterOutlineData({
    title: "故事一 雨夜无我 · 章纲",
    story: { index: 1, name: "雨夜无我", range, beats: "平升起紧落缓升紧顶缓顶悬" },
    words: 30000,
    chapters: Array.from({ length: to - from + 1 }, (_, index) => ({
      n: from + index,
      title: `第${from + index}章`,
      info: { words: "约 2500 字" },
    })),
  })
  if (!data) throw new Error("构造章纲数据失败")
  return data
}

function draftWith(from: number, to: number, conversationId = "c1"): ChapterOutlineDraft {
  return {
    conversationId,
    title: "故事一 雨夜无我 · 章纲",
    batches: [{ data: chapterData(from, to), md: "# 章纲-第01–10章\n\n## 第1章" }],
    updatedAt: 1,
  }
}

describe("chapter-outline-draft", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fileExists).mockResolvedValue(false)
  })

  it("写入后可原样读回（含本批 MD 与章数）", async () => {
    const draft = draftWith(1, 3)
    const serialized = JSON.stringify(draft, null, 2)
    await writeChapterOutlineDraft(PROJECT, draft)

    expect(vi.mocked(createDirectory)).toHaveBeenCalledWith("/book/.qmai")
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(DRAFT_PATH, serialized)

    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(readFile).mockResolvedValue(serialized)
    const restored = await readChapterOutlineDraft(PROJECT)

    expect(restored?.conversationId).toBe("c1")
    expect(restored?.batches).toHaveLength(1)
    expect(restored?.batches[0].data.chapters).toHaveLength(3)
    expect(restored?.batches[0].md).toContain("第1章")
  })

  it("文件不存在 / 路径为空 / 内容损坏时返回 null", async () => {
    expect(await readChapterOutlineDraft(PROJECT)).toBeNull()
    expect(await readChapterOutlineDraft(null)).toBeNull()

    vi.mocked(fileExists).mockResolvedValue(true)
    vi.mocked(readFile).mockResolvedValue("{ 不是 JSON")
    expect(await readChapterOutlineDraft(PROJECT)).toBeNull()

    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ conversationId: "", batches: [] }))
    expect(await readChapterOutlineDraft(PROJECT)).toBeNull()
  })

  it("草稿未完成时给出下一批提示词，已覆盖全部批次时返回 null", () => {
    expect(buildChapterOutlineResumePrompt(draftWith(1, 3))).toContain("继续生成章纲的第 4–6 章")
    expect(buildChapterOutlineResumePrompt(draftWith(1, 10))).toBeNull()
    expect(buildChapterOutlineResumePrompt({ ...draftWith(1, 3), batches: [] })).toBeNull()
  })

  it("清理草稿只在文件存在时删除", async () => {
    await clearChapterOutlineDraft(PROJECT)
    expect(vi.mocked(deleteFile)).not.toHaveBeenCalled()

    vi.mocked(fileExists).mockResolvedValue(true)
    await clearChapterOutlineDraft(PROJECT)
    expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(DRAFT_PATH)
  })
})