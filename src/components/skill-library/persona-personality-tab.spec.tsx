// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PersonaPersonalityTab } from "./persona-personality-tab"

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

async function render(props: Partial<Parameters<typeof PersonaPersonalityTab>[0]> = {}) {
  const onChange = vi.fn()
  await act(async () =>
    root.render(
      <PersonaPersonalityTab
        tags={props.tags ?? []}
        boundSoul={props.boundSoul ?? ""}
        raw={props.raw ?? ""}
        onChange={onChange}
        projectPath={props.projectPath}
        characterName={props.characterName}
      />,
    ),
  )
  return onChange
}

async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)
  expect(button, text).toBeTruthy()
  await act(async () => button!.click())
}

describe("PersonaPersonalityTab（T2 精简版：无题材包）", () => {
  it("四组分类行都在，标签不再藏在「展开更多」后面", async () => {
    await render({ tags: ["毒舌"] })
    for (const group of ["语气", "怪癖", "关系", "反差"]) expect(host.textContent).toContain(group)
    expect(host.textContent).toContain("毒舌")
    // 旧版的折叠开关已经取消：所有基底直接可见
    expect(host.textContent).not.toContain("展开更多性格")
    expect(host.textContent).toContain("满口网络梗")
    expect(host.textContent).toContain("收集癖")
  })

  it("显示已选条数与字数预算", async () => {
    await render({ tags: ["毒舌", "嘴硬心软"] })
    expect(host.textContent).toContain("2 / 4 条")
    // 「毒舌」(2) + 「嘴硬心软」(4) = 6 字
    expect(host.textContent).toContain("6 / 20 字")
  })

  it("题材预制包已移除：不再出现「套用」按钮与题材名", async () => {
    await render()
    const applyButtons = [...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "套用")
    expect(applyButtons).toHaveLength(0)
    expect(host.textContent).not.toContain("题材预制包")
  })

  it("点未选中的标签把它加进去", async () => {
    const onChange = await render()
    await click("毒舌")
    expect(onChange).toHaveBeenCalledWith({ tags: ["毒舌"], boundSoul: "" })
  })

  it("选满 4 条后再选第 5 条会被拦住并提示", async () => {
    await render({ tags: ["毒舌", "嘴硬心软", "阴阳怪气", "满口网络梗"] })
    await click("路痴")
    expect(host.textContent).toContain("最多选 4 条")
  })

  it("自定义输入拒绝抽象词，并说明该写什么", async () => {
    await render()
    const input = host.querySelector<HTMLInputElement>('input[placeholder="例：见到美酒走不动路"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      setter.call(input, "严肃沉稳")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("添加")
    expect(host.textContent).toContain("请写能演出来的具体特征")
  })

  it("手写原文会给出一条覆盖警告", async () => {
    await render({ raw: "他是那种一言不合就动手的人。" })
    expect(host.textContent).toContain("未按标签管理")
  })

  it("绑定灵魂显示当前灵魂名，并提供更换与解绑", async () => {
    const onChange = await render({
      boundSoul: "严肃沉稳",
      projectPath: "/tmp/project",
    })
    expect(host.textContent).toContain("严肃沉稳")
    expect(host.textContent).toContain("更换灵魂")

    const clear = host.querySelector<HTMLElement>('[data-testid="persona-soul-clear"]')!
    await act(async () => clear.click())
    expect(onChange).toHaveBeenCalledWith({ tags: [], boundSoul: "" })
  })

  it("没有绑定灵魂时按钮是「绑定灵魂」，且未打开项目时禁用", async () => {
    await render({ boundSoul: "" })
    const open = host.querySelector<HTMLButtonElement>('[data-testid="persona-soul-open"]')!
    expect(open.textContent?.trim()).toBe("绑定灵魂")
    expect(open.disabled).toBe(true)
  })

  it("点「绑定灵魂」打开灵魂库弹窗", async () => {
    await render({ boundSoul: "", projectPath: "/tmp/project" })
    const open = host.querySelector<HTMLButtonElement>('[data-testid="persona-soul-open"]')!
    expect(open.disabled).toBe(false)
    await act(async () => open.click())
    expect(host.ownerDocument.querySelector('[data-testid="persona-soul-picker"]')).not.toBeNull()
  })
})
