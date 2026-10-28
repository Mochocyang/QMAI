import { describe, expect, it, vi } from "vitest"
import {
  attachOutlineHtml,
  characterDraftsToSaveRequests,
  excludeEventOutlineSaveRequests,
  extractBodyContent,
  extractHtmlBlocks,
  formatOutlineSaveParseFeedback,
  mergeOutlineSaveRequests,
  parseOutlineSaveRequests,
  renderOutlineHtmlForPath,
  saveOutlineSaveRequests,
  splitConfirmRequiredSaveRequests,
  type OutlineSaveRequest,
  type OutlineSaveRequestFileType,
} from "./outline-save-request"
import { getDefaultFolderForOutlineFileType } from "./outline-save-classifier"

/**
 * `attachOutlineHtml` 的入参形状，直接由生产签名推导（`Parameters<...>[0]`）。
 *
 * 该函数的返回类型就是泛型 T，所以必须显式标注调用点：直接传对象字面量时，
 * T 会被推成 `{ fileType: string; content: string }` 这类没有 htmlContent 的窄类型，
 * 测试就访问不到生产函数实际会补上的那个字段了。
 */
type AttachOutlineHtmlInput = Parameters<typeof attachOutlineHtml>[0]

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

  it("append 模式必须真的追加（confirmed 下也不能覆盖已有内容）", async () => {
    /*
     * 回归点：append 的契约是「追加到文件末尾」（提示词与 AI_OUTLINE_OUTPUT_PROTOCOL.md），
     * 但旧实现里 `confirmed` 分支直接 `writeFile(targetPath, content)` —— 覆盖写。
     * 唯一调用点恒传 `confirmed: true`，于是用户已有的伏笔台账 / 设定更新记录
     * 会被这一轮新增的一小段整个替换掉，且 .md 没有版本历史，无法恢复。
     */
    const written = new Map<string, string>()
    const existing = new Set(["C:/book/wiki/outlines/设定/伏笔.md"])
    const original = "# 伏笔台账\n\n## 第一章\n\n- 门后的脚步声\n"

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      requests: [{
        targetFolder: "设定",
        fileName: "伏笔.md",
        fileType: "foreshadowing",
        writeMode: "append",
        referencedSkills: [],
        sourceIntent: "追加第三章伏笔",
        content: "## 第三章\n\n- 井口的刻痕",
      }],
      confirmed: true,
      createDirectory: async () => {},
      fileExists: async (path) => existing.has(path),
      readFile: async () => original,
      writeFile: async (path, content) => {
        written.set(path, content)
      },
    })

    expect(result.errors).toEqual([])
    expect(result.saved.map((item) => item.path)).toEqual(["C:/book/wiki/outlines/设定/伏笔.md"])
    const merged = written.get("C:/book/wiki/outlines/设定/伏笔.md") ?? ""
    // 旧内容必须还在，新内容必须接在后面
    expect(merged).toContain("门后的脚步声")
    expect(merged).toContain("井口的刻痕")
    expect(merged.indexOf("门后的脚步声")).toBeLessThan(merged.indexOf("井口的刻痕"))
    // 只有一份 H1，不能是「两份文件头拼在一起」
    expect(merged.match(/^# 伏笔台账$/gm)).toHaveLength(1)
  })

  it("append 模式下文件不存在时按新文件写入", async () => {
    const written = new Map<string, string>()

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      requests: [{
        targetFolder: "设定",
        fileName: "伏笔.md",
        fileType: "foreshadowing",
        writeMode: "append",
        referencedSkills: [],
        sourceIntent: "追加伏笔",
        content: "# 伏笔台账\n\n- 第一条",
      }],
      confirmed: true,
      createDirectory: async () => {},
      fileExists: async () => false,
      readFile: async () => "",
      writeFile: async (path, content) => {
        written.set(path, content)
      },
    })

    expect(result.errors).toEqual([])
    expect(written.get("C:/book/wiki/outlines/设定/伏笔.md")).toBe("# 伏笔台账\n\n- 第一条\n")
  })

  it("append 模式下文件已存在却读不到原文时跳过写入，绝不用覆盖写顶掉旧内容", async () => {
    const writeFile = vi.fn()

    const result = await saveOutlineSaveRequests({
      outlineRoot: "C:/book/wiki/outlines",
      requests: [{
        targetFolder: "设定",
        fileName: "伏笔.md",
        fileType: "foreshadowing",
        writeMode: "append",
        referencedSkills: [],
        sourceIntent: "追加伏笔",
        content: "## 第三章\n\n- 井口的刻痕",
      }],
      confirmed: true,
      createDirectory: async () => {},
      fileExists: async () => true,
      writeFile,
    })

    expect(writeFile).not.toHaveBeenCalled()
    expect(result.saved).toEqual([])
    expect(result.skipped.join("\n")).toContain("缺少追加读取能力")
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

  it("人物草稿解析不出结构化档案时也必须有 HTML（否则勾选框可用却拿不到 .html）", () => {
    /*
     * 人物确认框的 HTML 勾选框在 mode==="character" 时是无条件可用的
     * ——它不检查 htmlContent。所以这里若留空，就是最坏的一种缺口：
     * 用户能勾、也确实勾了，最后却没有 .html 文件，而界面不会说任何话。
     */
    const requests = characterDraftsToSaveRequests([{
      id: "路人:甲",
      characterName: "甲",
      roleType: "路人",
      fileName: "角色-路人-甲.md",
      // 没有任何可解析的字段结构，角色卡解析器会返回 null
      content: "甲。",
      selected: true,
      confidence: "low",
    }], "保存人物小传")
    expect(requests[0].htmlContent?.trim()).toBeTruthy()
    expect(requests[0].htmlContent).toContain("<html")
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

                                    })

describe("event-outline 保存类型", () => {
  const eventOutlineContent = [
    "# 第12章 · 令牌初现",
    "",
    "## 事件1 院子里的哭声",
    "- 关键台词：「夜壶里的东西是药。」",
    "- 神情动作：念念两只小手护住屁股蛋。",
  ].join("\n")

  const request = {
    targetFolder: "事件细纲",
    fileName: "事件细纲-第012章.md",
    fileType: "event-outline",
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "生成第12章事件细纲",
    content: eventOutlineContent,
  }

  const parseOne = (payload: Record<string, unknown>) =>
    parseOutlineSaveRequests(`\`\`\`json\n${JSON.stringify({ outlineSaveRequest: payload })}\n\`\`\``)

  const parseMany = (payloads: Array<Record<string, unknown>>) =>
    parseOutlineSaveRequests(`\`\`\`json\n${JSON.stringify({ outlineSaveRequests: payloads })}\n\`\`\``)

  /*
   * eventOutlineRejectionCount 的**口径**测试。
   *
   * 调用方（大纲面板的自动通道闸门）拿它与 errors.length 比较，只有相等才敢说
   * 「这一批错误全是事件细纲造成的」并改弹 info。所以「哪些错误算事件细纲被拒」
   * 必须连同归一化阶段的错误一起算 —— 否则一条缺 fileName 的事件细纲请求
   * 会让用户看到「请让 AI 重新输出 outlineSaveRequest」，而重出一次仍会被丢掉。
   */
  it("归一化阶段就被拒的事件细纲请求也计入拒收数（口径 = 错误条数）", () => {
    // 文件名不是 .md：错误在 normalizeRequest 里就产生了
    const parsed = parseOne({ ...request, fileName: "事件细纲-第012章.txt" })
    expect(parsed.requests).toEqual([])
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.eventOutlineRejectionCount).toBe(1)
  })

  /*
   * E8 的**缺 content** 路径（此前只覆盖了归一化阶段与结构闸门）。
   *
   * 输入刻意选成「唯一一条请求是 event-outline + content 为空 + 正文里也提不出内容」：
   * 归一化会放过它（`content: ""` 不触发那条「仅包含模型思考过程」的报错），
   * 拒绝发生在其后的 `!request.content.trim()` 分支。若那一支不计数，调用方拿到的是
   * `errors.length === 1 && eventOutlineRejectionCount === 0` ⇒ 判成「有真正的解析错误」
   * ⇒ 弹「请让 AI 重新输出 outlineSaveRequest」，而重出一次还是会被丢掉 ——
   * 正是 E8 要消除的症状。
   *
   * `parseOne` 的正文部分只有 json 围栏（extractBodyContent 会把它整块删掉），
   * 所以 fillContentFromText 确实补不出 content。
   */
  it("缺 content 的事件细纲请求也计入拒收数（E8：不在归一化阶段，但同样不许误报）", () => {
    const parsed = parseOne({ ...request, content: "" })
    // 三者的关系才是关键：调用方比的是 rejectionCount 与 errors.length
    expect(parsed.requests).toEqual([])
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.eventOutlineRejectionCount).toBe(parsed.errors.length)
    expect(parsed.errors[0]).toContain("缺少 content")
  })

  it("缺 content 的**非**事件细纲请求不计入拒收数（否则会把真错误也掩盖掉）", () => {
    const parsed = parseOne({
      targetFolder: "章纲",
      fileName: "章纲-第012章.md",
      fileType: "chapter-outline",
      writeMode: "create",
      referencedSkills: [],
      sourceIntent: "生成章纲",
      content: "",
    })
    expect(parsed.errors).toHaveLength(1)
    expect(parsed.eventOutlineRejectionCount).toBe(0)
  })

  it("混着真正的解析错误时，拒收数小于错误总数（调用方据此仍弹那条重出提示）", () => {
    const parsed = parseMany([
      { ...request, fileName: "事件细纲-第012章.txt" },
      {
        targetFolder: "章纲",
        fileName: "章纲-第012章.md",
        fileType: "chapter-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "生成章纲",
        content: "好的，我已完成本章细纲。",
      },
    ])
    expect(parsed.requests).toEqual([])
    expect(parsed.eventOutlineRejectionCount).toBe(1)
    expect(parsed.errors.length).toBeGreaterThan(parsed.eventOutlineRejectionCount)
  })

  it("中文别名「事件细纲」归一化为 event-outline", () => {
    const parsed = parseOne({ ...request, fileType: "事件细纲" })
    expect(parsed.errors).toEqual([])
    expect(parsed.requests[0]?.fileType).toBe("event-outline")
  })

  it("中文别名「细纲」不再归一化为 event-outline", () => {
    // 丙-1 的核心修复点：不给「细纲」这个别名，让它**整条被拒**（而不是被改判成事件细纲）。
    // 保留别名会让模型写 fileType: "细纲" 时，一份 17 节章纲被归一化成 event-outline，
    // 而 hasEventOutlineStructure 的闸门挡不住它（章纲的「## 1. 本章定位」本身就是
    // 编号分节 + 大量列表行），于是章纲会被落进「事件细纲」文件夹。
    // 注意结果不是「恢复成 17 节章纲」：白名单里没有「细纲」这个值，所以
    // normalizeRequest 直接报「不支持的大纲文件类型」，requests 里什么都不剩。
    const parsed = parseOne({ ...request, fileType: "细纲" })
    expect(parsed.requests.map((item) => item.fileType)).not.toContain("event-outline")
    expect(parsed.requests).toEqual([])
    expect(parsed.errors.join("\n")).toContain("细纲")
  })

  it("事件细纲落进「事件细纲」文件夹", () => {
    expect(getDefaultFolderForOutlineFileType("event-outline")).toBe("事件细纲")
  })

  it("内容不像事件细纲时拒绝写入", () => {
    const parsed = parseOne({ ...request, content: "好的，我已完成本章细纲。" })
    expect(parsed.requests).toEqual([])
    expect(parsed.errors.join("\n")).toContain("事件细纲")
  })

  it("结构完整的事件细纲能通过闸门", () => {
    const parsed = parseOne(request)
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
  })

  it("事件细纲不再自动套模板：没有 AI 网页就没有 HTML", () => {
    const parsed = parseOne(request)
    // 模板渲染已下线：AI 没写 ```html 围栏时，保存框的 HTML 选项应为不可用
    expect(parsed.requests[0]?.htmlContent).toBeUndefined()
  })

  it("分节写成编号标题（## 1. …）时同样过闸门", () => {
    // 提示词现在强制「## 事件N」，但模型仍可能写成编号分节：
    // 那种细纲在卡片上看着合格，过去会被保存闸门拒掉 —— 没有对话框，只报「保存请求解析失败」。
    const parsed = parseOne({
      ...request,
      content: [
        "# 事件细纲 · 第12章 令牌初现",
        "",
        "## 1. 院子里的哭声",
        "- 关键台词：「夜壶里的东西是药。」",
        "- 神情动作：念念两只小手护住屁股蛋。",
      ].join("\n"),
    })
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
  })

  it("分节写成「## 事件1」时过闸门", () => {
    const parsed = parseOne({
      ...request,
      content: [
        "# 事件细纲 · 第12章 令牌初现",
        "",
        "## 事件1 院子里的哭声",
        "- 关键台词：「夜壶里的东西是药。」",
        "- 神情动作：念念两只小手护住屁股蛋。",
      ].join("\n"),
    })
    expect(parsed.errors).toEqual([])
    expect(parsed.requests).toHaveLength(1)
  })

  it("只有列表行、没有事件分节的完成报告仍被闸门拒绝", () => {
    // listLines ≥ 2 只说明「像清单」，不能替代事件分节：摘要里也常有项目符号。
    const parsed = parseOne({
      ...request,
      content: "好的，我已完成本章细纲。\n- 已按 4 个事件排好\n- 已补全章尾钩子",
    })
    expect(parsed.requests).toEqual([])
    expect(parsed.errors.join("\n")).toContain("事件细纲")
  })

  it("17 节章纲的 §N 分节骗不过事件细纲闸门", () => {
    // 章纲模板用的是「## §5 核心事件链」这种 §N 分节（不是「## 5.」），
    // 因此 FIX 3 放宽编号分节后，章纲正文仍然过不了事件细纲闸门。
    const chapterOutlineBody = [
      "# 章纲-第046章：第一次冷处理",
      "",
      "## §1 基础信息",
      "- 章号：46",
      "## §5 核心事件链",
      "- what: 早会被点名",
      "  cause: 上级要一个交代",
      "  action: 把他移出核心组",
      "  result: 第一次被冷处理",
      "  use: 铺垫离职线",
      "## §17 写作检查清单",
      "- 三行内入戏",
    ].join("\n")
    const parsed = parseOne({ ...request, content: chapterOutlineBody })
    expect(parsed.requests).toEqual([])
    expect(parsed.errors.join("\n")).toContain("事件细纲")
  })
})

describe("excludeEventOutlineSaveRequests", () => {
  const eventOutlineRequest: OutlineSaveRequest = {
    targetFolder: "事件细纲",
    fileName: "事件细纲-第012章.md",
    fileType: "event-outline",
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "生成第12章事件细纲",
    content: "# 事件细纲 · 第12章 令牌初现\n\n## 事件1 院子里的哭声\n- 关键台词：「夜壶里的东西是药。」",
  }
  /*
   * 这份 fixture 的 targetFolder **刻意不叫「事件细纲」**：排除条件键的是 fileType，
   * 而每个事件 fixture 都带 `targetFolder: "事件细纲"` 时，一个改成键 targetFolder
   * 的变异实现照样能通过 —— 那条用例就钉不住它声称要钉的键。
   */
  const eventOutlineRequestOtherFolder: OutlineSaveRequest = {
    ...eventOutlineRequest,
    targetFolder: "大纲",
    fileName: "事件细纲-第013章.md",
  }
  const chapterOutlineRequest: OutlineSaveRequest = {
    ...eventOutlineRequest,
    targetFolder: "章纲",
    fileName: "章纲-第012章.md",
    fileType: "chapter-outline",
  }
  const volumeOutlineRequest: OutlineSaveRequest = {
    ...eventOutlineRequest,
    targetFolder: "卷纲",
    fileName: "卷纲-第二卷.md",
    fileType: "volume-outline",
  }
  const characterRequest: OutlineSaveRequest = {
    ...eventOutlineRequest,
    targetFolder: "人物小传",
    fileName: "角色-楚白.md",
    fileType: "character",
  }

  /*
   * 顺序**必须**用「有多个幸存者」的输入来测：只有一存一删时，
   * 输出永远只有一个元素，任何排序/反转都能通过，这条断言就没有鉴别力。
   * 这里混入四处事件细纲（其中一处 targetFolder 不是「事件细纲」，用来钉住
   * 排除键是 fileType 而不是文件夹名）、三个不同位置的幸存者，
   * 并对**完整序列**做断言。
   */
  it("摘掉全部事件细纲、留下的按原顺序（顺序不变）", () => {
    const result = excludeEventOutlineSaveRequests([
      chapterOutlineRequest,
      eventOutlineRequest,
      volumeOutlineRequest,
      eventOutlineRequestOtherFolder,
      characterRequest,
      eventOutlineRequest,
    ])
    // 三个幸存者的相对顺序必须与输入一致：章纲 → 卷纲 → 人物小传
    expect(result.requests.map((item) => item.fileType)).toEqual([
      "chapter-outline",
      "volume-outline",
      "character",
    ])
    expect(result.droppedEventOutlineCount).toBe(3)
  })

  it("只看 fileType，不靠 targetFolder 判断（改键实现会被这条抓住）", () => {
    // 键 targetFolder 的变异实现在这里会留下 1 条（因为它是「大纲」），
    // 而 fileType 仍是 event-outline —— 下面两条断言同时变红。
    const result = excludeEventOutlineSaveRequests([
      { ...eventOutlineRequestOtherFolder, targetFolder: "章纲" },
      { ...eventOutlineRequest, targetFolder: "事件细纲", fileType: "outline" },
    ])
    expect(result.requests.map((item) => item.fileType)).toEqual(["outline"])
    expect(result.droppedEventOutlineCount).toBe(1)
  })

  it("全是事件细纲时请求清空、且如实报出摘掉的条数", () => {
    // 调用方靠这个条数区分「压根没有请求」与「请求全是事件细纲」：
    // 后者必须直接收工，否则会掉进按正文推断的兜底分类，又判出一次事件细纲。
    const result = excludeEventOutlineSaveRequests([eventOutlineRequest])
    expect(result.requests).toEqual([])
    expect(result.droppedEventOutlineCount).toBe(1)
  })

  it("没有事件细纲时原样返回、条数为 0", () => {
    const result = excludeEventOutlineSaveRequests([chapterOutlineRequest, characterRequest])
    expect(result.requests.map((item) => item.fileType)).toEqual(["chapter-outline", "character"])
    expect(result.droppedEventOutlineCount).toBe(0)
  })

  it("空数组返回空数组、条数为 0（不能把 0 条算成「摘掉了但是空的」）", () => {
    expect(excludeEventOutlineSaveRequests([])).toEqual({
      requests: [],
      droppedEventOutlineCount: 0,
    })
  })
})

describe("人物小传：正文由结构化数据反推（模型不再写第二遍）", () => {
  const profile = {
    characterProfileData: {
      name: "楚白",
      tag: "主角",
      tagline: "一个把债还完就想收手的掮客",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "废品站的掮客" }, { label: "债务", text: "欠老秦三万七" }] },
        { kind: "kv", heading: "角色定位", items: [{ label: "故事功能", text: "替读者第一次看到城里的规矩" }] },
        { kind: "kv", heading: "外在表现", items: [{ label: "惯用动作", text: "说话时数指节" }] },
        { kind: "kv", heading: "内在分析", items: [{ label: "底线", text: "不把女人和孩子牵进交易" }] },
        {
          kind: "table",
          heading: "语言风格",
          head: ["对象与场景", "措辞与节奏", "潜台词与回避", "示例对白", "变化条件"],
          rows: [["对老秦", "短句，先答应再讲条件", "绝口不提母亲", "「三万七我认，别催。」", "被催第三次会涨语气"]],
        },
        {
          kind: "table",
          heading: "关系网络",
          head: ["对象与共同经历", "公开关系与真实态度", "利益与依赖", "秘密与冲突", "变化触发与代价"],
          rows: [["老秦", "债主与旧识", "互相捏着把柄", "他知道老秦的货源", "账清则断"]],
        },
      ],
    },
  }
  const request = {
    targetFolder: "人物小传",
    fileName: "角色-楚白.md",
    fileType: "character",
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "人物小传",
    content: "",
  }
  const parse = (text: string) => parseOutlineSaveRequests(text)

  it("只给 JSON + 空 content，也能存出完整正文", () => {
    const result = parse(`\`\`\`json\n${JSON.stringify(profile)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: request })}\n\`\`\``)
    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    const content = result.requests[0].content
    expect(content).toContain("# 楚白（主角）")
    expect(content).toContain("一个把债还完就想收手的掮客")
    for (const heading of ["基本信息", "角色定位", "外在表现", "内在分析", "语言风格", "关系网络"]) {
      expect(content).toContain(`## ${heading}`)
    }
    // 字段、表格行列一个都不能丢
    expect(content).toContain("- 债务：欠老秦三万七")
    expect(content).toContain("| 对象与场景 | 措辞与节奏 | 潜台词与回避 | 示例对白 | 变化条件 |")
    expect(content).toContain("「三万七我认，别催。」")
  })

  it("围栏外只剩一句交代语时，也用数据补正文（不能存成一句话）", () => {
    const result = parse(`已生成楚白的人物小传。\n\n\`\`\`json\n${JSON.stringify(profile)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: request })}\n\`\`\``)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toContain("## 基本信息")
    expect(result.requests[0].content.length).toBeGreaterThan(200)
  })

  it("模型没听指令真写了完整小传时，保留它自己写的正文", () => {
    /*
     * 「完整」现在是硬条件：六个分区标题都在、数量不少于数据产出，
     * 才认为模型这份正文能替代反推。见 `outlineBodyCoversData`。
     */
    const own = [
      "# 楚白（主角）", "",
      "## 基本信息", "", "- 职业：真正的掮客", "",
      "## 角色定位", "", "- 故事功能：模型自己写的定位", "",
      "## 外在表现", "", "- 惯用动作：说话时数指节", "",
      "## 内在分析", "", "- 底线：不把女人和孩子牵进交易", "",
      "## 语言风格", "",
      "| 对象与场景 | 措辞与节奏 | 潜台词与回避 | 示例对白 | 变化条件 |",
      "| --- | --- | --- | --- | --- |",
      "| 对老秦 | 短句，先答应再讲条件 | 绝口不提母亲 | 「三万七我认。」 | 被催第三次会涨语气 |", "",
      "## 关系网络", "",
      "| 对象与共同经历 | 公开关系与真实态度 | 利益与依赖 | 秘密与冲突 | 变化触发与代价 |",
      "| --- | --- | --- | --- | --- |",
      "| 老秦 | 债主与旧识 | 互相捏着把柄 | 他知道老秦的货源 | 账清则断 |", "",
      "（这是一段模型自己写的、长度超过两百字的正文，用来确认软件不会拿数据把它覆盖掉。它必须原样保留，因为模型写的内容里可能有结构化数据装不下的细节，覆盖就等于静默丢东西。）".repeat(2),
    ].join("\n")
    const result = parse(`${own}\n\n\`\`\`json\n${JSON.stringify(profile)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: { ...request, content: "" } })}\n\`\`\``)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toBe(own.trim())
  })

  it("只写了两节时用数据补齐，不让 .md 只剩两节", () => {
    const partial = ["# 楚白（主角）", "", "## 基本信息", "", "- 职业：真正的掮客", "", "## 关系网络", "", "- 老秦：债主"].join("\n")
    const result = parse(`${partial}\n\n\`\`\`json\n${JSON.stringify(profile)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: { ...request, content: "" } })}\n\`\`\``)
    expect(result.requests).toHaveLength(1)
    const content = result.requests[0].content
    // 数据里的其余四个分区必须回来
    for (const heading of ["角色定位", "外在表现", "内在分析", "语言风格"]) {
      expect(content, `缺分区：${heading}`).toContain(`## ${heading}`)
    }
    // 数据里的字段也要在，不能只剩模型那两行
    expect(content).toContain("废品站的掮客")
  })

  it("多角色数组按文件名挑本份，绝不张冠李戴", () => {
    const second = {
      characterProfileData: {
        name: "老秦",
        tag: "债主",
        sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "职业", text: "废品站老板" }] }],
      },
    }
    const text = `\`\`\`json\n${JSON.stringify({ characterProfiles: [profile.characterProfileData, second.characterProfileData] })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: { ...request, fileName: "角色-老秦.md" } })}\n\`\`\``
    const result = parse(text)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toContain("# 老秦（债主）")
    expect(result.requests[0].content).not.toContain("三万七")
  })
})

describe("七类设定：正文同样由结构化数据反推（模型不再写第二遍）", () => {
  const parse = (text: string) => parseOutlineSaveRequests(text)
  const request = {
    writeMode: "create",
    referencedSkills: [],
    content: "",
  }
  const faction = {
    factionProfileData: {
      name: "青云商会",
      tag: "商户",
      tagline: "北境唯一敢走雪线的补给商",
      sections: [
        { kind: "kv", heading: "基本信息", items: [{ label: "据点", text: "霜河渡口" }] },
        {
          kind: "table",
          heading: "组织架构",
          head: ["层级或部门", "职责与权限", "负责人及制衡", "决策与执行", "继任和问责"],
          rows: [["外事组", "对接军营采购", "柳三", "掌柜点头才签", "暂无继任者"]],
        },
      ],
    },
  }

  it("势力档案只给 JSON，也能存出含表格的完整正文", () => {
    const result = parse(
      `\`\`\`json\n${JSON.stringify(faction)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织势力设定",
          fileName: "势力-青云商会.md",
          fileType: "organization",
          sourceIntent: "组织势力设定",
          ...request,
        },
      })}\n\`\`\``,
    )
    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    const content = result.requests[0].content
    expect(content).toContain("# 青云商会（商户）")
    expect(content).toContain("北境唯一敢走雪线的补给商")
    expect(content).toContain("## 基本信息")
    expect(content).toContain("- 据点：霜河渡口")
    expect(content).toContain("| 层级或部门 | 职责与权限 | 负责人及制衡 | 决策与执行 | 继任和问责 |")
    expect(content).toContain("掌柜点头才签")
  })

  it("fileType=setting 的地理/地点档案靠 JSON 顶层 key 也能反推", () => {
    const location = {
      locationProfileData: {
        name: "霜河渡口",
        tag: "关卡",
        sections: [{ kind: "kv", heading: "地点定位", items: [{ label: "位置", text: "霜河北岸，距城三日脚程" }] }],
      },
    }
    // 文件名与目录都不含「地点」二字：只能靠数据本身判断，否则正文会空着、保存失败
    const result = parse(
      `\`\`\`json\n${JSON.stringify(location)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "设定",
          fileName: "霜河渡口.md",
          fileType: "setting",
          sourceIntent: "",
          ...request,
        },
      })}\n\`\`\``,
    )
    expect(result.errors).toEqual([])
    expect(result.requests[0].content).toContain("## 地点定位")
    expect(result.requests[0].content).toContain("- 位置：霜河北岸，距城三日脚程")
  })

  it("多份档案按文件名挑本份，绝不张冠李戴", () => {
    const bandit = {
      name: "黑水帮",
      tag: "匪帮",
      sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "据点", text: "黑水湾" }] }],
    }
    const result = parse(
      `\`\`\`json\n${JSON.stringify({ factionProfiles: [faction.factionProfileData, bandit] })}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织势力设定",
          fileName: "势力-黑水帮.md",
          fileType: "organization",
          sourceIntent: "组织势力设定",
          ...request,
        },
      })}\n\`\`\``,
    )
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].content).toContain("# 黑水帮（匪帮）")
    expect(result.requests[0].content).not.toContain("霜河渡口")
  })

  it("围栏外只剩一句交代语时，也用数据补正文", () => {
    const result = parse(
      `已生成青云商会的势力档案。\n\n\`\`\`json\n${JSON.stringify(faction)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织势力设定",
          fileName: "势力-青云商会.md",
          fileType: "organization",
          sourceIntent: "组织势力设定",
          ...request,
        },
      })}\n\`\`\``,
    )
    expect(result.requests[0].content).toContain("## 组织架构")
    expect(result.requests[0].content.length).toBeGreaterThan(120)
  })

  it("模型真写了完整正文时保留它自己写的", () => {
    const own = [
      "# 青云商会（商户）",
      "",
      "## 基本信息",
      "",
      "- 据点：霜河渡口",
      "- 商队：三支，冬季只走一支",
      "",
      "## 组织架构",
      "",
      "掌柜之下设外事、账房、走货三组，外事组直接对接军营采购。",
    ].join("\n")
    const result = parse(
      `${own}\n\n\`\`\`json\n${JSON.stringify(faction)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({
        outlineSaveRequest: {
          targetFolder: "组织势力设定",
          fileName: "势力-青云商会.md",
          fileType: "organization",
          sourceIntent: "组织势力设定",
          ...request,
        },
      })}\n\`\`\``,
    )
    expect(result.requests[0].content).toBe(own.trim())
  })
})

describe("章纲：单条 chapterOutlineData 也能落盘（不再被结构闸门拒收）", () => {
  const parse = (text: string) => parseOutlineSaveRequests(text)
  const data = {
    chapterOutlineData: {
      title: "故事一 雨夜无我 · 章纲",
      story: { index: 1, name: "雨夜无我", range: "第 1 章", beats: "平" },
      chapters: [{
        n: 1,
        title: "雨夜里的货箱",
        stage: "起①",
        beat: "平",
        info: { goal: "让他第一次发现货箱不对劲" },
        events: [{ what: "他翻到箱底的油布", cause: "欠债不得不验货", action: "用指甲挑开缝线", result: "确认不是废铁", use: "推向更大的事" }],
      }],
      words: 2500,
    },
  }
  const request = {
    targetFolder: "大纲",
    fileName: "章纲-故事一.md",
    fileType: "chapter-outline",
    writeMode: "create",
    referencedSkills: [],
    sourceIntent: "章纲",
    content: "",
  }

  it("只给 JSON + 空 content：正文由数据反推，且能通过「内容像章纲」闸门", () => {
    /*
     * 回归点：分批产线（chapterOutlineBatch）在合并时显式调反推，但**单条**
     * chapterOutlineData 走不到那里。此前它只能靠 fillContentFromText 捞到
     * 围栏外那句「已生成」，随即被 hasChapterOutlineStructure 判「内容不像章纲」
     * 整条拒收 —— 用户看到「保存请求解析失败」，而数据其实完好。
     */
    const result = parse(`已生成。\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: request })}\n\`\`\``)
    expect(result.errors).toEqual([])
    expect(result.requests).toHaveLength(1)
    const content = result.requests[0].content
    expect(content).toContain("### §5 核心事件链")
    expect(content).toContain("用指甲挑开缝线")
    // 反推的正文必须能自证是章纲（闸门认的就是这几个词）
    expect(/本章目标|核心事件|场景顺序|章尾钩子|章首钩子/.test(content)).toBe(true)
    // 不许夹带 JSON
    expect(content).not.toMatch(/[{}]/)
    expect(content).not.toContain("chapterOutlineData")
  })

  it("模型真写了完整章纲时不覆盖它写的内容", () => {
    const own = [
      "# 故事一 章纲",
      "",
      "## 第 1 章 雨夜里的货箱",
      "",
      "### §1 基础信息",
      "",
      "- **本章目标：** 模型自己写的目标",
      "",
      "### §5 核心事件链",
      "",
      "| 事件 | 起因 | 行动 | 结果 | 作用 |",
      "| --- | --- | --- | --- | --- |",
      "| 模型写的事件 | 起因 | 行动 | 结果 | 作用 |",
    ].join("\n")
    const result = parse(`${own}\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n\n\`\`\`json\n${JSON.stringify({ outlineSaveRequest: request })}\n\`\`\``)
    expect(result.errors).toEqual([])
    expect(result.requests[0].content).toBe(own.trim())
  })
})
