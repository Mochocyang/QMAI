// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { PRIMARY_NAV_LONG_PRESS_MS } from "@/lib/ui-test-primary-nav"
import { UiTestShell } from "./ui-test-shell"
import { useModelDraftGuard } from "./models/model-draft-guard"
const draftState = vi.hoisted(() => ({ dirty: false, saving: false }))

vi.mock("@/components/layout/content-area", () => ({ ContentArea: () => { useModelDraftGuard("shell-model-test", "模型配置", draftState.dirty, draftState.saving); return <div data-testid="business-view">实际功能页面</div> } }))
vi.mock("@/components/layout/knowledge-tree", () => ({ RawSourcesSection: () => null }))
vi.mock("@/lib/ui-test-library", () => ({ registerUiTestProject: vi.fn() }))
vi.mock("@/components/layout/sidebar-panel", () => ({ SidebarPanel: () => <div>测试目录</div> }))
vi.mock("@/components/layout/activity-panel", () => ({ ActivityPanel: () => <div data-testid="activity-panel">活动记录</div> }))
vi.mock("@/components/project/create-project-dialog", () => ({ CreateProjectDialog: () => null }))
vi.mock("./ui-test-shelf", () => ({ UiTestShelf: () => <div data-testid="shelf">书架内容</div> }))
vi.mock("@/lib/project-file-tree-refresh", () => ({ refreshProjectFileTree: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/project-store", () => ({ saveTheme: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/lib/theme-utils", () => ({ applyTheme: vi.fn() }))

let host: HTMLDivElement
let root: Root
const project = { id: "ui-sample", name: "测试小说", path: "/QM-BOOK-UI-TEST/sample" }
const callbacks = { onCreateProject: vi.fn(), onOpenProject: vi.fn(), onSelectProject: vi.fn(), onSwitchProject: vi.fn(), onProjectOpened: vi.fn() }
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label)
  expect(button, label).toBeTruthy()
  await act(async () => {
    button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))
  })
  await act(async () => {
    button!.click()
  })
}
async function render(withProject = true) {
  await act(async () => { root.render(<UiTestShell project={withProject ? project : null} {...callbacks} />) })
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Object.defineProperty(window, "innerWidth", { value: 1440, writable: true, configurable: true })
  draftState.dirty = false; draftState.saving = false
  localStorage.clear()
  useWikiStore.setState({ project, activeView: "soul", selectedFile: null, fileTree: [], chatExpanded: false })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe("独立UI测试版外壳", () => {
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
  it("没有固定活动栏；目录与窗口操作有中文可访问名称", async () => {
    await render()
    expect(host.querySelector('[data-testid="activity-panel"]')).toBeNull()
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
    await click("左移")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    vi.useRealTimers()
    await act(async () => root.unmount())
    root = createRoot(host)
    await render()
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "灵魂", "章节"])
    const movedSoul = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "灵魂") as HTMLElement
    await act(async () => { movedSoul.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await click("技能库")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
    const skill = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "技能库") as HTMLElement
    await act(async () => { skill.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await click("添加小说图谱")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节", "小说图谱"])
    useWikiStore.setState({ activeView: "graph" })
    const graph = [...host.querySelectorAll(".ui-test-nav-slot")].find((slot) => slot.querySelector("button")?.textContent === "小说图谱") as HTMLElement
    await act(async () => { graph.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    await click("删除功能")
    expect(useWikiStore.getState().activeView).toBe("sources")
    expect([...host.querySelectorAll("nav button")].map((button) => button.textContent)).toEqual(["大纲", "技能库", "章节"])
  })
  it("没有小说时仍可右键管理主导航", async () => {
    await render(false)
    const slot = host.querySelector(".ui-test-nav-slot") as HTMLElement
    await act(async () => { slot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })) })
    expect(host.querySelector('[role="menu"]')).not.toBeNull()
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
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
  useWikiStore.setState({ activeView: "settings" })
  await render()
  await click("设置")
  expect(confirm).not.toHaveBeenCalled()
  await click("灵魂")
  expect(confirm).toHaveBeenCalledOnce()
  expect(useWikiStore.getState().activeView).toBe("settings")
})
it("无小说全局模型设置返回书架也需要确认，保存中禁止离开", async () => {
  draftState.dirty = true
  vi.spyOn(window, "confirm").mockReturnValue(false)
  await render(false); await click("设置"); await click("返回书架")
  expect(host.querySelector('[data-testid="business-view"]')).not.toBeNull()
  draftState.saving = true
  await render(false)
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {})
  await click("返回书架")
  expect(alert).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-testid="shelf"]')).toBeNull()
})
