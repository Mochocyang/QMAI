// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { ToolCallEvent } from "./timeline-tool-event"
import type { ToolCallEventItem } from "./timeline-types"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(event: ToolCallEventItem) {
  const host = document.createElement("div")
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<ToolCallEvent event={event} />))
  act(() => host.querySelector("button")!.click())
  return host
}

const base: ToolCallEventItem = { id: "1", name: "web_search", description: "联网搜索「锦衣卫」", category: "read", status: "done", params: { query: "锦衣卫" } }

describe("时间线联网搜索展开", () => {
  it("Gemini：搜索词标签、摘要前几行、不显示来源列表与搜索建议 iframe", () => {
    const host = render({
      ...base,
      result: '{"status":"ok"}',
      searchDetail: {
        queries: ["明朝 锦衣卫"],
        summary: "### 一\n* **指挥使**：正三品\n* 千户：正五品\n* 百户\n* 第四行",
        sources: [{ id: "S1", title: "wikipedia.org", url: "https://r.example/1", source: "wikipedia.org" }],
        suggestionsHtml: "<div class=chip>建议</div>",
      },
    })
    expect(host.querySelector('[aria-label="实际搜索词"]')?.textContent).toBe("明朝 锦衣卫")
    expect(Array.from(host.querySelectorAll('[aria-label="搜索摘要"] p')).map((p) => p.textContent)).toEqual(["一", "指挥使：正三品", "千户：正五品"])
    expect(host.querySelector('[aria-label="来源"]')).toBeNull()
    expect(host.textContent).not.toContain("[S1]")
    expect(host.textContent).not.toContain("wikipedia.org")
    expect(host.querySelector("iframe")).toBeNull()
    expect(host.textContent).not.toContain('{"status":"ok"}')
  })

  it("其它后端 / 旧记录：没有 searchDetail，按原样显示结果", () => {
    const host = render({ ...base, result: "已搜索：黄蓉" })
    expect(host.querySelector("[data-search-detail]")).toBeNull()
    expect(host.querySelector("iframe")).toBeNull()
    expect(host.textContent).toContain("已搜索：黄蓉")
  })
})
