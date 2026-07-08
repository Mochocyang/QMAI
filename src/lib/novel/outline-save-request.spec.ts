import { describe, expect, it } from "vitest"
import {
  characterDraftsToSaveRequests,
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

  it("创建文件时自动避开同名文件并写入前置信息", async () => {
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
      ?.toContain("source_intent: \"生成第001章章纲\"")
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
})
