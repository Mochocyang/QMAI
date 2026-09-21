import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = readFileSync(resolve(__dirname, "sections/model-settings-section.tsx"), "utf8")

describe("ModelSettingsSection", () => {
  it("defines the four model tabs and defaults to the LLM tab", () => {
    expect(source).toContain('{ id: "default", label:')
    expect(source).toContain('{ id: "llm", label:')
    expect(source).toContain('{ id: "rerank", label:')
    expect(source).toContain('{ id: "embedding", label:')
    expect(source).toContain('useState<ModelTabId>(() => requestedTab ?? "llm")')
  })

  it("renders default, LLM, rerank, and embedding panels switchably", () => {
    expect(source).toContain('active === "llm" && <LlmProviderSection')
    expect(source).toContain('active === "default" && <DefaultModelSettingsPanel draft={draft} setDraft={setDraft}')
    expect(source).toContain('active === "rerank" && <RerankSection draft={draft} setDraft={setDraft}')
    expect(source).toContain('active === "embedding" && <EmbeddingSection draft={draft} setDraft={setDraft}')
  })

  it("opens a requested model tab from the store and then clears it", () => {
    expect(source).toContain("activeModelSettingsTab")
    expect(source).toContain("setActiveModelSettingsTab")
    expect(source).toContain("requestedTab ?? \"llm\"")
    expect(source).toContain("setRequestedTab(null)")
  })
})