import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Plus, Sparkles, Upload, X } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

interface UiTestDirectoryHeaderProps {
  kind: "chapter" | "outline"
  /** 当前书籍所有章节的正文字数合计；为空时不显示。 */
  totalWordCount?: number | null
  busy: boolean
  onCreate: () => void
  onCreateContainer: () => void
  onImportFiles: () => void
  onImportFolder: () => void
  onOpenAssistant: () => void
  onClose?: () => void
  onHelp: () => void
}

export function UiTestDirectoryHeader({ kind, totalWordCount, busy, onCreate, onCreateContainer, onImportFiles, onImportFolder, onOpenAssistant, onClose, onHelp }: UiTestDirectoryHeaderProps) {
  const [menu, setMenu] = useState<"create" | "import" | "more" | null>(null)
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
      <Tooltip>
        <TooltipTrigger render={<button type="button" className="ui-test-icon-btn" aria-label={kind === "outline" ? "批量大纲提取" : "一键提取"} onClick={onOpenAssistant}><Sparkles /></button>} />
        <TooltipContent>{kind === "outline" ? "批量大纲提取" : "一键提取"}</TooltipContent>
      </Tooltip>
      <button type="button" className="ui-test-icon-btn" aria-label="收起目录" title="收起目录" onClick={onClose}><X /></button>
    </div></div>
    <div className="ui-test-directory-tools" ref={toolsRef}>
      <button type="button" disabled={busy} aria-haspopup="menu" aria-expanded={menu === "create"} onClick={() => setMenu(menu === "create" ? null : "create")}><Plus />新建</button>
      <button ref={importRef} type="button" disabled={busy} aria-haspopup="menu" aria-expanded={menu === "import"} onClick={() => setMenu(menu === "import" ? null : "import")}><Upload />{busy ? "处理中" : "导入"}</button>
      {typeof totalWordCount === "number" ? <span className="ui-test-directory-total">{totalWordCount}字</span> : null}
      {false && <button ref={moreRef} type="button" aria-haspopup="menu" aria-expanded={menu === "more"} onClick={() => setMenu(menu === "more" ? null : "more")}><MoreHorizontal />更多</button>}
      {menu && <div className="ui-test-menu-pop" role="menu" aria-label={menu === "create" ? "新建大纲" : menu === "import" ? `导入${label}` : `${label}更多操作`} onKeyDown={event => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
        event.preventDefault()
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }}>
        {menu === "create" ? <>
          <button type="button" className="ui-test-menu-item" role="menuitem" onClick={() => execute(onCreate)}>{kind === "chapter" ? "新建章节" : "新建大纲"}</button>
          <button type="button" className="ui-test-menu-item" role="menuitem" onClick={() => execute(onCreateContainer)}>{kind === "chapter" ? "新建卷" : "新建文件夹"}</button>
        </> : menu === "import" ? <>
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
