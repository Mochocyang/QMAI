// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ChangelogSection } from "./changelog-section"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh" },
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? "",
  }),
}))

vi.mock("@/lib/platform", () => ({
  isTauri: () => false,
}))

let host: HTMLDivElement
let root: Root

describe("ChangelogSection", () => {
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

  it("shows five changelog items first and expands to all items when requested", async () => {
    await act(async () => {
      root.render(<ChangelogSection />)
    })

    const currentVersionCard = host.querySelector("[data-changelog-version='2.2.8']")
    if (!currentVersionCard) throw new Error("current changelog card not found")

    expect(currentVersionCard.querySelectorAll("li")).toHaveLength(5)
    expect(currentVersionCard.textContent).toContain("查看更多 1 条")
    expect(currentVersionCard.textContent).not.toContain("AI 会话深度章节第 4 阶段")

    const expandButton = Array.from(currentVersionCard.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("查看更多"))
    if (!expandButton) throw new Error("expand changelog button not found")

    await act(async () => {
      expandButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(currentVersionCard.querySelectorAll("li")).toHaveLength(6)
    expect(currentVersionCard.textContent).toContain("深度章节长度重写失败上限提升到 6000 字")
    expect(currentVersionCard.textContent).toContain("收起")
  })
})
