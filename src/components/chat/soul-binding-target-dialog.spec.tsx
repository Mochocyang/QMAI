// @vitest-environment jsdom
/**
 * 丁-4：`@某人灵魂` 的确认弹窗。
 *
 * 它钉住的是「绑定前必须有人明确指定人物」这条交互契约，以及两条必须让用户
 * 在**点确认之前**就看到的信息：
 *   - 影响范围（风险 7：匹配是包含式的，还含拼音/简繁，且不按章节过滤）；
 *   - 带人格规则的灵魂是 fail-closed 的（风险 6：预算装不下就停机，不是静默丢弃）。
 * 以及一条**不做**的事：弹窗自己不写盘（取消路径零副作用）。
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SoulBindingTargetDialog } from "./soul-binding-target-dialog"

// React 19 需要这个开关才能让 act(...) 无警告地工作，与本仓库其它 jsdom 用例一致。
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  listBindable: vi.fn(async (): Promise<string[]> => ["甲", "乙"]),
  readIgnore: vi.fn(async (): Promise<string[]> => []),
  bindCharacterAura: vi.fn(async () => ({ customAuras: [], bindings: [] })),
  unbindCharacterAura: vi.fn(async () => ({ customAuras: [], bindings: [] })),
  getCharacterAuraBindings: vi.fn(async () => []),
}))

vi.mock("@/lib/novel/character-aura", () => ({
  listBindableNovelCharacters: mocks.listBindable,
  bindCharacterAura: mocks.bindCharacterAura,
  unbindCharacterAura: mocks.unbindCharacterAura,
  getCharacterAuraBindings: mocks.getCharacterAuraBindings,
}))

vi.mock("@/lib/novel/bindable-characters-filter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/novel/bindable-characters-filter")>()),
  readBindableIgnoreList: mocks.readIgnore,
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

beforeEach(() => {
  mocks.listBindable.mockReset()
  mocks.listBindable.mockResolvedValue(["甲", "乙"])
  mocks.readIgnore.mockReset()
  mocks.readIgnore.mockResolvedValue([])
  mocks.bindCharacterAura.mockClear()
  mocks.unbindCharacterAura.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  document.body.innerHTML = ""
})

const dialogEl = () => document.querySelector<HTMLElement>('[data-testid="soul-binding-target-dialog"]')
const nameGrid = () => document.querySelector<HTMLElement>('[data-testid="soul-bindable-name-grid"]')
const blastRadius = () => document.querySelector<HTMLElement>('[data-testid="soul-blast-radius"]')
const personalityRisk = () => document.querySelector<HTMLElement>('[data-testid="soul-personality-risk"]')
const confirmButton = () => document.querySelector<HTMLButtonElement>('[data-testid="soul-binding-confirm"]')
const searchBox = () => document.querySelector<HTMLInputElement>('input[aria-label="搜索小说人物"]')
const shownNames = () => [...(nameGrid()?.querySelectorAll("label span") ?? [])].map((span) => span.textContent)
const radioFor = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[type="radio"][aria-label="绑定到${name}"]`)
const buttonWith = (label: string) =>
  [...(dialogEl()?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.includes(label))
const click = async (element: Element | null | undefined) => {
  await act(async () => { (element as HTMLElement | null)?.click() })
}

async function renderDialog(props: Partial<React.ComponentProps<typeof SoulBindingTargetDialog>> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  await act(async () => {
    root!.render(
      <SoulBindingTargetDialog
        open
        projectPath="/project"
        soulName="许七安"
        soulHasPortablePersonality={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        {...props}
      />,
    )
  })
  return { onConfirm, onOpenChange }
}

async function typeQuery(value: string) {
  const input = searchBox()!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("角色灵魂绑定确认弹窗", () => {
  it("列出可绑定的小说人物，并过滤掉内置规则认定的非人物条目", async () => {
    mocks.listBindable.mockResolvedValue(["甲", "乙", "冲突点", "人物关系图"])
    await renderDialog()

    expect(dialogEl()!.textContent).toContain("用「许七安」的灵魂")
    expect(shownNames()).toEqual(["甲", "乙"])
  })

  it("忽略表里的名字不出现在候选里（读忽略表但不改它）", async () => {
    mocks.listBindable.mockResolvedValue(["甲", "乙"])
    mocks.readIgnore.mockResolvedValue(["乙"])
    await renderDialog()

    expect(shownNames()).toEqual(["甲"])
  })

  it("没选人物时确认按钮禁用、且不显示影响范围；选中后两者同时出现", async () => {
    await renderDialog()

    expect(confirmButton()!.disabled).toBe(true)
    expect(blastRadius()).toBeNull()

    await click(radioFor("乙"))

    expect(confirmButton()!.disabled).toBe(false)
    // 风险 7：影响范围必须在**点确认之前**说出来，且点名用户真正会绑上去的那个人
    expect(blastRadius()!.textContent).toContain("乙")
    expect(blastRadius()!.textContent).toContain("包含式")
    expect(blastRadius()!.textContent).toContain("拼音")
  })

  it("确认时只交出一个人物名（「只对这一条消息生效」的还原边界才不含糊）", async () => {
    const { onConfirm } = await renderDialog()

    await click(radioFor("甲"))
    await click(confirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith("甲")
  })

  it("取消只关弹窗，不调用确认回调", async () => {
    const { onConfirm, onOpenChange } = await renderDialog()

    await click(buttonWith("取消"))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("带人格规则的灵魂：打开即给出 fail-closed 的失败模式说明", async () => {
    await renderDialog({ soulHasPortablePersonality: true })

    expect(personalityRisk()!.textContent).toContain("上下文预算不足，角色人格规则未完整保留")
  })

  it("不带人格规则的灵魂：不显示人格风险块（别把提示变成噪音）", async () => {
    await renderDialog({ soulHasPortablePersonality: false })

    expect(personalityRisk()).toBeNull()
  })

  it("没有可绑定人物时，直接给出「先补人物小传」这条可操作指引", async () => {
    mocks.listBindable.mockResolvedValue([])
    await renderDialog()

    expect(dialogEl()!.textContent).toContain("请先在大纲中添加人物小传或人物设定，再绑定角色灵魂")
    expect(confirmButton()!.disabled).toBe(true)
  })

  it("搜索按子串过滤，并且不会把已选中的人取消掉", async () => {
    mocks.listBindable.mockResolvedValue(["甲", "乙"])
    await renderDialog()

    await click(radioFor("甲"))
    await typeQuery("乙")

    expect(shownNames()).toEqual(["乙"])
    // 选中项由 state 持有，不随过滤后的视图推导
    expect(radioFor("甲")).toBeNull()
    expect(confirmButton()!.disabled).toBe(false)
    expect(blastRadius()!.textContent).toContain("甲")

    await typeQuery("zzz")
    expect(dialogEl()!.textContent).toContain("没有匹配「zzz」")
  })

  it("**不写盘**：这个弹窗从头到尾不碰任何存储写入函数", async () => {
    const { onConfirm } = await renderDialog()
    await click(radioFor("甲"))
    await click(confirmButton())

    // ⚠️ 断言的是「弹窗里那两个真实写盘函数没被调用」，而不是某个不存在的名字：
    // 写盘由调用方在确认之后走 `beginMessageScopedSoulBinding`。
    expect(onConfirm).toHaveBeenCalledWith("甲")
    expect(mocks.bindCharacterAura).not.toHaveBeenCalled()
    expect(mocks.unbindCharacterAura).not.toHaveBeenCalled()
  })
})
