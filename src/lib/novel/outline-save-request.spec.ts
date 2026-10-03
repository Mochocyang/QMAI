import { describe, expect, it, vi } from "vitest"
import {
  attachOutlineHtml,
  characterDraftsToSaveRequests,
  extractBodyContent,
  extractHtmlBlocks,
  formatOutlineSaveParseFeedback,
  mergeOutlineSaveRequests,
  parseOutlineSaveRequests,
  renderOutlineHtmlForPath,
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

const GEMINI_OUTLINE_THOUGHT_DUMP = [
  "I'm currently focused on defining the project scope and the requested chapter outline.",
  "",
  "**Examining the Narrative Details**",
  "",
  "I'm now analyzing the source text and identifying the required plot points.",
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

  it("清理保存请求 content 中前置的 Gemini 思考摘要", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "章纲",
        fileName: "章纲-第001章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "生成第001章章纲",
        content: `${GEMINI_OUTLINE_THOUGHT_DUMP}\n\n${SAMPLE_CHAPTER_OUTLINE}`,
      },
    }))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.content).toBe(SAMPLE_CHAPTER_OUTLINE)
  })

  it("拒绝 content 仅包含 Gemini 思考摘要的保存请求", () => {
    const result = parseOutlineSaveRequests(JSON.stringify({
      outlineSaveRequest: {
        targetFolder: "大纲",
        fileName: "总纲.md",
        fileType: "outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "生成总纲",
        content: GEMINI_OUTLINE_THOUGHT_DUMP,
      },
    }))

    expect(result.requests).toHaveLength(0)
    expect(result.errors).toContain("第 1 个保存请求的 content 仅包含模型思考过程。")
  })

  it("未闭合 json 围栏时仍能回收完整保存请求", () => {
    const result = parseOutlineSaveRequests([
      SAMPLE_CHAPTER_OUTLINE,
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "章纲",
          fileName: "章纲-第001章.md",
          fileType: "chapter-outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成第001章章纲",
          content: SAMPLE_CHAPTER_OUTLINE,
        },
      }),
    ].join("\n"))

    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]?.fileName).toBe("章纲-第001章.md")
    expect(result.requests[0]?.content).toContain("本章目标")
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

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      targetFolder: "人物小传",
      fileName: "角色-男主-林辰.md",
      fileType: "character",
      writeMode: "create",
      referencedSkills: ["JueseSkill/character-design"],
      sourceIntent: "保存人物小传",
      content: "# 角色-男主-林辰\n\n正文",
    })
    // 多 Agent 路径现在会由软件侧补一份同名 .html 角色卡
    expect(requests[0].htmlContent).toContain("角色-男主-林辰")
  })

  it("人物草稿自带 htmlContent（characterProfileData 预渲染）时优先使用", () => {
    const requests = characterDraftsToSaveRequests([{
      id: "男主:林辰",
      characterName: "林辰",
      roleType: "男主",
      fileName: "角色-男主-林辰.md",
      content: "# 林辰\n\n正文",
      selected: true,
      confidence: "high",
      htmlContent: "<!DOCTYPE html><html><body>CUSTOM-PROFILE</body></html>",
    }], "保存人物小传")
    expect(requests[0].htmlContent).toContain("CUSTOM-PROFILE")
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

  it("透传 htmlContent 字段（卷纲折叠树 HTML）", () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    const result = parseOutlineSaveRequests([
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "卷纲",
          fileName: "卷纲-第01卷.md",
          fileType: "volume-outline",
          writeMode: "create",
          referencedSkills: ["DagangSkill/juangangzhedieshu"],
          sourceIntent: "生成第01卷卷纲",
          content: "# 卷纲-第01卷\n\n## 卷目标",
          htmlContent: html,
        },
      }),
      "```",
    ].join("\n"))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].htmlContent).toBe(html)
  })

  it("htmlContent 缺失时从 ```html 围栏兜底提取", () => {
    const html = "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>"
    const result = parseOutlineSaveRequests([
      "# 卷纲-第01卷",
      "",
      "## 卷目标",
      "大高潮",
      "",
      "```html",
      html,
      "```",
      "",
      "```json",
      JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "卷纲",
          fileName: "卷纲-第01卷.md",
          fileType: "volume-outline",
          writeMode: "create",
          referencedSkills: [],
          sourceIntent: "生成第01卷卷纲",
          content: "# 卷纲-第01卷",
        },
      }),
      "```",
    ].join("\n"))

    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].htmlContent).toBe(html)
  })

  it("extractBodyContent 排除 ```html 围栏，不污染 MD 正文", () => {
    const body = extractBodyContent([
      "# 卷纲-第01卷",
      "",
      "## 卷目标",
      "大高潮",
      "",
      "```html",
      "<!DOCTYPE html><html><body><h1>折叠树</h1></body></html>",
      "```",
    ].join("\n"))

    expect(body).toContain("# 卷纲-第01卷")
    expect(body).not.toContain("<html")
    expect(body).not.toContain("```")
  })

  it("extractHtmlBlocks 提取多个 html 块，首个非空优先", () => {
    expect(extractHtmlBlocks("```html\n<a></a>\n```\n正文\n```html\n<b></b>\n```")).toEqual([
      "<a></a>",
      "<b></b>",
    ])
    expect(extractHtmlBlocks("没有 html 块")).toEqual([])
  })

  it("extractHtmlBlocks 不误抓 ```json / 无语言标记的围栏", () => {
    expect(extractHtmlBlocks('```json\n{"a":1}\n```')).toEqual([])
    expect(extractHtmlBlocks("```\n随便一段\n```")).toEqual([])
    expect(extractHtmlBlocks('```json\n{"volumeOutlineData":{}}\n```\n```html\n<html></html>\n```')).toEqual([
      "<html></html>",
    ])
  })

  it("saveOutlineSaveRequests 按 formats 落盘 .md 与伴生 .html", async () => {
    const written: Array<{ path: string; content: string }> = []
    const result = await saveOutlineSaveRequests({
      outlineRoot: "/root",
      confirmed: true,
      formats: { md: true, html: true },
      requests: [{
        targetFolder: "卷纲",
        fileName: "卷纲-第01卷.md",
        fileType: "volume-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "# 卷纲-第01卷",
        htmlContent: "<!DOCTYPE html><html></html>",
      }],
      createDirectory: async () => {},
      fileExists: async () => false,
      writeFile: async (path: string, content: string) => { written.push({ path, content }) },
    })

    expect(result.saved.map((item) => item.fileName)).toEqual(["卷纲-第01卷.md", "卷纲-第01卷.html"])
    expect(written.map((item) => item.path)).toEqual([
      "/root/卷纲/卷纲-第01卷.md",
      "/root/卷纲/卷纲-第01卷.html",
    ])
  })

  it("saveOutlineSaveRequests 只勾选 HTML 时仅落盘 .html", async () => {
    const written: Array<{ path: string }> = []
    await saveOutlineSaveRequests({
      outlineRoot: "/root",
      confirmed: true,
      formats: { md: false, html: true },
      requests: [{
        targetFolder: "卷纲",
        fileName: "卷纲-第01卷.md",
        fileType: "volume-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "# 卷纲-第01卷",
        htmlContent: "<!DOCTYPE html><html></html>",
      }],
      createDirectory: async () => {},
      fileExists: async () => false,
      writeFile: async (path: string) => { written.push({ path }) },
    })

    expect(written.map((item) => item.path)).toEqual(["/root/卷纲/卷纲-第01卷.html"])
  })

  it("attachOutlineHtml 为设定类（组织势力）补 htmlContent", () => {
    const source = "# 青云门\n## 阵营目标\n- 维护正道秩序\n## 掌握资源\n**掌门**：玉虚真人"
    const attached = attachOutlineHtml(
      { fileType: "organization", content: source },
      source,
    )
    expect(attached.htmlContent).toContain("青云门")
    expect(attached.htmlContent).toContain("玉虚真人")
  })

  it("attachOutlineHtml 对 fileType=setting 的力量体系走专属体系卡", () => {
    const source = "# 力量体系\n## 体系概览\n- 力量本质：灵力\n## 等级阶梯\n| 等级 | 名称 |\n| --- | --- |\n| 一阶 | 引气 |"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("力量体系 · 体系卡")
  })

  it("分类成章纲但正文其实是设定类时，仍借用设定家族补出 HTML（fileType 不变）", () => {
    const source = "# 力量体系\n## 等级阶梯\n| 等级 | 说明 |\n| --- | --- |\n| 一转 | 引气 |"
    const attached = attachOutlineHtml(
      { fileType: "chapter-outline", content: source, fileName: "力量体系总纲.md" },
      "",
    )
    expect(attached.htmlContent).toContain("力量体系 · 体系卡")
    expect(attached.fileType).toBe("chapter-outline")

    // 真正的章纲（不满足渲染条件时）不应被套上设定卡
    const realChapter = attachOutlineHtml(
      { fileType: "chapter-outline", content: "# 第001章章纲\n## 核心事件\n- 主角觉醒", fileName: "章纲-第001章.md" },
      "",
    )
    expect(realChapter.htmlContent).toBeUndefined()
  })

  it("renderOutlineHtmlForPath 为历史 / 外部写入的大纲 .md 即时渲染 HTML", () => {
    expect(
      renderOutlineHtmlForPath("/p/wiki/outlines/组织势力/青云门.md", "# 青云门\n## 阵营目标\n- 维护正道秩序"),
    ).toContain("组织势力 · 势力卡")
    expect(
      renderOutlineHtmlForPath("/p/wiki/outlines/人物小传/角色-林辰.md", "# 林辰\n## 基本信息\n- 身份：外门弟子"),
    ).toContain("人物小传 · 角色卡")
    expect(
      renderOutlineHtmlForPath("/p/wiki/outlines/设定/背景设定.md", "# 背景设定\n## 历史沿革\n| 时期 | 事件 |\n| --- | --- |\n| 开元 | 立国 |"),
    ).toContain("背景设定 · 背景卡")
    // 空内容 / 非 .md 不渲染
    expect(renderOutlineHtmlForPath("/p/wiki/outlines/组织势力/x.md", "")).toBeNull()
    expect(renderOutlineHtmlForPath("/p/wiki/outlines/组织势力/x.html", "x")).toBeNull()
  })

  it("attachOutlineHtml 对 fileType=setting 未命中子类型时走通用卡片流", () => {
    const source = "# 设定\n## 说明\n- 内容"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("设定 · 卡片流")
  })

  it("fileType=setting 但内容/文件夹指组织势力时走专属势力卡（不回退通用卡片流）", () => {
    const byContent = attachOutlineHtml(
      { fileType: "setting", content: "# 组织势力设定\n## 阵营目标\n- 维护正道秩序\n## 掌握资源\n- 灵脉" },
      "",
    )
    expect(byContent.htmlContent).toContain("组织势力 · 势力卡")

    const byFolder = attachOutlineHtml(
      { fileType: "setting", content: "# 某势力\n## 阵营目标\n- 扩张", targetFolder: "组织势力" },
      "",
    )
    expect(byFolder.htmlContent).toContain("组织势力 · 势力卡")
  })

  it("fileType=setting 但内容指人物小传 / 伏笔时也走各自专属卡", () => {
    const character = attachOutlineHtml(
      { fileType: "setting", content: "# 林辰\n## 基本信息\n- 身份：外门弟子", targetFolder: "人物小传" },
      "",
    )
    expect(character.htmlContent).toContain("人物小传 · 角色卡")

    const foreshadowing = attachOutlineHtml(
      { fileType: "setting", content: "# 伏笔追踪\n## 伏笔状态表\n| ID | 状态 |\n| --- | --- |\n| F001 | 已埋 |" },
      "",
    )
    expect(foreshadowing.htmlContent).toContain("伏笔计划 · 伏笔台账")
  })

  it("attachOutlineHtml 对 fileType=foreshadowing 走专属伏笔台账", () => {
    const source = "# 伏笔追踪\n## 伏笔状态表\n| ID | 状态 |\n| --- | --- |\n| F001 | 已埋 |"
    const attached = attachOutlineHtml({ fileType: "foreshadowing", content: source }, source)
    expect(attached.htmlContent).toContain("伏笔计划 · 伏笔台账")
  })

  it("attachOutlineHtml 对 fileType=setting 的金手指走专属能力卡", () => {
    const source = "# 金手指设定\n## 机制\n- 绑定方式：濒死激活\n## 已解锁能力\n| 解锁章节 | 能力 |\n| --- | --- |\n| 第1章 | 识海 |"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("金手指 · 能力卡")
  })

  it("attachOutlineHtml 对 fileType=setting 的地理设定走专属地理卡", () => {
    const source = "# 地理设定\n## 区域划分\n| 区域 | 类型 |\n| --- | --- |\n| 东荒 | 荒原 |"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("地理设定 · 地理卡")
  })

  it("attachOutlineHtml 对 fileType=setting 的地点设定走专属地点卡", () => {
    const source = "# 地点设定\n## 空间规则\n| 规则 | 说明 |\n| --- | --- |\n| 御剑限高 | 峰顶禁飞 |"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("地点设定 · 地点卡")
  })

  it("attachOutlineHtml 对 fileType=setting 的背景设定走专属背景卡", () => {
    const source = "# 背景设定\n## 历史沿革\n| 时期 | 关键事件 |\n| --- | --- |\n| 开元 | 立国 |"
    const attached = attachOutlineHtml({ fileType: "setting", content: source }, source)
    expect(attached.htmlContent).toContain("背景设定 · 背景卡")
  })

  it("地点 / 背景按文件名区分（同为 fileType=setting）", () => {
    const byFolder = attachOutlineHtml(
      { fileType: "setting", content: "# 清风镇\n## 地点定位\n- 所处区域：东荒", targetFolder: "地点设定" },
      "",
    )
    expect(byFolder.htmlContent).toContain("地点卡")

    const byIntent = attachOutlineHtml(
      { fileType: "setting", content: "# 某设定\n## 世界观背景\n- 世界前提：灵气复苏", sourceIntent: "生成背景设定" },
      "",
    )
    expect(byIntent.htmlContent).toContain("背景卡")
  })

  it("saveOutlineSaveRequests 为设定类落盘伴生 .html", async () => {
    const written: Array<{ path: string }> = []
    const result = await saveOutlineSaveRequests({
      outlineRoot: "/root",
      confirmed: true,
      formats: { md: true, html: true },
      requests: [{
        targetFolder: "组织",
        fileName: "青云门.md",
        fileType: "organization",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "测试",
        content: "# 青云门",
        htmlContent: "<!DOCTYPE html><html></html>",
      }],
      createDirectory: async () => {},
      fileExists: async () => false,
      writeFile: async (path: string) => { written.push({ path }) },
    })

    expect(result.saved.map((item) => item.fileName)).toEqual(["青云门.md", "青云门.html"])
    expect(written.map((item) => item.path)).toEqual([
      "/root/组织/青云门.md",
      "/root/组织/青云门.html",
    ])
  })
})
