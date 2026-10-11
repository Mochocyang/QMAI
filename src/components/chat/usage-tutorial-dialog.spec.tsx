// @vitest-environment jsdom
/**
 * 丙-4c：分步引导教程弹窗。
 *
 * ── 用真实 Dialog 原语渲染，不做源码文本断言 ──
 * 「每步有文案 + 「下一步」按钮、最后一步是「开始使用」」全是**交互行为**。
 * 源码里存在 `"下一步"` 这个字符串证明不了点击之后真的会推进
 * （把 onClick 去掉、把 `step + 1` 写成 `step` 都不会让源码断言变红）。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}))

vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/project-store")>(),
  saveNovelConfig: vi.fn(async () => {}),
}))

import { saveNovelConfig } from "@/lib/project-store"
import { UsageTutorialDialog } from "@/components/chat/usage-tutorial-dialog"

let container: HTMLDivElement
let root: Root

function dialogEl() {
  return document.querySelector<HTMLElement>(".ui-test-usage-tutorial")
}

function buttonIn(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.textContent?.trim() === label)
  expect(found, `弹窗里应有「${label}」按钮`).toBeDefined()
  return found!
}

async function clickLabel(label: string) {
  await act(async () => { buttonIn(label).click() })
}

async function mount(open = true, onOpenChange: (open: boolean) => void = () => {}) {
  await act(async () => {
    root = createRoot(container)
    root.render(<UsageTutorialDialog open={open} onOpenChange={onOpenChange} />)
  })
}

async function remount(open: boolean, onOpenChange: (open: boolean) => void = () => {}) {
  await act(async () => {
    root.render(<UsageTutorialDialog open={open} onOpenChange={onOpenChange} />)
  })
}

function buttonLabels(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .map((item) => item.textContent?.trim() ?? "")
}

/** 教程总步数，从「第 1 / N 步」里读出来，避免把步数写死在用例里。 */
function totalSteps(): number {
  const matched = dialogEl()!.textContent!.match(/第 1 \/ (\d+) 步/)
  expect(matched, "进度里应形如「第 1 / N 步」").not.toBeNull()
  return Number(matched![1])
}

beforeEach(() => {
  vi.clearAllMocks()
  useWikiStore.setState({
    novelConfig: { ...DEFAULT_NOVEL_CONFIG },
    project: { id: "tutorial-spec", name: "测试书", path: "C:/test-book" },
  })
  container = document.createElement("div")
  document.body.appendChild(container)
})

afterEach(async () => {
  await act(async () => { root?.unmount() })
  container.remove()
})

describe("分步引导教程弹窗", () => {
  it("第一步就给出文案与「下一步」", async () => {
    await mount()
    const dialog = dialogEl()
    expect(dialog, "open=true 时必须渲染出弹窗（内容 portal 到 document.body）").not.toBeNull()
    expect(dialog!.textContent).toContain("欢迎使用青幕 AI 写作")
    expect(buttonIn("下一步")).toBeDefined()
    expect(dialog!.textContent).toContain("第 1 / ")
  })

  it("「下一步」逐步推进，最后一步的按钮变成「开始使用」", async () => {
    await mount()
    const total = totalSteps()
    expect(total, "教程至少要有两步，否则「下一步」没有意义").toBeGreaterThanOrEqual(2)

    // 除最后一步外，每一步都必须有「下一步」、且点得动。
    for (let step = 2; step <= total; step += 1) {
      expect(buttonLabels(), `第 ${step - 1} 步应当还有「下一步」`).toContain("下一步")
      await clickLabel("下一步")
      expect(dialogEl()!.textContent, `第 ${step} 步应已显示`).toContain(`第 ${step} / ${total} 步`)
    }
    // 最后一步：没有「下一步」，只有「开始使用」。
    expect(buttonLabels()).not.toContain("下一步")
    expect(buttonIn("开始使用")).toBeDefined()
  })

  it("点「开始使用」关掉教程", async () => {
    const onOpenChange = vi.fn()
    await mount(true, onOpenChange)
    const total = totalSteps()
    for (let i = 1; i < total; i += 1) await clickLabel("下一步")
    await clickLabel("开始使用")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("显示即记 seen（每本书一次），且已经记过就不再写盘", async () => {
    await mount()
    expect(useWikiStore.getState().novelConfig.usageTutorialSeen).toBe(true)
    expect(saveNovelConfig as Mock).toHaveBeenCalledTimes(1)
    expect((saveNovelConfig as Mock).mock.calls[0][0]).toMatchObject({ usageTutorialSeen: true })

    // 同一个会话里再打开一次：seen 已是 true，不该重复写盘。
    await remount(false)
    await remount(true)
    expect(saveNovelConfig as Mock).toHaveBeenCalledTimes(1)
  })

  it("open=false 时不渲染任何内容", async () => {
    await mount(false)
    expect(dialogEl()).toBeNull()
  })

  /*
   * ── F6（修复批）：走到最后一步 → 关掉 → 再打开，必须回到第一步 ──
   *
   * 这一条能被漏掉，是因为「关掉」时组件**并不卸载**：`open=false` 只是
   * `return null`，`useState(0)` 里的 `step` 会留着。所以「重新查看教程」
   * （设置里的入口走同一个 `open`）若没有 effect 里的 `setStep(0)` 复位，
   * 会直接落在最后一步、「开始使用」上 —— 用户点开只看到一句话。
   *
   * 实测：删掉 `setStep(0)`，本文件其余用例全绿（它们每次都是新挂载，
   * `useState(0)` 本来就给 0）。所以必须用 `remount(false)` → `remount(true)`
   * 走「同一个实例被关掉再打开」这条路径。
   */
  it("走到最后一步后关掉再打开，从第一步重新开始", async () => {
    await mount(true)
    const total = totalSteps()
    expect(total, "教程至少要有两步，否则「最后一步」没有意义").toBeGreaterThanOrEqual(2)
    for (let i = 1; i < total; i += 1) await clickLabel("下一步")
    expect(dialogEl()!.textContent, "前提：确实走到了最后一步").toContain(`第 ${total} / ${total} 步`)
    expect(buttonIn("开始使用")).toBeDefined()

    await remount(false)
    expect(dialogEl(), "关掉之后不该还渲染着").toBeNull()

    await remount(true)
    expect(
      dialogEl()!.textContent,
      "重新打开必须回到第一步（组件没卸载，`step` 不复位就会停在最后一步）",
    ).toContain(`第 1 / ${total} 步`)
    expect(buttonLabels(), "回到第一步就该重新有「下一步」").toContain("下一步")
    expect(buttonLabels()).not.toContain("开始使用")
  })
})
