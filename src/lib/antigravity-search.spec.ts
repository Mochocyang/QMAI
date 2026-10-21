import { describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AntigravitySearchError,
  antigravitySearchDetailed,
  interpretAntigravitySearchRaw,
  parseAntigravitySearchOutput,
  type AntigravitySearchRaw,
} from "./antigravity-search"

// 合成样例：按官方 headless 文档与 1.1.8 changelog（tool_info 含工具名、参数、输出）构造，未经真机验证。
const lines = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n"
const init = { event: "init", conversation_id: "c1", init: { cwd: "/tmp/x", tools: ["search_web"], permission_mode: "request-review" } }
const searchStep = (query: string, output: unknown) => ({
  event: "step_update",
  step_update: {
    conversation_id: "c1",
    step_index: 1,
    state: "DONE",
    step_type: "tool",
    tool_name: "search_web",
    tool_info: { name: "search_web", parameters: { query }, output },
  },
})
const resultEvent = (response: unknown, status = "SUCCESS") => ({ event: "result", result: { status, response } })

const okRaw = (stdout: string): AntigravitySearchRaw => ({ notInstalled: false, timedOut: false, exitCode: 0, stdout, stderr: "", error: null })

describe("parseAntigravitySearchOutput", () => {
  it("取 tool_info 里的实际搜索词、最终 JSON 的摘要，并存下来源链接", () => {
    const stdout = lines(
      init,
      searchStep("T-80BVM 主战坦克", { results: [{ title: "T-80BVM", url: "https://example.com/t80", snippet: "s" }] }),
      searchStep("T-80BVM Relikt", "参见 https://www.army.example.org/a 。"),
      { event: "step_update", step_update: { step_type: "agent_response", text_delta: "思考" } },
      resultEvent(JSON.stringify({ queries: ["模型自报的词"], summary: "T-80BVM 是 T-80BV 的现代化改型。\n\n配 Relikt 反应装甲。" })),
    )
    const out = parseAntigravitySearchOutput(stdout)
    expect(out.queries).toEqual(["T-80BVM 主战坦克", "T-80BVM Relikt"])
    expect(out.summary).toBe("T-80BVM 是 T-80BV 的现代化改型。\n\n配 Relikt 反应装甲。")
    expect(out.results.map((r) => r.url)).toEqual(["https://example.com/t80", "https://www.army.example.org/a"])
  })

  it("没有 tool_info 时退回最终 JSON 的 queries；支持代码块包裹和 structured_output", () => {
    const fenced = parseAntigravitySearchOutput(lines(init, resultEvent("```json\n{\"queries\":[\"Tu-244\"],\"summary\":\"图-244 是未建成的超音速客机方案。\"}\n```")))
    expect(fenced).toEqual({ queries: ["Tu-244"], summary: "图-244 是未建成的超音速客机方案。", results: [] })
    const structured = parseAntigravitySearchOutput(lines({ event: "result", result: { status: "SUCCESS", structured_output: { queries: ["a"], summary: "b" } } }))
    expect(structured.summary).toBe("b")
  })

  it("最终回答不是 JSON 时把整段回答当摘要", () => {
    expect(parseAntigravitySearchOutput(lines(resultEvent("纯文本摘要"))).summary).toBe("纯文本摘要")
  })

  it("解析失败给中文错误", () => {
    expect(() => parseAntigravitySearchOutput("garbage")).toThrow(/无法解析反重力 CLI 的输出/)
    expect(() => parseAntigravitySearchOutput(lines(init))).toThrow(/没有返回最终结果/)
    expect(() => parseAntigravitySearchOutput(lines(resultEvent("{\"queries\":[],\"summary\":\"\"}")))).toThrow(/没有摘要/)
    expect(() => parseAntigravitySearchOutput(lines({ event: "result", result: { status: "ERROR", error: "quota exceeded" } }))).toThrow(/quota exceeded/)
  })
})

describe("interpretAntigravitySearchRaw", () => {
  it("未安装", () => {
    expect(() => interpretAntigravitySearchRaw({ ...okRaw(""), notInstalled: true, error: "未检测到 agy" })).toThrow(/未检测到 Antigravity CLI/)
  })
  it("未登录", () => {
    expect(() => interpretAntigravitySearchRaw({ ...okRaw(""), exitCode: 1, stderr: "Error: authentication required" })).toThrow(/未登录/)
  })
  it("未登录（agy 1.4.3 真机输出：等待登录 60 秒后返回 ERROR 结果）", () => {
    const stdout = 'Authentication required. Please visit the URL to log in:\n\nWaiting for authentication (timeout 60s)...\n' +
      '{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"authentication failed or timed out","duration_seconds":0,"num_turns":0}}\n'
    expect(() => interpretAntigravitySearchRaw({ ...okRaw(stdout), exitCode: 1, stderr: "error: authentication failed or timed out" })).toThrow(/未登录/)
  })
  it("超时", () => {
    expect(() => interpretAntigravitySearchRaw({ ...okRaw(lines(init)), timedOut: true, exitCode: null })).toThrow(/超时/)
  })
  it("没有输出时带上退出码和 stderr", () => {
    expect(() => interpretAntigravitySearchRaw({ ...okRaw(""), exitCode: 2, stderr: "boom" })).toThrow(/退出码 2.*boom/)
  })
  it("都是 AntigravitySearchError", () => {
    try {
      interpretAntigravitySearchRaw({ ...okRaw(""), timedOut: true })
    } catch (e) {
      expect(e).toBeInstanceOf(AntigravitySearchError)
    }
  })
})

describe("antigravitySearchDetailed", () => {
  it("调用独立的 antigravity_cli_search 命令", async () => {
    const invoke = vi.fn().mockResolvedValue(okRaw(lines(searchStep("q1", null), resultEvent("{\"queries\":[],\"summary\":\"摘要\"}"))))
    const out = await antigravitySearchDetailed("问题", { invoke, model: " m ", maxResults: 5 })
    expect(invoke).toHaveBeenCalledWith("antigravity_cli_search", { query: "问题", model: "m", maxResults: 5, timeoutSecs: 180 })
    expect(out).toEqual({ queries: ["q1"], summary: "摘要", results: [] })
  })
  it("invoke 本身失败（例如旧版应用没有该命令）也不崩，给中文错误", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("command not found"))
    await expect(antigravitySearchDetailed("x", { invoke })).rejects.toThrow(/无法调用反重力 CLI 搜索/)
  })
})

describe("真机样例（agy 1.4.3，去掉 conversation_id / usage）", () => {
  const fixture = (name: string) =>
    readFileSync(join(__dirname, "fixtures/antigravity-search", name), "utf8")

  it("带 --json-schema：搜索词来自 tool_info，摘要来自 structured_output，没有来源链接", () => {
    const out = parseAntigravitySearchOutput(fixture("tu244-json-schema.jsonl"))
    expect(out.queries).toEqual(["Tu-244"])
    expect(out.summary.startsWith("图波列夫 Tu-244")).toBe(true)
    expect(out.summary).toContain("\n\n")
    expect(out.results).toEqual([])
  })

  it("不带 --json-schema：ACTIVE/DONE 两条 tool_info 去重，整段回答当摘要", () => {
    const out = parseAntigravitySearchOutput(fixture("t80bvm-plain-3-searches.jsonl"))
    expect(out.queries).toEqual(["T-80BVM main battle tank"])
    expect(out.summary.startsWith("**T-80BVM**")).toBe(true)
    expect(out.results).toEqual([])
  })
})

describe("antigravity search default model", () => {
  it("falls back to the cheap flash model when empty, and supports explicit agy default", async () => {
    const { resolveAntigravitySearchModel, DEFAULT_ANTIGRAVITY_SEARCH_MODEL, ANTIGRAVITY_AGY_DEFAULT_MODEL, antigravityModelLabel } = await import("./antigravity-search")
    expect(DEFAULT_ANTIGRAVITY_SEARCH_MODEL).toBe("gemini-3.8-flash-low")
    expect(resolveAntigravitySearchModel(undefined)).toBe("gemini-3.8-flash-low")
    expect(resolveAntigravitySearchModel("  ")).toBe("gemini-3.8-flash-low")
    expect(resolveAntigravitySearchModel(ANTIGRAVITY_AGY_DEFAULT_MODEL)).toBeNull()
    expect(resolveAntigravitySearchModel(" gemini-x ")).toBe("gemini-x")
    expect(antigravityModelLabel("gemini-3.8-flash-low")).toBe("Gemini 3.8 Flash (Low)")
    expect(antigravityModelLabel("gpt-oss-120b-medium")).toBe("GPT OSS 120b (Medium)")
  })
})
