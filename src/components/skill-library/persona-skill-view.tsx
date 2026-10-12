import "@/components/uitest/ui-test-tools.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, RefreshCw, Search } from "lucide-react"
import { resolveNovelModel } from "@/lib/novel/model-resolver"
import {
  PERSONA_ARCHIVED_GAP_CHAPTERS,
  PERSONA_DORMANT_GAP_CHAPTERS,
  resolvePersonaTier,
  type PersonaSkillIndex,
  type PersonaSkillMeta,
  type PersonaSkillSighting,
  type PersonaSkillStatus,
} from "@/lib/novel/persona-skill-types"
import {
  loadPersonaSkillIndex,
  loadPersonaSightings,
  readPersonaSkillDocument,
  readPersonaSkillResearch,
  savePersonaSkillDocumentByUser,
  updatePersonaSkillIndex,
} from "@/lib/novel/persona-skill-store"
import { demotePersonaSkillToSighting, promotePersonaSighting, regeneratePersonaSkillResearch } from "@/lib/novel/persona-skill-learning"
import { useWikiStore } from "@/stores/wiki-store"

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

export function PersonaSkillView() {
  const projectPath = useWikiStore((s) => s.project?.path)
  const setDraftDirty = useWikiStore((s) => s.setPersonaSkillLibraryDraftDirty)

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

  useEffect(() => {
    if (!projectPath || !selectedId) {
      setDocumentText("")
      setResearch({})
      return
    }
    let cancelled = false
    void (async () => {
      const [document, docs] = await Promise.all([
        readPersonaSkillDocument(projectPath, selectedId),
        readPersonaSkillResearch(projectPath, selectedId),
      ])
      if (cancelled) return
      setDocumentText(document)
      setResearch(docs)
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
      const state = useWikiStore.getState()
      const ok = await promotePersonaSighting({
        projectPath,
        characterName: sighting.characterName,
        llmConfig: resolveNovelModel(state.llmConfig, state.novelConfig, "extract"),
      })
      if (ok) {
        await reload()
        setMessage(`已把「${sighting.characterName}」建档，并从候选区移到上方档案区。`)
      } else {
        setMessage(`「${sighting.characterName}」建档失败：模型没有返回可用的内容，可稍后重试。`)
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

  async function handleSaveDocument() {
    if (!projectPath || !selected) return
    setBusy(true)
    try {
      // 一次调用完成「写正文 + 置 editedByUser」：两者必须在同一把锁内，
      // 否则后台学习可能正好挤在中间，按「没被改过」把刚写的正文覆盖掉。
      const updated = await savePersonaSkillDocumentByUser(projectPath, selected.id, documentText)
      setIndex(updated)
      setDraftDirty(false)
      setMessage("已保存。之后 AI 只会在这份档案后面追加「补充」，不会覆盖你写的内容。")
    } catch (err) {
      // 同上：严格读会抛。这一条尤其不能吞——用户以为存下来了、其实没有，
      // 而且是「不改 draftDirty」的状态，草稿还在，可以重试。
      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}`)
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

  if (selected) {
    return (
      <div data-testid="persona-skill-view" className="ui-test-skills-gallery">
        <button type="button" className="ui-test-skills-back" onClick={handleBack}>
          <ArrowLeft /> 返回人物 Skill 列表
        </button>
        <div className="ui-test-skills-heading-copy">
          <h3>{selected.characterName}</h3>
          <div className="ui-test-skill-card-badges">
            <span className="ui-test-skill-badge is-type">{TIER_LABELS[selected.tier]}</span>
            <span className="ui-test-skill-badge">{STATUS_LABELS[selected.status]}</span>
            {selected.roleType ? <span className="ui-test-skill-badge">{selected.roleType}</span> : null}
            <span className="ui-test-skill-badge">出场 {selected.appearanceCount} 次</span>
            <span className="ui-test-skill-badge">首次第 {selected.firstChapter} 章</span>
            <span className="ui-test-skill-badge">最近第 {selected.lastChapter} 章</span>
          </div>
        </div>
        <textarea
          data-testid="persona-skill-editor"
          className="ui-test-persona-editor"
          value={documentText}
          onChange={(event) => {
            setDocumentText(event.target.value)
            setDraftDirty(true)
          }}
        />
        <div className="ui-test-skills-actions">
          <button type="button" onClick={() => void handleSaveDocument()} disabled={busy}>
            保存
          </button>
          <button type="button" onClick={handleBack} disabled={busy}>
            取消
          </button>
        </div>
        {Object.keys(research).length > 0 && selected.pinned ? (
          <div data-testid="persona-skill-research" className="ui-test-persona-research">
            <h4>研究文件</h4>
            {Object.entries(research).map(([name, content]) => (
              <details key={name}>
                <summary>{name}</summary>
                <pre>{content}</pre>
              </details>
            ))}
            <button type="button" onClick={() => void handleRegenerateResearch()} disabled={busy}>
              <RefreshCw /> 重新整理研究文件
            </button>
          </div>
        ) : (
          <p className="ui-test-skills-empty">
            {selected.pinned
              ? "研究文件会在该人物下次出场时自动生成。"
              : "点亮绿勾后，该人物会生成研究文件。"}
          </p>
        )}
        {message ? <span className="ui-test-skills-message">{message}</span> : null}
      </div>
    )
  }

  return (
    <div data-testid="persona-skill-view" className="ui-test-skills-gallery">
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
        <section data-testid="persona-skill-analysis" className="ui-test-skills-candidates">
          <h4 className="ui-test-skill-card-name">出场频次分析</h4>
          <p className="ui-test-skills-message">
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
                    <span className="ui-test-skill-badge">出场 {meta.appearanceCount} 次</span>
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
                <h3 className="ui-test-skill-card-name" title={meta.characterName}>
                  {meta.characterName}
                </h3>
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
                <button type="button" onClick={() => setSelectedId(meta.id)}>
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

      <section data-testid="persona-skill-candidates" className="ui-test-skills-candidates">
        <h4 className="ui-test-skill-card-name">候选人物（未建档）</h4>
        {sightings.length === 0 ? (
          <p className="ui-test-skills-empty">暂无候选人物</p>
        ) : (
          <div className="ui-test-skills-grid">
            {sightings.map((sighting) => (
              <article
                key={sighting.characterName}
                data-testid={`persona-skill-candidate-${sighting.characterName}`}
                className="ui-test-skill-card"
              >
                <header className="ui-test-skill-card-head">
                  <h3 className="ui-test-skill-card-name" title={sighting.characterName}>
                    {sighting.characterName}
                  </h3>
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
                    data-testid={`persona-skill-promote-${sighting.characterName}`}
                    className="ui-test-skills-action"
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
  )
}
