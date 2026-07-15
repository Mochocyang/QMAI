// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContextHubDetails } from "./context-hub-details"
import { CONTEXT_CACHE_SCHEMA_VERSION, type ContextHubSnapshot } from "@/lib/context-hub/types"

const snapshot: ContextHubSnapshot = {
  schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
  id: "assistant:1",
  surface: "ai-chat",
  createdAt: 10,
  stats: {
    hits: 3,
    refreshed: 2,
    failures: 0,
    stableTokens: 1200,
    summaryTokens: 60,
    dynamicTokens: 420,
    candidateTokens: 3000,
    estimatedSavedTokens: 1320,
    estimatedSavedPercent: 44,
    expanded: false,
    providerCacheEnabled: true,
  },
  items: [
    {
      key: "data-source:outline",
      sourceName: "outline",
      status: "hit",
      dependencyPaths: ["wiki/outlines/main.md"],
    },
    {
      key: "stable-core:ai-chat",
      sourceName: "stableCore",
      status: "refreshed",
      dependencyPaths: ["wiki/settings/world.md"],
    },
  ],
  stableCore: "稳定核心正文",
  sessionSummary: "会话摘要正文",
  dynamicContext: "动态片段正文",
}

const reference = {
  id: snapshot.id,
  surface: snapshot.surface,
  createdAt: snapshot.createdAt,
  stats: snapshot.stats,
}

describe("ContextHubDetails", () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    act(() => root.unmount())
    host.remove()
  })

  it("loads the persisted snapshot and shows cache items plus all composed sections", async () => {
    const loadSnapshot = vi.fn(async () => snapshot)
    await act(async () => {
      root.render(
        <ContextHubDetails
          reference={reference}
          loadSnapshot={loadSnapshot}
        />,
      )
    })

    expect(host.textContent).toContain("上下文中控")
    expect(host.textContent).toContain("命中 3")
    expect(host.textContent).toContain("刷新 2")
    expect(host.textContent).not.toContain("稳定核心正文")

    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-label="展开上下文中控"]')
    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(loadSnapshot).toHaveBeenCalledWith(reference)
    expect(host.textContent).toContain("大纲资料")
    expect(host.textContent).toContain("稳定核心缓存")
    expect(host.textContent).toContain("wiki/outlines/main.md")
    expect(host.textContent).toContain("稳定核心正文")
    expect(host.innerHTML).toContain("max-h-96")
    expect(host.innerHTML).toContain("overflow-y-auto")

    const summaryTab = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "会话摘要")
    await act(async () => {
      summaryTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(host.textContent).toContain("会话摘要正文")

    const dynamicTab = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "动态片段")
    await act(async () => {
      dynamicTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(host.textContent).toContain("动态片段正文")
  })

  it("keeps summary statistics visible when the snapshot cannot be read", async () => {
    await act(async () => {
      root.render(
        <ContextHubDetails
          reference={reference}
          loadSnapshot={async () => null}
        />,
      )
    })

    const expandButton = host.querySelector<HTMLButtonElement>('button[aria-label="展开上下文中控"]')
    await act(async () => {
      expandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(host.textContent).toContain("命中 3")
    expect(host.textContent).toContain("上下文快照不可用")
  })

  it("reloads an expanded snapshot when the same message receives a newer snapshot", async () => {
    const newerSnapshot: ContextHubSnapshot = {
      ...snapshot,
      createdAt: 20,
      stableCore: "续传后的稳定核心",
    }
    let currentSnapshot = snapshot
    const loadSnapshot = vi.fn(async () => currentSnapshot)

    await act(async () => {
      root.render(<ContextHubDetails reference={reference} loadSnapshot={loadSnapshot} />)
    })
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="展开上下文中控"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(host.textContent).toContain("稳定核心正文")

    currentSnapshot = newerSnapshot
    const newerReference = {
      id: "assistant:1:resume-2",
      surface: "ai-chat" as const,
      createdAt: newerSnapshot.createdAt,
      stats: newerSnapshot.stats,
    }
    currentSnapshot = { ...newerSnapshot, id: newerReference.id }
    await act(async () => {
      root.render(<ContextHubDetails reference={newerReference} loadSnapshot={loadSnapshot} />)
    })

    expect(loadSnapshot).toHaveBeenLastCalledWith(newerReference)
    expect(host.textContent).toContain("续传后的稳定核心")
    expect(host.textContent).not.toContain("稳定核心正文")
  })
})
