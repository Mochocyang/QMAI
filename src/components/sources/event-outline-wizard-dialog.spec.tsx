// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { EventOutlineWizardDialog } from "@/components/sources/event-outline-wizard-dialog"
import type { EventOutlineRequest } from "@/lib/novel/event-outline"

it("向导给出章号、事件数、目标字数三个字段，并把请求交给上层", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const submit = vi.fn()

  await act(async () => {
    root.render(
      <EventOutlineWizardDialog
        open
        onOpenChange={() => {}}
        onSubmit={submit}
        defaultChapterNumber={12}
        defaultTargetWords={3000}
      />,
    )
  })

  expect(document.body.textContent).toContain("生成章节细纲")

  const chapterInput = document.querySelector<HTMLInputElement>('input[aria-label="目标章节"]')
  expect(chapterInput?.value).toBe("12")

  const eventSelect = document.querySelector<HTMLSelectElement>('select[aria-label="事件数量"]')
  expect(eventSelect?.value).toBe("6")

  const wordsInput = document.querySelector<HTMLInputElement>('input[aria-label="本章目标字数"]')
  expect(wordsInput?.value).toBe("3000")

  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "生成细纲")!
  await act(async () => button.click())

  expect(submit).toHaveBeenCalledWith({
    chapterNumber: 12,
    eventCount: 6,
    targetWords: 3000,
    requirement: "",
  })

  await act(async () => root.unmount())
  host.remove()
})

it("章号非法时拦下提交并给出提示", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  const submit = vi.fn()

  await act(async () => {
    root.render(
      <EventOutlineWizardDialog open onOpenChange={() => {}} onSubmit={submit} defaultChapterNumber={12} defaultTargetWords={3000} />,
    )
  })

  const chapterInput = document.querySelector<HTMLInputElement>('input[aria-label="目标章节"]')!
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setValue?.call(chapterInput, "0")
    chapterInput.dispatchEvent(new Event("input", { bubbles: true }))
  })
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "生成细纲")!
  await act(async () => button.click())

  expect(submit).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("章号")

  await act(async () => root.unmount())
  host.remove()
})

// —— 以下为追加用例：把挂载/取值动作收成小助手，每个用例只关心一种行为 ——

interface WizardHandle {
  host: HTMLDivElement
  root: Root
}

interface WizardProps {
  onSubmit?: (request: EventOutlineRequest) => void
  onOpenChange?: (open: boolean) => void
  defaultChapterNumber?: number
  defaultTargetWords?: number
}

async function mountWizard(props: WizardProps = {}): Promise<WizardHandle> {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      <EventOutlineWizardDialog
        open
        onOpenChange={props.onOpenChange ?? (() => {})}
        onSubmit={props.onSubmit ?? (() => {})}
        defaultChapterNumber={props.defaultChapterNumber ?? 12}
        defaultTargetWords={props.defaultTargetWords ?? 3000}
      />,
    )
  })
  return { host, root }
}

async function unmountWizard(handle: WizardHandle) {
  await act(async () => handle.root.unmount())
  handle.host.remove()
}

/** 找到 aria-label 指定的字段，找不到就明确报错，避免用例因 null 静默通过。 */
function field<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`未找到元素：${selector}`)
  return element
}

/** 受控输入必须走原型上的 value setter，React 才认这次变更。 */
async function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  await act(async () => {
    setter?.call(element, value)
    element.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

async function clickButton(text: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === text)
  if (!button) throw new Error(`未找到按钮：${text}`)
  await act(async () => button.click())
}

it("事件数量下拉框只提供 4~8 这五个选项", async () => {
  const handle = await mountWizard()

  const select = field<HTMLSelectElement>('select[aria-label="事件数量"]')
  expect([...select.options].map((option) => option.value)).toEqual(["4", "5", "6", "7", "8"])

  await unmountWizard(handle)
})

it("只有空白字符的本章要求被裁成空串后提交", async () => {
  const submit = vi.fn()
  const handle = await mountWizard({ onSubmit: submit })

  await setFieldValue(field<HTMLTextAreaElement>('textarea[aria-label="本章想法/硬要求"]'), "   \n\t ")
  await clickButton("生成细纲")

  expect(submit).toHaveBeenCalledWith({
    chapterNumber: 12,
    eventCount: 6,
    targetWords: 3000,
    requirement: "",
  })

  await unmountWizard(handle)
})

it("本章目标字数留空时拦下提交并提示字数", async () => {
  const submit = vi.fn()
  const handle = await mountWizard({ onSubmit: submit })

  await setFieldValue(field<HTMLInputElement>('input[aria-label="本章目标字数"]'), "")
  await clickButton("生成细纲")

  expect(submit).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("字数")

  await unmountWizard(handle)
})

it("本章目标字数不是数字时拦下提交并提示字数", async () => {
  const submit = vi.fn()
  const handle = await mountWizard({ onSubmit: submit })

  await setFieldValue(field<HTMLInputElement>('input[aria-label="本章目标字数"]'), "约三千字")
  await clickButton("生成细纲")

  expect(submit).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain("字数")

  await unmountWizard(handle)
})

it("默认值变化后重新打开会把字段重置成新的默认值", async () => {
  const handle = await mountWizard({ defaultChapterNumber: 12, defaultTargetWords: 3000 })
  expect(field<HTMLInputElement>('input[aria-label="目标章节"]').value).toBe("12")

  // 面板探测出了新的下一章与新的项目字数设置。
  await act(async () => {
    handle.root.render(
      <EventOutlineWizardDialog
        open
        onOpenChange={() => {}}
        onSubmit={() => {}}
        defaultChapterNumber={20}
        defaultTargetWords={5000}
      />,
    )
  })

  expect(field<HTMLInputElement>('input[aria-label="目标章节"]').value).toBe("20")
  expect(field<HTMLInputElement>('input[aria-label="本章目标字数"]').value).toBe("5000")

  await unmountWizard(handle)
})

it("提交成功后请求上层关闭对话框", async () => {
  const onOpenChange = vi.fn()
  const handle = await mountWizard({ onOpenChange })

  await clickButton("生成细纲")

  expect(onOpenChange).toHaveBeenCalledWith(false)

  await unmountWizard(handle)
})
