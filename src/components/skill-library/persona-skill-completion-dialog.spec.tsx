// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { PersonaSkillCompletionDialog } from "./persona-skill-completion-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | undefined
let root: Root | undefined

function renderDialog() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(<PersonaSkillCompletionDialog />)
  })
}

function clickButton(label: string) {
  const button = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  )
  if (!button) throw new Error(`没找到按钮：${label}`)
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("PersonaSkillCompletionDialog", () => {
  beforeEach(() => {
    useWikiStore.setState({ personaSkillCompletion: null, activeView: "wiki" })
  })

  afterEach(() => {
    if (root && container) {
      const node = container
      act(() => root!.unmount())
      node.remove()
    }
    root = undefined
    container = undefined
    vi.useRealTimers()
  })

  it("显示标题与新增/更新的人物名", () => {
    useWikiStore.setState({
      personaSkillCompletion: { created: ["林清越"], updated: ["沈砚"] },
    })
    renderDialog()

    const dialog = document.querySelector('[data-testid="persona-skill-completion-dialog"]')
    expect(dialog).not.toBeNull()
    const text = document.body.textContent ?? ""
    expect(text).toContain("记忆提取完成，人物 Skill 生成成功")
    expect(text).toContain("新增")
    expect(text).toContain("林清越")
    expect(text).toContain("更新")
    expect(text).toContain("沈砚")
  })

  it("没有待显示的内容时不渲染弹窗", () => {
    renderDialog()
    expect(document.querySelector('[data-testid="persona-skill-completion-dialog"]')).toBeNull()
  })

  it("点「现在勾选」：关闭弹窗并切到人物 Skill 页", () => {
    useWikiStore.setState({
      personaSkillCompletion: { created: ["林清越"], updated: [] },
    })
    renderDialog()

    clickButton("现在勾选")

    expect(useWikiStore.getState().personaSkillCompletion).toBeNull()
    expect(useWikiStore.getState().activeView).toBe("personaSkillLibrary")
  })

  it("点「取消」：只关闭弹窗，不切换视图", () => {
    useWikiStore.setState({
      personaSkillCompletion: { created: ["林清越"], updated: [] },
    })
    renderDialog()

    clickButton("取消")

    expect(useWikiStore.getState().personaSkillCompletion).toBeNull()
    expect(useWikiStore.getState().activeView).toBe("wiki")
  })

  it("5 秒后自动关闭", () => {
    vi.useFakeTimers()
    useWikiStore.setState({
      personaSkillCompletion: { created: ["林清越"], updated: [] },
    })
    renderDialog()
    expect(document.querySelector('[data-testid="persona-skill-completion-dialog"]')).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(useWikiStore.getState().personaSkillCompletion).toBeNull()
  })
})
