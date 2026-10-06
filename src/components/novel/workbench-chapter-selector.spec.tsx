// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"
import { WorkbenchChapterSelector } from "./workbench-chapter-selector"

describe("页内章节选择", () => {
  it("支持101章以后、全书和不连续选择，搜索不清空选择", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement("div")
    document.body.append(host)
    const root = createRoot(host)
    const chapters = Array.from({ length: 123 }, (_, i) => ({ chapterId: `c${i + 1}`, title: `章节${i + 1}`, order: i + 1, wordCount: 100, selected: false, analyzed: false }))
    let selected = ["c101"]
    const render = () => root.render(<WorkbenchChapterSelector chapters={chapters} selectedIds={selected} onChange={(ids) => { selected = ids; render() }} />)
    await act(async () => render())
    try {
      const click = async (label: string) => {
        const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!
        await act(async () => button.click())
      }
      await click("全书")
      expect(selected).toHaveLength(123)
      await click("清空")
      expect(selected).toHaveLength(0)
      await act(async () => {
        host.querySelector<HTMLInputElement>('input[aria-label="选择第101章"]')!.click()
        host.querySelector<HTMLInputElement>('input[aria-label="选择第103章"]')!.click()
      })
      expect(selected).toEqual(["c101", "c103"])
      expect(host.querySelector<HTMLInputElement>('input[aria-label="结束章节"]')!.max).toBe("123")
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
