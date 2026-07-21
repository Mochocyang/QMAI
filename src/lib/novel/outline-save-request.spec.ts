import { describe, expect, it, vi } from "vitest"
import {
  characterDraftsToSaveRequests,
  formatOutlineSaveParseFeedback,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "./outline-save-request"

describe("outline-save-request", () => {
  it("解析 AI 大纲回复中的单个保存请求", () => {
    const result = parseOutlineSaveRequests([
      "已生成章纲：",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "章纲",
          fileName: "章纲-第001章.md",
          fileType: "chapter-outline",
          writeMode: "create",
          referencedSkills: ["ZhanggangSkill/chapter-outline-builder"],
          sourceIntent: "生成第001章章纲",
          content: "# 章纲-第001章\n\n正文",
        },
      }),
      "```",
    ].join("\n"))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]).toMatchObject({
      targetFolder: "章纲",
      fileName: "章纲-第001章.md",
      fileType: "chapter-outline",
      writeMode: "create",
    })
  })

  it("拒绝绝对路径和上级目录路径", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequests: [
        {
          targetFolder: "../其他",
          fileName: "章纲-第001章.md",
          fileType: "chapter-outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "测试",
          content: "正文",
        },
        {
          targetFolder: "章纲",
          fileName: "C:/危险.md",
          fileType: "chapter-outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "测试",
          content: "正文",
        },
      ],
    }))

    expect(result.requests).toHaveLength(0)
    expect(result.errors.join("\n")).toContain("不能包含上级目录")
    expect(result.errors.join("\n")).toContain("不能使用绝对路径")
  })

  it("创建文件时自动避开同名文件并写入纯 Markdown", async () => {
    const written = new Map<string, string>()
    const existing = new Set(["C:/book/wiki/outlines/章纲/章纲-第001章.md"])

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      requests: [{
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: ["ZhanggangSkill/chapter-outline-builder"],
        sourceIntent: "生成第001章章纲",
        content: "# 章纲-第001章\n\n正文",
      }],
      createDirectory: async () => {},
      fileExists: async (path) => existing.has(path),
      writeFile: async (path, content) => {
        written.set(path, content)
      },
    })

    expect(result.saved).toEqual([{
      fileName: "章纲-第001章-2.md",
      path: "C:/book/wiki/outlines/章纲/章纲-第001章-2.md",
      writeMode: "create",
    }])
    expect(written.get("C:/book/wiki/outlines/章纲/章纲-第001章-2.md"))
      .toBe("# 章纲-第001章\n\n正文\n")
  })

  it.each(["replace", "patch"] as const)("未确认时继续跳过 %s 写入", async (writeMode) => {
    const writeFile = vi.fn()

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      requests: [{
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode,
        referencedSkills: [],
        sourceIntent: "修改第001章章纲",
        content: "# 最新章纲\n\n正文",
      }],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "# 原章纲\n\n旧正文\n",
      writeFile,
    })

    expect(result.saved).toEqual([])
    expect(result.skipped.join("\n")).toContain("需要用户明确确认")
    expect(writeFile).not.toHaveBeenCalled()
  })

  it.each(["replace", "patch"] as const)("用户确认后允许 %s 写入原目标文件", async (writeMode) => {
    const writeFile = vi.fn()

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      confirmed: true,
      requests: [{
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode,
        referencedSkills: [],
        sourceIntent: "修改第001章章纲",
        content: "# 最新章纲\n\n正文",
      }],
      createDirectory: async () => {},
      fileExists: async () => true,
      readFile: async () => "# 原章纲\n\n旧正文\n",
      writeFile,
    })

    expect(writeFile).toHaveBeenCalledWith(
      "C:/book/wiki/outlines/章纲/章纲-第001章.md",
      "# 最新章纲\n\n正文\n",
    )
    expect(result.saved).toEqual([{
      path: "C:/book/wiki/outlines/章纲/章纲-第001章.md",
      fileName: "章纲-第001章.md",
      writeMode,
    }])
  })

  it("把角色保存草稿转换为人物小传保存请求", () => {
    const requests = characterDraftsToSaveRequests([{
      id: "男主:林辰",
      characterName: "林辰",
      roleType: "男主",
      fileName: "角色-男主-林辰.md",
      content: "# 角色-男主-林辰\n\n正文",
      selected: true,
      confidence: "high",
    }, {
      id: "女主:苏晚",
      characterName: "苏晚",
      roleType: "女主",
      fileName: "角色-女主-苏晚.md",
      content: "# 角色-女主-苏晚\n\n正文",
      selected: false,
      confidence: "low",
    }], "保存人物小传")

    expect(requests).toEqual([{
      targetFolder: "人物小传",
      fileName: "角色-男主-林辰.md",
      fileType: "character",
      writeMode: "create",
      referencedSkills: ["JueseSkill/character-design"],
      sourceIntent: "保存人物小传",
      content: "# 角色-男主-林辰\n\n正文",
    }])
  })

  it("自动保存时将 character 请求分离为需要用户确认", () => {
    const result = splitConfirmRequiredSaveRequests([
      {
        targetFolder: "人物小传",
        fileName: "角色-男主-林辰.md",
        fileType: "character",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "保存人物",
        content: "正文",
      },
      {
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "保存章纲",
        content: "正文",
      },
    ])

    expect(result.confirmRequired).toHaveLength(1)
    expect(result.autoSaveable).toHaveLength(1)
  })

  it("保存请求解析失败时返回可操作的中文纠错提示", () => {
    const parsed = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "",
        fileName: "章纲-第001章.txt",
        fileType: "unknown",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "保存章纲",
        content: "正文",
      },
    }))

    const feedback = formatOutlineSaveParseFeedback(parsed.errors)

    expect(feedback).toContain("自动保存失败")
    expect(feedback).toContain("请让 AI 重新输出 outlineSaveRequest")
    expect(feedback).toContain("targetFolder")
    expect(feedback).toContain("fileName")
    expect(feedback).toContain("不会写入文件")
  })

  it("将中文 fileType「大纲」归一化为 outline", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "大纲",
        fileName: "总纲.md",
        fileType: "大纲",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "正文",
      },
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].fileType).toBe("outline")
  })

  it("将中文 fileType「人物小传」归一化为 character", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "人物小传",
        fileName: "角色-林风.md",
        fileType: "人物小传",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "正文",
      },
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].fileType).toBe("character")
  })

  it("将 writeMode「overwrite」归一化为 create", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode: "overwrite",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "正文",
      },
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].writeMode).toBe("create")
  })

  it("将 targetFolder 绝对路径剥离为相对文件夹名", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "C:/book/wiki/outlines/人物小传",
        fileName: "角色-林风.md",
        fileType: "character",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "正文",
      },
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].targetFolder).toBe("人物小传")
  })

  it("同时修复中文 fileType、overwrite、绝对路径三种错误", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequests: [
        {
          targetFolder: "C:/book/wiki/outlines/大纲",
          fileName: "总纲.md",
          fileType: "大纲",
          writeMode: "overwrite",
          referencedSkills: [],
          sourceIntent: "生成总纲",
          content: "正文",
        },
        {
          targetFolder: "C:/book/wiki/outlines/人物小传",
          fileName: "角色-林风.md",
          fileType: "人物小传",
          writeMode: "overwrite",
          referencedSkills: [],
          sourceIntent: "生成角色",
          content: "正文",
        },
      ],
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(2)
    expect(result.requests[0].fileType).toBe("outline")
    expect(result.requests[0].writeMode).toBe("create")
    expect(result.requests[0].targetFolder).toBe("大纲")
    expect(result.requests[1].fileType).toBe("character")
    expect(result.requests[1].writeMode).toBe("create")
    expect(result.requests[1].targetFolder).toBe("人物小传")
  })
})
