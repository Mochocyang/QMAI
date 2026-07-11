// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ThinkingEvent } from "./timeline-thinking-event"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  host.remove()
})

async function renderThinking(content: string, streaming: boolean) {
  await act(async () => {
    root.render(
      <ThinkingEvent
        event={{
          id: "thinking-current",
          content,
          streaming,
        }}
      />,
    )
  })
}

describe("ThinkingEvent", () => {
  it("uses a line icon instead of emoji decoration", async () => {
    await renderThinking("正在分析", true)

    expect(host.textContent).not.toContain("💡")
    expect(host.querySelector("svg")).not.toBeNull()
  })
  it("expands automatically when a new streaming round starts after the previous round collapsed", async () => {
    await renderThinking("第一轮思考正文", true)
    expect(host.textContent).toContain("第一轮思考正文")

    await renderThinking("第一轮思考正文", false)
    expect(host.textContent).not.toContain("第一轮思考正文")

    await renderThinking("第二轮思考正文", true)
    expect(host.textContent).toContain("第二轮思考正文")
    expect(host.textContent).toContain("思考中")
  })

  it("keeps a manual expansion when completed content grows in the same round", async () => {
    await renderThinking("已完成正文", true)
    await renderThinking("已完成正文", false)

    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    expect(expandButton).not.toBeNull()
    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(host.textContent).toContain("已完成正文")

    await renderThinking("已完成正文，补充内容", false)
    expect(host.textContent).toContain("已完成正文，补充内容")
  })
})
