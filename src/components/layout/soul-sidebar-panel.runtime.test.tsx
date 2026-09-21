// @vitest-environment jsdom

import type { ButtonHTMLAttributes } from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import { BUILT_IN_CHARACTER_AURAS } from "@/lib/novel/character-aura"
import { useWikiStore } from "@/stores/wiki-store"
import { SoulSidebarPanel } from "./soul-sidebar-panel"

const auraMocks = vi.hoisted(() => ({
  bindCharacterAura: vi.fn(),
  getCharacterAuraBindings: vi.fn(),
  listCharacterAuras: vi.fn(),
  unbindCharacterAura: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>("@/lib/novel/character-aura")
  return {
    ...actual,
    bindCharacterAura: auraMocks.bindCharacterAura,
    getCharacterAuraBindings: auraMocks.getCharacterAuraBindings,
    listCharacterAuras: auraMocks.listCharacterAuras,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
  }
})

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" className={className} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("SoulSidebarPanel runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    auraMocks.listCharacterAuras.mockResolvedValue(BUILT_IN_CHARACTER_AURAS)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT
  })

  it("reloads bound characters after the shared data version changes", async () => {
    auraMocks.getCharacterAuraBindings
      .mockResolvedValueOnce([{ characterName: "杨墨", auraId: "builtin-qin-shihuang" }])
      .mockResolvedValueOnce([
        { characterName: "杨墨", auraId: "builtin-qin-shihuang" },
        { characterName: "林烬", auraId: "builtin-li-shimin" },
      ])

    useWikiStore.setState({
      project: { id: "proj-1", name: "proj", path: "/proj" },
      selectedSoulId: "project-soul",
      selectedSoulTab: "project",
      dataVersion: 0,
    })

    await act(async () => {
      root.render(<SoulSidebarPanel />)
    })
    await flush()

    expect(host.textContent).toContain("杨墨")
    expect(host.textContent).not.toContain("林烬")

    await act(async () => {
      useWikiStore.getState().bumpDataVersion()
    })
    await flush()

    expect(host.textContent).toContain("林烬")
  })
})
