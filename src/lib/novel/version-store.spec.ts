import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildVersionDir,
  buildVersionFileName,
  shortHash,
  parseVersionFileName,
  MERGE_WINDOW_MS,
  saveVersion,
} from "./version-store"

// vi.mock 是文件级的，但上面 5 个纯函数测试不碰 fs，所以 mock 无害；
// 每个用例前后用 clearAllMocks 保证互不干扰。
const fsMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  listDirectory: vi.fn(),
  deleteFile: vi.fn(),
  fileExists: vi.fn(),
  createDirectory: vi.fn(),
}))
vi.mock("@/commands/fs", () => fsMocks)

describe("版本文件名", () => {
  it("短哈希取 4 位，稳定可复现", () => {
    expect(shortHash("hello")).toBe(shortHash("hello"))
    expect(shortHash("hello")).toHaveLength(4)
    expect(shortHash("hello")).not.toBe(shortHash("hello!"))
  })

  it("文件名带时间戳和哈希，同秒两次保存不会互相覆盖", () => {
    const at = new Date(2026, 9, 26, 9, 0, 0) // 本地时间 2026-10-26 09:00:00
    const a = buildVersionFileName(at, "内容一")
    const b = buildVersionFileName(at, "内容二")
    expect(a).toMatch(/^20261026-090000-[0-9a-f]{4}\.md$/)
    expect(a).not.toBe(b)
  })

  it("能从文件名反解出时间", () => {
    const parsed = parseVersionFileName("20261026-090000-1c4d.md")
    expect(parsed).not.toBeNull()
    expect(parsed!.hash).toBe("1c4d")
    expect(parsed!.at.getFullYear()).toBe(2026)
    expect(parsed!.at.getMonth()).toBe(9) // 10 月
    expect(parsed!.at.getDate()).toBe(26)
    expect(parsed!.at.getHours()).toBe(9)
    expect(parsed!.at.getMinutes()).toBe(0)
  })

  it("不认识的乱文件名返回 null，不让界面崩", () => {
    expect(parseVersionFileName("README.md")).toBeNull()
    expect(parseVersionFileName("20261026-090000.md")).toBeNull()
    expect(parseVersionFileName("20261026-090000-zzzz.md")).toBeNull()
  })

  it("章节目录按编号补零；大纲目录用文件名并阻止越界", () => {
    expect(buildVersionDir("/书", "chapter", 7)).toBe("/书/.qmai/versions/chapters/007")
    expect(buildVersionDir("/书", "chapter", null)).toBe("/书/.qmai/versions/chapters/unnumbered")
    expect(buildVersionDir("/书", "outline", "总纲")).toBe("/书/.qmai/versions/outlines/总纲")
    // 路径分隔符必须被替换掉，否则会跳出版本库目录
    expect(buildVersionDir("/书", "outline", "../逃逸")).not.toContain("../")
  })
})

describe("写入版本", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.createDirectory.mockResolvedValue(undefined)
    fsMocks.writeFile.mockResolvedValue(undefined)
    fsMocks.deleteFile.mockResolvedValue(undefined)
    fsMocks.listDirectory.mockResolvedValue([])
    fsMocks.readFile.mockResolvedValue("")
  })

  it("30 秒窗口常量是 30 秒", () => {
    expect(MERGE_WINDOW_MS).toBe(30_000)
  })

  it("空白内容不落版本（新建章节第一步不能把空文件存成历史）", async () => {
    const outcome = await saveVersion({ projectPath: "/书", kind: "chapter", key: 2, content: "   " })
    expect(outcome.saved).toBe(false)
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
    expect(fsMocks.createDirectory).not.toHaveBeenCalled()
  })

  it("内容没变就不写新版本（敲个空格不该刷一条）", async () => {
    const fileName = "20261026-090000-aaaa.md"
    fsMocks.listDirectory.mockResolvedValue([{ name: fileName, path: `/书/.qmai/versions/chapters/001/${fileName}`, is_dir: false }])
    fsMocks.readFile.mockResolvedValue("正文")

    const outcome = await saveVersion({ projectPath: "/书", kind: "chapter", key: 1, content: "正文", at: new Date(2026, 9, 26, 9, 5, 0) })
    expect(outcome.saved).toBe(false)
    expect(fsMocks.writeFile).not.toHaveBeenCalled()
  })

  it("30 秒内的连续保存只留最后一条", async () => {
    const fileName = "20261026-090000-aaaa.md"
    fsMocks.listDirectory.mockResolvedValue([{ name: fileName, path: `/书/.qmai/versions/chapters/001/${fileName}`, is_dir: false }])
    fsMocks.readFile.mockResolvedValue("旧正文")

    const outcome = await saveVersion({
      projectPath: "/书", kind: "chapter", key: 1, content: "改过的正文",
      at: new Date(2026, 9, 26, 9, 0, 20),
    })
    expect(outcome.saved).toBe(true)
    expect(outcome.replaced).toBe(fileName)
    expect(fsMocks.writeFile).toHaveBeenCalledTimes(1)
    expect(fsMocks.deleteFile).toHaveBeenCalledWith(`/书/.qmai/versions/chapters/001/${fileName}`)
  })

  it("超过 30 秒的新内容会新增一条，不合并", async () => {
    const fileName = "20261026-090000-aaaa.md"
    fsMocks.listDirectory.mockResolvedValue([{ name: fileName, path: `/书/.qmai/versions/chapters/001/${fileName}`, is_dir: false }])
    fsMocks.readFile.mockResolvedValue("旧正文")

    const outcome = await saveVersion({
      projectPath: "/书", kind: "chapter", key: 1, content: "新内容",
      at: new Date(2026, 9, 26, 9, 5, 0),
    })
    expect(outcome.saved).toBe(true)
    expect(outcome.replaced).toBeUndefined()
    expect(fsMocks.deleteFile).not.toHaveBeenCalled()
  })

  it("写入路径落在版本库里，文件名带时间戳和哈希", async () => {
    const outcome = await saveVersion({
      projectPath: "/书", kind: "outline", key: "总纲", content: "大纲正文",
      at: new Date(2026, 9, 26, 9, 0, 0),
    })
    expect(outcome.saved).toBe(true)
    expect(outcome.path).toMatch(/^\/书\/\.qmai\/versions\/outlines\/总纲\/20261026-090000-[0-9a-f]{4}\.md$/)
  })

  it("目录不存在（列目录抛错）时仍然能写入第一条版本", async () => {
    fsMocks.listDirectory.mockRejectedValue(new Error("ENOENT"))
    const outcome = await saveVersion({ projectPath: "/书", kind: "chapter", key: 3, content: "第一版" })
    expect(outcome.saved).toBe(true)
    expect(fsMocks.createDirectory).toHaveBeenCalled()
  })
})
