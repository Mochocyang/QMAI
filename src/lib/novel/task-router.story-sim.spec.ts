import { describe, expect, it } from "vitest"
import { routeTask } from "./task-router"

describe("routeTask story simulation intents", () => {
  describe("story_framework_generate", () => {
    it("识别'故事框架'关键词", () => {
      const route = routeTask("生成故事框架")
      expect(route.intent).toBe("story_framework_generate")
    })

    it("识别'剧情框架'关键词", () => {
      const route = routeTask("帮我创建剧情框架")
      expect(route.intent).toBe("story_framework_generate")
    })

    it("识别'生成框架'关键词", () => {
      const route = routeTask("生成框架")
      expect(route.intent).toBe("story_framework_generate")
    })

    it("识别以'故事框架生成'开头的请求", () => {
      const route = routeTask("故事框架生成一个悬疑小说")
      expect(route.intent).toBe("story_framework_generate")
    })
  })

  describe("multi_agent_simulate", () => {
    it("识别'推演剧情'关键词", () => {
      const route = routeTask("推演剧情走向")
      expect(route.intent).toBe("multi_agent_simulate")
    })

    it("识别'多智能体推演'关键词", () => {
      const route = routeTask("多智能体推演")
      expect(route.intent).toBe("multi_agent_simulate")
    })

    it("识别'剧情走向'关键词", () => {
      const route = routeTask("分析一下剧情走向")
      expect(route.intent).toBe("multi_agent_simulate")
    })

    it("识别'推演一下'关键词", () => {
      const route = routeTask("推演一下主角发现真相后的发展")
      expect(route.intent).toBe("multi_agent_simulate")
    })

    it("识别'推演剧情走向'关键词", () => {
      const route = routeTask("推演剧情走向")
      expect(route.intent).toBe("multi_agent_simulate")
    })

    it("识别以'推演'开头的请求", () => {
      const route = routeTask("推演第三章之后的剧情")
      expect(route.intent).toBe("multi_agent_simulate")
    })
  })

  describe("character_interview", () => {
    it("识别'角色采访'关键词", () => {
      const route = routeTask("角色采访李明")
      expect(route.intent).toBe("character_interview")
    })

    it("识别'采访角色'关键词", () => {
      const route = routeTask("采访角色主角")
      expect(route.intent).toBe("character_interview")
    })

    it("识别'问角色'关键词", () => {
      const route = routeTask("问角色一个问题")
      expect(route.intent).toBe("character_interview")
    })

    it("识别以'角色采访'开头的请求", () => {
      const route = routeTask("角色采访一下女主角")
      expect(route.intent).toBe("character_interview")
    })
  })
})
