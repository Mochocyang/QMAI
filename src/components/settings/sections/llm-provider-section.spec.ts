import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "llm-provider-section.tsx"), "utf8")

describe("LLM provider model controls", () => {
  it("keeps fetched model selection wired into the LLM provider panel", () => {
    expect(source).toContain('import { fetchLlmModelList } from "@/lib/settings-model-list"')
    expect(source).toContain('import { useBatchModelTest } from "../hooks/use-batch-model-test"')
    expect(source).toContain('import { ModelSelectInput } from "../model-select-input"')

    expect(source).toContain("const [modelOptions, setModelOptions] = useState<string[]>([])")
    expect(source).toContain("await fetchLlmModelList(resolvedConfig)")
    expect(source).toContain("runBatchTest(modelsToTest, (modelId) => ({ ...resolvedConfig, model: modelId }))")
    expect(source).toContain("<ModelSelectInput")
    expect(source).toContain('selectPlaceholder={t("settings.sections.shared.modelSelectPlaceholder")}')
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
    expect(source).toContain('{preset.provider !== "cursor-cli" && (')
    expect(source).toContain("<ReasoningControls")
  })
})
