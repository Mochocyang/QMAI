import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import zh from "@/i18n/zh.json"

const settingsViewSource = readFileSync(resolve(__dirname, "settings-view.tsx"), "utf8")

describe("settings model categories", () => {
  it("shows LLM, reranker, and embedding as independent settings categories", () => {
    expect(settingsViewSource).toContain('| "llm"')
    expect(settingsViewSource).toContain('| "rerank"')
    expect(settingsViewSource).toContain('| "embedding"')

    expect(settingsViewSource).toContain('{ id: "llm", labelKey: "settings.categories.llm", icon: Bot }')
    expect(settingsViewSource).toContain('{ id: "rerank", labelKey: "settings.categories.rerank", icon: ListFilter }')
    expect(settingsViewSource).toContain('{ id: "embedding", labelKey: "settings.categories.embedding", icon: Database }')
  })

  it("keeps embedding and reranker panels out of the LLM category body", () => {
    expect(settingsViewSource).toContain('case "llm":')
    expect(settingsViewSource).toContain("return <LlmProviderSection />")
    expect(settingsViewSource).toContain('case "rerank":')
    expect(settingsViewSource).toContain('return <RerankSection draft={draft} setDraft={setDraft} />')
    expect(settingsViewSource).toContain('case "embedding":')
    expect(settingsViewSource).toContain('return <EmbeddingSection draft={draft} setDraft={setDraft} />')
  })

  it("uses the requested Chinese model category names", () => {
    expect(zh.settings.categories.llm).toBe("大语言/LLM模型")
    expect(zh.settings.categories.rerank).toBe("重排/Reranker模型")
    expect(zh.settings.categories.embedding).toBe("向量检索/Embedding模型")
    expect(zh.settings.sections.llm.title).toBe("大语言/LLM模型")
    expect(zh.settings.sections.rerank.title).toBe("重排/Reranker模型")
    expect(zh.settings.sections.embedding.title).toBe("向量检索/Embedding模型")
    expect(zh.settings.sections.llm.description).not.toContain("模型设置")
  })
})
