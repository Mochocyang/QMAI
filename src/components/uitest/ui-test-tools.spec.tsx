// @vitest-environment jsdom

import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import postcss from "postcss"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { SettingsView } from "@/components/settings/settings-view"
import { SoulView } from "@/components/novel/soul-view"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import type { SettingsDraft } from "@/components/settings/settings-types"
import { DEFAULT_SIDEBAR_NAV_CONFIG } from "@/lib/sidebar-nav-preferences"
import { UI_FONT_OPTIONS } from "@/lib/font-settings"
import { readUiTestSkin, writeUiTestSkin } from "@/lib/ui-test"

const ui = vi.hoisted(() => ({ enabled: true }))
const modelIo = vi.hoisted(() => ({
  connection: vi.fn(async () => ({ ok: true, message: "连接测试通过" })),
  functionTest: vi.fn(async () => ({ ok: true, message: "功能测试通过" })),
  saveConfigs: vi.fn(async () => undefined),
}))
vi.mock("@/lib/connection-tests", () => ({ testLlmConnection: modelIo.connection, testLlmFunction: modelIo.functionTest }))
const persistence = vi.hoisted(() => ({ saveLlm: vi.fn(async () => undefined), saveSoul: vi.fn(async (_path: string, store: unknown) => store) }))
vi.mock("@/lib/ui-test", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ui-test")>(),
  get IS_UI_TEST_BUILD() { return ui.enabled },
}))
vi.mock("@/lib/project-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/project-store")>(),
  loadNovelConfig: vi.fn(async () => null),
  loadRerankConfig: vi.fn(async () => null),
  saveLlmConfig: persistence.saveLlm,
  saveProviderConfigs: modelIo.saveConfigs,
  saveActivePresetId: vi.fn(async () => undefined),
}))
vi.mock("@/lib/novel/project-soul-style-store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/novel/project-soul-style-store")>(),
  loadProjectSoulStyleStore: vi.fn(async () => ({
    version: 1,
    enabledStyleId: "style-a",
    styles: [
      { id: "style-a", name: "现有风格甲", content: "既有长规则。".repeat(1000), enabled: true, createdAt: 1, updatedAt: 1 },
      { id: "style-b", name: "现有风格乙", content: "另一套已有规则。", enabled: false, createdAt: 2, updatedAt: 2 },
    ],
  })),
  saveProjectSoulStyleStore: persistence.saveSoul,
}))
vi.mock("@/components/novel/character-aura-view", () => ({ CharacterAuraView: ({ hideSidebar }: { hideSidebar?: boolean }) => <div data-existing-aura-view data-hide-sidebar={String(hideSidebar)} /> }))
vi.mock("@/components/layout/panel-header-with-help", () => ({ PanelHeaderWithHelp: ({ title }: { title: string }) => <span>{title}</span> }))

// 隔离业务I/O，验证正式入口与测试版四子页仍可达；具体保存与测试在models专项运行。
vi.mock("@/components/settings/sections/model-settings-section", () => ({ ModelSettingsSection: () => <div data-capability="legacy-model" /> }))
vi.mock("@/components/settings/sections/llm-provider-section", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/settings/sections/llm-provider-section")>(),
  LlmProviderSection: () => <div data-capability="llm" />,
}))
vi.mock("@/components/settings/sections/default-model-settings-panel", () => ({ DefaultModelSettingsPanel: () => <div data-capability="default" /> }))
vi.mock("@/components/settings/sections/embedding-section", () => ({ EmbeddingSection: () => <div data-capability="embedding" /> }))
vi.mock("@/components/settings/sections/rerank-section", () => ({ RerankSection: () => <div data-capability="rerank" /> }))
vi.mock("./models/retrieval-models", () => ({ UiTestEmbeddingModels: () => <div data-capability="embedding" />, UiTestRerankModels: () => <div data-capability="rerank" /> }))
vi.mock("@/components/settings/sections/interface-section", () => ({ InterfaceSection: () => <div data-capability="interface"><h2>外观与界面</h2></div> }))
vi.mock("@/components/settings/sections/novel-section", () => ({ NovelSection: () => <div data-capability="novel" /> }))
vi.mock("@/components/settings/sections/network-section", () => ({ NetworkSection: () => <div data-capability="network" /> }))
vi.mock("@/components/settings/sections/web-search-section", () => ({ WebSearchSection: () => <div data-capability="web-search" /> }))
vi.mock("@/components/settings/sections/user-memory-section", () => ({ UserMemorySection: () => <div data-capability="user-memory" /> }))
vi.mock("@/components/settings/sections/usage-guide-section", () => ({ UsageGuideSection: () => <div data-capability="usage-guide" /> }))
vi.mock("@/components/settings/sections/maintenance-section", () => ({ MaintenanceSection: () => <div data-capability="maintenance" /> }))
vi.mock("@/components/settings/sections/data-management-section", () => ({ DataManagementSection: () => <div data-capability="data-management" /> }))
vi.mock("@/components/settings/sections/export-center-section", () => ({ ExportCenterSection: () => <div data-capability="export-center" /> }))
vi.mock("@/components/settings/sections/feedback-section", () => ({ FeedbackSection: () => <div data-capability="feedback" /> }))
vi.mock("@/components/settings/sections/contact-support-section", () => ({ ContactSupportSection: () => <div data-capability="contact-support" /> }))
vi.mock("@/components/settings/sections/classification-section", () => ({ ClassificationSection: () => <div data-capability="classification" /> }))
vi.mock("@/components/settings/sections/changelog-section", () => ({ ChangelogSection: () => <div data-capability="changelog" /> }))

const categories = ["model", "novel", "network", "web-search", "interface", "user-memory", "maintenance", "data-management", "feedback", "contact-support", "changelog"]
let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  ui.enabled = true
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await i18n.changeLanguage("zh")
  useWikiStore.setState({
    project: { id: "ui-test-project", name: "当前项目名称", path: "/ui-test/project" },
    providerConfigs: {},
    activePresetId: null,
    activeSettingsCategory: null,
    activeModelSettingsTab: null,
    selectedSoulTab: "project",
    selectedSoulId: "project-soul",
    selectedSoulSection: "builtIn",
  })
  container = document.createElement("div")
  container.className = "ui-test-root"
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function render(element: React.ReactNode) {
  await act(async () => { root.render(element) })
}

async function click(selector: string) {
  const target = container.querySelector<HTMLButtonElement>(selector)
  expect(target, selector).not.toBeNull()
  await act(async () => { target!.click() })
}

describe("测试版设置布局与正式版隔离", () => {
  it("只保留十一个设置分类，不显示路径、导出、使用说明和意图路由", async () => {
    await render(<SettingsView />)
    expect(container.querySelector('[data-ui-page="settings"]')).not.toBeNull()
    expect(container.querySelectorAll('aside')).toHaveLength(1)
    expect(container.querySelectorAll('[data-ui="settings-navigation"] button')).toHaveLength(11)
    expect(container.querySelector('[data-ui-settings-category-button="export-center"]')).toBeNull()
    expect(container.querySelector('[data-ui-settings-category-button="usage-guide"]')).toBeNull()
    expect(container.querySelector('[data-ui-settings-category-button="classification"]')).toBeNull()
    expect(container.querySelector('[aria-label="面包屑"]')).toBeNull()
    for (const category of categories) {
      await click(`[data-ui-settings-category-button="${category}"]`)
      expect(container.querySelector(`[data-capability="${category === "model" ? "llm" : category}"]`)).not.toBeNull()
      const selected = container.querySelector(`[data-ui-settings-category-button="${category}"]`)
      expect(selected?.getAttribute("aria-current")).toBe("page")
    }
  })

  it("窄屏分类菜单仍包含全部入口，无项目也能进入全局设置", async () => {
    useWikiStore.setState({ project: null })
    await render(<SettingsView />)
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="设置分类"]')
    expect(select).not.toBeNull()
    expect(select?.options).toHaveLength(11)
    await act(async () => {
      select!.value = "interface"
      select!.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(container.querySelector('[data-capability="interface"]')).not.toBeNull()
  })

  it("四个模型页签保留能力入口、深链、键盘切换及选中语义", async () => {
    useWikiStore.setState({ activeModelSettingsTab: "embedding" })
    await render(<SettingsView />)
    expect(container.querySelector('[data-capability="embedding"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(4)
    for (const id of ["default", "llm", "rerank", "embedding"]) {
      await click(`[data-ui-model-tab="${id}"]`)
      expect(container.querySelector(`[data-capability="${id}"]`)).not.toBeNull()
      expect(container.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(1)
    }
    const last = container.querySelector<HTMLElement>('[data-ui-model-tab="embedding"]')!
    await act(async () => { last.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })) })
    expect(container.querySelector('[data-capability="default"]')).not.toBeNull()
    expect(document.activeElement).toBe(container.querySelector('[data-ui-model-tab="default"]'))
    expect(container.querySelector('[data-ui="settings-footer"] button')).toBeNull()
  })

  it("项目写作设置不再显示顶部路径", async () => {
    await render(<SettingsView />)
    await click('[data-ui-settings-category-button="novel"]')
    expect(container.querySelector('[aria-label="面包屑"]')).toBeNull()
  })


})

describe("真实外观页的测试皮肤", () => {

  async function renderInterface() {
    const { InterfaceSection } = await vi.importActual<typeof import("@/components/settings/sections/interface-section")>("@/components/settings/sections/interface-section")
    const onChange = vi.fn()
    function InterfaceHarness() {
      /*
       * 正文的 6 个字段必须给全。
       *
       * 这里原来只给 5 个界面字段，并用 `as SettingsDraft` 绕过类型检查 ——
       * 旧的两行本地控件读 `draft.uiBodyFontSizeScale` 只会得到 NaN（不抛错），
       * 所以缺字段一直没被发现。Task 9 把这两行换成共享控件
       * `BodyTypographyFields` 后，它读 `value.lineHeight.toFixed(2)`：
       * undefined 直接抛 `Cannot read properties of undefined`，
       * 本文件 5 条用例同时红。
       *
       * 这不是"共享控件太脆"，而是**这个草稿本来就不完整** ——
       * `as SettingsDraft` 正是让缺字段逃过类型系统的那个断言。
       * 本文件其余用例不需要这些字段，但草稿是共享的，所以一并给全。
       */
      const [draft, setDraft] = useState<SettingsDraft>({
        uiLanguage: "zh", uiFontFamily: "system", uiFontSizeScale: 1,
        uiBodyFontFamily: "serif-default", uiBodyFontPx: 18, uiBodyLineHeight: 1.95,
        uiBodyLetterSpacing: 0, uiBodyMarginX: null, uiBodySafeBottom: 51,
        visualStyle: "fangzheng", sidebarNavConfig: DEFAULT_SIDEBAR_NAV_CONFIG,
      } as SettingsDraft)
      return <InterfaceSection draft={draft} setDraft={(key, value) => { onChange(key, value); setDraft((current) => ({ ...current, [key]: value })) }} />
    }
    await render(<InterfaceHarness />)
    return onChange
  }

  it("只显示三款测试皮肤，不保留旧版界面切换和旧版风格", async () => {
    writeUiTestSkin("zhi")
    await renderInterface()
    const choices = container.querySelectorAll('[data-ui="interface-skins"] button')
    expect(choices).toHaveLength(3)
    expect(container.querySelector('[data-ui-skin-choice="zhi"]')?.getAttribute("aria-pressed")).toBe("true")
    expect(container.querySelectorAll('[data-ui="interface-skins"] [aria-pressed="true"]')).toHaveLength(1)
    expect(container.querySelector('h1')?.textContent).toBe("外观与界面")
    expect(container.textContent).not.toContain("切换到旧版界面")
    expect(container.querySelector('[data-ui="interface-compatibility"]')).toBeNull()
    expect(container.textContent).not.toContain("经典原版")
  })

  it("点击每个皮肤立即持久化并发送约定事件，不写入正式视觉风格草稿", async () => {
    writeUiTestSkin("jing")
    const setDraft = await renderInterface()
    const received: unknown[] = []
    const listener = (event: Event) => received.push((event as CustomEvent).detail)
    window.addEventListener("qmai-ui-test-skin-change", listener)
    try {
      for (const skin of ["zhi", "xing", "jing"] as const) {
        await click(`[data-ui-skin-choice="${skin}"]`)
        expect(readUiTestSkin()).toBe(skin)
        expect(container.querySelector(`[data-ui-skin-choice="${skin}"]`)?.getAttribute("aria-pressed")).toBe("true")
        expect(container.querySelectorAll('[data-ui="interface-skins"] [aria-pressed="true"]')).toHaveLength(1)
      }
      expect(received).toEqual(["zhi", "xing", "jing"])
      expect(setDraft).not.toHaveBeenCalled()
    } finally { window.removeEventListener("qmai-ui-test-skin-change", listener) }
  })

  it("从顶栏切换皮肤后页面当前选择同步，不误显示上一种外观", async () => {
    writeUiTestSkin("jing")
    await renderInterface()
    const previous = document.documentElement.dataset.uiTestSkin
    try {
      await act(async () => {
        document.documentElement.dataset.uiTestSkin = "xing"
        await Promise.resolve()
      })
      expect(container.querySelector('[data-ui-skin-choice="xing"]')?.getAttribute("aria-pressed")).toBe("true")
    } finally {
      if (previous) document.documentElement.dataset.uiTestSkin = previous
      else delete document.documentElement.dataset.uiTestSkin
    }
  })

  it("字体、字号及语言控件仍更新原草稿", async () => {
    const setDraft = await renderInterface()
    const font = container.querySelector<HTMLSelectElement>('select[aria-label="界面字体"]')!
    expect(font).not.toBeNull()
    expect(Array.from(font.options).map((option) => option.value)).toEqual(UI_FONT_OPTIONS.map((option) => option.value))
    await act(async () => { font.value = "simsun"; font.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(setDraft).toHaveBeenLastCalledWith("uiFontFamily", "simsun")
    expect(container.querySelector('[aria-label="界面语言"]')).toBeNull()
    const scale = container.querySelector<HTMLSelectElement>('select[aria-label="字号预设"]')!
    expect(scale).not.toBeNull()
    await act(async () => { scale.value = "1.25"; scale.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(setDraft).toHaveBeenLastCalledWith("uiFontSizeScale", 1.25)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="界面字号"]')?.value).toBe("125")
    // 滑块边界必须真的放宽到 80%–150%（用户确认的范围），而不只是常量改了
    const slider = container.querySelector<HTMLInputElement>('input[aria-label="界面字号"]')!
    expect(slider.min).toBe("80")
    expect(slider.max).toBe("150")
    expect(Array.from(scale.options).map((option) => option.value)).toEqual(["0.85", "1", "1.25", "1.5"])
  })

  it("皮肤保存失败时保留原选择并提示中文错误，不发送虚假应用事件", async () => {
    writeUiTestSkin("jing")
    await renderInterface()
    const listener = vi.fn()
    window.addEventListener("qmai-ui-test-skin-change", listener)
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("存储不可用") })
    try {
      await click('[data-ui-skin-choice="xing"]')
      expect(container.querySelector('[data-ui-skin-choice="jing"]')?.getAttribute("aria-pressed")).toBe("true")
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("无法保存")
      expect(listener).not.toHaveBeenCalled()
    } finally { storage.mockRestore(); window.removeEventListener("qmai-ui-test-skin-change", listener) }
  })


})

describe("真实模型列表的测试版分组", () => {
  async function renderProviders() {
    const { LlmProviderSection } = await vi.importActual<typeof import("@/components/settings/sections/llm-provider-section")>("@/components/settings/sections/llm-provider-section")
    await render(<LlmProviderSection />)
  }

  it("默认只展示自定义模型，风险说明折叠但完整可展开", async () => {
    await renderProviders()
    expect(container.textContent).toContain("我的模型配置")
    expect(container.textContent).toContain("我的模型配置")
    expect(container.textContent).toContain("＋ 添加提供方")
    expect(container.textContent).toContain("＋ 添加自定义模型")
    expect(container.querySelector(".model-add-panel")).toBeNull()
    expect(modelIo.connection).not.toHaveBeenCalled()
    expect(modelIo.functionTest).not.toHaveBeenCalled()
  })

  it("提供方模型保留每个内置提供方、中文说明与真实连接测试，切换不重置测试结果", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    useWikiStore.setState({ providerConfigs: { deepseek: { apiKey: "仅测试占位", model: "existing-model", baseUrl: "https://example.invalid/v1" } } })
    await renderProviders()
    const addProvider = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("添加提供方"))!
    await act(async () => { addProvider.click() })
    const panel = container.querySelector<HTMLElement>("[data-ui='llm-library']")!
    expect(panel?.hidden).toBe(false)
    for (const preset of LLM_PRESETS.filter((preset) => preset.id !== "custom")) expect(panel.textContent).toContain(preset.label)
    expect(panel.textContent).toContain("官方 Claude API")
    expect(panel.textContent).not.toContain("Uses the local")
    expect(modelIo.connection).not.toHaveBeenCalled()
    const deepseek = Array.from(panel.querySelectorAll("button")).find((button) => button.textContent?.includes("DeepSeek"))!
    await act(async () => { deepseek.click() })
    expect(panel.querySelector('[aria-label="模型"]')).not.toBeNull()
    expect(panel.querySelector('[aria-label="API 密钥"]')).not.toBeNull()
    expect(panel.textContent).toContain("拉取模型")
    expect(modelIo.connection).not.toHaveBeenCalled()
  })

  it("切换来源不卸载自定义配置编辑器，不丢临时模型输入", async () => {
    useWikiStore.setState({ providerConfigs: { "custom-ui-existing": { label: "已保存配置", enabled: true, savedModels: [] } } })
    await renderProviders()
    expect(container.querySelector(".model-provider-title")?.getAttribute("aria-expanded")).toBe("false")
    await act(async () => { container.querySelector<HTMLButtonElement>(".model-provider-title")?.click() })
    await click(".model-advanced > summary")
    const panel = container.querySelector("[data-ui='llm-library']")!
    const input = panel.querySelector<HTMLInputElement>('[aria-label="模型"]')!
    expect(input).toBeDefined()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "尚未添加的模型ID")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const addProvider = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("添加提供方"))!
    await act(async () => { addProvider.click(); addProvider.click() })
    expect(panel.contains(input)).toBe(true)
    expect(input.value).toBe("尚未添加的模型ID")
  })


})

describe("测试版灵魂单列与旧编辑能力", () => {
  it("项目灵魂单列展示页签与长规则，无面包屑，保留全部风格动作", async () => {
    await render(<SoulView />)
    expect(container.querySelector('[data-ui-page="soul"][data-ui-soul="project"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="面包屑"]')).toBeNull()
    expect(container.querySelector('[data-ui="soul-project-editor"] textarea')?.textContent).toBe("既有长规则。".repeat(1000))
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    expect(container.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1)
    expect(container.querySelector('[title="删除写作风格"]')).not.toBeNull()
    const save = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("保存项目灵魂"))!
    expect(save).toBeDefined()
    await act(async () => { save.click() })
    expect(persistence.saveSoul).toHaveBeenCalledWith("/ui-test/project", expect.objectContaining({ enabledStyleId: "style-a", styles: expect.arrayContaining([expect.objectContaining({ content: "既有长规则。".repeat(1000) })]) }))
  })

  it.each(["builtIn", "custom"] as const)("%s 先展示单列画廊，点开再复用原角色组件，不增加内层侧栏", async (section) => {
    useWikiStore.setState({ selectedSoulTab: "character", selectedSoulId: section === "custom" ? "new-custom-soul" : "existing-aura", selectedSoulSection: section })
    await render(<SoulView />)
    expect(container.querySelector(`[data-ui-soul="${section === "custom" ? "custom" : "role"}"]`)).not.toBeNull()
    expect(container.querySelector('[aria-label="面包屑"]')).toBeNull()
    // 画廊优先：初始不直接挂载编辑组件，也不渲染任何内侧栏。
    expect(container.querySelector('[data-existing-aura-view]')).toBeNull()
    expect(container.querySelector('[aria-label="灵魂分组"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="灵魂分类"]')).not.toBeNull()
    // 自定义灵魂有新建入口，进入后复用原角色组件（hideSidebar）。
    if (section === "custom") {
      const createBtn = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("新建角色灵魂"))
      expect(createBtn).not.toBeUndefined()
      await act(async () => { createBtn!.click() })
      expect(container.querySelector('[data-existing-aura-view][data-hide-sidebar="true"]')).not.toBeNull()
    }
  })


})

const cssPath = resolve(__dirname, "ui-test-tools.css")
function cssRoot() { return postcss.parse(existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "") }
function hasDeclaration(selector: string, property: string, value: string) {
  let found = false
  cssRoot().walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls(property, (declaration) => { if (declaration.value === value) found = true })
  })
  return found
}

describe("工具页样式规格及作用域", () => {
  it("独立 CSS 已接入且所有规则只作用于测试版，禁止按序号隐藏功能", () => {
    expect(existsSync(cssPath)).toBe(true)
    cssRoot().walkRules((rule) => {
      for (const selector of rule.selectors) expect(selector).toMatch(/^(\.ui-test-root\b|html\[data-ui-test-skin\])/)
      expect(rule.selector).not.toMatch(/nth-(child|of-type)/)
    })
    const source = readFileSync(resolve(__dirname, "../settings/settings-view.tsx"), "utf8")
    expect(source).toContain('uitest/ui-test-tools.css')
  })

  it("设置正文 930px、1.25rem（原20px）顶部衬线标题、灵魂风格和编辑器单列", () => {
    expect(hasDeclaration('.ui-test-root [data-ui="settings-section"]', "max-width", "930px")).toBe(true)
    expect(hasDeclaration('.ui-test-root .ui-test-page-title', "font-size", "1.25rem")).toBe(true)
    expect(hasDeclaration('.ui-test-root .ui-test-page-title', "font-family", "var(--serif)")).toBe(true)
    expect(hasDeclaration('.ui-test-root [data-ui="soul-project-editor"] > div > .grid', "grid-template-columns", "minmax(0, 1fr)")).toBe(true)
    expect(hasDeclaration('.ui-test-root [data-ui="soul-role-content"] main > div', "flex-direction", "column")).toBe(true)
  })

  it("测试版胶囊不受正式版直角风格的 important 层叠影响", () => {
    let protectedTabs = false
    cssRoot().walkRules((rule) => {
      const parent = rule.parent
      if (parent?.type !== "atrule" || parent.name !== "layer" || parent.params !== "components") return
      if (!rule.selectors.includes('.ui-test-root .ui-test-tool-tabs > button')) return
      rule.walkDecls("border-radius", (declaration) => { if (declaration.important && declaration.value !== "0") protectedTabs = true })
    })
    expect(protectedTabs).toBe(true)
  })

  it("正在编辑但未启用的风格仍有独立选中边界", () => {
    let selectedBorder = false
    cssRoot().walkRules((rule) => {
      if (!rule.selector.includes('button[class*="border-primary/70"]')) return
      rule.walkDecls("border-color", (declaration) => { if (declaration.value === "var(--ui-accent)") selectedBorder = true })
    })
    expect(selectedBorder).toBe(true)
  })

  it("自定义灵魂分组内的空输入框与容器有可见底色区分", () => {
    let contrastingField = false
    cssRoot().walkRules((rule) => {
      if (!rule.selector.includes('[data-ui="soul-role-content"] .rounded-md')) return
      rule.walkDecls("background-color", (declaration) => { if (declaration.value === "var(--ui-paper)") contrastingField = true })
    })
    expect(contrastingField).toBe(true)
  })

  it("图谱 Canvas 文字读取测试皮肤 token，保留正式版原值", () => {
    const source = readFileSync(resolve(__dirname, "../graph/graph-view.tsx"), "utf8")
    expect(source.includes('getPropertyValue("--ui-ink")')).toBe(true)
    expect(source.includes('getPropertyValue("--ui-muted")')).toBe(true)
    expect(source.includes('labelColor: { color: uiTestGraphColors?.ink ?? "#1e293b" }')).toBe(true)
    expect(source.includes('edgeLabelColor: { color: uiTestGraphColors?.muted ?? "#334155" }')).toBe(true)
  })

  it.each([
    ["memory", "novel/memory-center-view.tsx"],
    ["analysis", "novel/book-analysis-view.tsx"],
    ["simulation", "novel/story-simulation/story-simulation-view.tsx"],
    ["review", "review/review-center-view.tsx"],
    ["graph", "graph/graph-view.tsx"],
    ["search", "search/search-view.tsx"],
    ["skills", "skill-library/unified-skill-library-view.tsx"],
  ])("%s 有明确页面和状态布局标识，不影响正式版分支", (page, path) => {
    const source = readFileSync(resolve(__dirname, "..", path), "utf8")
    expect(source.includes(`data-ui-page="${page}"`)).toBe(true)
    expect(source).toContain("data-ui-state=")
    expect(readFileSync(cssPath, "utf8")).toContain(`[data-ui-page="${page}"]`)
  })
})
