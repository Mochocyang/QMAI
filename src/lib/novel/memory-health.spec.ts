/**
 * 记忆体检：找出「快照还在、来源文件已删」的孤儿。
 *
 * 判定口径（确定性，不调模型）：
 * - 现有快照编号来自 `.novel/snapshots`；
 * - 合法编号 = 现有章节号 ∪ 现有大纲的哈希编号（负数）；
 * - 两边都没有 → 孤儿。
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/commands/fs", () => ({
  listDirectory: vi.fn(),
  readFile: vi.fn(),
}))
vi.mock("./chapter-ingest", () => ({ listSnapshots: vi.fn() }))

import { listDirectory, readFile } from "@/commands/fs"
import { listSnapshots } from "./chapter-ingest"
import { scanMemoryHealth } from "./memory-health"

const mockListDirectory = vi.mocked(listDirectory)
const mockReadFile = vi.mocked(readFile)
const mockListSnapshots = vi.mocked(listSnapshots)

const projectPath = "E:/Novel"

function chapterFile(name: string, chapterNumber?: number) {
  return {
    name,
    path: `${projectPath}/wiki/chapters/${name}`,
    is_dir: false,
    children: [],
  }
}

function outlineFile(name: string) {
  return {
    name,
    path: `${projectPath}/wiki/outlines/卷纲/${name}`,
    is_dir: false,
    children: [],
  }
}

beforeEach(() => {
  mockListDirectory.mockReset()
  mockReadFile.mockReset()
  mockListSnapshots.mockReset()
})

describe("scanMemoryHealth", () => {
  it("章节号存在的快照不算孤儿；文件已删的才算", async () => {
    mockListSnapshots.mockResolvedValue([1, 2, 3])
    mockListDirectory.mockImplementation(async (dir: string) => {
      if (dir.includes("/wiki/chapters")) return [chapterFile("001.md"), chapterFile("002.md")]
      return []
    })
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.endsWith("001.md")) return "---\nchapter_number: 1\nchapter_status: final\n---\n正文"
      if (path.endsWith("002.md")) return "---\nchapter_number: 2\nchapter_status: final\n---\n正文"
      return ""
    })

    const report = await scanMemoryHealth(projectPath)

    expect(report.snapshotCount).toBe(3)
    expect(report.orphans.map((orphan) => orphan.snapshotNumber)).toEqual([3])
    expect(report.orphans[0].label).toContain("第 3 章")
  })

  it("大纲的负数编号按现有大纲文件名哈希判定", async () => {
    mockListSnapshots.mockResolvedValue([-42])
    mockListDirectory.mockImplementation(async (dir: string) => {
      if (dir.includes("/wiki/outlines")) return [outlineFile("卷纲-第01卷.md")]
      return []
    })
    mockReadFile.mockResolvedValue("")

    const stillThere = await scanMemoryHealth(projectPath)
    // 现有大纲的哈希不是 -42 → 判为孤儿
    expect(stillThere.orphans).toHaveLength(1)
    expect(stillThere.orphans[0].kind).toBe("outline")
    expect(stillThere.orphans[0].label).toContain("大纲快照")

    // 换成「快照编号正好等于现有大纲哈希」时应判为正常
    const { getOutlineSnapshotNumberFromPath } = await import("./delete-source-memory")
    const existingHash = getOutlineSnapshotNumberFromPath(
      `${projectPath}/wiki/outlines/卷纲/卷纲-第01卷.md`,
    )
    mockListSnapshots.mockResolvedValue([existingHash])
    const healthy = await scanMemoryHealth(projectPath)
    expect(healthy.orphans).toEqual([])
    expect(healthy.outlineCount).toBe(1)
  })

  it("目录都不存在时不报错，所有快照都算孤儿", async () => {
    mockListSnapshots.mockResolvedValue([5, 6])
    mockListDirectory.mockRejectedValue(new Error("ENOENT"))

    const report = await scanMemoryHealth(projectPath)

    expect(report.chapterCount).toBe(0)
    expect(report.outlineCount).toBe(0)
    expect(report.orphans.map((orphan) => orphan.snapshotNumber)).toEqual([5, 6])
  })

  it("没有快照时报告为空", async () => {
    mockListSnapshots.mockResolvedValue([])
    mockListDirectory.mockResolvedValue([])
    const report = await scanMemoryHealth(projectPath)
    expect(report.orphans).toEqual([])
    expect(report.snapshotCount).toBe(0)
  })
})
