import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/lib/llm-providers"
import { getProviderConfig } from "@/lib/llm-providers"
import { buildAgentRequestMessages } from "./cache-aware-messages"

const history: ChatMessage[] = [{ role: "user", content: "初始目标" }, { role: "assistant", content: "已确认主线" }]
function input(chapter: number): ChatMessage[] {
  return [{ role: "system", content: [
    { type: "text", text: "固定软件规则\n" },
    { type: "text", text: "全书稳定资料", cacheControl: true },
    { type: "text", text: `本轮第${chapter}章参考资料` },
  ] }, ...history, { role: "user", content: `写第${chapter}章` }]
}
function text(message: ChatMessage) {
  return typeof message.content === "string" ? message.content : message.content.map((b) => b.type === "text" ? b.text : "").join("")
}

describe("Agent最终缓存请求布局", () => {
  it("任务契约和动态上下文都在历史之后，实际协议体前部保持一致", () => {
    const first = buildAgentRequestMessages(input(1), "任务契约：写第1章")
    const second = buildAgentRequestMessages(input(2), "任务契约：写第2章")
    expect(first.slice(0, -1)).toEqual(second.slice(0, -1))
    expect(first.filter((m) => m.role === "system").map(text).join("")).not.toContain("本轮第1章")
    expect(text(first[first.length - 1])).toContain("本轮第1章参考资料")
    expect(text(first[first.length - 1])).toContain("任务契约：写第1章")
    expect(text(first[first.length - 1])).toContain("写第1章")
    expect(first.slice(1, 3).map(text)).toEqual(history.map(text))
    const provider = getProviderConfig({ provider: "openai", model: "gpt-test", apiKey: "", customEndpoint: "", ollamaUrl: "", maxContextSize: 32000 })
    const body1 = provider.buildBody(first) as { messages: unknown[] }
    const body2 = provider.buildBody(second) as { messages: unknown[] }
    expect(body1.messages.slice(0, -1)).toEqual(body2.messages.slice(0, -1))
    expect(input(1)[0].content).toHaveLength(3)
  })

  it("原文已在用户缓存块中时，契约不得插到原文之前", () => {
    const original: ChatMessage[] = [{ role: "user", content: [
      { type: "text", text: "共同原文材料".repeat(1000), cacheControl: true },
      { type: "text", text: "提取角色甲" },
    ] }]
    const output = buildAgentRequestMessages(original, "任务契约：提取角色甲")
    expect(output[0].content[0]).toEqual(original[0].content[0])
    expect(text(output[0])).toContain("任务契约：提取角色甲")
  })

  it("没有显式缓存块的旧调用仍保留原有系统契约行为", () => {
    const messages: ChatMessage[] = [{ role: "system", content: "原系统规则" }, ...history, { role: "user", content: "继续" }]
    const output = buildAgentRequestMessages(messages, "任务契约：继续")
    expect(output[1]).toEqual({ role: "system", content: "任务契约：继续" })
    expect(output.slice(2)).toEqual(messages.slice(1))
  })
})
