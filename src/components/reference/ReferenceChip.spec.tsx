// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReferenceChip } from "./ReferenceChip"
import type { ReferenceToken } from "@/lib/reference/types"

let host: HTMLDivElement
let root: Root

const token: ReferenceToken = {
  id: "ref-1",
  category: "chapter",
  title: "第一章",
  displayTitle: "第一章",
  path: "C:/Novel/wiki/chapters/第一章.md",
}

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

describe("ReferenceChip", () => {
  it("renders editable chip metadata and calls onRemove", async () => {
    const onRemove = vi.fn()

    await act(async () => {
      root.render(<ReferenceChip token={token} onRemove={onRemove} />)
    })

    const chip = host.querySelector("[data-reference-id='ref-1']")
    expect(chip?.textContent).toContain("@第一章")
    expect(chip?.getAttribute("data-reference-category")).toBe("chapter")
    expect(chip?.getAttribute("contenteditable")).toBe("false")

    const button = host.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("移除引用 第一章")

    await act(async () => {
      button?.click()
    })

    expect(onRemove).toHaveBeenCalledWith("ref-1")
  })

  it("renders readonly chip without a remove button", async () => {
    await act(async () => {
      root.render(<ReferenceChip token={token} readonly />)
    })

    expect(host.textContent).toBe("@第一章")
    expect(host.querySelector("button")).toBeNull()
  })
})
