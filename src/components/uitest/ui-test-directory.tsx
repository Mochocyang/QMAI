import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Plus, Search, Sparkles, Upload, X } from "lucide-react"

interface UiTestDirectoryHeaderProps {
  kind: "chapter" | "outline"
  query: string
  onQueryChange: (query: string) => void
  busy: boolean
  onCreate: () => void
  onCreateContainer: () => void
  onImportFiles: () => void
  onImportFolder: () => void
  onOpenAssistant: () => void
  onClose?: () => void
  onHelp: () => void
}

export function UiTestDirectoryHeader({ kind, query, onQueryChange, busy, onCreate, onCreateContainer, onImportFiles, onImportFolder, onOpenAssistant, onClose, onHelp }: UiTestDirectoryHeaderProps) {
  const [menu, setMenu] = useState<"import" | "more" | null>(null)
  const toolsRef = useRef<HTMLDivElement>(null)
  const importRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const label = kind === "chapter" ? "章节" : "大纲"
  useEffect(() => {
    if (!menu) return
    toolsRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const close = (event: MouseEvent) => { if (!toolsRef.current?.contains(event.target as Node)) setMenu(null) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault(); event.stopPropagation(); setMenu(null)
      ;(menu === "import" ? importRef : moreRef).current?.focus()
    }
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape) }
  }, [menu])
  const execute = (action: () => void) => { setMenu(null); action() }
  return <>
    <div className="ui-test-directory-head"><h2>{label}列表</h2><div className="ui-test-directory-head-actions">
      <button type="button" className="ui-test-icon-btn" aria-label={`打开${label}助手`} title={`打开${label}助手`} onClick={onOpenAssistant}><Sparkles /></button>
      <button type="button" className="ui-test-icon-btn" aria-label="收起目录" title="收起目录" onClick={onClose}><X /></button>
    </div></div>
    <label className="ui-test-directory-search"><Search aria-hidden="true" /><input aria-label={`查找${label}`} placeholder={`查找${label}`} value={query} onChange={event => onQueryChange(event.target.value)} /></label>
    <div className="ui-test-directory-tools" ref={toolsRef}>
      <button type="button" disabled={busy} onClick={onCreate}><Plus />新建</button>
      <button ref={importRef} type="button" disabled={busy} aria-haspopup="menu" aria-expanded={menu === "import"} onClick={() => setMenu(menu === "import" ? null : "import")}><Upload />{busy ? "处理中" : "导入"}</button>
      <button ref={moreRef} type="button" aria-haspopup="menu" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}><MoreHorizontal />更多</button>
      {menu && <div className="ui-test-menu-pop" role="menu" aria-label={menu === "import" ? `导入${label}` : `${label}更多操作`} onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }}>
        {menu === "import" ? <>
          <button type="button" className="ui-test-menu-item" role="menuitem" onClick={() => execute(onImportFiles)}>导入文件</button>
          <button type="button" className="ui-test-menu-item" role="menuitem" onClick={() => execute(onImportFolder)}>导入文件夹</button>
        </> : <>
          <button type="button" className="ui-test-menu-item" role="menuitem" disabled={busy} onClick={() => execute(onCreateContainer)}>{kind === "chapter" ? "新建分卷" : "新建文件夹"}</button>
          <button type="button" className="ui-test-menu-item" role="menuitem" onClick={() => execute(onHelp)}>功能使用说明</button>
        </>}
      </div>}
    </div>
  </>
}
