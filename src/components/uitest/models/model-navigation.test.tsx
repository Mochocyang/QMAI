// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { useWikiStore } from "@/stores/wiki-store"
import { SettingsView } from "@/components/settings/settings-view"
import { useModelDraftGuard } from "./model-draft-guard"

vi.mock("@/lib/ui-test", () => ({ IS_UI_TEST_BUILD: true }))
vi.mock("@/i18n", () => ({ default: { language: "zh-CN" } }))
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@/components/layout/panel-header-with-help", () => ({ PanelHeaderWithHelp: () => null }))
vi.mock("@/lib/project-store", () => ({ loadNovelConfig: vi.fn().mockResolvedValue(null), loadRerankConfig: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/platform", () => ({ isTauri: () => false }))
vi.mock("@/components/settings/sections/llm-provider-section", () => ({ LlmProviderSection: function ModelDraft() {
  const [value, setValue] = useState("")
  useModelDraftGuard("navigation-test", "模拟提供方", Boolean(value))
  return <div><output data-testid="model-draft">{value}</output><button type="button" onClick={() => setValue("待保存的模型")}>修改模拟配置</button></div>
} }))
vi.mock("./retrieval-models", () => ({ UiTestRerankModels: () => <div data-testid="independent-rerank" />, UiTestEmbeddingModels: () => <div data-testid="independent-embedding" /> }))
vi.mock("@/components/settings/sections/default-model-settings-panel", () => ({ DefaultModelSettingsPanel: () => <div>默认模型模拟</div> }))
vi.mock("@/components/settings/sections/model-settings-section", () => ({ ModelSettingsSection: () => <div>ModelSettingsSection</div> }))
vi.mock("@/components/settings/sections/embedding-section", () => ({ EmbeddingSection: () => <div>EmbeddingSection</div> }))
vi.mock("@/components/settings/sections/rerank-section", () => ({ RerankSection: () => <div>RerankSection</div> }))
vi.mock("@/components/settings/sections/interface-section", () => ({ InterfaceSection: () => <div>InterfaceSection</div> }))
vi.mock("@/components/settings/sections/novel-section", () => ({ NovelSection: () => <div>NovelSection</div> }))
vi.mock("@/components/settings/sections/classification-section", () => ({ ClassificationSection: () => <div>ClassificationSection</div> }))
vi.mock("@/components/settings/sections/network-section", () => ({ NetworkSection: () => <div>NetworkSection</div> }))
vi.mock("@/components/settings/sections/web-search-section", () => ({ WebSearchSection: () => <div>WebSearchSection</div> }))
vi.mock("@/components/settings/sections/mcp-section", () => ({ McpSection: () => <div>McpSection</div> }))
vi.mock("@/components/settings/sections/changelog-section", () => ({ ChangelogSection: () => <div>ChangelogSection</div> }))
vi.mock("@/components/settings/sections/maintenance-section", () => ({ MaintenanceSection: () => <div>MaintenanceSection</div> }))
vi.mock("@/components/settings/sections/feedback-section", () => ({ FeedbackSection: () => <div>FeedbackSection</div> }))
vi.mock("@/components/settings/sections/usage-guide-section", () => ({ UsageGuideSection: () => <div>UsageGuideSection</div> }))
vi.mock("@/components/settings/sections/contact-support-section", () => ({ ContactSupportSection: () => <div>ContactSupportSection</div> }))
vi.mock("@/components/settings/sections/data-management-section", () => ({ DataManagementSection: () => <div>DataManagementSection</div> }))
vi.mock("@/components/settings/sections/export-center-section", () => ({ ExportCenterSection: () => <div>ExportCenterSection</div> }))
vi.mock("@/components/settings/sections/user-memory-section", () => ({ UserMemorySection: () => <div>UserMemorySection</div> }))

let host: HTMLDivElement, root: Root
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useWikiStore.setState({ activeSettingsCategory: null, activeModelSettingsTab: null, project: null })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<SettingsView />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
async function click(selector: string) {
  const element = host.querySelector<HTMLButtonElement>(selector)
  expect(element, selector).toBeTruthy()
  await act(async () => element!.click())
}
async function edit() {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === "修改模拟配置")!
  await act(async () => button.click())
}
it("模型子页只在首次访问挂载，并在来回切换后保留草稿", async () => {
  expect(host.querySelector('[data-testid="independent-embedding"]')).toBeNull()
  await edit()
  await click('[data-ui-model-tab="default"]')
  expect(host.querySelector('[data-testid="model-draft"]')?.closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(true)
  await click('[data-ui-model-tab="llm"]')
  expect(host.querySelector('[data-testid="model-draft"]')?.textContent).toBe("待保存的模型")
  await click('[data-ui-model-tab="embedding"]')
  expect(host.querySelector('[data-testid="independent-embedding"]')).not.toBeNull()
  await click('[data-ui-model-tab="rerank"]')
  expect(host.querySelector('[data-testid="independent-rerank"]')).not.toBeNull()
})
it("模型页不出现会保存无关配置的全局页脚，其他分类保留", async () => {
  expect(host.querySelector('[data-ui="settings-footer"]')).toBeNull()
  await click('[data-ui-settings-category-button="network"]')
  expect(host.querySelector('[data-ui="settings-footer"]')).not.toBeNull()
})
it("取消离开模型分类时，不丢草稿；确认才离开", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
  await edit(); await click('[data-ui-settings-category-button="network"]')
  expect(confirm).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category")).toBe("model")
  expect(host.querySelector('[data-testid="model-draft"]')?.textContent).toBe("待保存的模型")
  confirm.mockReturnValue(true)
  await click('[data-ui-settings-category-button="network"]')
  expect(host.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category")).toBe("network")
})
it("外部分类跳转同样遵守未保存确认", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
  await edit()
  await act(async () => useWikiStore.getState().setActiveSettingsCategory("interface"))
  expect(confirm).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-ui-page="settings"]')?.getAttribute("data-ui-settings-category")).toBe("model")
  expect(useWikiStore.getState().activeSettingsCategory).toBeNull()
})
