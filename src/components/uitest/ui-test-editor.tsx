import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react"
import { Menu } from "@base-ui/react/menu"
import { ChevronRight, Eye, FileText, MoreHorizontal, Pencil } from "lucide-react"
import { DRAFT_MEMORY_HINT_MESSAGE } from "@/lib/draft-memory-hint"
import "./ui-test-editor.css"

export interface UiTestEditorSaveState {
  path: string
  retryAction?: "format" | "title" | "final"
  phase: "loaded" | "pending" | "saving" | "saved" | "error" | "conflict" | "load-error"
}

interface EditorAction {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: ReactNode
}

interface UiTestEditorProps {
  kind: "chapter" | "outline"
  path: string
  breadcrumbs: string[]
  title: string
  onTitleCommit: (title: string) => void | Promise<void>
  statusLabel: string
  wordCount: number
  actions: ReactNode
  documentDetails?: ReactNode
  auxiliaryPanel?: ReactNode
  moreActions: EditorAction[]
  saveState: UiTestEditorSaveState | null
  taskStatus: string
  onRetrySave: () => void
  onClose: () => void
  scrollRef: RefObject<HTMLDivElement | null>
  draftMemoryHint?: { onDismiss: () => void } | null
  children: (mode: "read" | "edit") => ReactNode
}

function withDraftMemoryHint(actions: ReactNode, hint: { onDismiss: () => void } | null | undefined): ReactNode {
  if (!hint) return actions
  const visit = (node: ReactNode): ReactNode => {
    if (!isValidElement(node)) return node
    if (node.type === Symbol.for("react.fragment")) {
      const fragment = node as ReactElement<{ children?: ReactNode }>
      return cloneElement(fragment, fragment.props, Children.map(fragment.props.children, visit))
    }
    const props = node.props as { className?: string; "data-draft-memory-target"?: string }
    if (props["data-draft-memory-target"] == null) return node
    return (
      <span className="ui-test-editor-hint-anchor">
        {cloneElement(node as ReactElement<{ className?: string }>, {
          className: [props.className, "is-hint-target"].filter(Boolean).join(" "),
        })}
        <div className="ui-test-editor-draft-hint" role="status">
          <p>{DRAFT_MEMORY_HINT_MESSAGE}</p>
          <button type="button" className="ui-test-editor-draft-hint-dismiss" onClick={hint.onDismiss}>知道了</button>
        </div>
      </span>
    )
  }
  return visit(actions)
}

const SAVE_LABELS: Partial<Record<UiTestEditorSaveState["phase"], string>> = {
  pending: "等待自动保存…",
  saving: "正在保存…",
  error: "保存失败，修改尚未保存",
  conflict: "文件已在外部修改，当前内容尚未保存；请核对原文件",
  "load-error": "读取文件失败，请重新打开文档",
}

/** 只承载测试版展示和交互；读写、生成、快照仍由 PreviewPanel 原处理器负责。 */
export function UiTestEditor({
  kind, path, breadcrumbs, title, onTitleCommit, statusLabel, wordCount,
  actions, documentDetails, auxiliaryPanel, moreActions, saveState, taskStatus, onRetrySave, onClose, scrollRef, draftMemoryHint, children,
}: UiTestEditorProps) {
  const [mode, setMode] = useState<"read" | "edit">("edit")
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(title)
  const [showPath, setShowPath] = useState(false)
  const [showAuxiliary] = useState(false)
  const [auxiliaryMounted] = useState(false)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const cancelTitleRef = useRef(false)
  const wordCountLabel = `${wordCount.toLocaleString("zh-CN")} 字`
  const currentSaveState = saveState?.path === path ? saveState : null
  const saveLabel = currentSaveState && currentSaveState.phase !== "loaded" && currentSaveState.phase !== "saved"
    ? SAVE_LABELS[currentSaveState.phase]
    : undefined
  const showFooter = Boolean(taskStatus || saveLabel)

  useEffect(() => {
    if (!editingTitle) setTitleDraft(title)
  }, [editingTitle, title])

  useLayoutEffect(() => {
    const input = titleRef.current
    if (!input) return
    input.style.height = "auto"
    input.style.height = `${input.scrollHeight}px`
  }, [editingTitle, titleDraft])

  if (currentSaveState?.phase === "load-error") {
    return (
      <div className="ui-test-editor-empty" role="alert">
        <h2>读取文件失败</h2>
        <p>本次没有打开可写编辑器。请核对文件后重新选择此文档。</p>
        <p className="ui-test-editor-path">{path}</p>
        <button type="button" className="ui-test-editor-action" onClick={onClose}>关闭文档</button>
      </div>
    )
  }

  return (
    <div className="ui-test-editor" data-kind={kind} ref={scrollRef}>
      <article className="ui-test-editor-document" aria-label={kind === "chapter" ? "章节编辑器" : "大纲编辑器"}>
        <header className="ui-test-editor-header">
          <nav className="ui-test-editor-breadcrumbs" aria-label="文档位置">
            <ol>
              {breadcrumbs.map((item, index) => (
                <li key={`${index}:${item}`}>
                  {index > 0 ? <ChevronRight aria-hidden="true" /> : null}
                  <span title={item}>{item}</span>
                </li>
              ))}
            </ol>
          </nav>
          <div className="ui-test-editor-title-row">
            {editingTitle ? (
              <textarea
                ref={titleRef}
                className="ui-test-editor-title-input"
                aria-label={kind === "chapter" ? "章节标题" : "大纲标题"}
                value={titleDraft}
                rows={1}
                autoFocus
                onChange={(event) => setTitleDraft(event.target.value.replace(/[\r\n]+/g, " "))}
                onBlur={() => {
                  setEditingTitle(false)
                  if (cancelTitleRef.current) { cancelTitleRef.current = false; return }
                  const nextTitle = titleDraft.trim()
                  // 章节标题失焦即保存：即使文字没改，也要交给原逻辑补连字符、改文件名并排版正文。
                  if (kind === "chapter") {
                    void onTitleCommit(nextTitle)
                    return
                  }
                  if (nextTitle && nextTitle !== title) void onTitleCommit(nextTitle)
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return
                  if (event.key === "Enter") {
                    event.preventDefault()
                    event.currentTarget.blur()
                  } else if (event.key === "Escape") {
                    event.preventDefault()
                    cancelTitleRef.current = true
                    setTitleDraft(title)
                    event.currentTarget.blur()
                  }
                }}
                spellCheck={false}
              />
            ) : (
              <h1 className="ui-test-editor-title">
                <button type="button" title={`编辑标题：${title}`} onClick={() => {
                  cancelTitleRef.current = false
                  setTitleDraft(title)
                  setEditingTitle(true)
                }}>{title}</button>
              </h1>
            )}
            {kind === "chapter" ? (
              <div className="ui-test-editor-meta">
                <span className={`ui-test-editor-status${statusLabel === "正式章节" ? " is-final" : ""}`}>{statusLabel}</span>
                <span>{wordCountLabel}</span>
              </div>
            ) : null}
          </div>
          <div className="ui-test-editor-toolbar" role="group" aria-label="文档操作">
            {withDraftMemoryHint(actions, draftMemoryHint)}
            {false && kind === "chapter" && <Menu.Root modal={false}>
              <Menu.Trigger className="ui-test-editor-action ui-test-editor-more" aria-label="更多编辑器操作" title="更多编辑器操作">
                <MoreHorizontal aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Portal container={scrollRef}>
              <Menu.Positioner className="ui-test-editor-menu-positioner" positionMethod="fixed" align="end" sideOffset={6} collisionPadding={12}>
                <Menu.Popup className="ui-test-editor-menu" aria-label="更多编辑器操作">
                  {kind === "chapter" ? <Menu.Item nativeButton render={<button type="button" />} className="ui-test-editor-menu-item" onClick={() => setMode(mode === "edit" ? "read" : "edit")}>
                    {mode === "edit" ? <Eye aria-hidden="true" /> : <Pencil aria-hidden="true" />}
                    {mode === "edit" ? "预览正文" : "编辑正文"}
                  </Menu.Item> : null}
                  {moreActions.filter((action) => kind === "chapter" || action.label !== "关闭文档").map((action) => (
                    <Menu.Item key={action.label} nativeButton render={<button type="button" />} className="ui-test-editor-menu-item" disabled={action.disabled} onClick={action.onClick}>
                      {action.icon}{action.label}
                    </Menu.Item>
                  ))}
                  {kind === "chapter" ? <Menu.Item nativeButton render={<button type="button" />} className="ui-test-editor-menu-item" onClick={() => setShowPath((value) => !value)}>
                    <FileText aria-hidden="true" />{showPath ? "收起文件详情" : "查看文件详情"}
                  </Menu.Item> : null}
                </Menu.Popup>
              </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>}
          </div>
          {kind === "outline" && auxiliaryMounted ? <div className="ui-test-editor-auxiliary" hidden={!showAuxiliary}>{auxiliaryPanel}</div> : null}
          {showPath ? (
            <section className="ui-test-editor-details" aria-label="文件详情">
              <p className="ui-test-editor-path">{path}</p>
              {documentDetails}
            </section>
          ) : null}
        </header>
        <div className="ui-test-editor-body" data-mode={mode}>
          {children(mode)}
        </div>
        {showFooter ? (
          <footer className="ui-test-editor-footer">
            <div className="ui-test-editor-save">
              {saveLabel ? (
                <span role="status" aria-live="polite" aria-atomic="true" data-ui-test-save-state={currentSaveState?.phase}>
                  {saveLabel}
                </span>
              ) : null}
              {currentSaveState?.phase === "error" ? <button className="ui-test-editor-action" type="button" onClick={onRetrySave}>重试保存</button> : null}
              {taskStatus ? <p className="ui-test-editor-task-status" role="status" aria-live="polite">{taskStatus}</p> : null}
            </div>
          </footer>
        ) : null}
      </article>
    </div>
  )
}