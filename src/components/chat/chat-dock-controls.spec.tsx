import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ChatDockControls } from "./chat-dock-controls"

const mocks = vi.hoisted(() => ({
  state: {
    chatDockPosition: "bottom" as "bottom" | "right",
    setChatDockPosition: vi.fn(),
  },
}))

vi.mock("@/stores/wiki-store", () => ({
  useWikiStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}))

describe("ChatDockControls", () => {
  beforeEach(() => {
    mocks.state.chatDockPosition = "bottom"
    mocks.state.setChatDockPosition.mockClear()
  })

  it("shows only the sidebar dock option when chat is docked at the bottom", () => {
    mocks.state.chatDockPosition = "bottom"

    const html = renderToStaticMarkup(<ChatDockControls />)

    expect(html).toContain("停靠在侧栏")
    expect(html).not.toContain("停靠在底栏")
    expect((html.match(/<button/g) || []).length).toBe(1)
  })

  it("shows only the bottom dock option when chat is docked at the sidebar", () => {
    mocks.state.chatDockPosition = "right"

    const html = renderToStaticMarkup(<ChatDockControls />)

    expect(html).toContain("停靠在底栏")
    expect(html).not.toContain("停靠在侧栏")
    expect((html.match(/<button/g) || []).length).toBe(1)
  })
})
