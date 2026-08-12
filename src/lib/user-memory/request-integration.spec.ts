import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/lib/llm-providers"
import { addManualUserMemoryRule, loadGlobalUserMemoryConfig, saveGlobalUserMemoryConfig } from "./store"
import { applyGlobalUserMemoryToMessages } from "./request-integration"
import { getLatestUserMemoryDecision } from "./decision-trace"

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

function withRules(storage: MemoryStorage) {
  let config = loadGlobalUserMemoryConfig(storage)
  config = addManualUserMemoryRule(config, {
    rule: "写作保持幽默。",
    category: "writing_preference",
    surfaces: ["chapter-writing"],
  }, 1)
  config = addManualUserMemoryRule(config, {
    rule: "回答时先给结论。",
    category: "interaction_preference",
    surfaces: ["all"],
  }, 2)
  saveGlobalUserMemoryConfig(config, storage)
}

describe("global user memory request integration", () => {
  it("关闭自动读取时不修改消息", () => {
    const storage = new MemoryStorage()
    saveGlobalUserMemoryConfig({ ...loadGlobalUserMemoryConfig(storage), autoRead: false }, storage)
    const messages: ChatMessage[] = [{ role: "user", content: "续写下一章" }]

    const result = applyGlobalUserMemoryToMessages(messages, {}, storage)
    expect(result.messages).toBe(messages)
    expect(result.decision).not.toBeNull()
  })

  it("写作任务只注入相关规则", () => {
    const storage = new MemoryStorage()
    withRules(storage)
    const result = applyGlobalUserMemoryToMessages([
      { role: "system", content: "软件规则" },
      { role: "user", content: "续写下一章正文" },
    ], { userMemorySurface: "chapter-writing" }, storage)

    expect(String(result.messages[0]?.content)).toContain("写作保持幽默")
    expect(String(result.messages[0]?.content)).toContain("回答时先给结论")
    expect(result.decision?.selectedRuleIds.length).toBeGreaterThan(0)
  })

  it("审查任务不注入创作文风并保留缓存块", () => {
    const storage = new MemoryStorage()
    withRules(storage)
    const messages: ChatMessage[] = [
      { role: "system", content: [
        { type: "text", text: "软件规则" },
        { type: "text", text: "项目稳定核心", cacheControl: true },
      ] },
      { role: "user", content: "请审查这一章" },
    ]
    const result = applyGlobalUserMemoryToMessages(messages, { userMemorySurface: "review" }, storage)
    const blocks = result.messages[0]?.content

    expect(Array.isArray(blocks)).toBe(true)
    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: "项目稳定核心", cacheControl: true }),
    ]))
    expect(JSON.stringify(blocks)).not.toContain("写作保持幽默")
    expect(JSON.stringify(blocks)).toContain("回答时先给结论")
  })

  it("skipUserMemory 防止提取器递归注入", () => {
    const storage = new MemoryStorage()
    withRules(storage)
    const messages: ChatMessage[] = [{ role: "user", content: "分析用户偏好" }]

    expect(applyGlobalUserMemoryToMessages(messages, { skipUserMemory: true }, storage)).toEqual({
      messages,
      decision: null,
    })
  })

  it("后台提取器跳过记忆时不覆盖最近一次用户请求决策", () => {
    const storage = new MemoryStorage()
    withRules(storage)
    applyGlobalUserMemoryToMessages([{ role: "user", content: "请回答问题" }], { userMemorySurface: "ai-chat" }, storage)
    const before = getLatestUserMemoryDecision()

    applyGlobalUserMemoryToMessages([{ role: "user", content: "后台提取" }], { skipUserMemory: true }, storage)

    expect(getLatestUserMemoryDecision()).toEqual(before)
  })

  it("按作品和会话上下文选择最近层级并记录决策", () => {
    const storage = new MemoryStorage()
    let config = loadGlobalUserMemoryConfig(storage)
    config = addManualUserMemoryRule(config, {
      rule: "全局规则。", category: "manual", surfaces: ["all"], scope: "global",
    }, 1)
    config = addManualUserMemoryRule(config, {
      rule: "作品规则。", category: "manual", surfaces: ["all"], scope: "project", projectKey: "p1",
    }, 2)
    config = addManualUserMemoryRule(config, {
      rule: "会话规则。", category: "manual", surfaces: ["all"], scope: "session", projectKey: "p1", sessionKey: "s1",
    }, 3)
    saveGlobalUserMemoryConfig(config, storage)

    const result = applyGlobalUserMemoryToMessages([
      { role: "user", content: "请回答" },
    ], { userMemorySurface: "ai-chat", userMemoryProjectKey: "p1", userMemorySessionKey: "s1" }, storage)

    expect(JSON.stringify(result.messages)).toContain("会话规则")
    expect(result.decision).toMatchObject({ projectKey: "p1", sessionKey: "s1" })
    expect(result.decision?.selectedRuleIds.length).toBe(3)
    expect(getLatestUserMemoryDecision()).toMatchObject({ projectKey: "p1", sessionKey: "s1" })
  })

  it("仅手动模式过滤自动规则并记录过滤原因", () => {
    const storage = new MemoryStorage()
    const config = loadGlobalUserMemoryConfig(storage)
    saveGlobalUserMemoryConfig({
      ...config,
      onlyManual: true,
      rules: [{
        id: "auto", rule: "自动规则。", category: "manual", source: "automatic", surfaces: ["all"], confidence: 1,
        evidenceSummary: "", sourceHash: "h", fingerprint: "auto", enabled: true, createdAt: 1, updatedAt: 1,
        scope: "global", status: "active",
      }],
    }, storage)

    const messages = [{ role: "user" as const, content: "请回答" }]
    const result = applyGlobalUserMemoryToMessages(messages, { userMemorySurface: "ai-chat" }, storage)
    expect(result.messages).toBe(messages)
    expect(result.decision?.filtered).toContainEqual({ ruleId: "auto", reason: "disabled" })
  })
})
