import type { AzureModelFamily } from "@/stores/wiki-store"
import { MIN_USER_LLM_CONTEXT_SIZE } from "@/lib/llm-context-size"
import { CODEX_CLI_SUGGESTED_MODELS, DEFAULT_CODEX_CLI_MODEL } from "@/lib/codex-cli-model"

/**
 * Curated LLM provider presets.
 *
 * Selecting a preset pre-fills the underlying LlmConfig fields so users
 * don't have to remember endpoint URLs / API mode per vendor. The
 * dispatch code in `src/lib/llm-providers.ts` still branches on the
 * lower-level `provider` field — presets just populate the config.
 */
export type CustomApiMode = "chat_completions" | "responses" | "anthropic_messages"

export type Provider =
  | "openai"
  | "anthropic"
  | "google"
  | "azure"
  | "ollama"
  | "custom"
  | "minimax"
  | "claude-code"
  | "codex-cli"
  | "cursor-cli"

export interface LlmPreset {
  /** Stable id used as the dropdown value. */
  id: string
  /** Display label in the dropdown. */
  label: string
  /** Short subtitle shown under the label. */
  hint?: string
  /** Underlying provider dispatch key (see llm-providers.ts). */
  provider: Provider
  /** Suggested base URL. `customEndpoint` for custom, `ollamaUrl` for ollama, ignored for built-ins. */
  baseUrl?: string
  /**
   * For vendors that serve the same model catalog over both an OpenAI-
   * compatible and an Anthropic-compatible endpoint at different URLs
   * (e.g. Alibaba Bailian Coding Plan), list the URL per wire mode.
   * The settings UI auto-swaps `baseUrl` when the user flips the API
   * mode toggle — so one preset covers both protocols instead of two.
   */
  baseUrlByMode?: Partial<Record<CustomApiMode, string>>
  /** Suggested default model; user can override. */
  defaultModel?: string
  /** Azure OpenAI api-version query parameter. Azure deployments vary by resource. */
  azureApiVersion?: string
  /** Azure deployment names are arbitrary, so users can declare GPT-5/o-series behavior explicitly. */
  azureModelFamily?: AzureModelFamily
  /**
   * Curated list of model ids the UI shows as clickable chips above the
   * Model input. The user can still type a custom value — the input stays
   * free-form. An empty/missing list means "no suggestions, type freely"
   * (e.g. Ollama Local where the model set is whatever the user pulled).
   */
  suggestedModels?: string[]
  /** Custom providers only: which wire protocol to speak. */
  apiMode?: CustomApiMode
  /** Suggested context window in tokens, from the model's spec sheet; user can override. */
  suggestedContextSize?: number
  /**
   * Suggested maximum output in tokens, from the model's spec sheet; user can
   * override. Only fill this in where the figure has a source — a wrong value
   * here either wastes the model's capacity or gets the request rejected.
   * Omitted presets fall back to `DEFAULT_USER_LLM_MAX_OUTPUT_TOKENS`.
   */
  suggestedMaxOutputTokens?: number
}

const RAW_LLM_PRESETS: LlmPreset[] = [
  {
    id: "custom",
    label: "自定义模型",
    hint: "任意 OpenAI、Responses 或 Anthropic 兼容接口",
    provider: "custom",
    apiMode: "chat_completions",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    hint: "Official Claude API",
    provider: "anthropic",
    defaultModel: "claude-sonnet-5",
    // 2026-08 lineup from platform.claude.com model overview. Retired
    // 3.5 / Sonnet-4 dated IDs dropped; type them manually if still needed.
    suggestedModels: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "claude-code-cli",
    label: "Claude Code CLI (local)",
    hint: "Uses the local `claude` binary — no API key needed",
    provider: "claude-code",
    defaultModel: "claude-sonnet-5",
    // Mirrors anthropic preset; the CLI forwards to the same Anthropic
    // backend, so model ids are identical. Users with a subscription
    // can pick Opus/Sonnet/Haiku here without paying an API key bill.
    suggestedModels: [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-opus-4-6",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "codex-cli",
    label: "Codex CLI (local)",
    hint: "Uses the local `codex` binary — no API key needed",
    provider: "codex-cli",
    defaultModel: DEFAULT_CODEX_CLI_MODEL,
    suggestedModels: [...CODEX_CLI_SUGGESTED_MODELS],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "cursor-cli",
    label: "Cursor CLI (local)",
    hint: "Local `agent` via cursor-api-proxy — no official API key needed",
    provider: "cursor-cli",
    baseUrl: "http://127.0.0.1:8765/v1",
    defaultModel: "composer-2.5-fast",
    apiMode: "chat_completions",
    // Only ids that survive ACP-catalog filtering of `agent --list-models`.
    suggestedModels: [
      "auto",
      "composer-2.5-fast",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "openai",
    label: "OpenAI (GPT)",
    hint: "Official OpenAI API",
    provider: "openai",
    defaultModel: "gpt-5.5",
    // 2026-08 api.openai.com lineup (GPT-5.5 / 5.4 family). Context preset
    // stops at the 272K long-context pricing inflection; users can raise it.
    suggestedModels: [
      "gpt-5.5",
      "gpt-5.5-pro",
      "gpt-5.4",
      "gpt-5.4-pro",
      "gpt-5.4-mini",
      "gpt-5.4-nano",
      "gpt-5.2",
    ],
    suggestedContextSize: 272_000,
  },
  {
    id: "google",
    label: "Google (Gemini)",
    hint: "Generative Language API",
    provider: "google",
    defaultModel: "gemini-3.6-flash",
    // 2026-08 Gemini API: Flash line is at 3.6; Pro flagship is still the
    // 3.1 preview — gemini-3.5-pro / 3.6-pro are not published yet.
    suggestedModels: [
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
      "gemini-3.1-flash-lite",
    ],
    suggestedContextSize: 1000000,
  },
  {
    id: "azure",
    label: "Azure OpenAI",
    hint: "Azure OpenAI resource endpoint; Model field is the deployment name",
    provider: "azure",
    baseUrl: "https://your-resource.openai.azure.com",
    defaultModel: "your-deployment-name",
    // Still on the deployment-style URL builder; keep a GA date-based
    // api-version that those endpoints accept. Foundry v1 is a different path.
    azureApiVersion: "2024-10-21",
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    hint: "api.deepseek.com",
    provider: "custom",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    apiMode: "chat_completions",
    // `deepseek-chat` and `deepseek-reasoner` remain selectable for
    // existing users, but DeepSeek has announced deprecation on
    // 2026-07-24. Keep chip values as exact model ids so clicking a
    // suggestion can be copied directly into the request body.
    suggestedModels: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ],
    suggestedContextSize: 1000000,
    // DeepSeek-V4: 1000K context / 384K max output, per the published spec.
    suggestedMaxOutputTokens: 393216,
  },
  {
    id: "atlascloud",
    label: "Atlas Cloud",
    hint: "api.atlascloud.ai",
    provider: "custom",
    baseUrl: "https://api.atlascloud.ai/v1",
    defaultModel: "deepseek-ai/deepseek-v4-pro",
    apiMode: "chat_completions",
    // Atlas Cloud is a full-modal inference platform exposing many model
    // families (DeepSeek, Qwen, GLM, Kimi, MiniMax, Claude, GPT, Gemini…)
    // behind a single OpenAI-compatible /v1/chat/completions endpoint, so
    // it reuses the generic chat-completions wire like the other hosted
    // gateways above. `deepseek-v4-pro` is a reasoning model — leave the
    // context window generous. Full catalog is large and rotates; this is
    // a practical subset and users can type any other id into the input.
    suggestedModels: [
      "deepseek-ai/deepseek-v4-pro",
      "deepseek-ai/deepseek-v4-flash",
      "deepseek-ai/deepseek-v3.2",
      "Qwen/Qwen3-Next-80B-A3B-Instruct",
      "moonshotai/kimi-k2.6",
      "zai-org/glm-5",
      "minimaxai/minimax-m2.7",
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-5.5",
      "google/gemini-3.5-flash",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "groq",
    label: "Groq",
    hint: "api.groq.com",
    provider: "custom",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
    apiMode: "chat_completions",
    // 2026-08: llama-3.3-70b / llama-3.1-8b shut down 2026-08-16; qwen3-32b
    // and llama-4-scout already retired. Prefer gpt-oss / qwen3.6 / MiniMax.
    suggestedModels: [
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.6-27b",
      "minimaxai/minimax-m2.7",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    hint: "api.x.ai",
    provider: "custom",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-4.5",
    apiMode: "chat_completions",
    // Live GET /v1/language-models (2026-07) returns exactly these six text
    // models. Trap: `grok-latest` aliases grok-4.3, not grok-4.5.
    suggestedModels: [
      "grok-4.5",
      "grok-4.3",
      "grok-4.20-0309-reasoning",
      "grok-4.20-0309-non-reasoning",
      "grok-4.20-multi-agent-0309",
      "grok-build-0.1",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    hint: "integrate.api.nvidia.com",
    provider: "custom",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiMode: "chat_completions",
    // NVIDIA's build.nvidia.com hosts both their own Nemotron family
    // and a rotating catalog of popular third-party open-weight models
    // behind the same OpenAI-compatible endpoint. API key is issued
    // per-user from build.nvidia.com. Full catalog is huge and
    // changes often — this is a practical subset; users can type any
    // other id into the custom input.
    defaultModel: "meta/llama-4-maverick-17b-128e-instruct",
    suggestedModels: [
      "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      "nvidia/nemotron-3-nano-30b-a3b",
      "meta/llama-4-maverick-17b-128e-instruct",
      "meta/llama-3.3-70b-instruct",
      "meta/llama-3.1-405b-instruct",
      "deepseek-ai/deepseek-v4-pro",
      "deepseek-ai/deepseek-v4-flash",
      "moonshotai/kimi-k2.6",
      "qwen/qwen3.5-397b-a17b",
      "qwen/qwen3-coder-480b-a35b-instruct",
      "minimaxai/minimax-m2.7",
      "mistralai/mistral-large-3-675b-instruct-2512",
      "openai/gpt-oss-120b",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    hint: "api.moonshot.ai",
    provider: "custom",
    baseUrl: "https://api.moonshot.ai/v1",
    defaultModel: "kimi-k2.6",
    apiMode: "chat_completions",
    // Current Moonshot lineup. The older `moonshot-v1-*` and
    // `kimi-k2-0905-preview` / `-turbo-preview` ids are being
    // deprecated on 2026-05-25 and dropped from the picker already —
    // users who still need them can type the id into the custom input.
    suggestedModels: [
      "kimi-k2.6",
      "kimi-k2.5",
      "kimi-k2-thinking",
      "kimi-for-coding",
    ],
    suggestedContextSize: 256000,
  },
  {
    id: "kimi-cn",
    label: "Kimi (Moonshot, 中国)",
    hint: "api.moonshot.cn",
    provider: "custom",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.6",
    apiMode: "chat_completions",
    suggestedModels: [
      "kimi-k2.6",
      "kimi-k2.5",
      "kimi-k2-thinking",
      "kimi-for-coding",
    ],
    suggestedContextSize: 256000,
  },
  {
    id: "kimi-coding-plan",
    label: "Kimi (Coding Plan)",
    hint: "api.kimi.com",
    provider: "custom",
    baseUrl: "https://api.kimi.com/coding/",
    defaultModel: "kimi-for-coding",
    apiMode: "chat_completions",
    // Kimi Coding Plan is a separate subscription service from the
    // Moonshot open platform. It supports both OpenAI-compatible
    // (chat_completions) and Anthropic-compatible (anthropic_messages)
    // wires on the same base URL. The Anthropic wire requires Bearer
    // auth (see requiresBearerAuth in llm-providers.ts).
    suggestedModels: ["kimi-for-coding"],
    suggestedContextSize: 256000,
  },
  {
    id: "zhipu",
    label: "智谱 GLM (Zhipu)",
    hint: "open.bigmodel.cn",
    provider: "custom",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.6",
    apiMode: "chat_completions",
    // Current Zhipu BigModel lineup on /api/paas/v4/chat/completions.
    // Vision-capable models use the same OpenAI-compatible image_url
    // content blocks as our generic chat-completions wire.
    suggestedModels: [
      "glm-5.1",
      "glm-5-turbo",
      "glm-5",
      "glm-5v-turbo",
      "glm-4.7",
      "glm-4.7-flash",
      "glm-4.7-flashx",
      "glm-4.6",
      "glm-4.6v",
      "glm-4.5",
      "glm-4.5v",
      "glm-4.5-air",
      "glm-4.5-airx",
      "glm-4.5-flash",
      "glm-4-flash-250414",
      "glm-4-flashx-250414",
      "glm-4-plus",
      "glm-4-air",
      "glm-4-flash",
      "glm-4v-plus",
      "glm-zero-preview",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "minimax-global",
    label: "MiniMax (Global)",
    hint: "api.minimax.io/anthropic",
    provider: "custom",
    baseUrl: "https://api.minimax.io/anthropic",
    defaultModel: "MiniMax-M3",
    apiMode: "anthropic_messages",
    // M3 is the current-gen default; M2.7 stays as a fallback for users
    // pinned to it. Older M2.5 / M2.1 / M2 are legacy and have been
    // dropped — users who still need them can type the id into the
    // custom input.
    suggestedModels: ["MiniMax-M3", "MiniMax-M2.7"],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "minimax-cn",
    label: "MiniMax (中国)",
    hint: "api.minimaxi.com/anthropic",
    provider: "custom",
    baseUrl: "https://api.minimaxi.com/anthropic",
    defaultModel: "MiniMax-M3",
    apiMode: "anthropic_messages",
    suggestedModels: ["MiniMax-M3", "MiniMax-M2.7"],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "bailian-coding",
    label: "阿里百炼 Coding Plan",
    hint: "coding.dashscope.aliyuncs.com",
    provider: "custom",
    // Default wire is OpenAI-compat. Flipping the "API 模式" toggle to
    // Anthropic-compat auto-swaps the base URL via baseUrlByMode below,
    // so users don't have to know the two URLs exist.
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    apiMode: "chat_completions",
    baseUrlByMode: {
      chat_completions: "https://coding.dashscope.aliyuncs.com/v1",
      anthropic_messages: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    },
    // Bailian's subscription-only "Coding Plan" exposes the same model
    // catalog on both wires. Key must come from the Bailian console's
    // Coding Plan tab — a regular DashScope key will 401. The
    // Anthropic-compat path uses Bearer auth (see requiresBearerAuth
    // in llm-providers.ts), matching the MiniMax gateway convention.
    defaultModel: "qwen3.6-plus",
    suggestedModels: [
      "qwen3.6-plus",
      "kimi-k2.5",
      "glm-5",
      "MiniMax-M2.5",
      "qwen3.5-plus",
      "qwen3-max-2026-01-23",
      "qwen3-coder-plus",
      "qwen3-coder-next",
      "glm-4.7",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "xiaomi-mimo",
    label: "小米 MiMo (Xiaomi)",
    hint: "api.xiaomimimo.com",
    provider: "custom",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiMode: "chat_completions",
    baseUrlByMode: {
      chat_completions: "https://token-plan-cn.xiaomimimo.com/v1",
      anthropic_messages: "https://token-plan-cn.xiaomimimo.com/anthropic",
    },
    // Official OpenAI-compatible endpoint at api.xiaomimimo.com/v1.
    // Token Plan users can switch API mode to the CN OpenAI/Anthropic
    // gateways above. MiMo V2.5 Pro / Omni advertise 1M context;
    // Flash remains the low-cost 256K option. Older v2 ids stay
    // selectable for existing users and gateway deployments.
    defaultModel: "mimo-v2.5-pro",
    suggestedModels: [
      "mimo-v2.5-pro",
      "mimo-v2.5",
      "mimo-v2-flash",
      "mimo-v2-pro",
      "mimo-v2-omni",
    ],
    suggestedContextSize: 1000000,
  },
  {
    id: "volcengine-ark",
    label: "火山引擎 Ark (Volcengine)",
    hint: "ark.cn-beijing.volces.com/api/coding/v3",
    provider: "custom",
    // Volcengine Ark's "coding" product line mandates this exact base URL
    // per their official docs. Their other OpenAI-compat base (api/v3) is
    // not a valid substitute. This endpoint rejects browser-origin fetch
    // via CORS (allow-headers omits `authorization`), so LLM calls route
    // through Tauri's HTTP plugin — see src/lib/llm-client.ts.
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    apiMode: "chat_completions",
    // Exact model catalog Volcengine's Coding product line accepts on
    // this endpoint. The older `doubao-*-1-5-*` / `doubao-seed-1-6-*` /
    // `deepseek-v3-250324` ids that work on the general Ark endpoints
    // are NOT available here and will 400.
    defaultModel: "Doubao-Seed-2.0-Code",
    suggestedModels: [
      "Doubao-Seed-2.0-Code",
      "Doubao-Seed-2.0-pro",
      "Doubao-Seed-2.0-lite",
      "Doubao-Seed-Code",
      "MiniMax-M2.5",
      "Kimi-K2.5",
      "GLM-4.7",
      "DeepSeek-V3",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "ollama-local",
    label: "Ollama (Local)",
    hint: "Self-hosted llama.cpp / Ollama",
    provider: "ollama",
    baseUrl: "http://localhost:11434",
    // Intentionally no suggestedModels: local set depends on what the
    // user has actually pulled / loaded. Kept as free-text input.
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    hint: "ollama.com",
    provider: "custom",
    baseUrl: "https://ollama.com/v1",
    apiMode: "chat_completions",
    // 2026-08 cloud catalog: deepseek-v3.1 / kimi-k2:1t / qwen3-coder:480b
    // retired in favor of v4 / k2.6 / qwen3.5.
    suggestedModels: [
      "gpt-oss:120b",
      "gpt-oss:20b",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.5:397b",
      "kimi-k2.6",
    ],
    suggestedContextSize: MIN_USER_LLM_CONTEXT_SIZE,
  },
  {
    id: "custom",
    label: "Custom",
    hint: "Any OpenAI- or Anthropic-compatible endpoint",
    provider: "custom",
    // Wire protocol is chosen via the "API 模式" toggle in the expanded
    // panel — no need for separate presets per mode. User supplies the
    // base URL manually (no baseUrlByMode: nothing we can auto-fill).
    apiMode: "chat_completions",
    // No suggestedModels: user knows what their gateway exposes.
  },
]

const ALL_LLM_PRESETS: LlmPreset[] = RAW_LLM_PRESETS
  .filter((preset, index) => preset.id !== "custom" || index === 0)
  .map((preset) => ({
    ...preset,
    suggestedContextSize: Math.max(
      preset.suggestedContextSize ?? MIN_USER_LLM_CONTEXT_SIZE,
      MIN_USER_LLM_CONTEXT_SIZE,
    ),
  }))

/** All providers remain visible and default to at least the writing floor. */
export const LLM_PRESETS: LlmPreset[] = ALL_LLM_PRESETS

/** Resolve provider configurations by their stable preset id. */
export function findLlmPresetById(id: string): LlmPreset | undefined {
  return ALL_LLM_PRESETS.find((preset) => preset.id === id)
}
