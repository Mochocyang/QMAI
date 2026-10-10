import { describe, expect, it } from "vitest"
import {
  buildClassifiedOutlineSaveRequest,
  decideOutlineAutoSaveGate,
  isEventOutlineSaveBlocked,
  isSaveableOutlineDeliverable,
  prepareOutlineSaveDraft,
  prepareOutlineSaveSourceContent,
} from "./outline-save"

describe("outline save draft", () => {
  it("ignores frontmatter when deriving an outline title", () => {
    const draft = prepareOutlineSaveDraft(
      [
        "---",
        "type: outline-17",
        "title: \"旧标题\"",
        "---",
        "",
        "# 新的大纲标题",
        "",
        "大纲正文",
      ].join("\n"),
      [],
    )

    expect(draft.title).toBe("新的大纲标题")
    expect(draft.content).not.toContain("type: outline-17")
  })

  it("changes the title when it already exists in the outline library", () => {
    const draft = prepareOutlineSaveDraft("# 第1章\n\n新的章纲", ["第1章"])

    expect(draft.title).not.toBe("第1章")
    expect(draft.title).toBe("第1章-AI生成")
  })

  it("normalizes fenced and escaped markdown before saving", () => {
    const draft = prepareOutlineSaveDraft(
      [
        "```markdown",
        "\\# 将乱天下总纲",
        "",
        "\\## 一句话梗概",
        "",
        "\\- 主角用化学戏法立足乱世。",
        "```",
      ].join("\n"),
      [],
    )

    expect(draft.title).toBe("将乱天下总纲")
    expect(draft.content).toContain("# 将乱天下总纲")
    expect(draft.content).toContain("## 一句话梗概")
    expect(draft.content).toContain("- 主角用化学戏法立足乱世。")
    expect(draft.content).not.toContain("```markdown")
    expect(draft.content).not.toContain("\\#")
  })

  it("prepareOutlineSaveSourceContent 保留 markdown 围栏中的大纲正文", () => {
    const source = prepareOutlineSaveSourceContent([
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

    expect(source).toContain("修仙界总纲")
    expect(source).toContain("灵气复苏")
    expect(source).not.toContain("outlineSaveRequest")
    expect(source).not.toContain("```")
  })

  it("完整章纲即使引用卷纲节拍也判定为可保存章纲", () => {
    const content = [
      "# 章纲-第46章：第一次冷处理",
      "",
      "## 上层依据",
      "- **卷纲节拍：** 终局期",
      "",
      "## 本章目标",
      "男主第一次被公司冷处理，被迫从执行者转成旁观者。",
      "",
      "## 核心事件",
      "1. 早会被点名缺席关键项目。",
      "2. 直属领导改口称他先休息。",
      "3. 同事开始绕开他同步进度。",
      "",
      "## 场景顺序",
      "公司早会 → 茶水间 → 回家。",
    ].join("\n")

    expect(isSaveableOutlineDeliverable(content)).toBe(true)
    expect(buildClassifiedOutlineSaveRequest({
      content,
      sourceIntent: "生成完成后自动保存",
      sourceHint: "编写第 46 章章纲",
    })).toMatchObject({
      classification: {
        fileType: "chapter-outline",
        targetFolder: "章纲",
      },
      request: {
        fileType: "chapter-outline",
        targetFolder: "章纲",
        sourceIntent: "生成完成后自动保存",
      },
    })
  })

  it("短问答不视为可保存大纲", () => {
    expect(isSaveableOutlineDeliverable("第46章可以按卷纲节拍写冷处理。")).toBe(false)
    expect(isSaveableOutlineDeliverable("好的，我明白了。")).toBe(false)
  })

  it("分类保存的章纲请求也会补上 HTML（此前只给卷纲补，导致章纲保存提示未生成 HTML）", () => {
    const content = [
      "# 章纲-第46章：第一次冷处理",
      "",
      "## 本章目标",
      "男主第一次被公司冷处理，被迫从执行者转成旁观者。",
      "",
      "## 核心事件",
      "1. 早会被点名缺席关键项目。",
      "",
      "```json",
      JSON.stringify({
        chapterOutlineData: {
          title: "故事一 章纲",
          story: { index: 1, name: "雨夜无我", range: "第 46–46 章", beats: "平" },
          words: 0,
          chapters: [{ n: 46, title: "第一次冷处理" }],
        },
      }),
      "```",
    ].join("\n")

    const built = buildClassifiedOutlineSaveRequest({
      content,
      sourceIntent: "生成完成后自动保存",
      sourceHint: "编写第 46 章章纲",
    })

    expect(built?.classification.fileType).toBe("chapter-outline")
    expect(built?.request.htmlContent).toContain("<html")
    expect(built?.request.htmlContent).toContain("<details")
  })
})

/*
 * 事件细纲的**保存闸门**判据。
 *
 * 为什么抽成纯函数并单测：这两条闸门（自动通道的兜底 + 手动「保存为大纲」）
 * 原本是组件里的 `if (… === "event-outline") return`，而删掉那个 return
 * 过后 295 条测试仍会全绿 —— 源码文本断言管不住「行为」。
 * 这里直接喂一份**已分类的 event-outline** 进判据本身。
 */
describe("事件细纲保存闸门判据", () => {
  it("已分类的 event-outline 一律判为拦下", () => {
    expect(isEventOutlineSaveBlocked("event-outline")).toBe(true)
  })

  it("其余类型不被误拦（真章纲/卷纲/人物小传照常保存）", () => {
    for (const fileType of ["outline", "chapter-outline", "volume-outline", "character", "setting"]) {
      expect(isEventOutlineSaveBlocked(fileType)).toBe(false)
    }
  })

  it("请求全是事件细纲：直接收工，不掉进按正文分类的兜底腿", () => {
    expect(decideOutlineAutoSaveGate({
      droppedEventOutlineCount: 2,
      keptRequestCount: 0,
      errors: [],
      eventOutlineRejectionCount: 0,
    })).toBe("drop-event-outline")
  })

  it("还有非事件细纲的请求：继续走确认框那条路", () => {
    expect(decideOutlineAutoSaveGate({
      droppedEventOutlineCount: 1,
      keptRequestCount: 1,
      errors: [],
      eventOutlineRejectionCount: 0,
    })).toBe("continue")
  })

  it("错误里混着真正的解析错误：仍必须弹「请让 AI 重新输出」", () => {
    expect(decideOutlineAutoSaveGate({
      droppedEventOutlineCount: 0,
      keptRequestCount: 0,
      errors: ["事件细纲被拒", "缺 targetFolder"],
      eventOutlineRejectionCount: 1,
    })).toBe("surface-parse-errors")
  })

  it("错误全是事件细纲被拒：改弹 info，不要求模型重出一遍", () => {
    expect(decideOutlineAutoSaveGate({
      droppedEventOutlineCount: 0,
      keptRequestCount: 0,
      errors: ["事件细纲被拒"],
      eventOutlineRejectionCount: 1,
    })).toBe("notify-event-outline-dropped")
  })

  it("没有错误也没有请求：继续（由正文分类那条腿接棒）", () => {
    expect(decideOutlineAutoSaveGate({
      droppedEventOutlineCount: 0,
      keptRequestCount: 0,
      errors: [],
      eventOutlineRejectionCount: 0,
    })).toBe("continue")
  })
})
