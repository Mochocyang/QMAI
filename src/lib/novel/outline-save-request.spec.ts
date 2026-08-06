import { describe, expect, it, vi } from "vitest"
import {
  characterDraftsToSaveRequests,
  extractBodyContent,
  formatOutlineSaveParseFeedback,
  mergeOutlineSaveRequests,
  parseOutlineSaveRequests,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
} from "./outline-save-request"

const SAMPLE_CHAPTER_OUTLINE = [
  "# 章纲-第001章",
  "",
  "## 本章目标",
  "建立开局冲突",
  "",
  "## 核心事件",
  "1. 主角觉醒",
  "",
  "## 场景顺序",
  "1. 客栈",
  "",
  "## 章尾钩子",
  "门外传来脚步声",
].join("\n")

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
          content: SAMPLE_CHAPTER_OUTLINE,
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

  it("所有大纲类型均需用户确认，禁止静默自动保存", () => {
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

    expect(result.confirmRequired).toHaveLength(2)
    expect(result.autoSaveable).toHaveLength(0)
  })

  it("mergeOutlineSaveRequests 按路径去重且以新内容覆盖同名", () => {
    const existing = [
      {
        targetFolder: "章纲",
        fileName: "第11章-入局.md",
        fileType: "chapter-outline" as const,
        writeMode: "create" as const,
        referencedSkills: [],
        sourceIntent: "第一批",
        content: "旧11",
      },
      {
        targetFolder: "章纲",
        fileName: "第12章-交割.md",
        fileType: "chapter-outline" as const,
        writeMode: "create" as const,
        referencedSkills: [],
        sourceIntent: "第一批",
        content: "旧12",
      },
    ]
    const incoming = [
      {
        targetFolder: "章纲",
        fileName: "第12章-交割.md",
        fileType: "chapter-outline" as const,
        writeMode: "create" as const,
        referencedSkills: [],
        sourceIntent: "第二批",
        content: "新12",
      },
      {
        targetFolder: "章纲",
        fileName: "第16章-季度会.md",
        fileType: "chapter-outline" as const,
        writeMode: "create" as const,
        referencedSkills: [],
        sourceIntent: "第二批",
        content: "新16",
      },
    ]

    const merged = mergeOutlineSaveRequests(existing, incoming)
    expect(merged.map((item) => item.fileName)).toEqual([
      "第11章-入局.md",
      "第12章-交割.md",
      "第16章-季度会.md",
    ])
    expect(merged[1].content).toBe("新12")
    expect(merged[1].sourceIntent).toBe("第二批")
    expect(merged[0].content).toBe("旧11")
  })

  it("多请求且正文无一级标题拆分时不共用同一份正文回填", () => {
    const result = parseOutlineSaveRequests([
      "### 下一步推荐",
      "",
      "当前前10章章纲已完成，可继续：",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequests: [
          {
            targetFolder: "章纲",
            fileName: "第1章-分手.md",
            fileType: "chapter-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "确认写入",
          },
          {
            targetFolder: "章纲",
            fileName: "第2章-摆烂.md",
            fileType: "chapter-outline",
            writeMode: "create",
            referencedSkills: [],
            sourceIntent: "确认写入",
          },
        ],
      }),
      "```",
    ].join("\n"))

    expect(result.requests).toHaveLength(0)
    expect(result.errors.some((item) => item.includes("缺少 content"))).toBe(true)
  })

  it("拒绝不像章纲的 chapter-outline content", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "章纲",
        fileName: "第1章-分手.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "确认写入",
        content: "### 下一步推荐\n\n当前前10章章纲已完成，可继续：",
      },
    }))

    expect(result.requests).toHaveLength(0)
    expect(result.errors.some((item) => item.includes("内容不像章纲"))).toBe(true)
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

    expect(feedback).toContain("保存请求解析失败")
    expect(feedback).toContain("请让 AI 重新输出 outlineSaveRequest")
    expect(feedback).toContain("targetFolder")
    expect(feedback).toContain("fileName")
    expect(feedback).toContain("content")
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
        content: SAMPLE_CHAPTER_OUTLINE,
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

  it("前言 + markdown 围栏 + json 时提取完整大纲正文", () => {
    const body = extractBodyContent([
      "好的，以下是完整大纲：",
      "",
      "```markdown",
      "# 修仙界总纲",
      "",
      "## 世界观",
      "灵气复苏，门派林立。",
      "```",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成总纲",
        },
      }),
      "```",
    ].join("\n"))

    expect(body).toContain("修仙界总纲")
    expect(body).toContain("灵气复苏")
    expect(body).not.toContain("```")
    expect(body).not.toContain("outlineSaveRequest")
  })

  it("纯文本大纲 + json 时保留正文并去掉协议块", () => {
    const body = extractBodyContent([
      "# 修仙界总纲",
      "",
      "## 世界观",
      "灵气复苏",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成总纲",
        },
      }),
      "```",
    ].join("\n"))

    expect(body).toContain("# 修仙界总纲")
    expect(body).toContain("灵气复苏")
    expect(body).not.toContain("outlineSaveRequest")
  })

  it("JSON 已有 content 时不被短前言覆盖", () => {
    const result = parseOutlineSaveRequests([
      "已生成大纲：",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "测试",
          content: "# 修仙界总纲\n\n## 世界观\n灵气复苏",
        },
      }),
      "```",
    ].join("\n"))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toContain("灵气复苏")
    expect(result.requests[0].content).not.toBe("已生成大纲：")
  })

  it("content 全空且无法从正文提取时剔除 request", () => {
    const result = parseOutlineSaveRequests([
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "测试",
        },
      }),
      "```",
    ].join("\n"))

    expect(result.requests).toHaveLength(0)
    expect(result.errors.join("\n")).toContain("缺少 content")
  })

  it("无 content 时从 markdown 围栏正文填充保存请求", () => {
    const result = parseOutlineSaveRequests([
      "```markdown",
      "# 修仙界总纲",
      "",
      "## 主线",
      "夺宝筑基",
      "```",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "大纲",
          fileName: "总纲.md",
          fileType: "outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成总纲",
        },
      }),
      "```",
    ].join("\n"))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toContain("夺宝筑基")
  })
})
