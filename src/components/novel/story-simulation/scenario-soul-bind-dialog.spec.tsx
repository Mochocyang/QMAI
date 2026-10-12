// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import "@/i18n"
import type { ScenarioCandidate } from "@/lib/novel/story-simulation/scenario-types"
import { ScenarioSoulBindDialog } from "./scenario-soul-bind-dialog"

/** listDirectory 返回的最小文件节点形状（真实实现只需要 name / path / is_dir）。 */
type FileNodeLike = { name: string; path: string; is_dir: boolean }

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn(async (_path: string) => {}),
  fileExists: vi.fn(async (_path: string) => false),
  writeFileAtomic: vi.fn(async (_path: string, _contents: string) => {}),
  // 真实可绑定名单（listBindableNovelCharactersLocal）要经过 listDirectory + readFile
  // 才认得人物页；本文件目前没有路径踩到，但少了这两个桩会撞
  // No "listDirectory" export is defined on the "@/commands/fs" mock
  listDirectory: vi.fn(async (_dir: string) => [] as FileNodeLike[]),
  readFile: vi.fn(async (_path: string) => ""),
}))

vi.mock("@/commands/fs", () => ({
  createDirectory: fsMocks.createDirectory,
  fileExists: fsMocks.fileExists,
  writeFileAtomic: fsMocks.writeFileAtomic,
  listDirectory: fsMocks.listDirectory,
  readFile: fsMocks.readFile,
}))

const auraMocks = vi.hoisted(() => ({
  listCharacterAuras: vi.fn(),
  bindCharacterAura: vi.fn(),
  unbindCharacterAura: vi.fn(),
}))

vi.mock("@/lib/novel/character-aura", async () => {
  const actual = await vi.importActual<typeof import("@/lib/novel/character-aura")>(
    "@/lib/novel/character-aura",
  )
  return {
    ...actual,
    listCharacterAuras: auraMocks.listCharacterAuras,
    bindCharacterAura: auraMocks.bindCharacterAura,
    unbindCharacterAura: auraMocks.unbindCharacterAura,
  }
})

const BLOCK_MESSAGE = "请先在大纲中添加人物小传或人物设定，再绑定角色灵魂"

function makeAura(id: string, name: string) {
  return {
    id,
    builtIn: false,
    name,
    sourceNote: "",
    corpus: "",
    styleDescription: "",
    behaviorRules: "",
    boundaries: "",
    notes: "",
  }
}

const CANDIDATE: ScenarioCandidate = {
  id: "沈砚",
  name: "沈砚",
  profile: "账房出身",
  auraId: null,
  auraName: null,
  speakingStyle: "短句",
  personality: ["谨慎"],
  knowledgeScope: ["账目"],
  doesNotKnow: ["北境战事"],
}

/** 换人场景用的另一个角色：id / name 都与 CANDIDATE 不同。 */
const OTHER_CANDIDATE: ScenarioCandidate = {
  id: "李四",
  name: "李四",
  profile: "画师出身",
  auraId: null,
  auraName: null,
  speakingStyle: "反问",
  personality: ["多疑"],
  knowledgeScope: ["丹青"],
  doesNotKnow: ["账目"],
}

let host: HTMLDivElement
let root: Root

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function makeMocks() {
  return { onOpenChange: vi.fn(), onBound: vi.fn() }
}

function renderDialog(
  props: Partial<React.ComponentProps<typeof ScenarioSoulBindDialog>> = {},
  mocks: ReturnType<typeof makeMocks> = makeMocks(),
) {
  act(() => {
    root.render(
      <ScenarioSoulBindDialog
        open
        projectPath="/proj"
        candidate={CANDIDATE}
        onOpenChange={mocks.onOpenChange}
        onBound={mocks.onBound}
        {...props}
      />,
    )
  })
  return mocks
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label,
  )
}

function click(node: Element | null | undefined) {
  if (!node) throw new Error("要点击的元素不存在")
  act(() => {
    ;(node as HTMLElement).click()
  })
}

function searchInput(): HTMLInputElement | undefined {
  return (
    document.body.querySelector<HTMLInputElement>('input[aria-label="搜索灵魂"]') ?? undefined
  )
}

function radios(): HTMLInputElement[] {
  return Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
}

/** 单选按钮的名字（aria-label 就是灵魂名）。 */
function radioNames(): (string | null)[] {
  return radios().map((r) => r.getAttribute("aria-label"))
}

function textarea(): HTMLTextAreaElement | undefined {
  return document.body.querySelector<HTMLTextAreaElement>("textarea") ?? undefined
}

function selectRadio(name: string) {
  const node = document.body.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!node) throw new Error(`选不到灵魂「${name}」`)
  click(node)
}

/** React 受控组件：必须走原型上的 setter，否则 value tracker 会吞掉事件。 */
function setNativeValue(el: HTMLElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
  setter?.call(el, value)
}

/** 往受控输入框里「打字」：先走原型 setter，再派发 input 事件。 */
function typeInto(el: HTMLElement | undefined, value: string) {
  if (!el) throw new Error("要输入的元素不存在")
  act(() => {
    setNativeValue(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

/** 手动控制兑现时机的 promise：用来制造「请求还在飞」的窗口。 */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 父组件重渲染 harness：每次渲染都新建 candidate 对象（等价于调用方写
 * `candidate={{ ... }}`），但 id / auraId 不变 —— 这正是「父组件无关重渲染」的形状。
 */
function ParentHarness({
  candidate,
  mocks,
  poke,
}: {
  candidate: ScenarioCandidate
  mocks: ReturnType<typeof makeMocks>
  poke: { current: () => void }
}) {
  const [, setTick] = useState(0)
  poke.current = () => setTick((n) => n + 1)
  return (
    <ScenarioSoulBindDialog
      open
      projectPath="/proj"
      candidate={{ ...candidate }}
      onOpenChange={mocks.onOpenChange}
      onBound={mocks.onBound}
    />
  )
}

/** 打开弹窗 → 选中第一个灵魂 → 点「绑定」。 */
async function pickSoulAndBind(name = "账房先生") {
  const mocks = renderDialog()
  await flush()
  act(() => document.body.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!.click())
  await flush()
  click(findButton("绑定"))
  await flush()
  return mocks
}

beforeEach(() => {
  // resetAllMocks 而不是 clearAllMocks：后者不会清掉 mockRejectedValueOnce 这类
  // 「只生效一次」的队列，上一个用例没用完的队列会串进下一个用例，让「第几次绑定
  // 失败」变得不确定。默认实现紧接着在下面重新设好。
  vi.resetAllMocks()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  fsMocks.fileExists.mockResolvedValue(false)
  auraMocks.listCharacterAuras.mockResolvedValue([makeAura("a1", "账房先生")])
  auraMocks.bindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
  // 弹窗走 Portal 渲染到 body，所以断言一律查 document.body；每次先清空 body，
  // 否则上一个用例残留的弹窗 DOM 会让「不该出现的东西」断言假通过
  document.body.innerHTML = ""
  host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  document.body.innerHTML = ""
})

describe("ScenarioSoulBindDialog", () => {
  it("打开时读出灵魂名单，选中后可绑定并回执", async () => {
    const { onBound, onOpenChange } = renderDialog()
    await flush()
    expect(auraMocks.listCharacterAuras).toHaveBeenCalledWith("/proj")

    act(() => document.body.querySelector<HTMLInputElement>('input[aria-label="账房先生"]')!.click())
    await flush()
    click(findButton("绑定"))
    await flush()

    expect(auraMocks.bindCharacterAura).toHaveBeenCalledWith("/proj", {
      characterName: "沈砚",
      auraId: "a1",
    })
    expect(onBound).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("绑定被拒（缺小传）时切到补小传步骤，并预填草稿、不写盘", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()

    expect(document.body.textContent).toContain("先补一份人物小传")
    const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea?.value).toContain("# 沈砚")
    expect(textarea?.value).toContain("谨慎")
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
  })

  it("补小传步骤：写盘 → 再次绑定 → 成功回执", async () => {
    auraMocks.bindCharacterAura
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
      .mockResolvedValueOnce({ customAuras: [], bindings: [] })
    const { onBound, onOpenChange } = await pickSoulAndBind()

    // 断言写进磁盘的是用户**看到并改过**的正文，而不是只看 frontmatter 常量：
    // 只断言 `tags: [character]` 的话，传一份空草稿也照样绿
    const draft = textarea()?.value ?? ""
    expect(draft).toContain("# 沈砚")
    const edited = `${draft}\n\n## 近况\n左手有旧伤，落笔会抖`
    typeInto(textarea(), edited)

    click(findButton("创建小传并绑定"))
    await flush()

    expect(fsMocks.writeFileAtomic).toHaveBeenCalledWith(
      "/proj/wiki/entities/沈砚.md",
      expect.stringContaining("左手有旧伤，落笔会抖"),
    )
    const written = fsMocks.writeFileAtomic.mock.calls[0]?.[1] ?? ""
    expect(written).toContain("tags: [character]")
    expect(written).toContain(edited.trim())
    expect(auraMocks.bindCharacterAura).toHaveBeenCalledTimes(2)
    expect(onBound).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("补小传步骤可以退回重选，退回时还没写盘", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()
    click(findButton("返回重选"))
    await flush()

    expect(document.body.textContent).toContain("绑定会写入本项目")
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
  })

  it("其它错误原样显示，且不切步骤", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error("磁盘满了"))
    await pickSoulAndBind()

    expect(document.body.textContent).toContain("磁盘满了")
    expect(document.body.textContent).not.toContain("先补一份人物小传")
  })

  it("灵魂库为空时给出可操作的空态", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([])
    renderDialog()
    await flush()
    expect(document.body.textContent).toContain("还没有可用的角色灵魂")
    // 名单为空 ≠ 搜不到：这时候不该出现「换个关键词」的提示
    expect(document.body.textContent).not.toContain("没有匹配")
  })

  it("角色已绑定时提供「解绑」，解绑成功同样回执", async () => {
    auraMocks.unbindCharacterAura.mockResolvedValue({ customAuras: [], bindings: [] })
    const { onBound, onOpenChange } = renderDialog({
      candidate: { ...CANDIDATE, auraId: "a1", auraName: "账房先生" },
    })
    await flush()
    click(findButton("解绑"))
    await flush()
    expect(auraMocks.unbindCharacterAura).toHaveBeenCalledWith("/proj", "沈砚")
    expect(onBound).toHaveBeenCalledTimes(1)
    // 用例名说「同样回执」，回执的两半都要断言
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("未绑定时不显示「解绑」", async () => {
    renderDialog()
    await flush()
    expect(findButton("解绑")).toBeUndefined()
  })

  it("取消不产生任何写入", async () => {
    const { onOpenChange } = renderDialog()
    await flush()
    click(findButton("返回"))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(auraMocks.bindCharacterAura).not.toHaveBeenCalled()
  })

  it("没有角色时不读名单、也不渲染内容", async () => {
    renderDialog({ candidate: null })
    await flush()
    expect(auraMocks.listCharacterAuras).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain("绑定会写入本项目")
  })

  it("搜索按关键词过滤名单；搜不到时提示换关键词而不是去灵魂页", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([
      makeAura("a1", "账房先生"),
      makeAura("a2", "画师"),
      makeAura("a3", "镖师"),
    ])
    renderDialog()
    await flush()
    expect(radioNames()).toEqual(["账房先生", "画师", "镖师"])

    // 受控输入必须走原型 setter：直接赋 value 会被 React 的 value tracker 吞掉，
    // 列表仍是 3 个单选项
    typeInto(searchInput(), "画师")
    await flush()
    expect(radioNames()).toEqual(["画师"])
    expect(document.body.textContent).not.toContain("账房先生")

    typeInto(searchInput(), "不存在的灵魂")
    await flush()
    expect(radios()).toHaveLength(0)
    expect(document.body.textContent).toContain("没有匹配「不存在的灵魂」的灵魂")
    expect(document.body.textContent).not.toContain("还没有可用的角色灵魂")
  })

  it("选中项被搜索过滤藏起来后，按钮不可再提交那个看不见的灵魂", async () => {
    auraMocks.listCharacterAuras.mockResolvedValue([
      makeAura("a1", "账房先生"),
      makeAura("a2", "画师"),
    ])
    renderDialog()
    await flush()
    selectRadio("账房先生")
    await flush()
    expect(findButton("绑定")?.disabled).toBe(false)

    typeInto(searchInput(), "画师")
    await flush()
    expect(radioNames()).toEqual(["画师"])
    expect(findButton("绑定")?.disabled).toBe(true)

    // 就算硬点，也不能绑那个已经被藏起来的账房先生
    click(findButton("绑定"))
    await flush()
    expect(auraMocks.bindCharacterAura).not.toHaveBeenCalled()
  })

  it("名单读不出来时按空名单兜底，不挡住弹窗", async () => {
    auraMocks.listCharacterAuras.mockRejectedValueOnce(new Error("读不到灵魂库"))
    renderDialog()
    await flush()
    expect(document.body.textContent).toContain("还没有可用的角色灵魂")
    expect(document.body.textContent).not.toContain("正在读取角色灵魂")
  })

  it("父组件无关重渲染：名单只读一次，用户改过的小传草稿不被清掉", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    const mocks = makeMocks()
    const poke = { current: () => {} }
    act(() => {
      root.render(<ParentHarness candidate={CANDIDATE} mocks={mocks} poke={poke} />)
    })
    await flush()
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()
    expect(textarea()?.value).toContain("# 沈砚")

    typeInto(textarea(), "# 沈砚\n\n## 近况\n左手有旧伤")
    expect(textarea()?.value).toContain("左手有旧伤")

    // 父组件因为任何别的原因重渲染一次（candidate 变成新对象，id / auraId 没变）
    act(() => poke.current())
    await flush()

    expect(auraMocks.listCharacterAuras).toHaveBeenCalledTimes(1)
    expect(textarea()?.value).toContain("左手有旧伤")
    expect(document.body.textContent).toContain("先补一份人物小传")
  })

  it("换了角色（id 变了）时步骤与草稿都要复位", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    const mocks = makeMocks()
    const poke = { current: () => {} }
    act(() => {
      root.render(<ParentHarness candidate={CANDIDATE} mocks={mocks} poke={poke} />)
    })
    await flush()
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()
    expect(textarea()?.value).toContain("# 沈砚")

    act(() => {
      root.render(<ParentHarness candidate={OTHER_CANDIDATE} mocks={mocks} poke={poke} />)
    })
    await flush()

    expect(auraMocks.listCharacterAuras).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).toContain("为「李四」绑定灵魂")
    expect(textarea()).toBeUndefined()
    expect(findButton("创建小传并绑定")).toBeUndefined()

    // 再走一次补小传：草稿必须是李四的，不能是沈砚的残留
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()
    expect(textarea()?.value).toContain("# 李四")
    expect(textarea()?.value).not.toContain("# 沈砚")
  })

  it("绑定请求在飞时换人：不给新角色写盘、不推进步骤、不回执", async () => {
    const pending = deferred<unknown>()
    auraMocks.bindCharacterAura.mockReturnValueOnce(pending.promise)
    const mocks = makeMocks()
    const poke = { current: () => {} }
    act(() => {
      root.render(<ParentHarness candidate={CANDIDATE} mocks={mocks} poke={poke} />)
    })
    await flush()
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()

    // 沈砚的绑定还在飞的时候，用户切到李四
    act(() => {
      root.render(<ParentHarness candidate={OTHER_CANDIDATE} mocks={mocks} poke={poke} />)
    })
    await flush()
    expect(document.body.textContent).toContain("为「李四」绑定灵魂")

    // 沈砚那次请求现在才以「缺小传」失败返回
    await act(async () => {
      pending.reject(new Error(BLOCK_MESSAGE))
      await Promise.resolve()
    })
    await flush()

    // 陈旧结果必须整条作废：不能把沈砚的草稿填进李四的补小传步骤，
    // 否则用户顺着点下去就会在磁盘上写出一份内容属于沈砚的 李四.md
    expect(mocks.onBound).not.toHaveBeenCalled()
    expect(mocks.onOpenChange).not.toHaveBeenCalled()
    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(findButton("创建小传并绑定")).toBeUndefined()
    expect(textarea()).toBeUndefined()
    expect(document.body.textContent).not.toContain("还没有档案")
  })

  it("补小传草稿被用户改过之后，「返回重选」再进来不会把它冲掉", async () => {
    auraMocks.bindCharacterAura.mockRejectedValue(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()
    const generated = textarea()?.value ?? ""
    expect(generated).toContain("# 沈砚")

    typeInto(textarea(), `${generated}\n\n## 近况\n左手有旧伤`)
    click(findButton("返回重选"))
    await flush()
    expect(findButton("创建小传并绑定")).toBeUndefined()

    click(findButton("绑定"))
    await flush()
    expect(textarea()?.value).toContain("左手有旧伤")
  })

  it("补小传之后仍然绑不上：created=true 的文案抵达用户，描述不算误导", async () => {
    auraMocks.bindCharacterAura
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    const { onBound } = await pickSoulAndBind()

    click(findButton("创建小传并绑定"))
    await flush()

    expect(fsMocks.writeFileAtomic).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("人物页已写入，但绑定校验仍未通过")
    // 这次确实写过盘，上面那句「还没有档案」并不矛盾，仍然显示
    expect(document.body.textContent).toContain("还没有档案")
    expect(onBound).not.toHaveBeenCalled()
  })

  it("已有同名人物页时（created=false）文案不误导：描述隐藏，只留错误", async () => {
    fsMocks.fileExists.mockResolvedValue(true)
    auraMocks.bindCharacterAura
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
      .mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    await pickSoulAndBind()
    expect(document.body.textContent).toContain("还没有档案")

    click(findButton("创建小传并绑定"))
    await flush()

    expect(fsMocks.writeFileAtomic).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("该角色已有同名人物页")
    // M8：一个字节都没写，就不能同屏说「还没有档案，直接绑定会被拒绝」
    expect(document.body.textContent).not.toContain("还没有档案")
  })

  it("候选缺 personality 时报错而不是静默无反应", async () => {
    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    renderDialog({
      // 历史 / 导入数据里可能缺这些字段，形状上强转成 ScenarioCandidate
      candidate: { ...CANDIDATE, personality: undefined } as unknown as ScenarioCandidate,
    })
    await flush()
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()

    const alert = document.body.querySelector('[role="alert"]')
    expect(alert?.textContent ?? "").toContain("length")
    // busy 必须复位，否则按钮永远停在「绑定中…」
    const confirm = findButton("绑定")
    expect(confirm).toBeDefined()
    expect(confirm?.disabled).toBe(false)
    expect(document.body.textContent).not.toContain("先补一份人物小传")
  })

  it("两段关键说明都挂在 DialogDescription 上（读屏器能关联到对话框）", async () => {
    renderDialog()
    await flush()

    const pickDesc = document.body.querySelector('[data-slot="dialog-description"]')
    expect(pickDesc?.textContent).toContain("绑定会写入本项目")
    const content = document.body.querySelector('[data-slot="dialog-content"]')
    const ids = (content?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean)
    expect(ids.map((id) => document.getElementById(id))).toContain(pickDesc)

    auraMocks.bindCharacterAura.mockRejectedValueOnce(new Error(BLOCK_MESSAGE))
    selectRadio("账房先生")
    await flush()
    click(findButton("绑定"))
    await flush()

    const profileDesc = document.body.querySelector('[data-slot="dialog-description"]')
    expect(profileDesc?.textContent).toContain("还没有档案")
  })
})

describe("ScenarioSoulBindDialog 源码契约", () => {
  const src = readFileSync(resolve(__dirname, "scenario-soul-bind-dialog.tsx"), "utf8")

  it("不复用拆书工作台的绑定弹窗（那是发布语义，文案与多选都不对）", () => {
    expect(src).not.toContain("BindingTargetDialog")
    expect(src).toContain("scenario-soul-bind-dialog")
  })

  it("名单来自 listCharacterAuras，绑定走 scenario-soul-binding", () => {
    expect(src).toContain("listCharacterAuras")
    expect(src).toContain("bindScenarioSoul")
    expect(src).toContain("createProfilePageThenBind")
  })
})
