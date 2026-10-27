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

  // ── 「添加账号」三栏入口（WorkBuddy 账号登录）────────────────
  // 顺序是产品叙事的一部分：先「用自己的账号登录」，再「填别人的 Key」，
  // 最后「完全自定义」；而且必须排在「我的模型配置」列表**之前**。
  it("puts three add entries above the config list, account first", () => {
    const heading = source.indexOf("我的模型设置")
    const addAccount = source.indexOf('data-guide="model.add-account"')
    const addProvider = source.indexOf('data-guide="model.add-provider"')
    const addCustom = source.indexOf('data-guide="model.add-custom"')
    const list = source.indexOf("model-library-list")

    expect(heading).toBeGreaterThan(-1)
    expect(addAccount).toBeGreaterThan(heading)
    expect(addAccount).toBeLessThan(addProvider)
    expect(addProvider).toBeLessThan(addCustom)
    expect(addCustom).toBeLessThan(list)
  })

  it("mounts the WorkBuddy account dialog and generates the model card on first login", () => {
    expect(source).toContain('import { AddWorkbuddyAccountDialog } from "./add-workbuddy-account-dialog"')
    expect(source).toContain("<AddWorkbuddyAccountDialog")
    expect(source).toContain("buildWorkbuddyCard(models)")
    expect(source).toContain('saveUiTestProvider("workbuddy", card, undefined)')
    // 删掉最后一个账号：置灰而不是删卡片，用户的模型勾选不丢。
    expect(source).toContain("disableWorkbuddyCard(expected)")
  })

  it("never asks for an API key on the account-login provider", () => {
    expect(source).toContain('preset.provider !== "workbuddy"')
    expect(source).toContain("workbuddy: \"用你自己的 WorkBuddy 账号登录")
  })
})
