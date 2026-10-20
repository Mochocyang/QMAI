// 兼容回归：非 Gemini 搜索后端的上下文文本、工具结果、时间线显示必须与 main 上（接入 Gemini 之前）逐字节一致。
// golden 由 origin/main 的代码生成（见 PR 描述），这里在当前代码上重新生成并逐项比较。
import { describe, expect, it, vi } from "vitest"
import golden from "./__fixtures__/search-compat-golden.json"
import { extractSearchDisplayDetail, splitToolResultForModel } from "@/lib/search-display"
import { buildWebResearchContext, collectWebResearch } from "@/lib/web-research"
import { formatWritingEntitySearchMarkdown, serializeWritingEntitySearchWorkflowResult, formatWritingEntitySearchWorkflowResult, displayWritingEntitySearchWorkflowContent } from "@/lib/novel/writing-entity-web-search"
import { getWorkflowToolResultDisplay, getWorkflowToolDescription } from "@/lib/agent/workflow-trace"
import { createWebSearchTool } from "@/lib/agent/tools/web-search"

const results = [
  { title: "黄蓉 - 维基百科", url: "https://zh.wikipedia.org/wiki/%E9%BB%84%E8%93%89", snippet: "黄蓉，金庸武侠小说《射雕英雄传》女主角。", source: "zh.wikipedia.org" },
  { title: "桃花岛", url: "https://example.com/taohuadao", snippet: "桃花岛位于东海。", source: "example.com" },
]
describe("非 Gemini 搜索后端兼容（对照 main 生成的 golden）", () => {
it("上下文、工具结果、工作流显示与 main 逐字节一致", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: results.map(r => ({ title: r.title, url: r.url, content: r.snippet })) }), { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
  const cfg = { provider: "tavily" as const, apiKey: "k" }
  const research = await collectWebResearch({ text: "搜索 黄蓉 桃花岛", searchApiConfig: cfg, allowReadUrls: false })
  const ctx = buildWebResearchContext(research)
  const items = [{ name: "黄蓉", results }, { name: "桃花岛", results: [] }]
  const serialized = serializeWritingEntitySearchWorkflowResult({ searchedNames: ["黄蓉", "桃花岛"], notes: ["n1"], items, markdown: "" })
  const tool = createWebSearchTool(() => cfg)
  const toolOut = await tool.execute({ query: "黄蓉", maxResults: 2 })
  const out = {
    researchKeys: Object.keys(research).sort(),
    researchContext: ctx,
    entityMarkdown: formatWritingEntitySearchMarkdown(items),
    entitySerialized: serialized,
    entityWorkflowText: formatWritingEntitySearchWorkflowResult({ searchedNames: ["黄蓉"], notes: [], items, markdown: "" }),
    entityDisplay: displayWritingEntitySearchWorkflowContent(serialized),
    entityResultDisplay: getWorkflowToolResultDisplay(serialized),
    toolOut,
    toolResultDisplay: getWorkflowToolResultDisplay(toolOut),
    toolDescription: getWorkflowToolDescription({ id: "1", name: "web_search", status: "done", params: { query: "黄蓉" }, result: toolOut } as never),
  }
  expect(JSON.parse(JSON.stringify(out))).toEqual(golden)
  // 没有附加信息：时间线不出结构化视图；发给模型的文本原样
  expect(extractSearchDisplayDetail(toolOut)).toBeNull()
  expect(extractSearchDisplayDetail(serialized)).toBeNull()
  expect(splitToolResultForModel(toolOut)).toBe(toolOut)
  vi.unstubAllGlobals()
})
})
