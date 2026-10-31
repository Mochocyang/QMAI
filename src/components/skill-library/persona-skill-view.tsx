import "@/components/uitest/ui-test-tools.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Search } from "lucide-react"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import {
  PERSONA_ARCHIVED_GAP_CHAPTERS,
  PERSONA_DORMANT_GAP_CHAPTERS,
  normalizePersonaName,
  resolvePersonaTier,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillSighting,
  type PersonaSkillStatus,
} from "@/lib/novel/persona-skill-types"
import {
  listPersonaSkillRevisions,
  loadPersonaSkillIndex,
  loadPersonaSightings,
  readPersonaSkillDocument,
  readPersonaSkillResearch,
  restorePersonaSkillRevision,
  savePersonaSkillDocumentByUser,
  updatePersonaSkillIndex,
} from "@/lib/novel/persona-skill-store"
import {
  createPersonaSkillByUser,
  demotePersonaSkillToSighting,
  deletePersonaSighting,
  promotePersonaSightingLocal,
  regeneratePersonaSkillResearch,
  savePersonaSkillProfileByUser,
} from "@/lib/novel/persona-skill-learning"
import { removePersonaFromProject } from "@/lib/novel/persona-outline-detach"
import { useWikiStore } from "@/stores/wiki-store"
import { PersonaCandidatePreview } from "./persona-candidate-preview"
import { PersonaPersonalityCreateForm } from "./persona-personality-create-form"
import { PersonaSkillProfilePanel } from "./persona-skill-profile-panel"

const STATUS_LABELS: Record<PersonaSkillStatus, string> = {
  active: "活跃",
  dormant: "潜伏",
  archived: "归档",
}

const TIER_LABELS = { major: "主要人物", minor: "次要人物" } as const
const STATUS_ORDER = ["all", "active", "dormant", "archived"] as const
type StatusFilter = (typeof STATUS_ORDER)[number]

/** 列表顺序：绿勾 → 出场次数多的 → 名字。注入用的顺序在 persona-skill-context.ts，两处口径不同是故意的。 */
function sortMeta(a: PersonaSkillMeta, b: PersonaSkillMeta): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.appearanceCount !== b.appearanceCount) return b.appearanceCount - a.appearanceCount
  return a.characterName.localeCompare(b.characterName, "zh-Hans-CN")
}


export interface PersonaSkillViewProps {
  /**
   * 中栏面板模式。人物搬回大纲后，左栏已经有「活跃角色 / 候选角色」树，
   * 面板里再显示旧的整页列表（搜索框 / 状态筛选 / 档案卡墙 / 候选折叠条）
   * 就是重复且多余的信息 —— 用户明确要求删掉。
   * 面板模式下没有选中对象时不渲染列表，只给一句空态提示。
   */
  paneMode?: boolean
}

export function PersonaSkillView({ paneMode = false }: PersonaSkillViewProps = {}) {
  const projectPath = useWikiStore((s) => s.project?.path)
  const setDraftDirty = useWikiStore((s) => s.setPersonaSkillLibraryDraftDirty)
  const bumpPersonaDataVersion = useWikiStore((s) => s.bumpPersonaDataVersion)
  const setPersonaOutlinePane = useWikiStore((s) => s.setPersonaOutlinePane)
  const personaOutlinePane = useWikiStore((s) => s.personaOutlinePane)

  const [index, setIndex] = useState<PersonaSkillIndex>({ version: 1, skills: [] })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [documentText, setDocumentText] = useState("")
  const [research, setResearch] = useState<Record<string, string>>({})
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [sightings, setSightings] = useState<PersonaSkillSighting[]>([])
  const [revisionCount, setRevisionCount] = useState(0)
  /** 每次保存成功 +1：让档案面板重置草稿态（只改定位时正文没变，靠 document 变化触发不了）。 */
  const [resetToken, setResetToken] = useState(0)
  /** 新建角色表单是否展开。由「新建人物角色」菜单置位，也允许用户在列表里自己发起。 */
  const [creating, setCreating] = useState(false)
  /** 中栏「候选预览」当前要看谁（C2）。null = 不在预览态。 */
  const [candidateFocus, setCandidateFocus] = useState<string | null>(null)
  /** 候选预览找不到数据时的补读守卫：同一名字只重试一次，避免无限重读。 */
  const candidateReloadTriedRef = useRef<string | null>(null)
  /** 候选人物默认折叠：9 张候选卡会把页面拉长一倍，先压成一条。 */
  const [candidatesOpen, setCandidatesOpen] = useState(false)

  const reload = useCallback(async () => {
    if (!projectPath) return
    const [loaded, loadedSightings] = await Promise.all([
      loadPersonaSkillIndex(projectPath),
      loadPersonaSightings(projectPath),
    ])
    setIndex({ version: 1, skills: [...loaded.skills].sort(sortMeta) })
    setSightings(loadedSightings.sightings)
  }, [projectPath])

  useEffect(() => {
    void reload()
  }, [reload])

  /*
   * 点候选进预览时，索引/候选池可能还没读完（面板刚挂载）。
   * 找不到就补读一次；只补一次，避免数据真的缺失时反复重读。
   */
  useEffect(() => {
    if (!candidateFocus) {
      candidateReloadTriedRef.current = null
      return
    }
    if (sightings.some((item) => item.characterName === candidateFocus)) return
    if (candidateReloadTriedRef.current === candidateFocus) return
    candidateReloadTriedRef.current = candidateFocus
    void reload()
  }, [candidateFocus, sightings, reload])

  /*
   * 「新建人物角色」菜单点进来时，store 里挂了一个一次性意图。
   * 读到就立刻清掉：意图只该起一次作用，否则用户关掉表单再切回本页，
   * 表单会莫名其妙自己又弹出来。
   */
  /*
   * 中栏面板模式：`personaOutlinePane` 说「要看谁 / 要新建」。
   * 这里只把它翻译成组件内部状态，**不清空它** ——
   * 它同时是「中栏正在显示人物面板」的持久状态：一旦清成 null，
   * WritingWorkspace 会立刻把中栏换回 PreviewPanel，面板刚挂载就被卸载，
   * 用户看到的就是「点角色没有任何反应」（用户实测过）。
   * 关闭面板由中栏右上角的「关闭」按钮负责。
   */
  useEffect(() => {
    if (!personaOutlinePane) return
    if (personaOutlinePane.mode === "create") {
      setSelectedId(null)
      setCreating(true)
      setCandidateFocus(null)
    } else if (personaOutlinePane.mode === "persona") {
      setSelectedId(personaOutlinePane.id)
      setCreating(false)
      setCandidateFocus(null)
    } else if (personaOutlinePane.mode === "candidate") {
      // 候选没有档案，但有轻量预览：出场分布 + 章节原句。
      setSelectedId(null)
      setCreating(false)
      setCandidateFocus(personaOutlinePane.name)
    } else {
      setSelectedId(null)
      setCreating(false)
      setCandidateFocus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaOutlinePane])

  useEffect(() => {
    if (!useWikiStore.getState().personaSkillCreateRequested) return
    useWikiStore.getState().setPersonaSkillCreateRequested(false)
    setSelectedId(null)
    setCreating(true)
  }, [])

  useEffect(() => {
    if (!projectPath || !selectedId) {
      setDocumentText("")
      setResearch({})
      setRevisionCount(0)
      return
    }
    let cancelled = false
    void (async () => {
      const [document, docs, revisions] = await Promise.all([
        readPersonaSkillDocument(projectPath, selectedId),
        readPersonaSkillResearch(projectPath, selectedId),
        listPersonaSkillRevisions(projectPath, selectedId),
      ])
      if (cancelled) return
      setDocumentText(document)
      setResearch(docs)
      setRevisionCount(revisions.length)
      setDraftDirty(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, selectedId, setDraftDirty])

  const selected = useMemo(
    () => index.skills.find((meta) => meta.id === selectedId) ?? null,
    [index.skills, selectedId],
  )

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return index.skills.filter((meta) => {
      if (statusFilter !== "all" && meta.status !== statusFilter) return false
      if (!keyword) return true
      return meta.characterName.toLowerCase().includes(keyword)
    })
  }, [index.skills, query, statusFilter])

  const counts = useMemo(() => ({
    all: index.skills.length,
    active: index.skills.filter((meta) => meta.status === "active").length,
    dormant: index.skills.filter((meta) => meta.status === "dormant").length,
    archived: index.skills.filter((meta) => meta.status === "archived").length,
  }), [index.skills])

  // 只读分析：规则只看已持久化的字段（appearanceCount / status），不引章号、
  // 不调 resolvePersonaStatus —— 视图只展示学习侧写下的结论，绝不重算状态。
  const analysisRows = useMemo(
    () =>
      index.skills.filter(
        (meta) =>
          meta.appearanceCount <= 1 || meta.status === "dormant" || meta.status === "archived",
      ),
    [index.skills],
  )

  async function handlePromote(sighting: PersonaSkillSighting) {
    if (!projectPath) return
    setBusy(true)
    try {
      /*
       * 建档**不调模型**：用户点一下就该立刻看到结果。
       * 旧路径要先让模型读章节生成整份档案，模型没配置/超时/返回空时界面什么都不会变，
       * 用户点完只觉得「这个按钮没用」。内容留给下一次「提取记忆」或用户自己补。
       */
      const created = await promotePersonaSightingLocal({
        projectPath,
        characterName: sighting.characterName,
      })
      if (created) {
        // 建档成功后别再停在预览卡上：直接打开这份新档案，用户才看得到「确实生效了」。
        setCandidateFocus(null)
        setSelectedId(created.id)
        await reload()
      bumpPersonaDataVersion()
        setMessage(`已把「${sighting.characterName}」建档。档案内容会在下次「提取记忆」时自动补齐，也可以自己填。`)
      } else {
        setMessage(`「${sighting.characterName}」在建档时找不到了，可能已被别处处理，请刷新后再试。`)
      }
    } catch (err) {
      setMessage(`「${sighting.characterName}」建档失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 把误建档的人物退回候选区。这条路径存在的唯一理由，就是候选区那个动作
   * **只有建档、没有反悔**：一旦建成，候选池里的记录会被删掉，用户再也回不去。
   */
  async function handleDemote(meta: PersonaSkillMeta) {
    if (!projectPath) return
    if (
      !window.confirm(
        `把「${meta.characterName}」退回候选人物（未建档）吗？\n\n` +
          "档案会从技能库移除，出场次数与章节记录保留到候选区；\n" +
          "已经写进档案的内容会在下次建档时重新生成。",
      )
    ) {
      return
    }
    setBusy(true)
    try {
      const ok = await demotePersonaSkillToSighting({
        projectPath,
        characterName: meta.characterName,
      })
      if (ok) {
        if (selectedId === meta.id) handleBack()
        await reload()
        // 左栏与中栏是两份副本：不 bump，左栏「活跃角色」里还会留着这个人（用户实测）。
        bumpPersonaDataVersion()
        // 退回候选后停在候选预览上，也不再落到那套旧列表页。
        setPersonaOutlinePane({ mode: "candidate", name: meta.characterName })
        setMessage(`已把「${meta.characterName}」退回候选人物。`)
      } else {
        setMessage(`「${meta.characterName}」退回候选失败：没有找到对应的档案。`)
      }
    } catch (err) {
      setMessage(`「${meta.characterName}」退回候选失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 删除候选人物。
   * 同时写进带忽略名单 —— 候选池是每章重新数出来的，只删当下这一条，
   * 下次「提取记忆」就会把它加回来，删除按钮等于假的。
   */
  async function handleDeleteSighting(sighting: PersonaSkillSighting) {
    if (!projectPath) return
    const confirmed = window.confirm(
      `确定删除候选人物「${sighting.characterName}」吗？\n\n之后提取记忆也不会再把它加回候选区（已建档的角色不受影响）。`
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const removed = await deletePersonaSighting({
        projectPath,
        characterName: sighting.characterName,
      })
      await reload()
      bumpPersonaDataVersion()
      setMessage(
        removed
          ? `已删除候选「${sighting.characterName}」，以后不会再出现在候选区。`
          : `候选「${sighting.characterName}」已经不在了，请刷新后再试。`
      )
    } finally {
      setBusy(false)
    }
  }

  /** 标记 / 取消「重要人物」（绿勾）。与左栏右键菜单是同一件事。 */
  async function handleToggleImportant(meta: PersonaSkillMeta, next: boolean) {
    if (!projectPath) return
    setBusy(true)
    try {
      await updatePersonaSkillIndex(projectPath, (current) => ({
        version: 1,
        skills: current.skills.map((item) =>
          item.id === meta.id
            ? {
                ...item,
                pinned: next,
                tier: resolvePersonaTier(item.roleType, next),
                status: next ? ("active" as const) : item.status,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }))
      await reload()
      bumpPersonaDataVersion()
    } finally {
      setBusy(false)
    }
  }

  /** 切换「随章节自动更新」。只改索引，不动正文。 */
  async function handleToggleAutoUpdate(meta: PersonaSkillMeta, next: boolean) {
    if (!projectPath) return
    setBusy(true)
    try {
      await updatePersonaSkillIndex(projectPath, (current) => ({
        version: 1,
        skills: current.skills.map((item) =>
          item.id === meta.id ? { ...item, autoUpdate: next, updatedAt: new Date().toISOString() } : item,
        ),
      }))
      await reload()
      bumpPersonaDataVersion()
      setMessage(
        next
          ? `「${meta.characterName}」已开启随章节自动更新。`
          : `「${meta.characterName}」已关闭自动更新，档案不会再被改写。`
      )
    } finally {
      setBusy(false)
    }
  }

  /**
   * 删除角色 = 从人物列表移除。
   * 只动索引，不删磁盘：`.qmai/persona-skills/<名>/` 留着，需要彻底清理时可手工删目录。
   * 「误删目录」不可逆，所以宁可留文件，也不给一个删了找不回来的按钮。
   */
  async function handleDeletePersona(meta: PersonaSkillMeta) {
    if (!projectPath) return
    const confirmed = window.confirm(
      `确定从人物列表删除「${meta.characterName}」吗？\n\n档案文件仍会保留在项目里，不会删盘。`
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const removed = await removePersonaFromProject(projectPath, [meta.characterName])
      setSelectedId(null)
      await reload()
      bumpPersonaDataVersion()
      setMessage(
        removed.length > 0
          ? `已从人物列表删除「${meta.characterName}」，档案文件仍保留在项目中。`
          : `「${meta.characterName}」没有删掉，可能已经不在了。`
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleTogglePin(meta: PersonaSkillMeta) {
    if (!projectPath) return
    const pinned = !meta.pinned
    setBusy(true)
    try {
      // 走 updatePersonaSkillIndex：读-改-写在同一把锁内。
      // 否则用户点绿勾的同时后台学习正在写 index，两边各自基于旧快照写回，会互相覆盖。
      const updated = await updatePersonaSkillIndex(projectPath, (current) => ({
        version: 1,
        skills: current.skills
          .map((item) =>
            item.id === meta.id
              ? {
                  ...item,
                  pinned,
                  tier: resolvePersonaTier(item.roleType, pinned),
                  status: pinned ? ("active" as const) : item.status,
                  updatedAt: new Date().toISOString(),
                }
              : item,
          )
          .sort(sortMeta),
      }))
      setIndex(updated)
      setMessage(
        pinned
          ? `已把「${meta.characterName}」标为重要人物：每章都会重点分析，下次出场时生成研究文件。`
          : `已取消「${meta.characterName}」的重要标记。`,
      )
    } catch (err) {
      // updatePersonaSkillIndex 内部用的是严格读：索引文件损坏或读不出来时它会抛，
      // 目的是拒绝用空索引覆盖整库。这里必须接住并告诉用户，
      // 否则点击只会变成一条无人处理的 Promise 拒绝，界面毫无反应。
      setMessage(`标记没保存成功：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 新建人物角色。
   *
   * 走 createPersonaSkillByUser 而不是 savePersonaSkillProfileByUser：
   * 后者要求 id 已存在（它是「改档案」），前者才是「建档」。
   * origin 用默认的 manual —— 这是用户亲手建的，删大纲时不该被连带删掉。
   */
  async function handleCreatePersona(input: {
    characterName: string
    roleType: string
    fields: Record<string, string>
    boundSoul: string
  }) {
    if (!projectPath) return
    setBusy(true)
    try {
      const created = await createPersonaSkillByUser({
        projectPath,
        characterName: input.characterName,
        roleType: input.roleType,
        fields: input.fields,
        llmConfig: null,
        boundSoul: input.boundSoul || undefined,
      })
      await reload()
      setCreating(false)
      setSelectedId(created.id)
      setMessage(`已创建「${input.characterName}」。之后 AI 只会更新文末的「补充」段，不会覆盖你写的内容。`)
    } catch (err) {
      setMessage(`创建失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 保存「原始 Markdown」页签的内容。
   *
   * 一次调用完成「写正文 + 置 editedByUser」：两者必须在同一把锁内，
   * 否则后台学习可能正好挤在中间，按「没被改过」把刚写的正文覆盖掉。
   */
  async function handleSaveDocument(text: string) {
    if (!projectPath || !selected) return
    setBusy(true)
    try {
      const updated = await savePersonaSkillDocumentByUser(projectPath, selected.id, text)
      setIndex(updated)
      setDocumentText(text)
      setRevisionCount((await listPersonaSkillRevisions(projectPath, selected.id)).length)
      setResetToken((token) => token + 1)
      setDraftDirty(false)
      setMessage("已保存。之后 AI 只会更新文末的「补充」段，不会覆盖你写的内容。")
    } catch (err) {
      // 同上：严格读会抛。这一条尤其不能吞——用户以为存下来了、其实没有，
      // 而且是「不改 draftDirty」的状态，草稿还在，可以重试。
      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 保存结构化档案（基础设定 / 演技字段 / 关系网 + 定位）。
   *
   * 正文由 `applyPersonaProfileEdits` 重建：frontmatter、H1、自定义分区与
   * 「补充」段都在原文档上保留，不是从表单从零拼一份 —— 那会把用户写在原文里
   * 的其它段整段抹掉。
   */
  async function handleSaveProfile(input: { fields: Record<string, string>; roleType: string }) {
    if (!projectPath || !selected) return
    setBusy(true)
    try {
      const updated = await savePersonaSkillProfileByUser({
        projectPath,
        id: selected.id,
        fields: input.fields,
        roleType: input.roleType,
      })
      setIndex(updated)
      setDocumentText(await readPersonaSkillDocument(projectPath, selected.id))
      setRevisionCount((await listPersonaSkillRevisions(projectPath, selected.id)).length)
      setResetToken((token) => token + 1)
      setDraftDirty(false)
      setMessage(
        input.roleType !== selected.roleType
          ? `已保存。定位改为「${input.roleType || "未标注"}」，档位随之变成${TIER_LABELS[resolvePersonaTier(input.roleType, selected.pinned)]}。`
          : "已保存。之后 AI 只会更新文末的「补充」段，不会覆盖你写的内容。",
      )
    } catch (err) {
      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  /** 关系网里点到一个人：他身上有档案就跳过去。 */
  function handleOpenCharacter(name: string) {
    const key = normalizePersonaName(name)
    const target = index.skills.find(
      (meta) =>
        normalizePersonaName(meta.characterName) === key ||
        meta.aliases.some((alias) => normalizePersonaName(alias) === key),
    )
    if (target) {
      setSelectedId(target.id)
      setMessage("")
    }
  }

  function hasCharacter(name: string): boolean {
    const key = normalizePersonaName(name)
    return index.skills.some(
      (meta) =>
        normalizePersonaName(meta.characterName) === key ||
        meta.aliases.some((alias) => normalizePersonaName(alias) === key),
    )
  }

  async function handleRestoreRevision() {
    if (!projectPath || !selected) return
    setBusy(true)
    try {
      const restored = await restorePersonaSkillRevision(projectPath, selected.id)
      if (!restored) {
        setMessage("没有可回退的历史版本。")
        return
      }
      setIndex({ version: 1, skills: [...restored.index.skills].sort(sortMeta) })
      setDocumentText(restored.document)
      setRevisionCount((await listPersonaSkillRevisions(projectPath, selected.id)).length)
      setDraftDirty(false)
      setMessage("已回退到上一版。")
    } catch (err) {
      setMessage(`回退失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleRegenerateResearch() {
    if (!projectPath || !selected) return
    setBusy(true)
    try {
      const state = useWikiStore.getState()
      const ok = await regeneratePersonaSkillResearch({
        projectPath,
        characterName: selected.characterName,
        llmConfig: resolveNovelModel(state.llmConfig, state.novelConfig, "extract"),
      })
      setResearch(await readPersonaSkillResearch(projectPath, selected.id))
      setMessage(ok ? "研究文件已重新整理。" : "研究文件整理失败：模型没有返回可整理的内容。")
    } finally {
      setBusy(false)
    }
  }

  function handleBack() {
    setSelectedId(null)
    setDocumentText("")
    setResearch({})
    setDraftDirty(false)
    setMessage("")
  }

  if (!projectPath) {
    return <div className="ui-test-skills-empty">先打开一本书，再管理人物 Skill。</div>
  }

  /*
   * 新建模式整页渲染：**不能**和列表挤在一起。
   * 早先把它放在列表工具栏下面，用户看到的是「搜索框 + 筛选按钮 + 一个巨大表单」
   * 叠在同一屏，既不知道自己在列表还是在新建，也得滚很久才看到字段。
   * 与「点开一个角色」同构：进入就是完整一页，返回即回列表。
   */
  if (creating) {
    return (
      <PersonaPersonalityCreateForm
        busy={busy}
        message={message}
        hasCharacter={hasCharacter}
        onCancel={() => {
          setCreating(false)
          setMessage("")
        }}
        onSubmit={(input) => void handleCreatePersona(input)}
      />
    )
  }
  /*
   * 候选预览：候选没有档案，但它有出场分布与原句可看。
   * 找不到对应候选时（例如数据还没读完）也停在面板里，
   * 不要往下掉进「角色档案」或「整页列表」——那会让点候选看起来像点错了地方。
   */
  if (candidateFocus) {
    const sighting = sightings.find((item) => item.characterName === candidateFocus)
    return (
      <div data-testid="persona-skill-view" className="ui-test-skills-gallery ui-test-gdoc">
        <div className="ui-test-gbody">
          <div className="ui-test-gbody-inner">
            {sighting ? (
              <PersonaCandidatePreview
                projectPath={projectPath}
                sighting={sighting}
                busy={busy}
                message={message}
                onPromote={() => void handlePromote(sighting)}
                onDelete={() => void handleDeleteSighting(sighting)}
              />
            ) : (
              <div className="ui-test-pdoc-empty-pane" data-testid="persona-pane-empty" />
            )}
          </div>
        </div>
      </div>
    )
  }


  if (selected) {
    return (
      <PersonaSkillProfilePanel
        meta={selected}
        document={documentText}
        research={research}
        revisionCount={revisionCount}
        resetToken={resetToken}
        busy={busy}
        message={message}
        onBack={handleBack}
        onDirtyChange={setDraftDirty}
        onSaveProfile={(input) => void handleSaveProfile(input)}
        onSaveRaw={(text) => void handleSaveDocument(text)}
        onRestoreRevision={() => void handleRestoreRevision()}
        onRegenerateResearch={() => void handleRegenerateResearch()}
        onOpenCharacter={handleOpenCharacter}
        hasCharacter={hasCharacter}
        projectPath={projectPath}
        onDemote={() => void handleDemote(selected)}
        onToggleImportant={(next) => void handleToggleImportant(selected, next)}
        onToggleAutoUpdate={(next) => void handleToggleAutoUpdate(selected, next)}
        onDeletePersona={() => void handleDeletePersona(selected)}
      />
    )
  }

  /*
   * 面板模式下没有选中对象时不渲染旧的整页列表：左栏已经承担列表职责，
   * 两处都显示只会让人不知道该看哪个。这里留一块空白，不写指引文案。
   */
  if (paneMode) {
    return (
      <div data-testid="persona-skill-view" className="ui-test-skills-gallery ui-test-gdoc">
        <div className="ui-test-gbody">
          <div className="ui-test-gbody-inner">
            <div className="ui-test-pdoc-empty-pane" data-testid="persona-pane-empty" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="persona-skill-view" className="ui-test-skills-gallery ui-test-pdoc">
      <div className="ui-test-pdoc-scroll">
        <div className="ui-test-pdoc-inner">
      <div className="ui-test-skills-toolbar">
        <label className="ui-test-skills-search">
          <Search />
          <input
            data-testid="persona-skill-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索人物名"
          />
        </label>
        <button
          type="button"
          data-testid="persona-skill-create-toggle"
          onClick={() => setCreating(true)}
          className="ui-test-skills-action is-primary"
        >
          新建人物角色
        </button>
        <div className="ui-test-skills-chips">
          {STATUS_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={statusFilter === key}
              onClick={() => setStatusFilter(key)}
              className={`ui-test-skills-chip${statusFilter === key ? " is-active" : ""}`}
            >
              {key === "all" ? `全部 ${counts.all}` : `${STATUS_LABELS[key]} ${counts[key]}`}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="persona-skill-analysis-toggle"
          aria-pressed={analysisOpen}
          onClick={() => setAnalysisOpen((open) => !open)}
          className={`ui-test-skills-chip${analysisOpen ? " is-active" : ""}`}
        >
          出场频次分析
        </button>
      </div>

      {message ? <span className="ui-test-skills-message">{message}</span> : null}

      {analysisOpen ? (
        <section data-testid="persona-skill-analysis" className="ui-test-skills-section">
          <h4 className="ui-test-skills-section-title">出场频次分析</h4>
          <p className="ui-test-skills-section-hint">
            连续 {PERSONA_DORMANT_GAP_CHAPTERS} 章未出场=潜伏，{PERSONA_ARCHIVED_GAP_CHAPTERS} 章=建议归档
          </p>
          {analysisRows.length === 0 ? (
            <p className="ui-test-skills-empty">没有需要关注的人物。</p>
          ) : (
            <div className="ui-test-skills-grid">
              {analysisRows.map((meta) => (
                <article
                  key={meta.id}
                  data-testid={`persona-skill-analysis-${meta.id}`}
                  className="ui-test-skill-card"
                >
                  <header className="ui-test-skill-card-head">
                    <h3 className="ui-test-skill-card-name" title={meta.characterName}>
                      {meta.characterName}
                    </h3>
                  </header>
                  <div className="ui-test-skill-card-badges">
                    <span className="ui-test-skill-badge is-type">{TIER_LABELS[meta.tier]}</span>
                        <span className="ui-test-skill-badge">首次第 {meta.firstChapter} 章</span>
                    <span className="ui-test-skill-badge">最近第 {meta.lastChapter} 章</span>
                    <span className="ui-test-skill-badge">{STATUS_LABELS[meta.status]}</span>
                    {meta.status === "archived" ? (
                      <span className="ui-test-skill-badge is-type">建议归档</span>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {visible.length === 0 ? (
        <div className="ui-test-skills-empty">
          {index.skills.length === 0
            ? "还没有人物 Skill。点章节工具栏的「提取记忆」时，AI 会自动为主要人物建档。"
            : "没有匹配的人物。"}
        </div>
      ) : (
        <div className="ui-test-skills-grid">
          {visible.map((meta) => (
            <article
              key={meta.id}
              data-testid={`persona-skill-card-${meta.id}`}
              className="ui-test-skill-card"
            >
              <header className="ui-test-skill-card-head">
                <div className="ui-test-persona-card-headtext">
                  <span className="ui-test-persona-card-avatar" aria-hidden="true">
                    {meta.characterName.slice(0, 1)}
                  </span>
                  <div className="ui-test-persona-card-meta">
                    <h3 className="ui-test-skill-card-name" title={meta.characterName}>
                      {meta.characterName}
                    </h3>
                    <span className="ui-test-persona-card-sub">
                      出场 {meta.appearanceCount} 次 · 最近第 {meta.lastChapter} 章
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`persona-skill-pin-${meta.id}`}
                  aria-pressed={meta.pinned}
                  aria-label={meta.pinned ? "取消重要人物标记" : "标为重要人物"}
                  title="绿勾 = 重要人物：每章重点分析，并生成研究文件"
                  onClick={() => void handleTogglePin(meta)}
                  className={`ui-test-persona-pin${meta.pinned ? " is-on" : ""}`}
                />
              </header>
              <div className="ui-test-skill-card-badges">
                <span className="ui-test-skill-badge is-type">{TIER_LABELS[meta.tier]}</span>
                <span className="ui-test-skill-badge">{STATUS_LABELS[meta.status]}</span>
                {meta.roleType ? <span className="ui-test-skill-badge">{meta.roleType}</span> : null}
                <span className="ui-test-skill-badge">出场 {meta.appearanceCount} 次</span>
                {meta.editedByUser ? <span className="ui-test-skill-badge">已手改</span> : null}
                {meta.hasResearch ? <span className="ui-test-skill-badge">有研究文件</span> : null}
              </div>
              <div className="ui-test-skills-actions">
                <button
                  type="button"
                  className="ui-test-skills-action is-primary"
                  onClick={() => setSelectedId(meta.id)}
                >
                  打开档案
                </button>
                <button
                  type="button"
                  data-testid={`persona-skill-demote-${meta.id}`}
                  className="ui-test-skills-action"
                  title="退回「候选人物（未建档）」，撤销误建档"
                  onClick={() => void handleDemote(meta)}
                  disabled={busy}
                >
                  移回候选
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section data-testid="persona-skill-candidates" className="ui-test-skills-section">
        <div className="ui-test-skills-section-head">
          <h4 className="ui-test-skills-section-title">候选人物（未建档）</h4>
          {sightings.length > 0 ? (
            <button
              type="button"
              data-testid="persona-skill-candidates-toggle"
              className="ui-test-skills-action is-small"
              aria-expanded={candidatesOpen}
              onClick={() => setCandidatesOpen((open) => !open)}
            >
              {candidatesOpen ? "收起" : `展开 ${sightings.length} 位`}
            </button>
          ) : null}
        </div>
        <p className="ui-test-skills-section-hint">
          这些名字在章节里出现过但还没建档。建档后移到上方档案区，可用「移回候选」撤销。
        </p>
        {sightings.length === 0 ? (
          <p className="ui-test-skills-empty">暂无候选人物</p>
        ) : !candidatesOpen ? (
          <div className="ui-test-skills-collapsed">
            <b>{sightings.length} 位候选</b>
            <span className="names">{sightings.slice(0, 8).map((s) => s.characterName).join(" · ")}</span>
            {sightings.length > 8 ? <span className="more">等 {sightings.length} 位</span> : null}
          </div>
        ) : (
          <div className="ui-test-skills-grid">
            {sightings.map((sighting) => (
              <article
                key={sighting.characterName}
                data-testid={`persona-skill-candidate-${sighting.characterName}`}
                className="ui-test-skill-card"
              >
                <header className="ui-test-skill-card-head">
                  <div className="ui-test-persona-card-headtext">
                    <span className="ui-test-persona-card-avatar" aria-hidden="true">
                      {sighting.characterName.slice(0, 1)}
                    </span>
                    <div className="ui-test-persona-card-meta">
                      <h3 className="ui-test-skill-card-name" title={sighting.characterName}>
                        {sighting.characterName}
                      </h3>
                      <span className="ui-test-persona-card-sub">候选 · 出场 {sighting.appearanceCount} 章</span>
                    </div>
                  </div>
                </header>
                <div className="ui-test-skill-card-badges">
                  {sighting.aliases.length > 0 ? (
                    <span className="ui-test-skill-badge">别名：{sighting.aliases.join("、")}</span>
                  ) : null}
                  <span className="ui-test-skill-badge">出场 {sighting.appearanceCount} 章</span>
                  <span className="ui-test-skill-badge">首次第 {sighting.firstChapter} 章</span>
                  <span className="ui-test-skill-badge">最近第 {sighting.lastChapter} 章</span>
                </div>
                {/*
                  这里原先复用了档案卡那枚绿勾（class 写死 is-on），于是渲染出来
                  永远是「已勾选」——它看着像重要角色开关，实际是「立即建档」动作，
                  而且没有取消分支。用户点它就是想把勾取消掉，结果只得到一次建档，
                  人还从候选区消失。改成一个说清后果的按钮。
                */}
                <div className="ui-test-skills-actions">
                  <button
                    type="button"
                    data-testid={`persona-skill-delete-sighting-${sighting.characterName}`}
                    className="ui-test-skills-action is-danger"
                    title="从候选区删除，且以后提取记忆不再加回"
                    onClick={() => void handleDeleteSighting(sighting)}
                    disabled={busy}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    data-testid={`persona-skill-promote-${sighting.characterName}`}
                    className="ui-test-skills-action is-primary"
                    title="建档后这个人会移到上方档案区，并标为重要角色；可用「移回候选」撤销"
                    onClick={() => void handlePromote(sighting)}
                    disabled={busy}
                  >
                    建档
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
        </div>
      </div>
    </div>
  )
}
