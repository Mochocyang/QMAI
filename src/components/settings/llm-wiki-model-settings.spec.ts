import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getProviderConfig } from "@/lib/llm-providers"
import type { LlmConfig } from "@/stores/wiki-store"
import zh from "@/i18n/zh.json"
import { LLM_PRESETS } from "./llm-presets"
import { resolveConfig } from "./preset-resolver"

const fallback: LlmConfig = {
  provider: "custom",
  apiKey: "",
  model: "",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 204800,
  apiMode: "chat_completions",
  reasoning: { mode: "auto" },
}

function preset(id: string) {
  const found = LLM_PRESETS.find((item) => item.id === id)
  if (!found) throw new Error(`Missing preset ${id}`)
  return found
}

describe("QMAI model settings", () => {
  it("renders the 200K long-writing requirement on the LLM settings page", () => {
    const source = readFileSync(
      resolve(__dirname, "sections/llm-provider-section.tsx"),
      "utf8",
    )
    expect(source).toContain("settings.sections.llm.longWritingContextTitle")
    expect(source).toContain("settings.sections.llm.longWritingContextHint")
    expect(source).toContain("settings.sections.llm.longWritingContextDocs")
    expect(source).toContain("https://global.modelmesh.info/model")
    expect(source).toContain("text-emerald-800 dark:text-emerald-200")
    expect(source).not.toContain("bg-emerald-500/10 px-3 py-2 text-sm text-white")
  })

  it("keeps every built-in provider and gives each one at least 204800", () => {
    expect(LLM_PRESETS[0]?.id).toBe("custom")

    expect(LLM_PRESETS.map((item) => item.id)).toEqual([
      "custom",
      "anthropic",
      "claude-code-cli",
      "codex-cli",
      "cursor-cli",
      "openai",
      "google",
      "azure",
      "deepseek",
      "atlascloud",
      "groq",
      "xai",
      "nvidia-nim",
      "kimi",
      "kimi-cn",
      "kimi-coding-plan",
      "zhipu",
      "minimax-global",
      "minimax-cn",
      "bailian-coding",
      "xiaomi-mimo",
      "volcengine-ark",
      "ollama-local",
      "ollama-cloud",
    ])
    for (const item of LLM_PRESETS) {
      expect(item.suggestedContextSize).toBeGreaterThanOrEqual(204_800)
    }
  })

  it("removes only known models below the writing window from suggestions", () => {
    const groq = preset("groq")
    expect(groq.suggestedModels).not.toContain("mixtral-8x7b-32768")
    expect(groq.suggestedModels).not.toContain("gemma2-9b-it")
    expect(groq.defaultModel).toBe("openai/gpt-oss-120b")
  })

  it("resolves DeepSeek to an OpenAI-compatible custom endpoint", () => {
    const config = resolveConfig(preset("deepseek"), { apiKey: "sk-test" }, fallback)
    expect(config.provider).toBe("custom")
    expect(config.customEndpoint).toBe("https://api.deepseek.com/v1")
    expect(config.model).toBe("deepseek-v4-flash")

    const provider = getProviderConfig(config)
    expect(provider.url).toBe("https://api.deepseek.com/v1/chat/completions")
    expect(provider.headers.Authorization).toBe("Bearer sk-test")
  })

  it("resolves Azure OpenAI deployment settings into the Azure chat endpoint", () => {
    const config = resolveConfig(
      preset("azure"),
      {
        apiKey: "azure-key",
        baseUrl: "https://qmai-test.openai.azure.com",
        model: "writer-prod",
        azureApiVersion: "2024-10-21",
        azureModelFamily: "gpt5",
      },
      fallback,
    )

    expect(config.provider).toBe("azure")
    expect(config.azureModelFamily).toBe("gpt5")

    const provider = getProviderConfig(config)
    expect(provider.url).toBe(
      "https://qmai-test.openai.azure.com/openai/deployments/writer-prod/chat/completions?api-version=2024-10-21",
    )
    expect(provider.headers["api-key"]).toBe("azure-key")
  })

  it("keeps local CLI provider options available in the resolved config", () => {
    const claude = resolveConfig(
      preset("claude-code-cli"),
      { localCliIsolation: true },
      fallback,
    )
    expect(claude.provider).toBe("claude-code")
    expect(claude.localCliIsolation).toBe(true)
    expect(claude.model).toBe("")

    const codex = resolveConfig(
      preset("codex-cli"),
      { localCliIsolation: true, codexCliTimeoutMinutes: 45, codexSpeedMode: "fast" },
      fallback,
    )
    expect(codex.provider).toBe("codex-cli")
    expect(codex.localCliIsolation).toBe(true)
    expect(codex.model).toBe("gpt-5.6-terra")
    expect(codex.codexCliTimeoutMinutes).toBe(45)
    expect(codex.codexSpeedMode).toBe("fast")

    const codexPreset = preset("codex-cli")
    expect(codexPreset.defaultModel).toBe("gpt-5.6-terra")
    expect(codexPreset.suggestedModels).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "gpt-5.6-luna",
    ])
    const codexDefault = resolveConfig(preset("codex-cli"), {}, fallback)
    expect(codexDefault.model).toBe("gpt-5.6-terra")
    expect(codexDefault.codexCliTimeoutMinutes).toBe(40)
    expect(codexDefault.codexSpeedMode).toBe("standard")

    const cursor = resolveConfig(
      preset("cursor-cli"),
      { baseUrl: "http://127.0.0.1:8765/v1" },
      fallback,
    )
    expect(cursor.provider).toBe("cursor-cli")
    expect(cursor.customEndpoint).toBe("http://127.0.0.1:8765/v1")
    expect(cursor.model).toBe("composer-2-fast")
    expect(cursor.apiKey).toBe("")

    const cursorProvider = getProviderConfig(cursor)
    expect(cursorProvider.url).toBe("http://127.0.0.1:8765/v1/chat/completions")
    expect(cursorProvider.headers.Authorization).toBe("Bearer unused")
  })

  it("has Chinese labels for the built-in model settings instead of placeholder question marks", () => {
    const llm = zh.settings.sections.llm
    expect(llm.collapse).toBe("收起配置")
    expect(llm.apiKeyPlaceholder).toBe("输入 API Key")
    expect(llm.activeBadge).toBe("当前使用")
    expect(llm.longWritingContextTitle).toContain("至少 200K")
    expect(llm.longWritingContextHint).toContain("手动配置")
    expect(llm.longWritingContextHint).toContain("最大")
    expect(llm.longWritingContextHint).toContain("输出")
    expect(llm.longWritingContextDocs).toBe("参考文档")
    expect(llm.codexSpeed).toBe("Codex 速度")
    expect(llm.codexSpeedFast).toContain("1.5 倍")
    expect(llm.codexSpeedFast).toContain("用量更多")
    expect(JSON.stringify(llm)).not.toContain("??")
  })
})
