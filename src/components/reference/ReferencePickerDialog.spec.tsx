// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReferencePickerDialog } from "./ReferencePickerDialog"
import type { ReferenceProvider } from "@/lib/reference/providers"
import type { ReferenceToken } from "@/lib/reference/types"

let host: HTMLDivElement
let root: Root

function makeToken(index: number): ReferenceToken {
  return {
    id: `ref-${index}`,
    category: "chapter",
    title: `章节${index}`,
    displayTitle: `章节${index}`,
    path: `C:/Novel/wiki/chapters/章节${index}.md`,
  }
}

const chapterItems = Array.from({ length: 11 }, (_, index) => makeToken(index + 1))
const technicalChapterItem: ReferenceToken = {
  id: "ref-technical",
  category: "chapter",
  title: "1/chapter-010",
  displayTitle: "第10章-灯下旧影",
  path: "C:/Novel/wiki/chapters/第10章-灯下旧影.md",
}

const providers: ReferenceProvider[] = [
  {
    category: "chapter",
    fetchItems: vi.fn(async () => chapterItems),
  },
  {
    category: "memory",
    fetchItems: vi.fn(async () => [{
      id: "memory-1",
      category: "memory" as const,
      title: "人物",
      displayTitle: "人物",
      path: "C:/Novel/wiki/memory/人物.md",
    }]),
  },
]

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
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

describe("ReferencePickerDialog", () => {
  it("renders nothing when closed", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open={false}
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })

    expect(host.textContent).toBe("")
  })

  it("loads items, filters search, and confirms selected tokens", async () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={onConfirm}
          onClose={onClose}
        />,
      )
    })
    await flush()

    expect(providers[0].fetchItems).toHaveBeenCalledWith("C:/Novel")
    expect(host.textContent).toContain("选择引用内容")
    expect(host.textContent).toContain("章节1")

    const search = host.querySelector("input[type='search']") as HTMLInputElement
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set
      valueSetter?.call(search, "章节11")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(host.textContent).toContain("章节11")
    expect(host.textContent).not.toContain("章节1章节2")

    const checkbox = host.querySelector("input[type='checkbox']") as HTMLInputElement
    await act(async () => {
      checkbox.click()
    })

    const confirm = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "确认",
    )
    await act(async () => {
      confirm?.click()
    })

    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ title: "章节11" })])
    expect(onClose).toHaveBeenCalled()
  })

  it("uses the app surface styles and clear Chinese labels", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    const dialog = host.querySelector<HTMLElement>("[role='dialog']")
    expect(dialog).toBeTruthy()
    expect(dialog?.className).toContain("bg-background")
    expect(dialog?.className).toContain("max-w-[min(920px,calc(100vw-32px))]")
    expect(host.textContent).toContain("选择引用内容")
    expect(host.textContent).toContain("章节")
    expect(host.textContent).toContain("记忆库")
    expect(host.textContent).toContain("已选 0/10")
    expect(host.textContent).not.toMatch(/[📄🧠📋🔬⚡💬📝]/u)
  })

  it("uses the display title as the visible item name instead of technical file names", async () => {
    const technicalProviders: ReferenceProvider[] = [
      {
        category: "chapter",
        fetchItems: vi.fn(async () => [technicalChapterItem]),
      },
    ]

    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={technicalProviders}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    expect(host.textContent).toContain("第10章-灯下旧影")
    expect(host.textContent).not.toContain("1/chapter-010")
  })

  it("does not select more than the maximum reference count", async () => {
    await act(async () => {
      root.render(
        <ReferencePickerDialog
          open
          providers={providers}
          projectPath="C:/Novel"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    })
    await flush()

    const checkboxes = Array.from(host.querySelectorAll("input[type='checkbox']")) as HTMLInputElement[]
    for (const checkbox of checkboxes) {
      await act(async () => {
        checkbox.click()
      })
    }

    const checked = Array.from(host.querySelectorAll("input[type='checkbox']:checked"))
    expect(checked).toHaveLength(10)
    expect(host.textContent).toContain("已选 10/10")
    expect(host.textContent).toContain("已达上限")
  })
})
