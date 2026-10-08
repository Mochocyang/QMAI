// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { UserMemorySection } from "./user-memory-section"
import { loadGlobalUserMemoryConfig } from "@/lib/user-memory/store"
import { addManualUserMemoryRule, saveGlobalUserMemoryConfig } from "@/lib/user-memory/store"

// React 19 需要 IS_REACT_ACT_ENVIRONMENT 才能让 act(...) 正常工作且无警告
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("UserMemorySection", () => {
  let host: HTMLDivElement

  beforeEach(() => {
    window.localStorage.clear()
    host = document.createElement("div")
    document.body.appendChild(host)
  })

  afterEach(() => {
    host.remove()
  })

  it("显示三个开关和记忆列表入口", async () => {
    await act(async () => createRoot(host).render(<UserMemorySection />))

    expect(document.body.textContent).toContain("全局用户记忆")
    expect(document.body.textContent).toContain("启用全局记忆")
    expect(document.body.textContent).toContain("自动学习")
    expect(document.body.textContent).toContain("自动读取")
    expect(document.body.textContent).toContain("新增规则")
    expect(document.body.textContent).toContain("仅使用手动记忆")
    expect(document.body.textContent).toContain("导出记忆")
    expect(document.body.textContent).toContain("清空全部")
    expect(document.body.textContent).toContain("存储占用")
    expect(document.body.textContent).toContain("今日自动学习")
  })

  it("用户可以新增手动规则", async () => {
    await act(async () => createRoot(host).render(<UserMemorySection />))
    const add = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("新增规则"))!
    await act(async () => add.click())
    const input = document.querySelector('[aria-label="规则内容"]') as HTMLTextAreaElement
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(input, "回答时先给结论。")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const save = [...document.querySelectorAll("button")].find((button) => button.textContent === "保存规则")!
    await act(async () => save.click())

    expect(loadGlobalUserMemoryConfig().rules[0]?.rule).toBe("回答时先给结论。")
  })

  it("用户可以对单条规则标记有效", async () => {
    saveGlobalUserMemoryConfig(addManualUserMemoryRule(loadGlobalUserMemoryConfig(), {
      rule: "回答时先给结论。", category: "manual", surfaces: ["all"],
    }, 1))
    await act(async () => createRoot(host).render(<UserMemorySection />))

    const positive = document.querySelector('[title="标记此规则有效"]') as HTMLButtonElement
    await act(async () => positive.click())

    expect(loadGlobalUserMemoryConfig().rules[0]?.positiveFeedback).toBe(1)
  })
})
