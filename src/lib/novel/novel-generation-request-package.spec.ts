import { describe, expect, it } from "vitest"
import {
  buildOutlineRegenerationInput,
  compactConsumedOutlineBlocks,
  createNovelGenerationRequestPackage,
  getNovelGenerationModelContent,
  getOutlineMessageModelContent,
  isExplicitStructuredGenerationFollowUp,
  isInternalOutlineMessage,
  mapOutlineConversationsForModel,
  mapOutlineMessagesForModel,
} from "./novel-generation-request-package"
import type { OutlineWizardRequest } from "./outline-wizard"

const request: OutlineWizardRequest = {
  task: "newBook", length: "long", channel: "male", genre: "xuanhuan",
  customGenre: "", inspiration: "?????????????", sellingPoints: ["????"],
  targets: ["??", "????"], scale: "120?", narrative: "thirdPerson", materialSource: "none",
}

describe("???????", () => {
  it("??????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    expect(value.version).toBe(1)
    expect(value.summary).not.toBe("??????")
    expect(value.details.length).toBeGreaterThan(0)
    expect(getNovelGenerationModelContent(value)).toBe("??????")
    expect(getOutlineMessageModelContent({ content: value.summary, novelGenerationRequest: value })).toBe("??????")
  })

  it("?????????????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    expect(mapOutlineMessagesForModel([
      { role: "user", content: value.summary, novelGenerationRequest: value },
      { role: "assistant", content: "", isAgentRunning: true },
      { role: "assistant", content: "??" },
    ])).toEqual([{ role: "user", content: "??????" }, { role: "assistant", content: "??" }])
  })

  it("preserves assistant reasoning_content for model replay", () => {
    expect(mapOutlineMessagesForModel([
      { role: "user", content: "继续完善大纲" },
      { role: "assistant", content: "已更新人物设定", reasoning_content: "先核对冲突" },
      { role: "assistant", content: "已确认方向", reasoning_content: "" },
    ])).toEqual([
      { role: "user", content: "继续完善大纲" },
      { role: "assistant", content: "已更新人物设定", reasoning_content: "先核对冲突" },
      { role: "assistant", content: "已确认方向", reasoning_content: "" },
    ])
  })

  it("keeps hidden internal prompts in model history while identifying legacy UI leaks", () => {
    const internal = {
      role: "user" as const,
      content: "继续生成",
      modelContent: "请按内部完整工作流生成正文",
      visibility: "internal" as const,
    }
    expect(isInternalOutlineMessage(internal)).toBe(true)
    expect(mapOutlineMessagesForModel([internal])).toEqual([
      { role: "user", content: "请按内部完整工作流生成正文" },
    ])
    expect(isInternalOutlineMessage({
      role: "user",
      content: "请按「AI大纲生成工作流」生成「章节细纲」。\n## PRD 3.1 主流程要求\n禁止再次输出 intent_clarity",
    })).toBe(true)
  })

  it("????????????", () => {
    const value = createNovelGenerationRequestPackage(request, "??????")
    const messages = [
      { role: "user" as const, content: value.summary, novelGenerationRequest: value },
      { role: "assistant" as const, content: "??" },
      { role: "user" as const, content: "????" },
    ]
    expect(buildOutlineRegenerationInput(messages)).toEqual({
      request: "????",
      history: [{ role: "user", content: "??????" }, { role: "assistant", content: "??" }],
      structuredGeneration: false,
    })
    expect(mapOutlineConversationsForModel([{ id: "c1", title: "??", messages }])[0].messages[0].content).toBe("??????")
  })

  it("??????????????????????????", () => {
    expect(isExplicitStructuredGenerationFollowUp("\u751f\u6210\u4eba\u7269\u8bbe\u5b9a", { generationContext: false })).toBe(true)
    expect(isExplicitStructuredGenerationFollowUp("\u751f\u6210\u4e16\u754c\u89c2", { generationContext: false })).toBe(true)
    expect(isExplicitStructuredGenerationFollowUp("\u89e3\u91ca\u4e00\u4e0b\u8fd9\u4e2a\u8bbe\u5b9a", { generationContext: false })).toBe(false)
    expect(isExplicitStructuredGenerationFollowUp("\u7ee7\u7eed\u5b8c\u5584\u4eba\u7269\u5173\u7cfb", { generationContext: true })).toBe(true)
  })

  it("??????????????????????", () => {
    const generationRequest = createNovelGenerationRequestPackage(request, "???????")
    expect(buildOutlineRegenerationInput([
      { role: "user", content: generationRequest.summary, novelGenerationRequest: generationRequest },
    ])).toEqual({ request: "???????", history: [], structuredGeneration: true })
  })
})

describe("历史里的结构化数据不再重复回灌（省输入 token）", () => {
  /** 造一份够大的卷纲数据：10 故事 × 10 环节 × 3 条，和真实生成体积同量级。 */
  function volumeReply() {
    const stages = ["起①", "起②", "起③", "承①", "承②", "承③", "转①", "转②", "合①", "合②"]
    const data = {
      volumeOutlineData: {
        title: "卷一 无我绝响",
        stories: Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          range: `第 ${i * 12 + 1}–${i * 12 + 12} 章`,
          title: `故事${i + 1}`,
          st: stages.map((stage) => ({
            stage,
            label: "沐浴昏死",
            who: "杨寒（主角）＋ 陈守拙（引路）",
            p: ["雨夜断电，编号在纸上自己浮出来", "他用手压住纸条，血从指缝里渗下去", "门外有人叫了他的本名"],
          })),
        })),
      },
    }
    return ["正文若干", "```json", JSON.stringify(data), "```"].join("\n")
  }

  it("volumeOutlineData 围栏被压成一行说明，payload 不再出现", () => {
    const compacted = compactConsumedOutlineBlocks(volumeReply())
    expect(compacted).toContain("volumeOutlineData 结构化数据已由软件保存")
    expect(compacted).not.toContain("沐浴昏死")
    expect(compacted.length).toBeLessThan(volumeReply().length / 10)
  })

  it("outlineSaveRequest 保留「存到哪个文件」，方便后续改动定位", () => {
    const reply = [
      "```json",
      JSON.stringify({ outlineSaveRequest: {
        targetFolder: "卷纲",
        fileName: "卷纲-第01卷.md",
        fileType: "volume-outline",
        writeMode: "create",
        referencedSkills: [],
        sourceIntent: "生成卷纲",
        content: "很长的正文".repeat(200),
      } }),
      "```",
    ].join("\n")
    const compacted = compactConsumedOutlineBlocks(reply)
    expect(compacted).toContain("卷纲/卷纲-第01卷.md")
    expect(compacted).not.toContain("很长的正文")
  })

  it("普通对话与短文不被动：没有结构化围栏就原样返回", () => {
    const plain = "这一卷的冲突还不够硬，建议让对手在起③先出一次手。"
    expect(compactConsumedOutlineBlocks(plain)).toBe(plain)
    const small = '```json\n{"note":"短"}\n```'
    expect(compactConsumedOutlineBlocks(small)).toBe(small)
  })

  it("只压 assistant 历史，用户自己贴的内容不动", () => {
    const mapped = mapOutlineMessagesForModel([
      { role: "user", content: volumeReply() },
      { role: "assistant", content: volumeReply() },
    ])
    expect(mapped[0].content).toContain("沐浴昏死")
    expect(mapped[1].content).toContain("结构化数据已由软件保存")
  })

  it("整条消息只有结构化数据时留一行说明，不会变成空消息", () => {
    const mapped = mapOutlineMessagesForModel([{ role: "assistant", content: volumeReply() }])
    expect(mapped).toHaveLength(1)
    expect(mapped[0].content.trim().length).toBeGreaterThan(0)
    expect(mapped[0].content).not.toContain("沐浴昏死")
  })

  /*
   * 八类设定一次生成多个对象时用的是复数数组（factionProfiles / locationProfiles…）。
   * 复数 key 漏在压缩清单外，多轮里那一大坨已保存档案就会一直原样回灌 —— 正是
   * 「没几轮就烧钱」最典型的成因，所以单/复数必须成对覆盖。
   */
  it("八类设定的复数数组（多对象批量）同样被压成一行", () => {
    const reply = [
      "```json",
      JSON.stringify({
        factionProfiles: [
          { name: "青云商会", tag: "商户", sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "据点", text: "霜河渡口南岸货栈，占地约六亩，含三座冻库，冬季只开西侧那扇门。" }] }] },
          { name: "黑水帮", tag: "匪帮", sections: [{ kind: "kv", heading: "基本信息", items: [{ label: "据点", text: "黑水湾上游的石滩，涨水时只剩一条窄路进出。" }] }] },
        ],
      }),
      "```",
    ].join("\n")
    const compacted = compactConsumedOutlineBlocks(reply)
    expect(compacted).toContain("factionProfiles 结构化数据已由软件保存")
    expect(compacted).not.toContain("霜河渡口")
  })
})
