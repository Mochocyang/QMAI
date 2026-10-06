// @vitest-environment jsdom
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

describe("独立UI测试版外壳", () => {
  it("书名保留在书架右侧原位置，切换小说同步", async () => {
    await render()
    const brand = host.querySelector(".ui-test-brand")!
    const book = host.querySelector(".ui-test-current-book")!
    const shelf = host.querySelector('[aria-label="返回书架"]')!
    expect(host.querySelector(".ui-test-brand-copy")).toBeNull()
    expect(book.parentElement).toBe(brand)
    expect(book.previousElementSibling).toBe(shelf)
    expect(book.textContent).toBe(project.name)
    expect(host.querySelectorAll(".ui-test-current-book")).toHaveLength(1)
    const next = { ...project, id: "next", name: "很长的小说名称用于验证省略及悬停完整名称" }
    await act(async () => { root.render(<UiTestShell project={next} {...callbacks} />) })
    expect(host.querySelector(".ui-test-current-book")?.getAttribute("title")).toBe(next.name)
    expect(host.querySelector(".ui-test-current-book")?.textContent).toBe(next.name)
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
  it("外观选项点击后应用主题，Esc关闭菜单归还焦点", async () => {
    await render()
    await click("外观")
    const option = [...host.querySelectorAll('[role="menuitemradio"], [role="menuitem"]')].find(item => item.textContent?.includes("纸间")) as HTMLElement
    expect(option).toBeTruthy()
    await act(async () => { option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); option.click() })
    expect(host.querySelector('.ui-test-root')?.getAttribute("data-skin")).toBe("zhi")
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
    expect(actions?.compareDocumentPosition(brand!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
  it("无书时主工作区入口禁用，不留下看似有效却无效的按钮", async () => {
    await render(false)
    for (const name of ["大纲", "章节", "灵魂"]) {
      const button = [...host.querySelectorAll("nav button")].find(b => b.textContent === name) as HTMLButtonElement
      expect(button.disabled).toBe(true)
    }
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
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    vi.useRealTimers()
    await act(async () => root.unmount())
    root = createRoot(host)
    await render()
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    const movedSoul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "灵魂") as HTMLElement
    await act(async () => { movedSoul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await hover("替换为")
    await click("技能库")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
    const skill = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "技能库") as HTMLElement
    await act(async () => { skill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await hover("新增功能")
    await click("小说图谱")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节", "小说图谱"])
    useWikiStore.setState({ activeView: "graph" })
    const graph = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "小说图谱") as HTMLElement
    await act(async () => { graph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await click("删除")
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
  })
  it("没有小说时仍可右键管理主导航", async () => {
    await render(false)
    const slot = host.querySelector(".ui-test-nav-slot") as HTMLElement
    await act(async () => { slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
  })
  it("替换当前功能时同步切换页面，替换其他功能时保持页面", async () => {
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("技能库")
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "章节", "技能库"])

    useWikiStore.setState({ activeView: "sources" })
    const skill = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "技能库") as HTMLElement
    await act(async () => { skill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("小说图谱")
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "章节", "小说图谱"])
  })
  it("灵魂被替换成技能库后，仍可从创作工具重新打开灵魂", async () => {
    await render()
    const soul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.textContent?.includes("灵魂")) as HTMLElement
    await act(async () => { soul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 })) })
    await hover("替换为")
    await click("技能库")
    expect(useWikiStore.getState().activeView).toBe("skillLibrary")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "章节", "技能库"])
    await click("创作工具")
    expect(host.querySelector('[aria-label="创作工具"]')).not.toBeNull()
    const soulEntry = [...host.querySelectorAll('[aria-label="创作工具"] [role="menuitem"]')].find((button) => button.textContent?.trim() === "灵魂")
    expect(soulEntry, "创作工具里的灵魂入口").toBeTruthy()
    await act(async () => { (soulEntry as HTMLButtonElement).click() })
    expect(useWikiStore.getState().activeView).toBe("soul")
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
