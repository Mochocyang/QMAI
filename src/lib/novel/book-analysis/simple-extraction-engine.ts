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

function emptyProfile(): PersonalityProfile {
  return { personality: "", motivation: "", speechStyle: "", behaviorPatterns: "", quotes: [] }
}

async function defaultLlmCall(_prompt: string): Promise<string> {
  throw new Error("defaultLlmCall not implemented in this context")
}
