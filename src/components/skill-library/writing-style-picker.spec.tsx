// @vitest-environment jsdom

/**
 * 丁-2「文风写作」选择器。
 *
 * ## 本次改造后的契约（下拉**只剩两项**）
 *
 *   (a)「当前文风」—— 只读读数，直接把生效的那条名字摆出来；
 *   (b)「打开文风库」—— 唯一的动作入口，跳 `/writingStyleLibrary`。
 *
 * 所以本文件里**不再**有：listbox / `role="option"` / 箭头键选单 /
 * 「跟随项目设置的文风」/「本次不用文风」/「只影响这一次生成」提示。
 * 那些断言连同它们的实现一起删了 —— 想加回来的话，先看组件文件头那段注释。
 *
 * ⚠️ 唯一还留着的"防旧版回潮"守卫是最后一条 `下拉不许再有旧入口`：
 * 它钉的是**用户需求本身**（只要两项），不是实现细节。
 *
 * ⚠️ 这里**不** mock `useWritingStyleOptions`：显示名（含「未启用」/「所选文风已不存在」）
 * 的推导就在那个 hook 里，mock 掉这条用例只剩空壳。只 mock 读盘（`@/commands/fs`）。
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { WritingStylePicker } from "./writing-style-picker"
import { useWritingStyleOptions } from "./use-writing-style-options"

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const readFileMock = vi.hoisted(() => vi.fn())
/**
 * 文风库写盘的两个真实入口（`writing-style-store.ts:15` 从 `@/commands/fs`
 * import 的是 `createDirectory, readFile, writeFileAtomic`）。
 * 提到 `vi.hoisted` 里是为了**每个用例都能查调用记录** —— 只用
 * `writeFileAtomic: vi.fn()` 内联的话，测试里拿不到那个 mock。
 */
const writeFileAtomicMock = vi.hoisted(() => vi.fn())
const createDirectoryMock = vi.hoisted(() => vi.fn())

vi.mock("@/commands/fs", () => ({
  readFile: readFileMock,
  writeFileAtomic: writeFileAtomicMock,
  createDirectory: createDirectoryMock,
  fileExists: vi.fn(),
}))

const PROJECT_PATH = "C:/project"
const STORE_PATH = `${PROJECT_PATH}/.qmai/writing-style.json`

function preset(id: string, name: string, sourceBook: string) {
  return {
    id,
    name,
    sourceBook,
    profile: { schemaVersion: 1, generatedAt: 1, constitution: "克制", samples: [] },
    createdAt: 1,
    updatedAt: 1,
  }
}

/** 盘上的 store 内容；每个用例可以改。 */
let store = {
  version: 1,
  enabledStyleId: "style-b" as string | null,
  styles: [preset("style-a", "甲书 · 文风", "甲书"), preset("style-b", "乙书 · 文风", "乙书")],
}

async function renderPicker(
  onChange = vi.fn(),
  props: Partial<ComponentProps<typeof WritingStylePicker>> = {},
) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<WritingStylePicker onChange={onChange} {...props} />)
  })
  return { container, root, onChange }
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount())
  document.body.removeChild(container)
}

function trigger(container: HTMLElement): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('[data-testid="writing-style-picker-trigger"]')
  expect(found, "应有选择器触发按钮").not.toBeNull()
  return found!
}

function popover(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('[data-testid="writing-style-picker-popover"]')
  expect(found, "浮层应已打开").not.toBeNull()
  return found!
}

async function openPicker(container: HTMLElement) {
  await act(async () => {
    trigger(container).click()
  })
  await flushEffects()
}

/** 浮层里的动作按钮（按文案找）。 */
function popoverButton(container: HTMLElement, text: string): HTMLButtonElement {
  const found = Array.from(popover(container).querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.textContent?.includes(text))
  expect(found, `浮层里应有「${text}」按钮`).toBeDefined()
  return found!
}

beforeEach(() => {
  vi.clearAllMocks()
  store = {
    version: 1,
    enabledStyleId: "style-b",
    styles: [preset("style-a", "甲书 · 文风", "甲书"), preset("style-b", "乙书 · 文风", "乙书")],
  }
  readFileMock.mockImplementation(async (path: string) => {
    if (path === STORE_PATH) return JSON.stringify(store)
    throw new Error("ENOENT")
  })
  useWikiStore.getState().setProject({ id: "p1", name: "测试项目", path: PROJECT_PATH })
})

describe("WritingStylePicker", () => {
  it("下拉只剩两项：一个只读的「当前文风」读数 + 一个「打开文风库」按钮", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    const panel = popover(container)
    const current = panel.querySelector<HTMLElement>('[data-testid="writing-style-picker-current"]')
    expect(current, "应有当前文风读数").not.toBeNull()
    // 没有覆盖时，读数是项目启用项
    expect(current!.textContent).toContain("乙书 · 文风")

    /*
     * 读数**不可点**：它必须是普通元素，不能是 button。
     * 判别力：把它改成 <button> ⇒ 红。这一条钉的是需求里的「显示」二字 ——
     * 一旦可点，用户就会以为这里还能选文风，两项的设计立刻退化。
     */
    expect(current!.tagName).not.toBe("BUTTON")
    expect(current!.querySelector("button")).toBeNull()

    // 整块浮层里**只有**一个按钮：打开文风库
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button"))
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent).toContain("打开文风库")

    cleanup(root, container)
  })

  it("「打开文风库」跳到丁-1 那个视图", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    await act(async () => {
      popoverButton(container, "打开文风库").click()
    })

    expect(useWikiStore.getState().activeView).toBe("writingStyleLibrary")
    // 点完即关，别把浮层留在屏幕上
    expect(container.querySelector('[data-testid="writing-style-picker-popover"]')).toBeNull()

    cleanup(root, container)
  })

  /*
   * ── ★ 需求守卫：旧入口一个都不许回潮 ──
   *
   * 用户明确要求「只显示以下两个内容」。改造前浮层里有 5 块，其中
   * 「跟随项目设置的文风」「本次不用文风」是**两个覆盖入口**、
   * 「文风列表」是一整套 listbox。留成一条断言是为了防止以后有人
   * 「顺手把列表补回来」—— 那是需求变更，不该悄悄发生。
   */
  it("下拉不许再有旧入口：文风列表 / 跟随项目设置 / 本次不用 / 预算提示", async () => {
    // 用「有覆盖 + 库里有两条」的真实状态，把列表和两个入口的渲染条件都满足
    const { container, root } = await renderPicker(vi.fn(), { value: "style-a" })
    await flushEffects()
    await openPicker(container)

    const panel = popover(container)
    expect(panel.querySelector('[role="listbox"]')).toBeNull()
    expect(panel.querySelector('[role="option"]')).toBeNull()

    const text = panel.textContent ?? ""
    for (const removed of [
      "跟随项目设置的文风",
      "本次不用文风",
      "打开完整文风库",
      "只影响这一次生成",
    ]) {
      expect(text, `「${removed}」不该再出现`).not.toContain(removed)
    }

    cleanup(root, container)
  })

  it("选中的是具体预设时，读数显示那条预设的名字", async () => {
    const { container, root } = await renderPicker(vi.fn(), { value: "style-a" })
    await flushEffects()
    await openPicker(container)

    expect(
      popover(container).querySelector('[data-testid="writing-style-picker-current"]')?.textContent,
    ).toContain("甲书 · 文风")

    cleanup(root, container)
  })

  it("所选预设已被删除时说「已不存在」，不回落到项目启用项的名字", async () => {
    store = { version: 1, enabledStyleId: "style-b", styles: [preset("style-b", "乙书 · 文风", "乙书")] }
    const { container, root } = await renderPicker(vi.fn(), { value: "style-gone" })
    await flushEffects()

    expect(trigger(container).textContent).toContain("所选文风已不存在")
    expect(trigger(container).textContent).not.toContain("乙书 · 文风")

    await openPicker(container)
    const currentText =
      popover(container).querySelector('[data-testid="writing-style-picker-current"]')?.textContent ?? ""
    expect(currentText).toContain("所选文风已不存在")
    expect(currentText).not.toContain("乙书 · 文风")

    cleanup(root, container)
  })

  it("value=null 时读数说「本次不用」，不回落到项目启用项", async () => {
    const { container, root } = await renderPicker(vi.fn(), { value: null })
    await flushEffects()

    expect(trigger(container).textContent).toContain("本次不用")
    expect(trigger(container).getAttribute("aria-label")).toBe("文风：本次不用")

    await openPicker(container)
    const currentText =
      popover(container).querySelector('[data-testid="writing-style-picker-current"]')?.textContent ?? ""
    expect(currentText).toContain("本次不用")
    expect(currentText).not.toContain("乙书")

    cleanup(root, container)
  })

  it("文风库为空时读数给「未启用」，浮层照样能打开（不是空浮层）", async () => {
    store = { version: 1, enabledStyleId: null, styles: [] }
    const { container, root } = await renderPicker()
    await flushEffects()

    expect(trigger(container).textContent).toContain("文风写作")
    await openPicker(container)

    const panel = popover(container)
    expect(
      panel.querySelector('[data-testid="writing-style-picker-current"]')?.textContent,
    ).toContain("未启用")
    // 空库也要能去文风库（那里才是「做一次文风提炼」的入口）
    expect(popoverButton(container, "打开文风库")).toBeDefined()

    cleanup(root, container)
  })

  it("Escape 与点击外部都能关闭浮层", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()

    await openPicker(container)
    expect(container.querySelector('[data-testid="writing-style-picker-popover"]')).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })
    expect(container.querySelector('[data-testid="writing-style-picker-popover"]')).toBeNull()

    await openPicker(container)
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
    })
    expect(container.querySelector('[data-testid="writing-style-picker-popover"]')).toBeNull()

    cleanup(root, container)
  })

  /*
   * 打开即聚焦到唯一的动作按钮 —— 改造前焦点落在 listbox 上，收成两项后
   * 若不接管，键盘用户打开浮层还得再按一次 Tab。判别力：删掉那段 useEffect ⇒ 红。
   */
  it("打开后焦点落在「打开文风库」上，键盘直接 Enter 就能跳", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    const openLibrary = container.querySelector('[data-testid="writing-style-picker-open-library"]')
    expect(document.activeElement).toBe(openLibrary)

    cleanup(root, container)
  })

  /*
   * 用户决定 2（项目设置不得被改）在**选择器这一层自己**也要守住。
   *
   * 为什么不能只靠 chat-panel 那层：那是另一个 spec 的 mock 环境，
   * 而这里才是「有人往组件里加一行 `setEnabledWritingStyle`」最可能发生的地方。
   * 两条断言都对着**文风库真正用的**写盘函数（`writeFileAtomic` +
   * `createDirectory`，即 `writing-style-store.ts` 里 `saveWritingStyleStore`
   * 的那两笔）—— 早先 chat-panel 那条断言的是 `writeFile`，一个文风库永远不会碰的 mock。
   *
   * 这条是**行为**断言（真点一次、再查盘上有没有动静），不是源码正则：
   * 正则会被注释满足（本分支栽过），而行为断言连"注释掉又加回来"都抓得住。
   */
  it("点「打开文风库」不写盘：writeFileAtomic 与 createDirectory 零调用", async () => {
    const { container, root, onChange } = await renderPicker()
    await flushEffects()

    await openPicker(container)
    await act(async () => {
      popoverButton(container, "打开文风库").click()
    })

    // 跳转是纯导航，不该回调覆盖值（覆盖入口已移除）
    expect(onChange).not.toHaveBeenCalled()
    expect(
      writeFileAtomicMock.mock.calls.filter(([path]) => String(path).includes("writing-style.json")),
      "选择器不得写文风库文件",
    ).toEqual([])
    expect(
      createDirectoryMock.mock.calls.filter(([path]) => String(path).includes(".qmai")),
      "选择器不得为文风库建目录",
    ).toEqual([])

    cleanup(root, container)
  })

  /*
   * ── 触发按钮的文案（用户要求收窄工具栏）──
   *
   * 常态只留一个图标，文案全部退到悬停提示里：
   *   · 没有任何文风生效 → 「文风」
   *   · 有文风生效       → 「文风：<名称>」
   *
   * ⚠️ 悬停时**必须**带上名称：收起状态下这是唯一能看到当前生效文风的落点，
   * 浮层里那一行读数只有打开才看得到。
   *
   * 判别力：把 `triggerTitle` 改回固定字符串「文风」，第二条与第三条会红
   * （一条断名称在、一条断无启用项时不冒名称）。
   */
  it("iconOnly 形态不显示文字，悬停提示是「文风：当前文风名」", async () => {
    const { container, root } = await renderPicker(vi.fn(), { iconOnly: true })
    await flushEffects()

    const button = trigger(container)
    expect(button.textContent).not.toContain("文风写作")
    expect(button.getAttribute("aria-label")).toBe("文风：乙书 · 文风")
    expect(button.title).toBe("文风：乙书 · 文风")

    /*
     * 方块是 28px（`h-7 w-7`），不是 32px。
     * 用户反馈「两个图标之间相隔的距离都太大了」——间距是**容器 gap + 两侧内边距之和**，
     * 只收 gap 不够，方框也得从 32px 收到 28px（16px 图标 → 每侧 6px），
     * 与同一行本来就是 28px 的「上下文用量」圆环、@ 按钮统一。
     * 判别力：iconOnly 改回 h-8 w-8 ⇒ 红（这条最初就是漏的，靠变异测试补上）。
     */
    expect(button.className).toContain("h-7")
    expect(button.className).toContain("w-7")
    expect(button.className).not.toContain("h-8")
    expect(button.className).not.toContain("w-8")

    cleanup(root, container)
  })

  it("iconOnly 且没有任何文风生效时，悬停提示就是「文风」两个字", async () => {
    store = { version: 1, enabledStyleId: null, styles: [preset("style-a", "甲书 · 文风", "甲书")] }
    const { container, root } = await renderPicker(vi.fn(), { iconOnly: true })
    await flushEffects()

    const button = trigger(container)
    expect(button.title).toBe("文风")
    expect(button.getAttribute("aria-label")).toBe("文风")
    // 没有启用项时**不得**凭空冒出某个名字
    expect(button.title).not.toContain("甲书")

    cleanup(root, container)
  })

  it("iconOnly 且 value=null 时，悬停提示据实说「文风：本次不用」", async () => {
    const { container, root } = await renderPicker(vi.fn(), { iconOnly: true, value: null })
    await flushEffects()

    expect(trigger(container).title).toBe("文风：本次不用")

    cleanup(root, container)
  })
})

/** 直接探测 hook 的三态口径（选择器的显示名就是从这里来的）。 */
function OptionsProbe({ selectedSkillId }: { selectedSkillId?: string | null }) {
  const options = useWritingStyleOptions({ projectPath: PROJECT_PATH, selectedSkillId })
  return (
    <div>
      <span data-testid="effective">{options.effectiveName}</span>
      {/* 三态各写成一个字面量：`null` 与 `undefined` 在 DOM 里都会消失，必须区分出来 */}
      <span data-testid="current">{options.currentSkillId === null ? "<null>" : options.currentSkillId ?? "<undefined>"}</span>
      <span data-testid="default">{options.defaultSkillId ?? "<null>"}</span>
      <span data-testid="count">{options.styles.length}</span>
    </div>
  )
}

async function probe(selectedSkillId?: string | null) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(<OptionsProbe selectedSkillId={selectedSkillId} />)
  })
  await flushEffects()
  const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent
  const snapshot = {
    effective: text("effective"),
    current: text("current"),
    default: text("default"),
    count: text("count"),
  }
  cleanup(root, container)
  return snapshot
}

describe("useWritingStyleOptions 的三态口径", () => {
  it("undefined = 没有覆盖（当前=项目启用项）；null = 本次不用；string = 那条预设", async () => {
    await expect(probe(undefined)).resolves.toEqual({
      effective: "乙书 · 文风",
      current: "style-b",
      default: "style-b",
      count: "2",
    })
    await expect(probe(null)).resolves.toEqual({
      effective: "本次不用",
      current: "<null>",
      default: "style-b",
      count: "2",
    })
    await expect(probe("style-a")).resolves.toEqual({
      effective: "甲书 · 文风",
      current: "style-a",
      default: "style-b",
      count: "2",
    })
  })

  it("没有项目时给空状态，不抛错", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    function NoProjectProbe() {
      const options = useWritingStyleOptions({ projectPath: null })
      return <span data-testid="count">{options.styles.length}</span>
    }
    await act(async () => {
      root.render(<NoProjectProbe />)
    })
    await flushEffects()
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("0")
    cleanup(root, container)
  })
})
