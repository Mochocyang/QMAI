import type { LlmConfig, ProviderConfigs } from "@/stores/wiki-store"
import { isProviderAvailable } from "@/lib/llm-model-keys"
import { isPluginProviderInjected } from "@/lib/plugins/provider-sync"

type LlmProvider = LlmConfig["provider"]

/**
 * Maps LlmConfig.provider values to their corresponding LLM_PRESETS id,
 * for providers that are gated by a single well-known preset toggle.
 */
const PRESET_ID_BY_PROVIDER: Partial<Record<LlmProvider, string>> = {
  "claude-code": "claude-code-cli",
  "codex-cli": "codex-cli",
  "cursor-cli": "cursor-cli",
  "antigravity-cli": "antigravity-cli",
  "workbuddy": "workbuddy",
  "ollama": "ollama-local",
}

function isPresetAvailable(providerConfigs: ProviderConfigs, presetId: string): boolean {
  const entry = providerConfigs[presetId]
  // 与设置页、模型选择器一致：兼容已有模型但尚无 enabled 字段的旧配置。
  return !!entry && isProviderAvailable(presetId, entry)
}

function hasEnabledCustomPreset(providerConfigs: ProviderConfigs): boolean {
  for (const key of Object.keys(providerConfigs)) {
    if (!key.startsWith("custom-")) continue
    if (providerConfigs[key]?.enabled === true) return true
  }
  return false
}

/**
 * Single source of truth for "is the user's LLM configuration good
 * enough to make calls?" Replaces ad-hoc `apiKey || provider ===
 * "ollama" || …` checks scattered across ingest, sweep, lint,
 * chat, and clip-watcher — every one of which had to be edited
 * by hand whenever a new no-key provider was added, and at least
 * three of which were silently out of date when the
 * Claude Code CLI provider shipped.
 *
 * Use this everywhere a guard like "do we have an LLM?" is
 * needed; the type-level union plus the exhaustiveness test in
 * `has-usable-llm.test.ts` ensures future provider additions
 * land in exactly one bucket and don't slip through.
 */
export function hasUsableLlm(
  cfg: Pick<LlmConfig, "provider" | "apiKey" | "model">,
  providerConfigs: ProviderConfigs = {},
): boolean {
  const hasKey = cfg.apiKey.trim().length > 0
  const hasModel = cfg.model.trim().length > 0

  if (cfg.provider === "claude-code" || cfg.provider === "codex-cli" || cfg.provider === "cursor-cli" || cfg.provider === "antigravity-cli") {
    const presetId = PRESET_ID_BY_PROVIDER[cfg.provider]!
    return isPresetAvailable(providerConfigs, presetId)
  }

  // 账号登录类：没有 apiKey —— 可用性就是「卡片存在且启用，且有模型」。
  // 登录态本身不在这个纯函数里判（它只看配置）；删掉最后一个账号时由设置页
  // 把卡片 enabled 置 false，于是这里自然变假。
  if (cfg.provider === "workbuddy") {
    const presetId = PRESET_ID_BY_PROVIDER["workbuddy"]!
    return isPresetAvailable(providerConfigs, presetId) && hasModel
  }

  if (cfg.provider === "ollama") {
    return isPresetAvailable(providerConfigs, "ollama-local") && hasModel
  }

  if (cfg.provider === "custom") {
    if (hasKey && hasModel) return true
    return hasEnabledCustomPreset(providerConfigs) && hasModel
  }

  /*
   * 插件 provider（运行期注入，见 `plugins/provider-sync`）：
   * token 按设计只活在 Rust 内存里（计划第 0 节），所以 `apiKey` **永远为空**。
   * 用「apiKey 非空」判定会把插件 provider 一律判成不可用 —— 模型解析与
   * 聊天前的守卫都会直接挡掉，整条链路等于没接通。
   *
   * 可用性改判：宿主分配的 `baseUrl` 已经写进配置 + 用户选了模型。
   * 条件必须是「本进程注入过」而不是「id 不在内置清单里」：用户手工配置的
   * 陌生 id 同样陌生，不能因此被放行。
   */
  if (isPluginProviderInjected(cfg.provider)) {
    const entry = providerConfigs[cfg.provider]
    return Boolean(entry?.baseUrl?.trim()) && hasModel
  }

  return hasKey && hasModel
}
