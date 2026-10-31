/**
 * 大纲第一栏里的「人物小传」区段。
 *
 * ── 为什么单独一个组件，而没有塞进 KnowledgeTree ──
 * `KnowledgeTree` 是**磁盘文件树**（一次 listDirectory 出来的真实目录/文件），
 * 而人物的真源在 `.qmai/persona-skills/`，候选更是只存在于 `sightings.json`，
 * 磁盘上根本没有对应文件。硬把虚拟节点插进文件树，会让
 * 「树 = 磁盘」这条不变量破掉（展开/折叠、删除、拖拽全都按路径工作）。
 * 所以这里是**独立的一段**，数据来自 persona-skill 索引与候选池。
 *
 * ── 交互约定（用户拍板） ──
 * · 左键：活跃角色 → 中栏打开档案；候选角色**左键不做事**（它没有档案可开）。
 * · 右键：候选 → 「建档 / 删除」；活跃 → 「标记重要 / 打开 / 删除」。
 *   候选没有档案，所以它的一切操作只能靠右键菜单与建档；这也是为什么
 *   以前点候选「没反应」——它本来就没有可打开的东西。
 * · 新建入口统一走顶部「新建」菜单，区段里不再放按钮（避免两个入口打架）。
 */
import { useCallback, useEffect, useState } from "react"
import { Check, ChevronDown, ChevronRight, FolderLock, Trash2, User, UserPlus, Users } from "lucide-react"
import {
  deletePersonaSighting,
  promotePersonaSightingLocal,
} from "@/lib/novel/persona-skill-learning"
import { removePersonaFromProject } from "@/lib/novel/persona-outline-detach"
import {
  loadPersonaSkillIndex,
  loadPersonaSightings,
  updatePersonaSkillIndex,
} from "@/lib/novel/persona-skill-store"
import {
  resolvePersonaTier,
  type PersonaSkillMeta,
  type PersonaSkillSighting,
} from "@/lib/novel/persona-skill-types"
import { useWikiStore } from "@/stores/wiki-store"

interface PersonaTreeSectionProps {
  /** 数据版本号：外部（建档 / 删除 / 学习）发生后 +1，用来触发重读。 */
  refreshKey?: number
}

type MenuState =
  | { kind: "candidate"; name: string; x: number; y: number }
  | { kind: "active"; id: string; name: string; pinned: boolean; x: number; y: number }
  | null

export function PersonaTreeSection({ refreshKey = 0 }: PersonaTreeSectionProps) {
  const projectPath = useWikiStore((s) => s.project?.path)
  const personaOutlinePane = useWikiStore((s) => s.personaOutlinePane)
  const setPersonaOutlinePane = useWikiStore((s) => s.setPersonaOutlinePane)
  /** 任何人物数据变更都会 +1：左栏据此重读，避免与档案页显示不一致。 */
  const personaDataVersion = useWikiStore((s) => s.personaDataVersion)
  const bumpPersonaDataVersion = useWikiStore((s) => s.bumpPersonaDataVersion)

  const [skills, setSkills] = useState<PersonaSkillMeta[]>([])
  const [candidates, setCandidates] = useState<PersonaSkillSighting[]>([])
  const [open, setOpen] = useState(true)
  const [activeOpen, setActiveOpen] = useState(true)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    if (!projectPath) {
      setSkills([])
      setCandidates([])
      return
    }
    const [index, sightings] = await Promise.all([
      loadPersonaSkillIndex(projectPath).catch(() => ({ version: 1 as const, skills: [] })),
      loadPersonaSightings(projectPath).catch(() => ({ version: 1 as const, sightings: [] })),
    ])
    setSkills(index.skills)
    setCandidates(sightings.sightings)
  }, [projectPath])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey, personaDataVersion])

  /*
   * 点空白处收起菜单。
   *
   * 这里**不能**监听 `contextmenu`：菜单正是被 contextmenu 打开的，
   * 同一个事件冒泡到 window 时会把刚打开的菜单立刻关掉 ——
   * 表现就是「右键完全没反应」（用户实测）。
   * 用 `mousedown` 收起，并且忽略菜单内部的按下（否则点菜单项会先关菜单、
   * 再触发 click，动作就丢了）。
   */
  useEffect(() => {
    if (!menu) return
    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest(".ui-test-ptree-menu")) return
      setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }
    window.addEventListener("mousedown", close)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("mousedown", close)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [menu])

  async function handlePromote(name: string) {
    if (!projectPath) return
    setBusy(true)
    try {
      await promotePersonaSightingLocal({ projectPath, characterName: name })
      await reload()
      bumpPersonaDataVersion()
    } catch (err) {
      // 左栏没有消息区：失败必须显式告知，否则又是「点了没反应」。
      console.error("[PersonaTree] 建档失败:", err)
      window.alert(`「${name}」建档失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setMenu(null)
    }
  }

  async function handleDeleteCandidate(name: string) {
    if (!projectPath) return
    const confirmed = window.confirm(
      `确定删除候选人物「${name}」吗？\n\n之后提取记忆也不会再把它加回候选区。`,
    )
    if (!confirmed) {
      setMenu(null)
      return
    }
    setBusy(true)
    try {
      await deletePersonaSighting({ projectPath, characterName: name })
      await reload()
      bumpPersonaDataVersion()
    } catch (err) {
      console.error("[PersonaTree] 删除候选失败:", err)
      window.alert(`「${name}」删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setMenu(null)
    }
  }

  async function handleDeletePersona(name: string) {
    if (!projectPath) return
    const confirmed = window.confirm(
      `确定从人物列表删除「${name}」吗？\n\n档案文件仍会保留在项目里，不会删盘。`,
    )
    if (!confirmed) {
      setMenu(null)
      return
    }
    setBusy(true)
    try {
      await removePersonaFromProject(projectPath, [name])
      setPersonaOutlinePane(null)
      await reload()
      bumpPersonaDataVersion()
    } catch (err) {
      console.error("[PersonaTree] 删除角色失败:", err)
      window.alert(`「${name}」删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setMenu(null)
    }
  }

  /** 标记 / 取消「重要人物」：绿勾。重要人物才会生成研究文件。 */
  async function handleToggleImportant(id: string, pinned: boolean) {
    if (!projectPath) return
    setBusy(true)
    try {
      await updatePersonaSkillIndex(projectPath, (current) => ({
        version: 1,
        skills: current.skills.map((item) =>
          item.id === id
            ? {
                ...item,
                pinned,
                tier: resolvePersonaTier(item.roleType, pinned),
                status: pinned ? ("active" as const) : item.status,
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      }))
      await reload()
      bumpPersonaDataVersion()
    } catch (err) {
      console.error("[PersonaTree] 标记重要失败:", err)
      window.alert(`标记「重要人物」失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
      setMenu(null)
    }
  }

  const total = skills.length + candidates.length
  const currentId = personaOutlinePane?.mode === "persona" ? personaOutlinePane.id : null

  return (
    <div data-testid="persona-tree-section" className="ui-test-ptree">
      {/* 固定文件夹 */}
      {/* 整行就是一个折叠开关：和卷纲 / 地点库这些文件夹一致，点名字只展开收起，不导航。 */}
      <button
        type="button"
        className="ui-test-ptree-row is-folder"
        aria-expanded={open}
        data-testid="persona-tree-folder"
        title="人物小传（固定文件夹，不可删除）"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ui-test-ptree-toggle" aria-hidden="true">
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        <FolderLock className="ui-test-ptree-ico" aria-hidden="true" />
        <span className="ui-test-ptree-name">人物小传</span>
        <span className="ui-test-ptree-count">{total}</span>
      </button>

      {open ? (
        <div className="ui-test-ptree-children">
          {/* 活跃角色 */}
          <button
            type="button"
            className="ui-test-ptree-row is-group"
            aria-expanded={activeOpen}
            data-testid="persona-tree-active-toggle"
            onClick={() => setActiveOpen((value) => !value)}
          >
            <span className="ui-test-ptree-toggle" aria-hidden="true">
              {activeOpen ? <ChevronDown /> : <ChevronRight />}
            </span>
            <User className="ui-test-ptree-ico" aria-hidden="true" />
            <span className="ui-test-ptree-name">活跃角色</span>
            <span className="ui-test-ptree-count">{skills.length}</span>
          </button>

          {activeOpen
            ? skills.map((meta) => (
                <button
                  key={meta.id}
                  type="button"
                  data-testid={`persona-tree-item-${meta.characterName}`}
                  className={`ui-test-ptree-row is-leaf${currentId === meta.id ? " is-on" : ""}`}
                  title={`${meta.characterName} · ${meta.roleType || "未标注"} · 出场 ${meta.appearanceCount} 次 · 右键更多`}
                  onClick={() => setPersonaOutlinePane({ mode: "persona", id: meta.id })}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({
                      kind: "active",
                      id: meta.id,
                      name: meta.characterName,
                      pinned: meta.pinned,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }}
                >
                  <i
                    className={`ui-test-ptree-dot${meta.status === "active" ? "" : " is-idle"}`}
                    aria-hidden="true"
                  />
                  <span className="ui-test-ptree-name">{meta.characterName}</span>
                  {meta.pinned ? (
                    <span className="ui-test-ptree-check" title="重要人物（生成研究文件）">
                      <Check aria-hidden="true" />
                    </span>
                  ) : null}
                  {meta.status !== "active" ? (
                    <span className="ui-test-ptree-state" title={meta.status === "dormant" ? "潜伏：长期未出场" : "归档：已长期未出场"}>
                      {meta.status === "dormant" ? "潜伏" : "归档"}
                    </span>
                  ) : null}
                  {meta.autoUpdate === false ? (
                    <span className="ui-test-ptree-badge" title="已关闭随章节自动更新">
                      冻
                    </span>
                  ) : null}
                </button>
              ))
            : null}

          {/* 候选角色（默认折叠） */}
          <button
            type="button"
            className="ui-test-ptree-row is-group"
            aria-expanded={candidatesOpen}
            data-testid="persona-tree-candidates-toggle"
            onClick={() => setCandidatesOpen((value) => !value)}
          >
            <span className="ui-test-ptree-toggle" aria-hidden="true">
              {candidatesOpen ? <ChevronDown /> : <ChevronRight />}
            </span>
            <Users className="ui-test-ptree-ico" aria-hidden="true" />
            <span className="ui-test-ptree-name">候选角色</span>
            <span className="ui-test-ptree-count">{candidates.length}</span>
          </button>

          {candidatesOpen
            ? candidates.map((sighting) => (
                <button
                  key={sighting.characterName}
                  type="button"
                  data-testid={`persona-tree-candidate-${sighting.characterName}`}
                  className="ui-test-ptree-row is-leaf is-candidate"
                  title={`${sighting.characterName} · 候选 · 出场 ${sighting.appearanceCount} 章 · 右键可建档或删除`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setMenu({
                      kind: "candidate",
                      name: sighting.characterName,
                      x: event.clientX,
                      y: event.clientY,
                    })
                  }}
                  /* 候选没有档案可开：左键不做跳转，只提示去看右键菜单。 */
                  // 候选没有档案，但有「轻量预览」：切中栏看它的出场与原句。
                  onClick={() => setPersonaOutlinePane({ mode: "candidate", name: sighting.characterName })}
                >
                  <i className="ui-test-ptree-dot is-candidate" aria-hidden="true" />
                  <span className="ui-test-ptree-name">{sighting.characterName}</span>
                </button>
              ))
            : null}
        </div>
      ) : null}

      {menu ? (
        <ul
          className="ui-test-ptree-menu"
          style={{ left: menu.x, top: menu.y }}
          data-testid="persona-tree-menu"
        >
          {menu.kind === "candidate" ? (
            <>
              <li>
                <button
                  type="button"
                  data-testid="persona-tree-menu-promote"
                  disabled={busy}
                  onClick={() => void handlePromote(menu.name)}
                >
                  <UserPlus aria-hidden="true" /> 建档
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="persona-tree-menu-delete-candidate"
                  className="is-danger"
                  disabled={busy}
                  onClick={() => void handleDeleteCandidate(menu.name)}
                >
                  <Trash2 aria-hidden="true" /> 删除
                </button>
              </li>
            </>
          ) : (
            <>
              <li>
                <button
                  type="button"
                  data-testid="persona-tree-menu-important"
                  disabled={busy}
                  onClick={() => void handleToggleImportant(menu.id, !menu.pinned)}
                >
                  <Check aria-hidden="true" /> {menu.pinned ? "取消重要人物" : "标记为重要人物"}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="persona-tree-menu-open"
                  disabled={busy}
                  onClick={() => {
                    setPersonaOutlinePane({ mode: "persona", id: menu.id })
                    setMenu(null)
                  }}
                >
                  <User aria-hidden="true" /> 打开档案
                </button>
              </li>
              <li>
                <button
                  type="button"
                  data-testid="persona-tree-menu-delete-persona"
                  className="is-danger"
                  disabled={busy}
                  onClick={() => void handleDeletePersona(menu.name)}
                >
                  <Trash2 aria-hidden="true" /> 删除角色
                </button>
              </li>
            </>
          )}
        </ul>
      ) : null}
    </div>
  )
}
