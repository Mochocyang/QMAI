import type { LlmConfig } from "@/stores/wiki-store"
import type { RecognizedCharacter, PersonalityProfile } from "./types"
import { buildSimpleExtractionPrompt } from "./simple-extraction-prompts"

export interface SimpleExtractionInput {
  candidates: RecognizedCharacter[]
  chapterSamples: string
  llmConfig: LlmConfig
  signal?: AbortSignal
  // 测试注入点
  _llmCall?: (prompt: string) => Promise<string>
  onProgress?: (completed: number, total: number) => void
}

export interface SimpleProfileResult {
  name: string
  profile: PersonalityProfile
}

export interface SimpleExtractionOutput {
  profiles: SimpleProfileResult[]
  error?: string
}

export async function extractSimpleProfiles(
  input: SimpleExtractionInput
): Promise<SimpleExtractionOutput> {
  const { candidates, chapterSamples, signal, _llmCall, onProgress } = input
  const prompt = buildSimpleExtractionPrompt({
    characterNames: candidates.map((c) => c.name),
    chapterSamples,
  })

  try {
    const llmFn = _llmCall ?? defaultLlmCall
    const raw = await llmFn(prompt)
    if (signal?.aborted) throw new Error("aborted")

    const parsed = JSON.parse(raw) as Array<{
      name: string
      personality: string
      motivation: string
      speechStyle: string
      behaviorPatterns: string
      quotes: string[]
    }>

    const profiles: SimpleProfileResult[] = candidates.map((c, i) => {
      const llmResult = parsed.find((p) => p.name === c.name)
      onProgress?.(i + 1, candidates.length)
      return {
        name: c.name,
        profile: llmResult
          ? {
              personality: llmResult.personality,
              motivation: llmResult.motivation,
              speechStyle: llmResult.speechStyle,
              behaviorPatterns: llmResult.behaviorPatterns,
              quotes: (llmResult.quotes ?? []).slice(0, 5),
            }
          : emptyProfile(),
      }
    })

    return { profiles }
  } catch (err) {
    return {
      profiles: candidates.map((c) => ({ name: c.name, profile: emptyProfile() })),
      error: err instanceof Error ? err.message : "unknown error",
    }
  }
}

// === 单角色简单提取（feature/book-analysis-reuse）===

export interface SingleProfileInput {
  character: RecognizedCharacter
  chapterSamples: string
  llmConfig: LlmConfig
  signal?: AbortSignal
  _llmCall?: (prompt: string) => Promise<string>
}

export interface SingleProfileResult {
  name: string
  profile: PersonalityProfile
  error?: string
  errorKind?: string
}

/**
 * 对单个角色执行简单提取，用 LLM 调用获取 4 字段 + 代表性台词。
 * 与 extractSimpleProfiles 不同，本函数每次只针对一个角色调用 LLM，
 * 用于单角色重提和断点续传场景。
 */
export async function extractSingleProfile(
  input: SingleProfileInput
): Promise<SingleProfileResult> {
  const { character, chapterSamples, signal, _llmCall } = input

  try {
    const prompt = buildSimpleExtractionPrompt({
      characterNames: [character.name],
      chapterSamples,
    })

    const llmFn = _llmCall ?? defaultLlmCall
    const raw = await llmFn(prompt)
    if (signal?.aborted) throw new Error("aborted")

    let parsed: Array<{
      name: string
      personality: string
      motivation: string
      speechStyle: string
      behaviorPatterns: string
      quotes: string[]
    }>

    try {
      parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error("LLM 返回的不是数组")
      }
    } catch {
      // LLM 可能返回纯文本，尝试提取
      return {
        name: character.name,
        profile: {
          personality: raw.slice(0, 200).trim(),
          motivation: "",
          speechStyle: "",
          behaviorPatterns: "",
          quotes: [],
        },
        error: "LLM 返回格式不正确，已提取部分内容",
        errorKind: "parse",
      }
    }

    const llmResult = parsed.find((p) => p.name === character.name)

    if (!llmResult) {
      return {
        name: character.name,
        profile: emptyProfile(),
        error: `LLM 返回中未找到角色「${character.name}」的信息`,
        errorKind: "missing",
      }
    }

    return {
      name: character.name,
      profile: {
        personality: llmResult.personality || "",
        motivation: llmResult.motivation || "",
        speechStyle: llmResult.speechStyle || "",
        behaviorPatterns: llmResult.behaviorPatterns || "",
        quotes: (llmResult.quotes ?? []).slice(0, 5),
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error"
    const isNetwork = msg.toLowerCase().includes("network")
      || msg.toLowerCase().includes("fetch")
      || msg.toLowerCase().includes("timeout")
      || msg === "aborted"
    return {
      name: character.name,
      profile: emptyProfile(),
      error: msg,
      errorKind: isNetwork ? "network" : "unknown",
    }
  }
}

function emptyProfile(): PersonalityProfile {
  return { personality: "", motivation: "", speechStyle: "", behaviorPatterns: "", quotes: [] }
}

async function defaultLlmCall(_prompt: string): Promise<string> {
  throw new Error("defaultLlmCall not implemented in this context")
}
