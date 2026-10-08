// 注：`SOUL_DOC_FILENAME` 的具名导出已在 01aab5f（refactor(cleanup): 收口测试专用旧模块和未使用导出）
// 中被移除——该提交判定「只有测试在用」的导出属于未使用导出，把 `export const SOUL_DOC_FILENAME`
// 降级为 soul-doc.ts 内的私有常量。常量本身仍然存在（值仍为 "soul.md"，仍被 readSoulDoc /
// writeSoulDoc 使用），但已没有可导入的等价替代物，故此处改为通过公开 API 的行为断言来验证同一事实，
// 断言强度不降低（filename 精确相等，而非存在性判断）。
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readSoulDoc, writeSoulDoc } from "./soul-doc"
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
  it("should be soul.md", async () => {
    mockReadFile.mockResolvedValueOnce("")
    await readSoulDoc("/project/path")
    expect(mockReadFile).toHaveBeenCalledWith("/project/path/soul.md")

    await writeSoulDoc("/project/path", "content")
    expect(mockWriteFileAtomic).toHaveBeenCalledWith("/project/path/soul.md", "content")
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