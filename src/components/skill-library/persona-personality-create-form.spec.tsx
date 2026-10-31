// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PersonaPersonalityCreateForm } from "./persona-personality-create-form"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

async function render(props: Partial<Parameters<typeof PersonaPersonalityCreateForm>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  await act(async () =>
    root.render(
      <PersonaPersonalityCreateForm
        busy={props.busy ?? false}
        message={props.message ?? ""}
        hasCharacter={props.hasCharacter ?? (() => false)}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    ),
  )
  return { onSubmit, onCancel }
}

function field(testId: string): HTMLInputElement | HTMLTextAreaElement {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-testid="${testId}"]`)
  expect(element, testId).toBeTruthy()
  return element!
}

async function type(testId: string, value: string) {
  const element = field(testId)
  await act(async () => {
    // 短字段是 input、长文本是 textarea，各有自己的 value setter，不能混用。
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function clickSubmit() {
  const button = host.querySelector<HTMLButtonElement>('[data-testid="persona-create-submit"]')!
  await act(async () => button.click())
}

describe("PersonaPersonalityCreateForm", () => {
  it("姓名为空时拦住，并说明原因", async () => {
    const { onSubmit } = await render()
    await clickSubmit()
    expect(host.querySelector('[data-testid="persona-create-error"]')!.textContent).toContain("请先填写人物姓名")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("重名时拦住，不静默合并进老档案", async () => {
    const { onSubmit } = await render({ hasCharacter: (name) => name === "林清越" })
    await type("persona-create-name", "林清越")
    await clickSubmit()
    expect(host.querySelector('[data-testid="persona-create-error"]')!.textContent).toContain("已经有档案了")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("填写姓名与字段后提交，空字段不提交", async () => {
    const { onSubmit } = await render()
    await type("persona-create-name", "  林清越  ")
    await type("persona-create-性别", "男")
    await type("persona-create-势力组织", "青云宗")
    await type("persona-create-背景", "")
    await clickSubmit()
    expect(onSubmit).toHaveBeenCalledWith({
      characterName: "林清越",
      roleType: "主角",
      fields: { 性别: "男", 势力组织: "青云宗" },
      boundSoul: "",
    })
  })

  it("选了性格标签时，把它写进 fields 的「性格」段", async () => {
    const { onSubmit } = await render()
    await type("persona-create-name", "沈砚")
    // 性格面板（T2）取消了折叠：所有基底标签直接可见，无需先展开
    const tag = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "毒舌")!
    await act(async () => tag.click())
    await clickSubmit()

    const call = onSubmit.mock.calls[0][0]
    expect(call.fields["性格"]).toContain("- 性格标签：毒舌")
  })

  it("取消按钮走 onCancel", async () => {
    const { onCancel } = await render()
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === "取消")!
    await act(async () => button.click())
    expect(onCancel).toHaveBeenCalled()
  })

  it("busy 时提交按钮禁用并显示进行中文案", async () => {
    await render({ busy: true })
    const button = host.querySelector<HTMLButtonElement>('[data-testid="persona-create-submit"]')!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain("正在创建")
  })
})
