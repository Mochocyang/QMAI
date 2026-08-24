import type { LlmConfig } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"

export interface ProviderTestResult {
  ok: boolean
  message: string
}

const LLM_PROVIDER_TEST_MAX_TOKENS = 512

export async function testLlmConnection(cfg: LlmConfig): Promise<ProviderTestResult> {
  const started = performance.now()
  let content = ""
  let errorMessage: string | null = null

  await streamChat(
    cfg,
    [
      { role: "system", content: "You are a connection checker. Reply briefly." },
      { role: "user", content: "Reply with one short word." },
    ],
    {
      onToken: (token) => { content += token },
      onDone: () => {},
      onError: (err) => { errorMessage = err.message },
    },
    undefined,
    { max_tokens: LLM_PROVIDER_TEST_MAX_TOKENS, reasoning: { mode: "off" } },
  )

  if (errorMessage) return { ok: false, message: errorMessage }
  if (!content.trim()) return { ok: false, message: "Model connected but returned empty content." }
  return {
    ok: true,
    message: `Connected in ${Math.round(performance.now() - started)} ms. Response: ${content.trim().slice(0, 80)}`,
  }
}

export async function testLlmFunction(cfg: LlmConfig): Promise<ProviderTestResult> {
  let content = ""
  let errorMessage: string | null = null

  await streamChat(
    cfg,
    [
      {
        role: "system",
        content: "You are a deterministic API test. Do not explain. Output only the requested token.",
      },
      { role: "user", content: "Output exactly this token and nothing else: LLM_WIKI_TEST_OK" },
    ],
    {
      onToken: (token) => { content += token },
      onDone: () => {},
      onError: (err) => { errorMessage = err.message },
    },
    undefined,
    { max_tokens: LLM_PROVIDER_TEST_MAX_TOKENS, reasoning: { mode: "off" } },
  )

  if (errorMessage) return { ok: false, message: errorMessage }
  const trimmed = content.trim()
  if (!trimmed.includes("LLM_WIKI_TEST_OK")) {
    return {
      ok: false,
      message: `Model responded, but did not follow the functional test prompt. Response: ${trimmed.slice(0, 120) || "(empty)"}`,
    }
  }
  return { ok: true, message: "Functional test passed. The model returned the expected token." }
}
