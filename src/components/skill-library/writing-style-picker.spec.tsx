// @vitest-environment jsdom

/**
 * 丁-2「文风写作」选择器。
 *
 * 形状照 `de-ai-skill-picker.spec.tsx`：可访问性（键盘 + `role="option"`）、
 * 三态回调（`string` / `null` / `undefined`）、空态、库内跳转。
 *
 * ⚠️ 这里**不** mock `useWritingStyleOptions`：选择器的三态语义一半在 hook 里
 * （`undefined` 显示项目启用项、`null` 显示「本次不用」），mock 掉它这条用例就只剩空壳。
 * 只 mock 读盘（`@/commands/fs`）。
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { WritingStyleOptionsPanel, WritingStylePicker } from "./writing-style-picker"
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

async function openPicker(container: HTMLElement) {
  await act(async () => {
    trigger(container).click()
  })
  await flushEffects()
}

/** 取浮层里某个文案的按钮（选项是 role="option"，动作按钮是普通按钮）。 */
function popoverButton(container: HTMLElement, text: string): HTMLButtonElement {
  const popover = container.querySelector('[data-testid="writing-style-picker-popover"]')
  expect(popover, "浮层应已打开").not.toBeNull()
  const found = Array.from(popover!.querySelectorAll<HTMLButtonElement>("button"))
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
  it("没有覆盖时显示项目启用项，并同时标「当前」与「默认」", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()

    expect(trigger(container).textContent).toContain("文风写作：乙书 · 文风")

    await openPicker(container)

    const current = container.querySelector('[aria-current="true"]')
    expect(current?.textContent).toContain("乙书 · 文风")
    expect(current?.textContent).toContain("当前")
    expect(current?.textContent).toContain("默认")

    cleanup(root, container)
  })

  it("选中某条文风时回调拿到它的 id（string = 本次用这条）", async () => {
    const { container, root, onChange } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    await act(async () => {
      popoverButton(container, "甲书 · 文风").click()
    })

    expect(onChange).toHaveBeenCalledWith("style-a")
    // 选完即关
    expect(container.querySelector('[data-testid="writing-style-picker-popover"]')).toBeNull()

    cleanup(root, container)
  })

  /*
   * 用户决定 2（项目设置不得被改）在**选择器这一层自己**也要守住。
   *
   * 为什么不能只靠 chat-panel 那层：那是另一个 spec 的 mock 环境，
   * 而这里才是「有人往组件里加一行 `setEnabledWritingStyle`」最可能发生的地方。
   * 两条断言都对着**文风库真正用的**写盘函数（`writeFileAtomic` +
   * `createDirectory`，即 `writing-style-store.ts` 里 `saveWritingStyleStore`
   * 的那两笔 —— 这里写符号名而不是行号，行号被本批自己的注释改动带偏过）——
   * 早先 chat-panel 那条断言的是 `writeFile`，一个文风库永远不会碰的 mock。
   *
   * 这条是**行为**断言（真点一次、再查盘上有没有动静），不是源码正则：
   * 正则会被注释满足（本分支栽过），而行为断言连"注释掉又加回来"都抓得住。
   */
  it("点选任何一项都不写盘：writeFileAtomic 与 createDirectory 零调用", async () => {
    const { container, root, onChange } = await renderPicker()
    await flushEffects()

    for (const label of ["甲书 · 文风", "本次不用文风", "跟随项目设置的文风"]) {
      await openPicker(container)
      await act(async () => {
        popoverButton(container, label).click()
      })
    }
    expect(onChange).toHaveBeenCalledTimes(3)

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

  it("「本次不用文风」回调 null、「跟随项目设置的文风」回调 undefined（两者不能混）", async () => {
    const { container, root, onChange } = await renderPicker()
    await flushEffects()

    await openPicker(container)
    await act(async () => {
      popoverButton(container, "本次不用文风").click()
    })
    expect(onChange).toHaveBeenLastCalledWith(null)

    await openPicker(container)
    await act(async () => {
      popoverButton(container, "跟随项目设置的文风").click()
    })
    expect(onChange).toHaveBeenLastCalledWith(undefined)

    cleanup(root, container)
  })

  it("value=null 时触发按钮说「本次不用」，且没有任何选项被标为当前", async () => {
    const { container, root } = await renderPicker(vi.fn(), { value: null })
    await flushEffects()

    expect(trigger(container).textContent).toContain("本次不用")
    expect(trigger(container).getAttribute("aria-label")).toBe("文风：本次不用")

    await openPicker(container)
    expect(container.querySelector('[aria-current="true"]')).toBeNull()

    cleanup(root, container)
  })

  it("所选预设已被删除时说「已不存在」，不回落到项目启用项的名字", async () => {
    store = { version: 1, enabledStyleId: "style-b", styles: [preset("style-b", "乙书 · 文风", "乙书")] }
    const { container, root } = await renderPicker(vi.fn(), { value: "style-gone" })
    await flushEffects()

    expect(trigger(container).textContent).toContain("所选文风已不存在")
    expect(trigger(container).textContent).not.toContain("乙书 · 文风")

    cleanup(root, container)
  })

  it("文风库为空时给空态，而不是一个空浮层", async () => {
    store = { version: 1, enabledStyleId: null, styles: [] }
    const { container, root } = await renderPicker()
    await flushEffects()

    expect(trigger(container).textContent).toContain("文风写作")
    await openPicker(container)

    expect(container.textContent).toContain("文风库还是空的")
    expect(container.querySelector('[role="listbox"]')).toBeNull()

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

  it("键盘可操作：打开后焦点在列表上，ArrowDown + Enter 能选中", async () => {
    const { container, root, onChange } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    const listbox = container.querySelector('[role="listbox"]')
    expect(document.activeElement).toBe(listbox)

    await act(async () => {
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    })
    await act(async () => {
      listbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    })

    // 初始焦点在「当前」那条（乙书，列表第 2 项），ArrowDown 环绕到第 1 项
    expect(onChange).toHaveBeenCalledWith("style-a")

    cleanup(root, container)
  })

  it("「打开完整文风库」跳到丁-1 那个视图", async () => {
    const { container, root } = await renderPicker(vi.fn(), { showLibraryShortcut: true })
    await flushEffects()
    await openPicker(container)

    await act(async () => {
      popoverButton(container, "打开完整文风库").click()
    })

    expect(useWikiStore.getState().activeView).toBe("writingStyleLibrary")

    cleanup(root, container)
  })

  it("浮层里明说「只影响这一次生成，不改动项目设置」", async () => {
    const { container, root } = await renderPicker()
    await flushEffects()
    await openPicker(container)

    expect(container.textContent).toContain("只影响这一次生成，不改动项目设置。")

    cleanup(root, container)
  })

  /*
   * ── 触发按钮的文案（用户要求收窄工具栏）──
   *
   * 改造前常态写着「文风写作：乙书 · 文风」，把工具栏挤得很宽。现在常态只留
   * 一个图标，文案全部退到悬停提示里：
   *   · 没有任何文风生效 → 「文风」
   *   · 有文风生效       → 「文风：<名称>」
   *
   * ⚠️ 悬停时**必须**带上名称（这是用户报的「点击后根本不显示选中的是哪一个」
   * 那一项）：收起状态下这是唯一能看到当前生效文风的落点，
   * 浮层里的「当前」徽章只有打开才看得到。
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

  it("iconOnly 时选择「本次不用」，悬停提示据实说「文风：本次不用」", async () => {
    const { container, root } = await renderPicker(vi.fn(), { iconOnly: true, value: null })
    await flushEffects()

    expect(trigger(container).title).toBe("文风：本次不用")

    cleanup(root, container)
  })

  it("两个开关可以分别关掉，面板可单独复用", async () => {
    const { container, root } = await renderPicker(vi.fn(), {
      includeDisableOption: false,
      includeFollowProjectOption: false,
    })
    await flushEffects()
    await openPicker(container)

    expect(container.textContent).not.toContain("本次不用文风")
    expect(container.textContent).not.toContain("跟随项目设置的文风")

    cleanup(root, container)

    // 独立面板：加载 / 空 / 错误三态各有一份输出
    const panelContainer = document.createElement("div")
    document.body.appendChild(panelContainer)
    const panelRoot = createRoot(panelContainer)
    await act(async () => {
      panelRoot.render(
        <WritingStyleOptionsPanel
          loading={false}
          errorMessage=""
          emptyMessage="文风库还是空的"
          styles={[{ id: "style-a", name: "甲书 · 文风", description: "来源：甲书" }]}
          currentSkillId="style-a"
          defaultSkillId="style-b"
          onPick={vi.fn()}
        />,
      )
    })
    expect(panelContainer.textContent).toContain("来源：甲书")
    expect(panelContainer.textContent).toContain("当前")
    expect(panelContainer.querySelector('[role="listbox"]')).not.toBeNull()

    await act(async () => {
      panelRoot.render(
        <WritingStyleOptionsPanel
          loading={false}
          errorMessage=""
          emptyMessage="文风库还是空的"
          styles={[]}
          currentSkillId={null}
          defaultSkillId={null}
          onPick={vi.fn()}
        />,
      )
    })
    expect(panelContainer.textContent).toContain("文风库还是空的")

    act(() => panelRoot.unmount())
    document.body.removeChild(panelContainer)
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
