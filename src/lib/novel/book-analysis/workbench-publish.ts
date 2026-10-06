import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { createCustomCharacterAuraFromGeneratedSkill, loadCharacterAuraStore, updateCustomCharacterAura } from "../character-aura"
import { loadWritingStyleStore, upsertWritingStylePreset } from "../writing-style-store"
import { loadPlotFrameworkLibrary, upsertPlotFramework } from "../plot-framework-library"
import { renderPersonalitySkill, parsePortablePersonality } from "../portable-personality"
import { buildGeneratedAuraInputFromBookCharacter } from "./aura-adapter"
import { isSameBookAnalysisCharacterAura } from "./aura-match"
import { workbenchPersonality, workbenchRulesMarkdown, type WorkbenchRevision } from "./workbench-core"
import { readWorkbenchChapters, saveWorkbenchRevision, workbenchRevisionPath } from "./workbench-storage"
import type { ExtractedCharacter, BookAnalysisMetadata } from "./types"
import type { PlotFramework } from "../plot-framework"
import { styleItemEvidenceIds } from "./style-fingerprint"

const pending = new Map<string, Promise<WorkbenchRevision>>()
export async function inspectWorkbenchPublication(projectPath: string, revision: WorkbenchRevision) {
  const auras = await loadCharacterAuraStore(projectPath)
  const styles = await loadWritingStyleStore(projectPath)
  const frameworks = await loadPlotFrameworkLibrary(projectPath)
  const targets = revision.skill === "characters"
    ? auras.customAuras.filter((a) => revision.items.some((item) => isSameBookAnalysisCharacterAura(a, revision.bookTitle, item.subject)))
    : revision.skill === "style" ? styles.styles.filter((s) => s.sourceBook === revision.bookTitle)
      : frameworks.frameworks.filter((f) => f.id === `wb-story-${revision.bookId}`)
  const impacts = revision.skill === "characters" ? auras.bindings.filter((b) => targets.some((t) => t.id === b.auraId)).map((b) => `人物「${b.characterName}」`)
    : revision.skill === "style" && targets.some((t) => t.id === styles.enabledStyleId) ? ["当前启用的文风"]
      : revision.skill === "story" && targets.length ? ["该框架的现有引用；已生成正文不自动改写"] : []
  return { targets, impacts, fingerprint: await sha256Text(JSON.stringify({ targets, impacts })) }
}

export async function confirmWorkbenchRevision(projectPath: string, bookPath: string, revisionId: string, expectedFingerprint: string): Promise<WorkbenchRevision> {
  const key = `${projectPath}:${revisionId}`
  if (pending.has(key)) return pending.get(key)!
  const operation = (async () => {
    const revision = JSON.parse(await readFile(workbenchRevisionPath(bookPath, revisionId))) as WorkbenchRevision
    if (revision.confirmedAt) return revision
    if (!revision.items.some((item) => item.rules.length)) throw new Error("没有有依据的规则可加入")
    const inspection = await inspectWorkbenchPublication(projectPath, revision)
    if (inspection.fingerprint !== expectedFingerprint) throw new Error("使用库或绑定已变化，请重新确认替换范围")
    const chapters = await readWorkbenchChapters(bookPath, revision.selectedChapterIds)
    for (const e of revision.evidence) {
      const chapter = chapters.find((c) => c.id === e.chapterId)
      if (!chapter || chapter.sourceHash !== e.sourceHash || chapter.content.slice(e.start, e.end) !== e.text) {
        throw new Error("原文证据已变化，请重新生成后确认")
      }
    }
    const backup = joinPath(bookPath, "analysis", "publication-history")
    await createDirectory(backup)
    await writeFileAtomic(joinPath(backup, `${revision.id}-${Date.now()}.json`), JSON.stringify(inspection.targets, null, 2))
    const publishedIds: string[] = []
    if (revision.skill === "characters") {
      const store = await loadCharacterAuraStore(projectPath)
      for (const item of revision.items.filter((item) => item.rules.length)) {
        const profile = parsePortablePersonality(workbenchPersonality(item, revision.evidence))
        const character: ExtractedCharacter = {
          id: `wb-${(await sha256Text(item.subject)).slice(0, 16)}`, name: item.subject, aliases: [], importance: 0, category: "supporting",
          firstAppearance: Math.min(...revision.coverage.map((c) => c.order)), lastAppearance: Math.max(...revision.coverage.map((c) => c.order)),
          appearanceCount: 0, description: "", personality: profile.summary, speechStyle: "", relationships: [], keyEvents: [],
        }
        const metadata: BookAnalysisMetadata = { title: revision.bookTitle, totalChapters: revision.selectedChapterIds.length, totalWords: 0, sourceType: "file", createdAt: revision.createdAt, updatedAt: Date.now() }
        const input = buildGeneratedAuraInputFromBookCharacter(character, {
          id: `skill-${character.id}`, characterId: character.id, characterName: character.name, skillContent: renderPersonalitySkill(item.subject, revision.bookTitle, profile),
          sourceBook: revision.bookTitle, chapterRange: revision.selectedChapterIds, createdAt: revision.createdAt,
        }, metadata)
        const existing = store.customAuras.find((a) => isSameBookAnalysisCharacterAura(a, revision.bookTitle, item.subject))
        const aura = existing ? await updateCustomCharacterAura(projectPath, existing.id, input)
          : await createCustomCharacterAuraFromGeneratedSkill(projectPath, input)
        store.customAuras = [...store.customAuras.filter((a) => a.id !== aura.id), aura]
        publishedIds.push(aura.id)
      }
    } else if (revision.skill === "style") {
      const markdown = revision.items.map(workbenchRulesMarkdown).join("\n\n")
      const evidenceIds = new Set(revision.items.flatMap(styleItemEvidenceIds))
      const samples = revision.evidence.filter((e) => evidenceIds.has(e.id)).slice(0, 6).map((e) => e.text)
      const item = revision.items.find((item) => item.styleFingerprint)
      const workbenchStyle = item?.styleFingerprint?.omitted?.length
        ? { ...item, styleFingerprint: { ...item.styleFingerprint, omitted: undefined } } : item
      const result = await upsertWritingStylePreset(projectPath, {
        name: `${revision.bookTitle} · 文风`, sourceBook: revision.bookTitle,
        sourceBookId: revision.bookId,
        profile: {
          schemaVersion: 2, generatedAt: revision.createdAt, sampledChapterIds: revision.selectedChapterIds,
          workbenchStyle,
          integratedDna: markdown, constitution: revision.items.flatMap((i) => i.rules.map((r, index) => `${index + 1}. ${r.condition}：${r.action}；${r.boundary}`)).join("\n"),
          metrics: revision.metrics, samples,
        },
      })
      publishedIds.push(result.id)
    } else {
      const item = revision.items[0]
      const pick = (dimensions: string[]) => item.rules.filter((r) => dimensions.includes(r.dimension)).map((r) => `${r.condition}：${r.action}；${r.boundary}`).join("\n")
        || "本次没有充分依据，不固定该环节；由目标故事实际情境决定。"
      const framework: PlotFramework = {
        id: `wb-story-${revision.bookId}`, title: `${revision.bookTitle} · 故事机制`, line: "main",
        beats: { hook: pick(["目标与阻力", "信息投放"]), buildup: pick(["冲突升级"]), payoff: pick(["转折条件", "兑现"]), endingHook: pick(["后续悬念"]) },
        rangeChapterIds: revision.selectedChapterIds, characters: [], foreshadowing: [], reusableTemplate: item.summary,
        directionHints: workbenchRulesMarkdown(item), handcraftHints: item.limitations,
        sourceDismantlingProjectId: `book-analysis:${revision.bookId}`, sourceDismantlingProjectTitle: revision.bookTitle,
        createdAt: revision.createdAt, updatedAt: Date.now(),
      }
      publishedIds.push((await upsertPlotFramework(projectPath, framework)).id)
    }
    const confirmed = { ...revision, confirmedAt: Date.now(), publishedIds }
    await saveWorkbenchRevision(bookPath, confirmed)
    return confirmed
  })().finally(() => pending.delete(key))
  pending.set(key, operation)
  return operation
}
