import "@/components/uitest/ui-test-tools.css"
import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  getWritingStylePreset,
  loadWritingStyleStore,
  removeWritingStylePreset,
  setEnabledWritingStyle,
  updateWritingStylePreset,
  type WritingStylePreset,
} from "@/lib/novel/writing-style-store"

/**
 * 技能库「文风 skill」tab 的编辑器。
 *
 * 精简为三个字段：名称 / 来源作品 / 一个「文风内容」多行框。
 * 内容统一存进 `profile.constitution`（风格硬约束）；保存时把 `samples` 与
 * `integratedDna` 清空 —— 单框即这份文风的全部内容，保持单一数据来源。
 *
 * 新建入口在头部动作区（`SkillLibraryActions`）：先 `createWritingStylePreset`
 * 落盘并把新 id 写进 `selectedWritingStyleLibraryStyleId`，再由本组件读出来编辑。
 * 本组件只负责「改 / 启用 / 删除」，不承担「新建」（避免双份创建逻辑）。
 */
export function WritingStyleLibraryView() {
  const projectPath = useWikiStore((s) => s.project?.path)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const selectedId = useWikiStore((s) => s.selectedWritingStyleLibraryStyleId)
  const setSelectedId = useWikiStore((s) => s.setSelectedWritingStyleLibraryStyleId)

  const [preset, setPreset] = useState<WritingStylePreset | null>(null)
  const [enabledId, setEnabledId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [sourceBook, setSourceBook] = useState("")
  const [content, setContent] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!projectPath) return
      const store = await loadWritingStyleStore(projectPath)
      if (cancelled) return
      setEnabledId(store.enabledStyleId)
      if (!selectedId) {
        setPreset(null)
        return
      }
      const loaded = await getWritingStylePreset(projectPath, selectedId)
      if (cancelled) return
      setPreset(loaded)
      if (loaded) {
        setName(loaded.name)
        setSourceBook(loaded.sourceBook === "手动创建" ? "" : loaded.sourceBook)
        // 兼容旧数据：只有整合文档时也带出来（单框即全部内容）。
        setContent(loaded.profile?.constitution || loaded.profile?.integratedDna || "")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectPath, selectedId, dataVersion])

  if (!projectPath) {
    return <div className="ui-test-skills-empty">先打开一本书，再管理文风 skill。</div>
  }

  if (!selectedId || !preset) {
    return (
      <div className="ui-test-skills-empty">
        从列表点开一条文风，或点右上角「+ 新建文风」开始。
      </div>
    )
  }

  const enabled = enabledId === preset.id

  async function handleSave() {
    if (!projectPath || !preset || busy) return
    setBusy(true)
    try {
      const updated = await updateWritingStylePreset(projectPath, preset.id, {
        name,
        sourceBook,
        constitution: content,
        // 单一输入框：代表片段 / 整合文档一并清空（见文件头注释）。
        samples: [],
        integratedDna: "",
      })
      setPreset(updated)
      setMessage("已保存。")
      bumpDataVersion()
    } catch (err) {
      setMessage(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleEnabled() {
    if (!projectPath || !preset || busy) return
    setBusy(true)
    try {
      const next = await setEnabledWritingStyle(projectPath, enabled ? null : preset.id)
      setEnabledId(next.enabledStyleId)
      setMessage(next.enabledStyleId ? "已启用此文风。" : "已停用此文风。")
    } catch (err) {
      setMessage(`操作失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!projectPath || !preset || busy) return
    if (!window.confirm(`确定删除文风「${preset.name}」吗？`)) return
    setBusy(true)
    try {
      const next = await removeWritingStylePreset(projectPath, preset.id)
      setEnabledId(next.enabledStyleId)
      setSelectedId(null)
      setPreset(null)
      setMessage("已删除。")
      bumpDataVersion()
    } catch (err) {
      setMessage(`删除失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-testid="writing-style-library-view" className="ui-test-skills-gallery ui-test-style-form">
      <p className="ui-test-style-hint">
        也可以对一部作品做完文风提炼后自动出现在这里。
      </p>
      <label className="ui-test-style-field">
        <span>名称</span>
        <input
          data-testid="writing-style-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="文风名称"
        />
      </label>
      <label className="ui-test-style-field">
        <span>来源作品</span>
        <input
          data-testid="writing-style-source"
          value={sourceBook}
          onChange={(event) => setSourceBook(event.target.value)}
          placeholder="来源作品（留空则记为「手动创建」）"
        />
      </label>
      <label className="ui-test-style-field">
        <span>文风内容</span>
        <textarea
          data-testid="writing-style-constitution"
          className="ui-test-persona-editor"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="直接编写／粘贴这份文风的全部内容"
        />
      </label>
      <div className="ui-test-skills-actions">
        <button type="button" onClick={() => void handleSave()} disabled={busy}>
          保存
        </button>
        <button type="button" onClick={() => void handleToggleEnabled()} disabled={busy}>
          {enabled ? "停用" : "启用"}
        </button>
        <button type="button" onClick={() => void handleDelete()} disabled={busy}>
          删除
        </button>
      </div>
      {message ? <span className="ui-test-skills-message">{message}</span> : null}
    </div>
  )
}
