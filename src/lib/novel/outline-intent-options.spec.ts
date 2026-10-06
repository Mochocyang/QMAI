import { describe, expect, it } from "vitest"
import type { OutlineListEntry } from "@/lib/agent/tools/outline-list-helpers"
import {
  CUSTOM_INTENT_OPTION_ID,
  resolveIntentOptions,
} from "./outline-intent-options"

const CUSTOM_LABEL = "自定义"
import type { IntentClarityResult } from "./outline-intent-clarity"

function result(overrides: Partial<IntentClarityResult> = {}): IntentClarityResult {
  return {
    clarity: "needs_input",
    module: "卷纲",
    analysis: "判断依据",
    detectedScope: "",
    missingItems: [],
    options: [],
    question: "请选择本次要生成哪一卷的折叠树卷纲。",
    ...overrides,
  }
}

function entry(relativePath: string, folder?: string): OutlineListEntry {
  return { relativePath, absolutePath: `D:/p/wiki/outlines/${relativePath}`, folder }
}

describe("意图澄清选项解析", () => {
  it("模型给出选项时直接采用，并保留顺序", () => {
    const options = resolveIntentOptions(result({
      options: [
        { id: "A", label: "第二卷", description: "归墟寄魂" },
        { id: "B", label: "第三卷", description: "记忆深渊" },
      ],
    }))

    expect(options.map((option) => option.label)).toEqual(["第二卷", "第三卷", CUSTOM_LABEL])
    expect(options.at(-1)?.id).toBe(CUSTOM_INTENT_OPTION_ID)
  })

  it("模型返回空选项时，从缺失项里解析出真实卷次候选", () => {
    const options = resolveIntentOptions(result({
      missingItems: [
        "未明确要生成哪一卷的折叠树卷纲（第二卷归墟寄魂 / 第三卷记忆深渊 / 第四卷无名样本）",
      ],
    }))

    expect(options.map((option) => option.label)).toEqual([
      "第二卷归墟寄魂",
      "第三卷记忆深渊",
      "第四卷无名样本",
      CUSTOM_LABEL,
    ])
    expect(options[0].description).toContain("折叠树卷纲")
  })

  it("括号里的非候选说明不会被误当成选项", () => {
    const options = resolveIntentOptions(result({
      missingItems: [
        "未明确第七卷千碑城卷纲是否需要按折叠树标准（10故事×10环节＋volumeOutlineData）重构",
      ],
    }))

    const labels = options.map((option) => option.label)
    expect(labels).not.toContain("10故事×10环节＋volumeOutlineData")
    expect(labels.some((label) => label.includes("需要按折叠树标准"))).toBe(true)
    expect(options.at(-1)?.id).toBe(CUSTOM_INTENT_OPTION_ID)
  })

  it("缺少可用缺失项时，退回已有文档作为补充/修订候选", () => {
    const options = resolveIntentOptions(
      result({ missingItems: ["未明确范围"] }),
      [
        entry("卷纲/卷纲-第一卷无我绝响.md", "卷纲"),
        entry("设定/力量体系.md", "设定"),
        entry("大纲/总纲.md", "大纲"),
      ],
    )

    // 模块是卷纲，只应给出卷纲类文档；设定与总纲不属于本次可生成对象。
    expect(options.map((option) => option.label)).toEqual([
      "补《卷纲-第一卷无我绝响》",
      CUSTOM_LABEL,
    ])
    expect(options.map((option) => option.label)).not.toContain("补《总纲》")
    expect(options.map((option) => option.label)).not.toContain("补《力量体系》")
  })

  it("选项数量过多时截断，但自定义项永远保留", () => {
    const many = Array.from({ length: 14 }, (_, index) => `第${index + 1}卷卷名${index + 1}`).join(" / ")
    const options = resolveIntentOptions(result({
      missingItems: [`未明确要生成哪一卷的折叠树卷纲（${many}）`],
    }))

    expect(options.length).toBeLessThanOrEqual(9)
    expect(options.at(-1)?.id).toBe(CUSTOM_INTENT_OPTION_ID)
  })

  it("完全没有可用信息时也只呈现自定义，绝不给出空白列表", () => {
    const options = resolveIntentOptions(result({ missingItems: [] }))

    expect(options).toEqual([
      { id: CUSTOM_INTENT_OPTION_ID, label: "自定义", description: "自己填写本次要生成的范围" },
    ])
  })

  it("丢弃模型返回的残缺选项（缺少 ID 或标题）", () => {
    const options = resolveIntentOptions(result({
      options: [
        { id: "", label: "没有 ID", description: "" },
        { id: "B", label: "   ", description: "" },
        { id: "C", label: "有效选项", description: "" },
      ],
    }))

    expect(options.map((option) => option.label)).toEqual(["有效选项", CUSTOM_LABEL])
  })
})
