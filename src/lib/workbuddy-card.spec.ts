import { describe, expect, it } from "vitest"
import {
  MAX_DEFAULT_MODELS,
  buildWorkbuddyCard,
  disableWorkbuddyCard,
  enableWorkbuddyCard,
  retuneWorkbuddyCard,
} from "./workbuddy-card"
import type { WorkbuddyModel } from "@/lib/workbuddy-accounts"

function model(overrides: Partial<WorkbuddyModel> & { id: string }): WorkbuddyModel {
  return {
    name: overrides.id,
    maxInputTokens: 262_144,
    maxOutputTokens: 65_536,
    supportsToolCall: true,
    supportsReasoning: false,
    isDefault: false,
    ...overrides,
  }
}

const models: WorkbuddyModel[] = [
  model({ id: "glm-5.3", maxInputTokens: 131_072 }),
  model({ id: "deepseek-v4.1-flash", maxInputTokens: 262_144, isDefault: true }),
  model({ id: "kimi-k2.6" }),
  model({ id: "hunyuan-t1" }),
  model({ id: "hunyuan-turbos" }),
]

describe("buildWorkbuddyCard", () => {
  it("默认勾 isDefault 在前，最多 3 个", () => {
    const card = buildWorkbuddyCard(models)
    expect(card.enabled).toBe(true)
    expect(card.savedModels?.length).toBe(MAX_DEFAULT_MODELS)
    expect(card.savedModels?.[0].model).toBe("deepseek-v4.1-flash")
    expect(card.model).toBe("deepseek-v4.1-flash")
  })

  it("上下文取已选模型里的最小值（避免长章节被上游拒绝）", () => {
    const card = buildWorkbuddyCard(models)
    // 选中 glm-5.3(131072) / deepseek(262144) / kimi(262144) → 最小值 131072
    expect(card.maxContextSize).toBe(131_072)
  })

  it("输出上限取默认模型的真实值", () => {
    const card = buildWorkbuddyCard(models)
    expect(card.maxOutputTokens).toBe(65_536)
  })

  it("目录为空时仍给出可用的卡片骨架", () => {
    const card = buildWorkbuddyCard([])
    expect(card.enabled).toBe(true)
    expect(card.savedModels).toEqual([])
    expect(card.maxContextSize).toBe(131_072)
    expect(card.maxOutputTokens).toBeUndefined()
  })

  it("模型缺失上下文时用兜底值而不是 0", () => {
    const card = buildWorkbuddyCard([model({ id: "x", maxInputTokens: 0, isDefault: true })])
    expect(card.maxContextSize).toBe(131_072)
  })
})

describe("retuneWorkbuddyCard", () => {
  it("用户改动勾选后只重算上下文，不动 enabled", () => {
    const card = { ...buildWorkbuddyCard(models), enabled: true }
    const narrowed = { ...card, savedModels: [{ id: "a", name: "kimi", model: "kimi-k2.6", createdAt: 1 }] }
    const next = retuneWorkbuddyCard(narrowed, models)
    expect(next.maxContextSize).toBe(262_144)
    expect(next.enabled).toBe(true)
  })

  it("没有勾选任何模型时原样返回", () => {
    const card = { ...buildWorkbuddyCard(models), savedModels: [] }
    expect(retuneWorkbuddyCard(card, models)).toBe(card)
  })

  it("勾选里有目录里已不存在的模型时忽略它", () => {
    const card = {
      ...buildWorkbuddyCard(models),
      savedModels: [
        { id: "gone", name: "gone", model: "removed-model", createdAt: 1 },
        { id: "kimi", name: "kimi", model: "kimi-k2.6", createdAt: 1 },
      ],
    }
    expect(retuneWorkbuddyCard(card, models).maxContextSize).toBe(262_144)
  })
})

describe("disable / enable", () => {
  it("删掉最后一个账号：置灰但保留模型列表", () => {
    const card = buildWorkbuddyCard(models)
    const disabled = disableWorkbuddyCard(card)
    expect(disabled.enabled).toBe(false)
    expect(disabled.savedModels?.length).toBe(card.savedModels?.length)
    expect(disabled.model).toBe(card.model)
  })

  it("重新登录后恢复启用，模型不丢", () => {
    const card = buildWorkbuddyCard(models)
    const restored = enableWorkbuddyCard(disableWorkbuddyCard(card))
    expect(restored.enabled).toBe(true)
    expect(restored.savedModels).toEqual(card.savedModels)
  })
})
