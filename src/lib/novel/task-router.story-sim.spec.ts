import { describe, expect, it } from "vitest"
import { routeTask, type NovelTaskIntent } from "./task-router"

function asIntent(intent: NovelTaskIntent, confidence = 0.83) {
  return { classification: { intent, confidence } }
}

describe("routeTask story simulation intents", () => {
  it("keeps the model story-framework intent instead of matching 框架 keywords", async () => {
    const route = await routeTask("帮我搭一个悬疑故事的骨架", asIntent("story_framework_generate", 0.66))

    expect(route.intent).toBe("story_framework_generate")
    expect(route.confidence).toBe(0.66)
  })

  it("does not assign story_framework_generate just because the text says 故事框架", async () => {
    const route = await routeTask("生成故事框架", { classification: null })

    expect(route.intent).toBe("general_chat")
  })

  it("keeps a model simulation intent and still parses a structural chapter number", async () => {
    const route = await routeTask("推演第三章之后的剧情", asIntent("multi_agent_simulate", 0.74))

    expect(route.intent).toBe("multi_agent_simulate")
    expect(route.chapterNumber).toBe(3)
    expect(route.confidence).toBe(0.74)
  })

  it("does not assign multi_agent_simulate from 推演 wording alone", async () => {
    const route = await routeTask("推演剧情走向", { classification: null })

    expect(route.intent).toBe("general_chat")
  })

  it("keeps a model character-interview intent", async () => {
    const route = await routeTask("我想听听李明怎么解释这件事", asIntent("character_interview"))

    expect(route.intent).toBe("character_interview")
    expect(route.confidence).toBe(0.83)
  })

  it("does not assign character_interview from 角色采访 wording alone", async () => {
    const route = await routeTask("角色采访李明", { classification: null })

    expect(route.intent).toBe("general_chat")
  })
})
