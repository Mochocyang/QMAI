/**
 * 从拆书结果中删除单个条目 —— 并「连使用库一起真删」。
 *
 * 用户诉求（docs/workbench-simplify-20261007/design.html §6）：分析结果自动入库后，
 * 结果面板不再有整版「确认并加入」，改成每张卡片上一个删除按钮 + 确认弹窗；
 * 删除要真删使用库里的对应条目，同时把 subject 记进版本的 removedSubjects，
 * 这样重新打开页面不会又把已删卡片渲染回来。
 *
 * 三技能页的库条目粒度不同（这是本模块存在的理由，不是可以合并的分支）：
 *  - characters：一个对象 = 一个角色灵魂，删谁删谁
 *  - style     ：整版只生成 1 个文风预设，删任一对象 = 删整个预设
 *  - story     ：整版只生成 1 个故事框架，删任一对象 = 删整个框架
 */
import { sanitizeRemovedSubjects, type WorkbenchRevision } from "./workbench-core"
import { loadWorkbenchRevisions, saveWorkbenchRevision, withWorkbenchRevisionLock } from "./workbench-storage"
import { workbenchAuraId } from "./workbench-publish"
import { deleteCustomCharacterAura, loadCharacterAuraStore } from "../character-aura"
import { removePlotFramework } from "../plot-framework-library"
import { removeWritingStylePresetBySourceBook } from "../writing-style-store"
import { isSameBookAnalysisCharacterAura } from "./aura-match"

/** 故事框架的 id 是确定性的（workbench-publish 发布时用同一表达式）。 */
export function workbenchStoryFrameworkId(bookId: string): string {
  return `wb-story-${bookId}`
}

export interface RemoveWorkbenchItemInput {
  projectPath: string
  bookPath: string
  revision: WorkbenchRevision
  subject: string
}

/**
 * 删除某个拆书角色在灵魂库里的条目。
 *
 * 为什么不能只用 workbenchAuraId(subject)：该推导值**不是 aura 的主键**。
 * aura 的 id 由 createCustomCharacterAuraFromGeneratedSkill 生成
 * （character-aura.ts:432 `custom-${now}-${random}`），而 publishWorkbenchCharacter 里
 * 那个 `wb-${sha256}` 只赋给一个从不外传的临时 ExtractedCharacter.id。
 * deleteCustomCharacterAura 又是按 id 精确过滤、查不到也不抛错——
 * 只按推导值删会「静默成功」：卡片消失、灵魂仍在库里。
 *
 * 所以这里先用与发布完全相同的同源判据 isSameBookAnalysisCharacterAura
 * （workbench-publish.ts 找 existing 用的就是它）解析出真实条目。
 * 而且**有名字就全删**：同一个 (书名, 角色名) 在库里可能留下多条（历史重复导入、
 * 或书名被改过而旧备注仍在），只删 find 到的第一条会留下删不掉的同名残留。
 * 一条都匹配不上才退回推导值调一次，保持「删不存在的目标不抛错」。
 */
async function removeCharacterAura(projectPath: string, bookTitle: string, subject: string): Promise<string[]> {
  const deterministicId = await workbenchAuraId(subject)
  const store = await loadCharacterAuraStore(projectPath)
  const targets = new Set(
    store.customAuras
      .filter((aura) => isSameBookAnalysisCharacterAura(aura, bookTitle, subject))
      .map((aura) => aura.id),
  )
  if (store.customAuras.some((aura) => aura.id === deterministicId)) targets.add(deterministicId)
  const auraIds = targets.size ? [...targets] : [deterministicId]
  // deleteCustomCharacterAura 每次自行 load+save 并连带解除绑定，逐个调用是安全的。
  for (const auraId of auraIds) await deleteCustomCharacterAura(projectPath, auraId)
  return auraIds
}

export async function removeWorkbenchRevisionItem(
  input: RemoveWorkbenchItemInput,
): Promise<WorkbenchRevision> {
  const { projectPath, bookPath, revision, subject } = input
  /*
   * 整段包在版本锁里，并且以**盘上最新内容**为基准。
   *
   * 调用方传来的是组件的 React 快照，随时可能已经过期（自动入库刚写回 confirmedAt、
   * 上一次删除刚写进 removedSubjects）。用过快照整份写回会把这些更新抹掉，
   * 而这里要改的正好是同一个 JSON —— 丢更新的症状就是「删了又回来」。
   *
   * 版本还没落盘的情况（旧版迁移条目是懒落盘的）读不到，此时才退回调用方的快照。
   * 注意：这种情况下**仍然会落盘**（见下方注释），这是对「懒落盘」契约的一处
   * 有意扩展 —— 不落盘的话 removedSubjects 无从保存，被删的旧版角色下次打开又会
   * 被 buildLegacyCharacterRevision 重新造出来，正是用户抱怨的「删了又回来」。
   */
  return withWorkbenchRevisionLock(bookPath, revision.id, async () => {
    const stored = await loadWorkbenchRevisions(bookPath).catch(() => [] as WorkbenchRevision[])
    const base = stored.find((item) => item.id === revision.id) ?? revision

    let removedSubjects: string[]
    /*
     * publishedIds 是「本版发布过哪些库条目」的历史记录。条目被用户真删之后，
     * 留着已删的 id 会让它变成悬空引用（book-analysis-workbench 用
     * publishedIds.includes(id) 反查文风预设）。所以这里一并回收：
     *  - characters：只回收本次真删掉的那几个 aura id；
     *  - style / story：整版只有一个库条目且已被删，全部回收。
     */
    let dropPublished: (id: string) => boolean
    if (base.skill === "characters") {
      const deleted = new Set(await removeCharacterAura(projectPath, base.bookTitle, subject))
      removedSubjects = [subject]
      dropPublished = (id) => deleted.has(id)
    } else if (base.skill === "style") {
      // 整版只有一个文风预设：删任一对象即删整版，并把该版本全部对象都记进 removedSubjects，
      // 否则会出现「预设已删、同版另一个对象还显示着」的不一致状态。
      await removeWritingStylePresetBySourceBook(projectPath, base.bookTitle)
      removedSubjects = base.items.map((item) => item.subject)
      dropPublished = () => true
    } else if (base.skill === "story") {
      await removePlotFramework(projectPath, workbenchStoryFrameworkId(base.bookId))
      removedSubjects = base.items.map((item) => item.subject)
      dropPublished = () => true
    } else {
      // 静默什么都不做最危险：库没删、记录也没写，调用方却以为删成功。
      throw new Error(`未知技能页「${base.skill}」，无法删除条目`)
    }

    const next: WorkbenchRevision = {
      ...base,
      // sanitizeRemovedSubjects 顺带完成去重，因此重复删除是幂等的。
      removedSubjects: sanitizeRemovedSubjects([...(base.removedSubjects ?? []), ...removedSubjects]),
      ...(base.publishedIds ? { publishedIds: base.publishedIds.filter((id) => !dropPublished(id)) } : {}),
    }
    await saveWorkbenchRevision(bookPath, next)
    return next
  })
}
