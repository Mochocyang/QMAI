import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  fileExists: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

vi.mock("@/lib/novel/outline-save-request", () => ({
  renderOutlineHtmlForPath: vi.fn(() => "<html><body>即时渲染</body></html>"),
}))

import { fileExists, readFile } from "@/commands/fs"
import { renderOutlineHtmlForPath } from "@/lib/novel/outline-save-request"
import {
  companionHtmlPath,
  documentContentMatches,
  hasCompanionHtml,
  loadReaderDocument,
  normalizeDocumentForSave,
  readDiskDocument,
  readerDocumentBaseName,
} from "@/lib/reader-window-document"

const CHAPTER = "C:/书/我的小说/wiki/chapters/第一卷/第1章 起点.md"
const OUTLINE = "C:/书/我的小说/wiki/settings/characters/主角.md"

const mockReadFile = vi.mocked(readFile)
const mockFileExists = vi.mocked(fileExists)
const mockRender = vi.mocked(renderOutlineHtmlForPath)

beforeEach(() => {
  vi.clearAllMocks()
  mockRender.mockReturnValue("<html><body>即时渲染</body></html>")
})

describe("readerDocumentBaseName", () => {
  it("去掉扩展名与目录，只留文件名", () => {
    expect(readerDocumentBaseName(CHAPTER)).toBe("第1章 起点")
    expect(readerDocumentBaseName("C:/a/b/卷纲.html")).toBe("卷纲")
  })
})

describe("companionHtmlPath", () => {
  it("md 换成同名 html", () => {
    expect(companionHtmlPath(CHAPTER)).toBe("C:/书/我的小说/wiki/chapters/第一卷/第1章 起点.html")
  })

  it("本身已是 html 时没有伴生文件", () => {
    expect(companionHtmlPath("C:/a/卷纲.html")).toBeNull()
  })
})

describe("normalizeDocumentForSave", () => {
  it("章节走规范化：正文补首行缩进", () => {
    const saved = normalizeDocumentForSave(CHAPTER, "# 第1章 起点\n\n正文")
    expect(saved).toContain("　　正文")
  })

  it("大纲原样返回，不套章节格式", () => {
    const outline = "# 主角\n\n- 性格：倔\n"
    expect(normalizeDocumentForSave(OUTLINE, outline)).toBe(outline)
  })
})

describe("documentContentMatches", () => {
  it("原文一致时直接判等", () => {
    expect(documentContentMatches(OUTLINE, "同一个字符串", "同一个字符串")).toBe(true)
  })

  it("章节排版等价（少缩进）仍算未改动", () => {
    // 关窗时必须能认出"编辑器回吐的排版不同但内容相同"，否则会白写一次盘，
    // 还会让主窗口的磁盘轮询误判成外部改动。
    expect(documentContentMatches(CHAPTER, "# 第1章 起点\n\n正文", "# 第1章 起点\n\n　　正文")).toBe(true)
  })

  it("章节正文真的变了就是改动", () => {
    expect(documentContentMatches(CHAPTER, "# 第1章 起点\n\n正文", "# 第1章 起点\n\n另一个正文")).toBe(false)
  })

  it("大纲不做排版归一：多一个字符就是改动", () => {
    expect(documentContentMatches(OUTLINE, "- 倔", "- 倔 ")).toBe(false)
  })
})

describe("readDiskDocument", () => {
  it("读不到时返回 null，不是空字符串", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))
    expect(await readDiskDocument(CHAPTER)).toBeNull()
  })
})

describe("loadReaderDocument", () => {
  it("章节：标题取正文首行，html 恒为 null", async () => {
    mockReadFile.mockResolvedValueOnce("---\ntitle: 忽略\n---\n# 第1章 起点\n\n正文")
    const doc = await loadReaderDocument("chapter", CHAPTER)
    expect(doc.heading).toBe("第1章 起点")
    expect(doc.html).toBeNull()
    expect(doc.markdown).toContain("# 第1章 起点")
  })

  it("章节：没有标题行时用文件名兜底", async () => {
    mockReadFile.mockResolvedValueOnce("正文而已")
    expect((await loadReaderDocument("chapter", CHAPTER)).heading).toBe("第1章 起点")
  })

  it("大纲：优先读同名 .html", async () => {
    mockReadFile
      .mockResolvedValueOnce("# 主角\n\n- 性格：倔") // .md
      .mockResolvedValueOnce("<html><body>磁盘上的漂亮版本</body></html>") // .html
    const doc = await loadReaderDocument("outline", OUTLINE)
    expect(doc.html).toContain("磁盘上的漂亮版本")
    expect(mockRender).not.toHaveBeenCalled()
  })

  it("大纲：伴生文件为空时退回即时渲染", async () => {
    mockReadFile
      .mockResolvedValueOnce("# 主角\n\n- 性格：倔")
      .mockResolvedValueOnce("   ")
    const doc = await loadReaderDocument("outline", OUTLINE)
    expect(doc.html).toContain("即时渲染")
    expect(mockRender).toHaveBeenCalledWith(OUTLINE, expect.any(String))
  })

  it("大纲：伴生文件读不出来（编码/占用）也不报错", async () => {
    mockReadFile
      .mockResolvedValueOnce("# 主角")
      .mockRejectedValueOnce(new Error("EBUSY"))
    const doc = await loadReaderDocument("outline", OUTLINE)
    expect(doc.html).toContain("即时渲染")
  })

  it("大纲：正文读失败要抛出去，由界面显示错误", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))
    await expect(loadReaderDocument("outline", OUTLINE)).rejects.toThrow("ENOENT")
  })
})

describe("hasCompanionHtml", () => {
  it("文件不存在为 false", async () => {
    mockFileExists.mockResolvedValueOnce(false)
    expect(await hasCompanionHtml(OUTLINE)).toBe(false)
  })

  it("空白文件也算没有", async () => {
    mockFileExists.mockResolvedValueOnce(true)
    mockReadFile.mockResolvedValueOnce("\n  \n")
    expect(await hasCompanionHtml(OUTLINE)).toBe(false)
  })

  it("有内容为 true", async () => {
    mockFileExists.mockResolvedValueOnce(true)
    mockReadFile.mockResolvedValueOnce("<html></html>")
    expect(await hasCompanionHtml(OUTLINE)).toBe(true)
  })
})
