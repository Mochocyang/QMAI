// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContextUsageRing } from "./context-usage-ring"
import type { ContextUsageSnapshot } from "@/lib/context-usage"

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { percent?: number }) => {
      if (key === "chat.contextUsage.percentFull") return `${options?.percent ?? 0}% Full`
      if (key.startsWith("chat.contextUsage.segments.")) {
        return key.replace("chat.contextUsage.segments.", "")
      }
      if (key === "chat.contextUsage.title") return "Context Usage"
      if (key === "chat.contextUsage.tokens") return "Tokens"
      if (key === "chat.contextUsage.fullHint") return "Context is nearly full"
      if (key === "chat.contextUsage.newConversation") return "New conversation"
      return key
    },
  }),
}))

const usage: ContextUsageSnapshot = {
  windowTokens: 1000,
  totalTokens: 230,
  measuredAt: 1,
  estimated: true,
  segments: [
    { key: "softwareRules", tokens: 50 },
    { key: "toolDefinitions", tokens: 30 },
    { key: "stableCore", tokens: 40 },
    { key: "sessionSummary", tokens: 20 },
    { key: "dynamicContext", tokens: 30 },
    { key: "history", tokens: 40 },
    { key: "currentInput", tokens: 20 },
  ],
}

describe("ContextUsageRing", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  async function openTooltip() {
    const trigger = container.querySelector("button")
    expect(trigger).toBeTruthy()
    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
      trigger?.focus()
      trigger?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
  }

  function filledBarPercent(): number {
    const bar = document.querySelector<HTMLElement>('[data-testid="context-usage-bar"]')
    expect(bar).toBeTruthy()
    return Array.from(bar!.children).reduce((sum, node) => {
      const width = (node as HTMLElement).style.width
      return sum + Number.parseFloat(width || "0")
    }, 0)
  }

  it("renders nothing without usage", async () => {
    await act(async () => {
      root.render(<ContextUsageRing />)
    })
    expect(container.textContent).toBe("")
  })

  it("fills the usage bar against the context window, not used tokens", async () => {
    await act(async () => {
      root.render(<ContextUsageRing usage={usage} />)
    })
    await openTooltip()

    const filled = filledBarPercent()
    expect(filled).toBeCloseTo((usage.totalTokens / usage.windowTokens) * 100, 5)
    expect(filled).toBe(23)
    expect(filled).toBeLessThan(100)

    const history = document.querySelector<HTMLElement>('[data-segment="history"]')
    expect(history?.style.width).toBe("4%")
  })

  it("shows percent and warns when nearly full", async () => {
    const onCreateConversation = vi.fn()
    const fullUsage: ContextUsageSnapshot = {
      ...usage,
      totalTokens: 950,
      segments: [{ key: "history", tokens: 950 }],
    }
    await act(async () => {
      root.render(
        <ContextUsageRing
          usage={fullUsage}
          onCreateConversation={onCreateConversation}
        />,
      )
    })

    const trigger = container.querySelector("button")
    expect(trigger).toBeTruthy()
    expect(trigger?.textContent).toContain("95")

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
      trigger?.focus()
      trigger?.click()
    })

    // Tooltip content may render in a portal; look across document.
    await act(async () => {
      await Promise.resolve()
    })
    const hint = Array.from(document.querySelectorAll("p")).find((node) =>
      node.textContent?.includes("Context is nearly full"),
    )
    const createButton = Array.from(document.querySelectorAll("button")).find((node) =>
      node.textContent?.includes("New conversation"),
    )
    expect(hint || createButton).toBeTruthy()
    if (createButton) {
      await act(async () => {
        createButton.click()
      })
      expect(onCreateConversation).toHaveBeenCalled()
    }
  })
})
