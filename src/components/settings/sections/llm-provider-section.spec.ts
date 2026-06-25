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
})
