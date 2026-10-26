// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import postcss from "postcss"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { PRIMARY_NAV_LONG_PRESS_MS } from "@/lib/ui-test-primary-nav"
import { UiTestShell } from "./ui-test-shell"
import { useModelDraftGuard } from "./models/model-draft-guard"
import { answerModelDraft, deferred } from "./models/model-test-utils"
const draftState = vi.hoisted(() => ({ dirty: false, saving: false }))
const saveDraft = vi.hoisted(() => vi.fn<() => Promise<boolean>>())
const platformState = vi.hoisted(() => ({ macOS: false }))

vi.mock("@/components/layout/content-area", () => ({ ContentArea: () => { useModelDraftGuard("shell-model-test", "模型配置", draftState.dirty, draftState.saving, saveDraft); return <div data-testid="business-view">实际功能页面</div> } }))
vi.mock("@/components/layout/knowledge-tree", () => ({ RawSourcesSection: () => null }))
vi.mock("@/lib/ui-test-library", () => ({ registerUiTestProject: vi.fn() }))
vi.mock("@/components/layout/sidebar-panel", () => ({ SidebarPanel: () => <div>测试目录</div> }))

vi.mock("@/components/project/create-project-dialog", () => ({ CreateProjectDialog: () => null }))
vi.mock("./ui-test-shelf", () => ({ UiTestShelf: () => <div data-testid="shelf">书架内容</div> }))
vi.mock("@/lib/project-file-tree-refresh", () => ({ refreshProjectFileTree: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/project-store", () => ({ saveTheme: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/platform", () => ({ isTauri: () => false, isMacOS: () => platformState.macOS }))
vi.mock("@/lib/theme-utils", () => ({ applyTheme: vi.fn() }))

let host: HTMLDivElement
let root: Root
const project = { id: "ui-sample", name: "测试小说", path: "/QM-BOOK-UI-TEST/sample" }
const callbacks = { onCreateProject: vi.fn(), onOpenProject: vi.fn(), onSelectProject: vi.fn(), onSwitchProject: vi.fn(), onProjectOpened: vi.fn() }
async function hover(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.trim() === label)
  expect(button, label).toBeTruthy()
  const propsKey = Object.keys(button!).find((key) => key.startsWith("__reactProps"))
  const onMouseEnter = propsKey ? (button as unknown as Record<string, { onMouseEnter?: () => void }>)[propsKey].onMouseEnter : undefined
  expect(onMouseEnter, label).toEqual(expect.any(Function))
  await act(async () => { onMouseEnter!() })
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label)
  expect(button, label).toBeTruthy()
  await leftClick(button!)
}
async function leftClick(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
  })
  await act(async () => {
    element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }))
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
    element.click()
  })
}
async function render(withProject = true) {
  await act(async () => { root.render(<UiTestShell project={withProject ? project : null} {...callbacks} />) })
}
beforeEach(() => {
  platformState.macOS = false
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true })
  draftState.dirty = false; draftState.saving = false
  saveDraft.mockReset().mockResolvedValue(true)
  localStorage.clear()
  useWikiStore.setState({ project, activeView: "soul", selectedFile: null, fileTree: [], chatExpanded: false })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.restoreAllMocks() })

/**
 * 顶栏书名可见性的判别函数：找出所有会**让书名消失**的规则。
 *
 * 缺陷形态：`.ui-test-current-book { display: none }` 曾挂在 `@media (max-width: 1179px)` 上。
 * 于是同一个界面：1205px 窗口显示「青幕AI写作 楚白」，把窗口拖到 1098px 书名凭空消失。
 * 用户报的是「打开章节或大纲时书名时有时无」—— 与打开的是什么内容无关，纯粹是窗口宽度。
 * 窄屏该做的是**收窄**（走省略号，`title` 属性仍可悬停看全名），不是**消失**。
 *
 * 抽成函数是为了能做反向控制：只断言真实样式表"为空"，可能是判别函数恒返回空集（假绿）。
 */
function findBookHiddenRules(css: string): string[] {
  const hidden: string[] = []
  postcss.parse(css).walkRules((rule) => {
    if (!rule.selector.includes(".ui-test-current-book")) return
    rule.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase()
      const value = decl.value.trim().toLowerCase()
      if (prop === "display" && value === "none") hidden.push(rule.selector)
      if (prop === "visibility" && value === "hidden") hidden.push(rule.selector)
      if (prop === "max-width" && /^0(px|rem|em)?$/.test(value)) hidden.push(rule.selector)
    })
  })
  return hidden
}

describe("顶栏书名的可见性", () => {
  it("任何窗口宽度下都不隐藏书名，只收窄走省略号", () => {
    const css = readFileSync(resolve(__dirname, "ui-test.css"), "utf8")
    expect(
      findBookHiddenRules(css),
      "顶栏书名又被某条规则藏起来了：窄屏应该收窄 max-width 走省略号，而不是让它消失",
    ).toEqual([])

    // 反向控制：判别函数必须真的抓得到隐藏写法，否则上面那条是恒绿
    expect(findBookHiddenRules(".ui-test-current-book { display: none }")).toHaveLength(1)
    expect(findBookHiddenRules("@media (max-width: 1179px) { .ui-test-current-book { display: none } }")).toHaveLength(1)
    expect(findBookHiddenRules(".ui-test-current-book { visibility: hidden }")).toHaveLength(1)
    expect(findBookHiddenRules(".ui-test-current-book { max-width: 0 }")).toHaveLength(1)
    // 合法写法不许被误伤
    expect(findBookHiddenRules("@media (max-width: 1179px) { .ui-test-current-book { max-width: 84px } }")).toEqual([])

    // 三个窄屏断点都必须显式声明 max-width，否则窗口一窄会被更宽的同名值盖回去
    //（同一块里 `.ui-test-current-book` 前面还有别的规则，所以要先按大括号配平切出整块）
    const mediaBlocks = new Map(
      [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
        .map((match) => [match[1], match[2]] as const),
    )
    for (const width of ["1179", "959", "767"]) {
      const block = mediaBlocks.get(width)
      expect(block, `找不到 @media (max-width: ${width}px) 块`).toBeTruthy()
      const capped = /\.ui-test-current-book\s*\{[^}]*max-width:\s*(\d+)px/.exec(block!)
      expect(capped, `断点 ${width}px 没有给 .ui-test-current-book 收窄 max-width`).toBeTruthy()
      expect(Number(capped![1]), `断点 ${width}px 把书名宽度收成了 0`).toBeGreaterThan(0)
    }
  })
})

describe("独立UI测试版外壳", () => {
  it("书名保留在品牌区，书架固定按钮钉在主导航最左端（大纲左侧）", async () => {
    await render()
    const brand = host.querySelector(".ui-test-brand")!
    const book = host.querySelector(".ui-test-current-book")!
    const shelf = host.querySelector<HTMLElement>(".ui-test-nav-shelf")!
    expect(host.querySelector(".ui-test-brand-copy")).toBeNull()
    expect(book.parentElement).toBe(brand)
    // ⚠️ 这条断言在本次改动中**方向反了**：书架原来在品牌区、书名紧跟在它右侧
    // （旧断言是 `book.previousElementSibling === shelf`）。用户要求把书架
    // 移到「大纲」左侧作为固定按钮，所以现在品牌区只剩「图标 + 产品名 + 书名」，
    // 书架不再与书名相邻。这条改成钉**新**位置，并同时钉住它没留在品牌区。
    expect(brand.querySelector(".ui-test-nav-shelf")).toBeNull()
    /*
     * 品牌区不许再出现「书架」。上面那条只查 `.ui-test-nav-shelf`，
     * 而书架在品牌区时用的类名是 `.ui-test-crumb`（旧的圆角小按钮样式）——
     * 只查一个类名，等于给「用旧类名搬回去」留了后门。两条一起查。
     * （品牌区里合法存在的按钮只有左上角那个目录开关 `.ui-test-brand-logo-btn`。）
     */
    expect(brand.querySelector(".ui-test-crumb")).toBeNull()
    expect(brand.querySelectorAll("button:not(.ui-test-brand-logo-btn):not(.ui-test-header-hint-dismiss)")).toHaveLength(0)
    expect(book.textContent).toBe(project.name)
    expect(host.querySelectorAll(".ui-test-current-book")).toHaveLength(1)
    const next = { ...project, id: "next", name: "很长的小说名称用于验证省略及悬停完整名称" }
    await act(async () => { root.render(<UiTestShell project={next} {...callbacks} />) })
    expect(host.querySelector(".ui-test-current-book")?.getAttribute("title")).toBe(next.name)
    expect(host.querySelector(".ui-test-current-book")?.textContent).toBe(next.name)
    // 主导航 = 固定按钮 + 可配置项；书架必须是第一个，且紧挨在「大纲」左边
    const nav = host.querySelector(".ui-test-nav")!
    expect(nav.firstElementChild).toBe(shelf)
    expect(shelf.textContent).toBe("书架")
    /*
     * ⚠️ 上面那条 `textContent === "书架"` **不足以**表达「只有两个字」：
     * lucide 图标渲染成 `<svg>`，**不产生任何文字**，所以 `svg + 书架`
     * 的 textContent 同样是 `"书架"` —— 这条断言对「图标又回来了」是瞎的
     * （变异测试 M3 就是这么漏过去的）。
     * 用户要求「不要那个图标，只留『书架』两个字」，所以必须单独钉住
     * **没有 svg 子元素**：这一条才是那个要求的判别点。
     */
    expect(shelf.querySelector("svg")).toBeNull()
    expect(shelf.children).toHaveLength(0)
    expect(nav.querySelector(".ui-test-nav-slot")?.previousElementSibling).toBe(shelf)
    expect(nav.querySelector(".ui-test-nav-slot button")?.textContent).toBe("大纲")
    await click("返回书架")
    expect(callbacks.onSwitchProject).toHaveBeenCalled()
  })
  it("未打开小说时不创建空书名行", async () => {
    await render(false)
    expect(host.querySelector(".ui-test-brand > .ui-test-brand-name")).not.toBeNull()
    expect(host.querySelector(".ui-test-current-book")).toBeNull()
  })
  it("没有打开小说也可以进入全局设置，再返回书架", async () => {
    await render(false)
    await click("设置")
    expect(host.querySelector('[data-testid="business-view"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="shelf"]')).toBeNull()
    await click("返回书架")
    expect(host.querySelector('[data-testid="shelf"]')).not.toBeNull()
  })
  it("点击工具菜单内部不会先被外部mousedown关闭，目标页面可达", async () => {
    await render()
    await click("创作工具")
    await click("记忆中心")
    expect(useWikiStore.getState().activeView).toBe("lint")
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
  it.each(["大纲", "章节", "灵魂", "创作工具"])("%s菜单点击工作区时关闭，即使工作区阻止事件冒泡", async (label) => {
    await render()
    if (label === "创作工具") await click(label)
    else {
      const slot = [...host.querySelectorAll(".ui-test-nav-slot")].find((item) => item.querySelector("button")?.textContent === label)!
      await act(async () => { slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
      await hover("替换为")
    }
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    const workspace = host.querySelector<HTMLElement>('[data-testid="business-view"]')!
    workspace.addEventListener("pointerdown", (event) => event.stopPropagation())
    workspace.addEventListener("mousedown", (event) => event.stopPropagation())
    workspace.addEventListener("click", (event) => event.stopPropagation())
    await leftClick(workspace)
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
  it.each(["大纲", "章节", "灵魂", "创作工具"])("%s菜单点击主导航按钮时关闭，包括当前菜单的触发按钮", async (label) => {
    await render()
    if (label === "创作工具") await click(label)
    else {
      const slot = [...host.querySelectorAll(".ui-test-nav-slot")].find((item) => item.querySelector("button")?.textContent === label)!
      await act(async () => { slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    }
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    await click("灵魂")
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(useWikiStore.getState().activeView).toBe("soul")
  })
  it("菜单外只移动鼠标不关闭，点击空白处才关闭", async () => {
    await render()
    await click("创作工具")
    const workspace = host.querySelector<HTMLElement>(".ui-test-main")!
    await act(async () => { workspace.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })) })
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
    await leftClick(workspace)
    expect(host.querySelector('[role="menu"]')).toBeNull()
    await click("创作工具")
    await click("创作工具")
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
  it("后台活动右侧的联系图标打开联系与支持弹窗，一屏容纳三张二维码且不显示联系作者", async () => {
    await render()
    const activityBtn = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "后台活动")
    const contactBtn = [...host.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "联系与支持")
    expect(activityBtn).toBeTruthy()
    expect(contactBtn).toBeTruthy()
    expect(activityBtn!.compareDocumentPosition(contactBtn!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await click("联系与支持")
    const dialog = document.querySelector(".ui-test-contact-dialog")
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute("aria-label")).toBe("联系与支持")
    expect(dialog?.textContent).toContain("联系与支持")
    expect(host.textContent).not.toContain("联系作者")
    expect(dialog?.querySelectorAll("img")).toHaveLength(3)
    expect([...dialog!.querySelectorAll(".grid")].some((el) => el.className.includes("sm:grid-cols-3"))).toBe(true)
  })
  it("外观与设置已从顶栏迁出（外观移到侧栏，设置不再进创作工具）", async () => {
    await render()
    // 顶栏不再有「外观」图标（皮肤切换已搬到侧栏底部）
    expect(host.querySelector('.ui-test-actions [aria-label="外观"]')).toBeNull()
    // 创作工具菜单里不再有「设置」项
    await click("创作工具")
    const settingsEntry = [...host.querySelectorAll('[aria-label="创作工具"] [role="menuitem"]')].find((button) => button.textContent?.trim() === "设置")
    expect(settingsEntry).toBeUndefined()
  })
  it("创作工具菜单 Esc 关闭后焦点归还触发按钮", async () => {
    await render()
    await click("创作工具")
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(document.activeElement?.getAttribute("aria-label")).toBe("创作工具")
  })
  it("macOS 把关闭按钮放到左侧交通灯最前", async () => {
    platformState.macOS = true
    await render()
    const root = host.querySelector(".ui-test-root")
    expect(root?.getAttribute("data-platform")).toBe("macos")
    const labels = [...host.querySelectorAll(".ui-test-win-actions button")].map((button) => button.getAttribute("aria-label"))
    expect(labels).toEqual(["关闭窗口", "最小化", "最大化或还原"])
    const actions = host.querySelector(".ui-test-win-actions")
    const brand = host.querySelector(".ui-test-brand")
    expect(actions).not.toBeNull()
    expect(brand).not.toBeNull()
    expect(actions!.compareDocumentPosition(brand!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(host.querySelectorAll(".ui-test-win-actions")).toHaveLength(1)
  })
  it("没有固定活动栏；目录与窗口操作有中文可访问名称", async () => {
    useWikiStore.setState({ activeView: "wiki" })
    await render()
    expect(host.textContent).not.toContain("活动记录")
    expect(host.querySelector('[aria-label="收起目录"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="最小化"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="最大化或还原"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="关闭窗口"]')).not.toBeNull()
    expect([...host.querySelectorAll('[aria-label]')].some(n => /\?{2,}/.test(n.getAttribute('aria-label') ?? ''))).toBe(false)
  })
  it("目录收起后左上角按钮显示「收起目录」图标而不是品牌 logo", async () => {
    useWikiStore.setState({ activeView: "wiki" })
    await render()
    const btn = host.querySelector(".ui-test-brand-logo-btn") as HTMLButtonElement
    expect(btn).not.toBeNull()

    // 目录展开时：按钮回到「收起目录」语义，且不带已收起标记（显示 logo）
    expect(btn.getAttribute("aria-label")).toBe("收起目录")
    expect(btn.classList.contains("is-directory-collapsed")).toBe(false)

    // 点一下收起目录
    btn.click()
    await act(async () => {})
    const collapsed = host.querySelector(".ui-test-brand-logo-btn") as HTMLButtonElement
    expect(collapsed.getAttribute("aria-label")).toBe("展开目录")
    // 关键：带上标记类，CSS 才能常驻显示收起图标而不是 logo。
    // 否则用户看不出列表是被收起了，也不知道再点一次能打开。
    expect(collapsed.classList.contains("is-directory-collapsed")).toBe(true)

    // 再点一次展开，标记要撤掉，恢复显示 logo
    collapsed.click()
    await act(async () => {})
    const expanded = host.querySelector(".ui-test-brand-logo-btn") as HTMLButtonElement
    expect(expanded.getAttribute("aria-label")).toBe("收起目录")
    expect(expanded.classList.contains("is-directory-collapsed")).toBe(false)
  })
  it("无书时主工作区入口禁用，不留下看似有效却无效的按钮", async () => {
    await render(false)
    for (const name of ["大纲", "章节", "灵魂"]) {
      const button = [...host.querySelectorAll("nav button")].find(b => b.textContent === name) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    }
  })
  it("外壳不再横跨整窗渲染写作字数状态栏", async () => {
    await render()
    const app = host.querySelector(".ui-test-app")!
    // 状态栏此前挂在 .ui-test-app 下，于是横跨整窗、并出现在目录栏与 AI 对话栏
    // 下方。用户要求它只显示在章节正文栏底部，因此外壳自己不再渲染它。
    expect(app.querySelector(":scope > footer.ui-test-statusbar")).toBeNull()
    expect(host.querySelector(".ui-test-workspace > .ui-test-statusbar")).toBeNull()
    expect(host.querySelector(".ui-test-statusbar")).toBeNull()
  })
  it("书架页不显示写作字数状态栏（没有可统计的对象，全 0 会被误读成空书）", async () => {
    await render(false)
    expect(host.querySelector(".ui-test-statusbar")).toBeNull()
  })
  it("设置页的三皮肤选择同步外壳与Portal作用域", async () => {
    await render()
    await act(async () => window.dispatchEvent(new CustomEvent("qmai-ui-test-skin-change", { detail: "xing" })))
    expect(host.querySelector(".ui-test-root")?.getAttribute("data-skin")).toBe("xing")
    expect(document.documentElement.dataset.uiTestSkin).toBe("xing")
  })
  it("右键或长按可调整主导航，并在重新打开后保留", async () => {
    vi.useFakeTimers()
    await render()
    const soulSlot = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => {
      soulSlot.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20, button: 0, pointerType: "touch" }))
      vi.advanceTimersByTime(PRIMARY_NAV_LONG_PRESS_MS)
    })
    expect(host.querySelector('[aria-label="灵魂功能菜单"]')).not.toBeNull()
    await hover("移动")
    await click("左移")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    vi.useRealTimers()
    await act(async () => root.unmount())
    root = createRoot(host)
    await render()
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    const movedSoul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "灵魂") as HTMLElement
    await act(async () => { movedSoul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await hover("替换为")
    await click("技能库")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
    const skill = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "技能库") as HTMLElement
    await act(async () => { skill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await hover("新增功能")
    await click("小说图谱")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节", "小说图谱"])
    useWikiStore.setState({ activeView: "graph" })
    const graph = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "小说图谱") as HTMLElement
    await act(async () => { graph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await click("删除")
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
  })
  it("没有小说时仍可右键管理主导航", async () => {
    await render(false)
    const slot = host.querySelector(".ui-test-nav-slot") as HTMLElement
    await act(async () => { slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
  })

  /*
   * 「人物 Skill」视图不得渲染左侧目录栏（用户报的缺陷）。
   *
   * 现象：技能库六个 tab 里，切到「人物 Skill」时左边会冒出一条**章节列表**，
   * 其余五个 tab 都是整窗、没有目录栏。根因是 `personaSkillLibrary`
   * 漏在 `FULL_WINDOW_VIEWS` 之外，于是 `hasDirectory` 判真。
   *
   * 为什么这条要写在**外壳**上，而不是只靠 `full-window-views.spec.ts`：
   * 那边验的是纯函数 `isFullWindowView`；而用户看到的是**渲染结果**。
   * 两者之间还隔着 `hasDirectory` 那一串条件（`activeView !== "settings"`、
   * `!memoryCenterFullWindow`…）。这里直接钉住「DOM 里没有目录栏」，
   * 把那串条件一起盖住。
   *
   * 判别力：把 `personaSkillLibrary` 从 `FULL_WINDOW_VIEWS` 删掉 ⇒ 红
   * （aside 会重新出现）。同时对照一个**应当有**目录栏的视图（章节写作区），
   * 证明这条断言不是恒真 —— 否则「永远查不到 aside」也会绿。
   */
  it("「人物 Skill」视图不渲染左侧目录栏，与技能库其余 tab 一致", async () => {
    // 对照：章节写作区（wiki）**应该**有目录栏，证明 aside 确实会被渲染出来
    useWikiStore.setState({ activeView: "wiki", selectedFile: null })
    await render()
    expect(host.querySelector("#ui-test-directory"), "章节写作区应当有目录栏（对照）").not.toBeNull()

    // 正题：切到「人物 Skill」，目录栏必须消失
    await act(async () => { useWikiStore.setState({ activeView: "personaSkillLibrary" }) })
    expect(host.querySelector("#ui-test-directory"), "「人物 Skill」不应有左侧目录栏").toBeNull()

    // 再对照技能库里一个**本来就在**整窗清单里的 tab，行为应当一致
    await act(async () => { useWikiStore.setState({ activeView: "characterSoulLibrary" }) })
    expect(host.querySelector("#ui-test-directory"), "「角色灵魂」不应有左侧目录栏").toBeNull()
  })
  it("替换当前功能时同步切换页面，替换其他功能时保持页面", async () => {
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("技能库")
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "章节", "技能库"])

    useWikiStore.setState({ activeView: "sources" })
    const skill = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "技能库") as HTMLElement
    await act(async () => { skill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("小说图谱")
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "章节", "小说图谱"])
  })
  it("灵魂被替换成技能库后，仍可从创作工具重新打开灵魂", async () => {
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("技能库")
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "章节", "技能库"])
    await click("创作工具")
    expect(host.querySelector('[aria-label="创作工具"]')).not.toBeNull()
    const soulEntry = [...host.querySelectorAll('[aria-label="创作工具"] [role="menuitem"]')].find((button) => button.textContent?.trim() === "灵魂")
    expect(soulEntry, "创作工具里的灵魂入口").toBeTruthy()
    await act(async () => { (soulEntry as HTMLButtonElement).click() })
    expect(useWikiStore.getState().activeView).toBe("soul")
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
  /*
   * 「维护工具」从设置搬到了创作工具（用户要求：它是项目级维护动作，
   * 不该待在应用级设置里）。这条用例钉住两件事：入口在创作工具里，
   * 且**确实能打开对应视图**（只断言菜单里有个名字，改坏了也测不出来）。
   */
  it("维护工具从创作工具打开，且不再出现在设置分类里", async () => {
    await render()
    await click("创作工具")
    const entry = [...host.querySelectorAll('[aria-label="创作工具"] [role="menuitem"]')]
      .find((button) => button.textContent?.trim() === "维护工具")
    expect(entry, "创作工具里的维护工具入口").toBeTruthy()
    await act(async () => { (entry as HTMLButtonElement).click() })
    expect(useWikiStore.getState().activeView).toBe("maintenance")
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
  it("取消离开确认时不替换当前功能", async () => {
    draftState.dirty = true
    useWikiStore.setState({ activeView: "soul" })
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    // 浏览器鼠标点击会聚焦菜单项；让弹窗关闭后的焦点恢复与实际操作一致。
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.trim() === "技能库")!.focus() })
    await click("技能库")
    await answerModelDraft("关闭")
    expect(useWikiStore.getState().activeView).toBe("soul")
    expect([...host.querySelectorAll(".ui-test-nav-item")].map((button) => button.textContent)).toEqual(["大纲", "章节", "灵魂"])
    const menu = host.querySelector('[aria-label="灵魂功能菜单"]')!
    const submenu = menu.querySelector<HTMLElement>('[aria-label="灵魂二级菜单"]')!
    expect([...submenu.querySelectorAll(".ui-test-menu-item")].map((button) => button.textContent)).toEqual(["技能库", "小说图谱", "拆书库", "审查中心", "剧情搜索", "剧情推演", "记忆中心"])
  })
  it("窄窗口中的功能菜单保持在窗口内并可滚动", async () => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true })
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 360, clientY: 20 })) })
    const menu = host.querySelector<HTMLElement>('[aria-label="灵魂功能菜单"]')!
    const rect = menu.getBoundingClientRect()
    expect(rect.width).toBeLessThanOrEqual(window.innerWidth - 32)
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
    expect(menu.className).toContain("is-right")
  })
  it("重复点击当前主导航不改变文件选择", async () => {
    useWikiStore.setState({ activeView: "soul", selectedFile: "/QM-BOOK-UI-TEST/sample/wiki/chapters/01.md" })
    await render()
    await click("灵魂")
    expect(useWikiStore.getState().selectedFile).toBe("/QM-BOOK-UI-TEST/sample/wiki/chapters/01.md")
  })
})

it("有模型草稿时取消切换主导航，当前页与文件保持不变", async () => {
  draftState.dirty = true
  useWikiStore.setState({ activeView: "settings" })
  await render()
  await click("设置")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await click("灵魂")
  await answerModelDraft("关闭")
  expect(useWikiStore.getState().activeView).toBe("settings")
})
it("无小说全局模型设置返回书架也需要确认，保存中禁止离开", async () => {
  draftState.dirty = true
  await render(false); await click("设置"); await click("返回书架")
  await answerModelDraft("关闭")
  expect(host.querySelector('[data-testid="business-view"]')).not.toBeNull()
  draftState.saving = true
  await render(false)
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
  await click("返回书架")
  expect(alert).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-testid="shelf"]')).toBeNull()
})
it("主导航等待保存结果，失败留在设置，成功继续进入原目标", async () => {
  draftState.dirty = true
  useWikiStore.setState({ activeView: "settings", selectedFile: "/mock/chapter.md" })
  await render()
  saveDraft.mockResolvedValueOnce(false)
  await click("灵魂"); await answerModelDraft("保存配置")
  expect(useWikiStore.getState().activeView).toBe("settings")
  expect(useWikiStore.getState().selectedFile).toBe("/mock/chapter.md")
  const pending = deferred<boolean>()
  saveDraft.mockReturnValueOnce(pending.promise)
  await click("灵魂"); await answerModelDraft("保存配置")
  expect(useWikiStore.getState().activeView).toBe("settings")
  await act(async () => pending.resolve(true))
  expect(useWikiStore.getState().activeView).toBe("soul")
})
