import { describe, it, expect, vi, beforeEach } from "vitest"
import { readSoulDoc, writeSoulDoc, SOUL_DOC_FILENAME } from "./soul-doc"
import * as fs from "@/commands/fs"

vi.mock("@/commands/fs", () => ({
  readFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}))

const mockReadFile = vi.mocked(fs.readFile)
const mockWriteFileAtomic = vi.mocked(fs.writeFileAtomic)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("SOUL_DOC_FILENAME", () => {
  it("should be soul.md", () => {
    expect(SOUL_DOC_FILENAME).toBe("soul.md")
  })
})

describe("readSoulDoc", () => {
  it("should read soul.md from project root", async () => {
    mockReadFile.mockResolvedValueOnce("# 项目灵魂\n\n幽默风趣，快节奏叙事")
    const result = await readSoulDoc("/project/path")
    expect(mockReadFile).toHaveBeenCalledWith("/project/path/soul.md")
    expect(result).toBe("# 项目灵魂\n\n幽默风趣，快节奏叙事")
  })

  it("should return empty string when file does not exist", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"))
    const result = await readSoulDoc("/project/path")
    expect(result).toBe("")
  })

  it("should return empty string for other errors", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("Permission denied"))
    const result = await readSoulDoc("/project/path")
    expect(result).toBe("")
  })
})

describe("writeSoulDoc", () => {
  it("should write content to soul.md atomically", async () => {
    await writeSoulDoc("/project/path", "简洁克制的古典风格")
    expect(mockWriteFileAtomic).toHaveBeenCalledWith(
      "/project/path/soul.md",
      "简洁克制的古典风格"
    )
  })

  it("should propagate write errors", async () => {
    mockWriteFileAtomic.mockRejectedValueOnce(new Error("Disk full"))
    await expect(writeSoulDoc("/project/path", "content")).rejects.toThrow("Disk full")
  })
})