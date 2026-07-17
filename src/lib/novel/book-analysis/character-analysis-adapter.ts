import { joinPath, normalizePath } from "@/lib/path-utils"
import { extractCharactersFromChapters } from "./character-extraction-engine"
import { persistCharacterToDisk } from "./character-disk-store"
import { loadMetadata } from "./analysis-engine"
import { generateSkillsForCharacters } from "./skill-generator"
import { replaceAutomaticEvidence } from "./analysis-evidence-store"
import { rebuildBookAnalysisContextIndex } from "./analysis-context-index"
import { loadAnalysisManifest, saveAnalysisManifest } from "./analysis-pipeline-storage"
import { selectCharacterCandidates } from "./character-candidate-selection"
import type {
  AnalysisEvidenceSnippet,
  BookAnalysisModuleManifest,
} from "./analysis-pipeline-types"
import type { AnalysisSkillAdapter } from "./analysis-skill-adapter"
import type { ExtractedCharacter } from "./types"

export interface CharacterAnalysisChunkResult {
  characters: ExtractedCharacter[]
}

interface CharacterAnalysisAdapterDependencies {
  extractCharacters: typeof extractCharactersFromChapters
  persistCharacter: typeof persistCharacterToDisk
  generateSkills: typeof generateSkillsForCharacters
  loadMetadata: typeof loadMetadata
  replaceEvidence: typeof replaceAutomaticEvidence
  loadManifest: typeof loadAnalysisManifest
  saveManifest: typeof saveAnalysisManifest
  rebuildContextIndex: typeof rebuildBookAnalysisContextIndex
  now: () => number
}

const defaultDependencies: CharacterAnalysisAdapterDependencies = {
  extractCharacters: extractCharactersFromChapters,
  persistCharacter: persistCharacterToDisk,
  generateSkills: generateSkillsForCharacters,
  loadMetadata,
  replaceEvidence: replaceAutomaticEvidence,
  loadManifest: loadAnalysisManifest,
  saveManifest: saveAnalysisManifest,
  rebuildContextIndex: rebuildBookAnalysisContextIndex,
  now: Date.now,
}

function normalizedText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "")
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    const key = normalizedText(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function identities(character: ExtractedCharacter): Set<string> {
  return new Set(uniqueStrings([character.name, ...character.aliases]).map(normalizedText))
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const item of left) if (right.has(item)) return true
  return false
}

function pickLongest(values: Array<string | undefined>): string {
  return values.reduce<string>((best, value) => (
    (value?.trim().length ?? 0) > best.length ? value!.trim() : best
  ), "")
}

function mergeCharacterGroup(group: ExtractedCharacter[]): ExtractedCharacter {
  const nameWeights = new Map<string, { name: string; weight: number }>()
  for (const character of group) {
    const key = normalizedText(character.name)
    const current = nameWeights.get(key)
    nameWeights.set(key, {
      name: character.name.trim(),
      weight: (current?.weight ?? 0) + Math.max(1, character.appearanceCount),
    })
  }
  const canonical = [...nameWeights.values()].sort((left, right) => right.weight - left.weight)[0]?.name
    ?? group[0].name
  const dominant = [...group].sort((left, right) => right.appearanceCount - left.appearanceCount)[0]
  const relationshipKeys = new Set<string>()
  const relationships = group.flatMap((character) => character.relationships).filter((relationship) => {
    const key = [relationship.target, relationship.relation, relationship.description ?? ""].map(normalizedText).join("::")
    if (relationshipKeys.has(key)) return false
    relationshipKeys.add(key)
    return true
  })
  const eventKeys = new Set<string>()
  const keyEvents = group.flatMap((character) => character.keyEvents).filter((event) => {
    const key = [event.chapterId, event.description].map(normalizedText).join("::")
    if (eventKeys.has(key)) return false
    eventKeys.add(key)
    return true
  })
  const quoteKeys = new Set<string>()
  const representativeQuotes = group.flatMap((character) => character.representativeQuotes ?? []).filter((quote) => {
    const key = [quote.chapterId, quote.text].map(normalizedText).join("::")
    if (quoteKeys.has(key)) return false
    quoteKeys.add(key)
    return true
  })
  const categoryRank = { protagonist: 4, antagonist: 3, supporting: 2, minor: 1 } as const
  const category = [...group].sort((left, right) => categoryRank[right.category] - categoryRank[left.category])[0].category

  return {
    ...dominant,
    name: canonical,
    aliases: uniqueStrings(group.flatMap((character) => [character.name, ...character.aliases]))
      .filter((name) => normalizedText(name) !== normalizedText(canonical)),
    importance: Math.max(...group.map((character) => character.importance)),
    category,
    firstAppearance: Math.min(...group.map((character) => character.firstAppearance)),
    lastAppearance: Math.max(...group.map((character) => character.lastAppearance)),
    appearanceCount: group.reduce((sum, character) => sum + character.appearanceCount, 0),
    description: pickLongest(group.map((character) => character.description)),
    personality: pickLongest(group.map((character) => character.personality)),
    motivation: pickLongest(group.map((character) => character.motivation)),
    goals: uniqueStrings(group.flatMap((character) => character.goals ?? [])),
    fears: uniqueStrings(group.flatMap((character) => character.fears ?? [])),
    growthArc: uniqueStrings(group.map((character) => character.growthArc)).join("；"),
    behaviorPatterns: uniqueStrings(group.map((character) => character.behaviorPatterns)).join("；"),
    speechStyle: pickLongest(group.map((character) => character.speechStyle)),
    relationships,
    keyEvents,
    representativeQuotes,
    corpus: group.map((character) => character.corpus ?? "").filter(Boolean).join("\n\n").slice(0, 12000),
  }
}

export function mergeCharacterChunkResults(chunks: ExtractedCharacter[][]): ExtractedCharacter[] {
  const all = chunks.flat()
  const parent = all.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const union = (left: number, right: number): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }
  const identitySets = all.map(identities)
  for (let left = 0; left < all.length; left += 1) {
    for (let right = left + 1; right < all.length; right += 1) {
      if (intersects(identitySets[left], identitySets[right])) union(left, right)
    }
  }
  const groups = new Map<number, ExtractedCharacter[]>()
  all.forEach((character, index) => {
    const root = find(index)
    groups.set(root, [...(groups.get(root) ?? []), character])
  })
  return [...groups.values()].map(mergeCharacterGroup)
}

function characterEvidence(
  taskId: string,
  bookId: string,
  chunkId: string,
  chapterIds: string[],
  startOrder: number,
  characters: ExtractedCharacter[],
  now: number,
): AnalysisEvidenceSnippet[] {
  let index = 0
  return characters.flatMap((character) => (character.representativeQuotes ?? []).map((quote) => {
    const chapterIndex = chapterIds.indexOf(quote.chapterId)
    const evidence: AnalysisEvidenceSnippet = {
      version: 1,
      id: `evidence-${taskId}-characters-${chunkId}-${index++}`,
      bookId,
      skill: "characters",
      taskId,
      chapterId: quote.chapterId,
      chapterOrder: chapterIndex >= 0 ? startOrder + chapterIndex : startOrder,
      text: quote.text.trim().slice(0, 500),
      tags: [character.name, "角色塑造"],
      reason: `体现${character.name}的动机、语言或行为模式`,
      purpose: "角色塑造与对话参考",
      enabled: true,
      userPinned: false,
      createdAt: now,
      updatedAt: now,
    }
    return evidence
  })).filter((item) => item.text)
}

export function createCharacterAnalysisAdapter(
  overrides: Partial<CharacterAnalysisAdapterDependencies> = {},
): AnalysisSkillAdapter<CharacterAnalysisChunkResult, ExtractedCharacter[]> {
  const dependencies = { ...defaultDependencies, ...overrides }
  return {
    skill: "characters",
    async runChunk({ task, bookPath, llmConfig, chunk, signal }) {
      const extracted = await dependencies.extractCharacters({
        bookPath,
        selectedChapterIds: chunk.chapterIds,
        llmConfig,
        depth: "fast",
        persistResults: false,
        signal,
      })
      if (!extracted.success) throw new Error("角色区块分析失败")
      return {
        result: { characters: extracted.characters },
        evidence: characterEvidence(
          task.id,
          task.bookId,
          chunk.id,
          chunk.chapterIds,
          chunk.startOrder,
          extracted.characters,
          dependencies.now(),
        ),
      }
    },
    async aggregate({ chunks }) {
      const merged = mergeCharacterChunkResults(chunks.map((chunk) => chunk.characters))
      const candidates = selectCharacterCandidates(merged)
      if (candidates.length === 0) {
        throw new Error("所选章节未识别到可提取角色，请确认章节正文包含有姓名的重要角色")
      }
      return candidates
    },
    async publish({ task, bookPath, projectPath, result, evidence }) {
      const metadata = await dependencies.loadMetadata(bookPath)
      if (!metadata) throw new Error("未找到作品元数据，无法发布角色分析")
      for (const character of result) await dependencies.persistCharacter(bookPath, character)
      const characterNames = new Set(result.map((character) => character.name))
      await dependencies.replaceEvidence(bookPath, "characters", evidence.filter((item) => item.tags.some((tag) => characterNames.has(tag))))

      const resultPath = normalizePath(joinPath(bookPath, "characters"))
      const updatedAt = dependencies.now()
      const current = await dependencies.loadManifest(bookPath)
      const manifest: BookAnalysisModuleManifest = {
        version: 1,
        bookId: task.bookId,
        modules: {
          ...(current?.modules ?? {}),
          characters: {
            ...task.modules.characters,
            status: "completed",
            resultPath,
            summary: `识别 ${result.length} 个候选角色，覆盖第 ${task.modules.characters.range.startOrder}～${task.modules.characters.range.endOrder} 章，等待用户选择生成 Skill。`,
            updatedAt,
          },
        },
        updatedAt,
      }
      await dependencies.saveManifest(bookPath, manifest)
      await dependencies.rebuildContextIndex(projectPath)
      return resultPath
    },
  }
}

export const characterAnalysisAdapter = createCharacterAnalysisAdapter()
