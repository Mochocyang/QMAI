import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentRunner } from "./runner"
import { ToolRegistry } from "./registry"
import { resetHttpFetchForTests } from "../tauri-fetch"
import type { AgentConfig } from "./types"

// 使用实际 AgentRunner + streamChat + SSE解析，仅替换网络传输，绝不访问真实模型。
afterEach(() => {
  resetHttpFetchForTests()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("真实SSE解析链路的断流回归", () => {
  it("收到两个正文事件后reader抛解码错误，正文仍到达调用方且请求失败", async () => {
    vi.useFakeTimers()
    const encoder = new TextEncoder()
    const packet = (content: string) => encoder.encode(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`)
    const releaseLock = vi.fn()
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({done:false,value:packet("# 金手指设定：回响\n")})
        .mockResolvedValueOnce({done:false,value:packet("## 能力规则\n只能读取旧物方向。")})
        .mockRejectedValueOnce(new Error("error decoding response body")),
      releaseLock,
    }
    const response = new Response(null, {status:200,headers:{"Content-Type":"text/event-stream"}})
    Object.defineProperty(response, "body", {value:{getReader:()=>reader}})
    const fetchMock = vi.fn().mockResolvedValue(response)
    vi.stubGlobal("fetch", fetchMock)
    const config: AgentConfig = {
      systemPrompt:"生成设定",maxRounds:2,tools:[],
      llmConfig:{provider:"custom",apiKey:"test-key",model:"test-model",customEndpoint:"https://stream-recovery.invalid/v1",ollamaUrl:"",apiMode:"chat_completions",maxContextSize:120000},
    }
    const callbacks = {onText:vi.fn(),onDone:vi.fn(),onError:vi.fn(),onToolCall:vi.fn(),onToolResult:vi.fn(),onToolError:vi.fn()}
    const result = await new AgentRunner().run(config,new ToolRegistry(),[{role:"system",content:"生成设定"},{role:"user",content:"只生成一个金手指设定"}],callbacks)
    expect(result.finalText).toBe("# 金手指设定：回响\n## 能力规则\n只能读取旧物方向。")
    expect(callbacks.onText).toHaveBeenCalledExactlyOnceWith(result.finalText)
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining("流式响应读取中断")}))
    expect(callbacks.onDone).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(releaseLock).toHaveBeenCalledTimes(1)
    expect(result.requestTraces?.at(-1)?.status).toBe("network_error")
  })
})
