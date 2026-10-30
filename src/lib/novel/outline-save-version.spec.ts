import { describe, expect, it, vi } from "vitest"

import { saveOutlineSaveRequests } from "./outline-save-request"

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    targetFolder: "总纲",
    fileName: "总纲.md",
    fileType: "outline" as const,
    writeMode: "replace" as const,
    referencedSkills: [],
    sourceIntent: "生成总纲",
    content: "# 总纲\n\n新的内容",
    ...overrides,
  }
}

describe("大纲覆盖前留历史版本", () => {
  it("replace 覆盖已有 .md 时，用旧内容和文件名为 key 调 hook", async () => {
    const beforeOverwrite = vi.fn()
    await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      projectPath: "C:/book",
      confirmed: true,
      requests: [baseRequest()],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "# 总纲\n\n旧的内容",
      writeFile: async () => {},
      beforeOverwrite,
    })

    expect(beforeOverwrite).toHaveBeenCalledWith({
      projectPath: "C:/book",
      name: "总纲",
      previousContent: "# 总纲\n\n旧的内容",
    })
  })

  it("新建文件（writeMode=create）不落版本", async () => {
    const beforeOverwrite = vi.fn()
    await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      projectPath: "C:/book",
      confirmed: true,
      requests: [baseRequest({ writeMode: "create" })],
      createDirectory: async () => {},
      fileExists: async () => false,
      readFile: async () => "",
      writeFile: async () => {},
      beforeOverwrite,
    })
    expect(beforeOverwrite).not.toHaveBeenCalled()
  })

  it("没传 projectPath 时不落版本（安全跳过）", async () => {
    const beforeOverwrite = vi.fn()
    await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      confirmed: true,
      requests: [baseRequest()],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "旧内容",
      writeFile: async () => {},
      beforeOverwrite,
    })
    expect(beforeOverwrite).not.toHaveBeenCalled()
  })

  it("读到空旧内容时不落版本", async () => {
    const beforeOverwrite = vi.fn()
    await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      projectPath: "C:/book",
      confirmed: true,
      requests: [baseRequest()],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "   ",
      writeFile: async () => {},
      beforeOverwrite,
    })
    expect(beforeOverwrite).not.toHaveBeenCalled()
  })

  it("hook 抛错也不能挡住保存", async () => {
    const written: string[] = []
    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      projectPath: "C:/book",
      confirmed: true,
      requests: [baseRequest()],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "旧内容",
      writeFile: async (path) => {
        written.push(path)
      },
      beforeOverwrite: () => {
        throw new Error("历史库写坏了")
      },
    })
    expect(result.saved.length).toBeGreaterThan(0)
    expect(written.length).toBeGreaterThan(0)
  })

  it("append 分支复用已读到的原文，不再二次读取", async () => {
    const beforeOverwrite = vi.fn()
    const readFile = vi.fn(async () => "旧内容")
    await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      projectPath: "C:/book",
      confirmed: true,
      requests: [baseRequest({ writeMode: "append" })],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile,
      writeFile: async () => {},
      beforeOverwrite,
    })
    expect(beforeOverwrite).toHaveBeenCalledWith(
      expect.objectContaining({ name: "总纲", previousContent: "旧内容" }),
    )
    // 只读一次（原来那次 append 本来就要读）
    expect(readFile).toHaveBeenCalledTimes(1)
  })
})
