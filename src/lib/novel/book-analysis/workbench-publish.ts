import { createDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { joinPath } from "@/lib/path-utils"
import { sha256Text } from "@/lib/context-hub/fingerprint"
import { createCustomCharacterAuraFromGeneratedSkill, loadCharacterAuraStore, updateCustomCharacterAura, type CharacterAura } from "../character-aura"
import { loadWritingStyleStore, upsertWritingStylePreset } from "../writing-style-store"
import { loadPlotFrameworkLibrary, upsertPlotFramework } from "../plot-framework-library"
import { renderPersonalitySkill, parsePortablePersonality } from "../portable-personality"
import { buildGeneratedAuraInputFromBookCharacter, importBookAnalysisSkillsAsAuras } from "./aura-adapter"
import { isSameBookAnalysisCharacterAura } from "./aura-match"
import { generateSimpleSkillMarkdown } from "./skill-generator"
import { workbenchPersonality, workbenchRulesMarkdown, type WorkbenchItem, type WorkbenchRevision } from "./workbench-core"
import { readWorkbenchChapters, saveWorkbenchRevision, workbenchRevisionPath } from "./workbench-storage"
import type { BookAnalysisLibraryBook } from "./library-state"
import type { ExtractedCharacter, BookAnalysisMetadata, CharacterSkill } from "./types"
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

/**
 * 迁移版本的 evidence 是空的（旧版人格来自 LLM 摘要，本就没有正文偏移），
 * 而 parsePortablePersonality 要求每条规则都引用一条**已存在**的证据。
 * 所以先判断「有没有可用的证据引用」：有才生成人格块，
 * 没有就返回空串，交给 buildGeneratedAuraInputFromBookCharacter 的
 * personalityProfile／散文字段兜底（aura-adapter.ts:61 起），条目摘要仍作为性格写入，不丢数据。
 */
function workbenchSkillContent(item: WorkbenchItem, revision: WorkbenchRevision): string {
  const evidenceIds = new Set(revision.evidence.map((e) => e.id))
  const usable = item.rules.length >= 1 && item.rules.length <= 8
    && item.rules.every((rule) => rule.evidenceIds.length > 0 && rule.evidenceIds.every((id) => evidenceIds.has(id)))
  if (!usable) return ""
  return renderPersonalitySkill(item.subject, revision.bookTitle,
    parsePortablePersonality(workbenchPersonality(item, revision.evidence)))
}

/**
 * 旧版（迁移）条目没有可用 Skill 时就地合成一个、仅作为 aura 输入载体的 CharacterSkill。
 * 不写进 skills 目录、不进入作品库。
 *
 * 有 personalityProfile 时用 generateSimpleSkillMarkdown 生成真实内容而非留空：
 * character-aura.ts 会把 skillContent 写成 SKILL.md，故事提取会读回它。
 */
function syntheticLegacySkill(book: BookAnalysisLibraryBook, character: ExtractedCharacter): CharacterSkill {
  const profile = character.personalityProfile
  return {
    id: `legacy-skill-${character.id}`,
    characterId: character.id,
    characterName: character.name,
    // 有富详情就用真实内容生成；没有就留空——留空时 aura 的字段仍由
    // buildGeneratedAuraInputFromBookCharacter 的散文字段兜底取到。
    skillContent: profile
      ? generateSimpleSkillMarkdown({ characterName: character.name, profile, sourceBook: book.metadata.title })
      : "",
    sourceBook: book.metadata.title,
    chapterRange: [`${character.firstAppearance}`, `${character.lastAppearance}`],
    createdAt: book.metadata.updatedAt,
  }
}

/**
 * 确保旧版（迁移）角色在自定义灵魂库里，返回它的 auraId／auraName。
 *
 * 为什么单独有这个函数（设计 §5.2「两条发布路径」）：旧版条目**不复用**
 * publishWorkbenchCharacter。那条路用的是就地合成的 ExtractedCharacter（没有
 * personalityProfile），且迁移条目的 evidence／coverage 是空的，workbenchSkillContent
 * 因此返回 ""，最终 createCustomCharacterAuraFromGeneratedSkill 会把空串写成 SKILL.md。
 * 只有 importBookAnalysisSkillsAsAuras 握有作品库里的真实角色，aura-adapter.ts:61 起
 * 「无人格块 → personalityProfile → 散文字段」的兜底链才会生效（情况 X/Y/Z 全覆盖）。
 *
 * 放在 workbench-publish.ts 而不是动作层，是因为 workbench-soul-actions.ts 已经
 * import 本模块——反向 import 会形成循环依赖。
 */
export async function ensureLegacyCharacterAura(
  projectPath: string, book: BookAnalysisLibraryBook, subject: string,
): Promise<{ auraId: string; auraName: string }> {
  const character = book.characters.find((c) => c.name === subject)
  if (!character) throw new Error(`找不到旧版角色「${subject}」`)
  const skill = book.skills.find((s) => s.characterId === character.id || s.characterName === character.name)
    ?? syntheticLegacySkill(book, character)
  const imported = await importBookAnalysisSkillsAsAuras(projectPath, book.metadata, book.characters, [skill], [skill.id])
  if (imported.length) return { auraId: imported[0].auraId, auraName: imported[0].auraName }
  // 已存在时该函数会跳过并返回空数组；必须查回既有 aura，
  // 否则「已入库但未绑定」的角色永远绑不上（设计 §5.1）。
  const store = await loadCharacterAuraStore(projectPath)
  const aura = store.customAuras.find((a) => isSameBookAnalysisCharacterAura(a, book.metadata.title, subject))
  if (!aura) throw new Error(`加入灵魂库失败：${subject}`)
  return { auraId: aura.id, auraName: aura.name }
}

export async function publishWorkbenchCharacter(
  projectPath: string,
  revision: WorkbenchRevision,
  item: WorkbenchItem,
  store?: { customAuras: CharacterAura[] },
): Promise<CharacterAura> {
  const skillContent = workbenchSkillContent(item, revision)
  const orders = revision.coverage.map((c) => c.order).filter((order) => Number.isFinite(order))
  const character: ExtractedCharacter = {
    id: `wb-${(await sha256Text(item.subject)).slice(0, 16)}`, name: item.subject, aliases: [], importance: 0, category: "supporting",
    // 迁移版本的 coverage 是空的：Math.min()/Math.max() 空参会得到 ±Infinity，
    // 而散文兜底链会把它读成「第 Infinity 章」。夹到 1。
    firstAppearance: orders.length ? Math.min(...orders) : 1, lastAppearance: orders.length ? Math.max(...orders) : 1,
    appearanceCount: 0, description: "", personality: item.summary, speechStyle: "", relationships: [], keyEvents: [],
  }
  const metadata: BookAnalysisMetadata = { title: revision.bookTitle, totalChapters: revision.selectedChapterIds.length, totalWords: 0, sourceType: "file", createdAt: revision.createdAt, updatedAt: Date.now() }
  const input = buildGeneratedAuraInputFromBookCharacter(character, {
    id: `skill-${character.id}`, characterId: character.id, characterName: character.name, skillContent,
    sourceBook: revision.bookTitle, chapterRange: revision.selectedChapterIds, createdAt: revision.createdAt,
  }, metadata)
  const auraStore = store ?? await loadCharacterAuraStore(projectPath)
  const existing = auraStore.customAuras.find((a) => isSameBookAnalysisCharacterAura(a, revision.bookTitle, item.subject))
  return existing ? await updateCustomCharacterAura(projectPath, existing.id, input)
    : await createCustomCharacterAuraFromGeneratedSkill(projectPath, input)
}

export async function confirmWorkbenchRevision(projectPath: string, bookPath: string, revisionId: string, expectedFingerprint: string, book?: BookAnalysisLibraryBook): Promise<WorkbenchRevision> {
  const key = `${projectPath}:${revisionId}`
  if (pending.has(key)) return pending.get(key)!
  const operation = (async () => {
    const revision = JSON.parse(await readFile(workbenchRevisionPath(bookPath, revisionId))) as WorkbenchRevision
    if (revision.confirmedAt) return revision
    // 旧版迁移版本可能没有任何结构化规则（六维路径的 Skill 不含便携人格块），
    // 但它仍有可发布内容——发布时走 buildGeneratedAuraInputFromBookCharacter 的
    // personalityProfile／散文字段兜底。因此只对有规则的新版版本保留这道门槛。
    if (!revision.items.some((item) => item.rules.length) && revision.origin !== "legacy") {
      throw new Error("没有有依据的规则可加入")
    }
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
      if (revision.origin === "legacy") {
        // 设计 §5.2：旧版条目「不复用上面这条」，必须走 importBookAnalysisSkillsAsAuras，
        // 否则旧版角色会拿到一个 SKILL.md 为空的灵魂。
        if (!book) throw new Error("旧版迁移版本发布需要作品资料")
        for (const subject of new Set(revision.items.map((item) => item.subject))) {
          publishedIds.push((await ensureLegacyCharacterAura(projectPath, book, subject)).auraId)
        }
      } else {
        const store = await loadCharacterAuraStore(projectPath)
        for (const item of revision.items.filter((item) => item.rules.length)) {
          const aura = await publishWorkbenchCharacter(projectPath, revision, item, store)
          store.customAuras = [...store.customAuras.filter((a) => a.id !== aura.id), aura]
          publishedIds.push(aura.id)
        }
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
