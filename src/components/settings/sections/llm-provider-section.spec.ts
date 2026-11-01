import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "llm-provider-section.tsx"), "utf8")

describe("LLM provider model controls", () => {
  it("keeps fetched model selection wired into the LLM provider panel", () => {
    expect(source).toContain('import { fetchLlmModelList } from "@/lib/settings-model-list"')
    expect(source).toContain('import { useUiTestProviderBatch } from "@/components/uitest/models/provider-batch"')
    expect(source).toContain('import { mergeProviderModels, removeProviderModel } from "@/components/uitest/models/provider-data"')

    expect(source).toContain("const [modelOptions, setModelOptions] = useState<string[]>([])")
    expect(source).toContain("await fetchLlmModelList(resolvedConfig)")
    expect(source).toContain("runBatchTest(modelsToTest, (modelId) => ({ ...resolvedConfig, model: modelId }))")
    expect(source).toContain("<UiTestProviderModelInput")
    expect(source).toContain('aria-label="模型"')
  })

  it("shows separate controls for fetching models and testing the selected model", () => {
    expect(source).toContain('t("settings.sections.llm.fetchModels")')
    expect(source).toContain('t("settings.sections.shared.testModel")')
    expect(source).toContain("runBatchTest(modelsToTest, (modelId)")
    expect(source).toContain("retryFailed((modelId)")
    expect(source).toContain("重试失败模型")
  })

  it("exposes a per-provider Function Calling toggle", () => {
    expect(source).toContain("export function FunctionCallingControls")
    expect(source).toContain("<FunctionCallingControls")
    expect(source).toContain("functionCallingEnabled")
    expect(source).toContain('settings.sections.llm.functionCalling.label')
  })

  it("starts cursor-api-proxy via npx @latest instead of a global install", () => {
    expect(source).toContain('t("settings.sections.llm.cliStatus.cursorProxyNpxHint")')
    expect(source).not.toContain("npm i -g cursor-api-proxy")
  })

  it("exposes Cursor agent version check and update", () => {
    expect(source).toContain("checkCursorAgentUpdate")
    expect(source).toContain("updateCursorAgent")
    expect(source).toContain('t("settings.sections.llm.cliStatus.cursorCheckUpdate")')
    expect(source).toContain('t("settings.sections.llm.cliStatus.cursorUpdateNow")')
    expect(source).toContain("await detect({ silent: true })")
  })

  it("keeps Codex CLI isolated and requires app-server dynamic tools", () => {
    expect(source).toContain('const showLocalCliIsolation = preset.provider === "claude-code"')
    expect(source).toContain("r.installed && r.appServerReady === true && r.dynamicToolsReady === true")
    expect(source).toContain('invoke<DetectResult>("codex_cli_detect")')
  })

  it("exposes the persisted Codex standard and fast speed switch", () => {
    expect(source).toContain("resolveCodexSpeedMode(ov.codexSpeedMode)")
    expect(source).toContain('role="switch"')
    expect(source).toContain('codexSpeedMode: codexFastEnabled ? "standard" : "fast"')
    expect(source).toContain('settings.sections.llm.codexSpeedFast')
  })

  it("does not expose Cursor Fast or reasoning controls", () => {
    expect(source).not.toContain("resolveCursorSpeedMode")
    expect(source).not.toContain("cursorSpeedMode")
    expect(source).toContain('{preset.provider !== "cursor-cli" && preset.provider !== "antigravity-cli" && (')
    expect(source).toContain("<ReasoningControls")
  })

  it("renders plugin provider cards first, above configured/custom cards (v4 插件区置顶)", () => {
    /*
     * v4（docs/plugins/workbuddy-provider-卡片设计v4.html §4b）：插件 provider 区
     * 从页面最底部移到「添加提供方 / 添加自定义模型」按钮行的正下方 ——
     * model-library-list 的第一个位置，在 configured（自定义模型）卡片之前。
     * 本文件是源码断言型测试，用两段代码的先后位置表达渲染顺序。
     */
    const pluginGroup = source.indexOf('data-ui="plugin-provider-group"')
    const configuredMap = source.indexOf("configured.map((id)")
    expect(pluginGroup).toBeGreaterThanOrEqual(0)
    expect(configuredMap).toBeGreaterThanOrEqual(0)
    expect(pluginGroup).toBeLessThan(configuredMap)
  })

  it("提供方目录紧贴按钮行，不再渲染在列表最底部", () => {
    /*
     * 用户反馈：点「＋ 添加提供方」后目录出现在整张列表下面，得滚到底才看得到，
     * 像"点了没反应"。现在按钮行 → 目录 → 卡片列表，顺序写死在这段源码里。
     */
    const addRow = source.indexOf('className="model-add-row"')
    const addPanel = source.indexOf('className="model-add-panel"')
    const list = source.indexOf('className="model-library-list"')
    expect(addRow).toBeGreaterThanOrEqual(0)
    expect(addPanel).toBeGreaterThanOrEqual(0)
    expect(list).toBeGreaterThanOrEqual(0)
    expect(addRow).toBeLessThan(addPanel)
    expect(addPanel).toBeLessThan(list)
  })

  it("新建但没保存的配置排在列表最前，保存后回到正常顺序", () => {
    // 未保存 → providerConfigs 里没有这条 → 排 0；保存后 → 排 1
    expect(source).toContain(
      ".sort((a, b) => Number(Boolean(providerConfigs[a])) - Number(Boolean(providerConfigs[b])))",
    )
  })
})

/**
 * 用户卸载插件后仍看到「WorkBuddy 国内版 / 未选择模型」的空卡片：
 * 卡是持久化的 providerConfigs 残留，代码里早已没有这个预设。
 */
describe("已移除的 provider 不再渲染卡片", () => {
  it("configured 列表会剔除已移除的 provider", () => {
    expect(source).toContain('import { isObsoleteProviderId } from "@/lib/obsolete-providers"')
    expect(source).toContain(".filter((id) => !isObsoleteProviderId(id))")
  })
})
