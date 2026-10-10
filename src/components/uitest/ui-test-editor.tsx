import { Children, Fragment, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from "react"
import { Menu } from "@base-ui/react/menu"
import { Eye, FileText, MoreHorizontal, Pencil } from "lucide-react"
import { DRAFT_MEMORY_HINT_MESSAGE } from "@/lib/draft-memory-hint"
import { INSPIRATION_HINT_MESSAGE } from "@/lib/inspiration-hint"
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

/** 一枚「锚定气泡」需要知道的全部信息。 */
interface AnchoredHint {
  /**
   * 锚点属性名（例如 `data-draft-memory-target`）。
   * `actions` 里带这个属性的子元素会被包进 `.ui-test-editor-hint-anchor`。
   */
  targetAttr: string
  /**
   * 气泡的类名前缀。根节点用前缀本身，动作行用 `${prefix}-actions`，
   * 两个关闭按钮用 `${prefix}-dismiss` —— 这样既有草稿气泡的类名
   * （`ui-test-editor-draft-hint` / `-actions` / `-dismiss`）逐字不变。
   */
  classPrefix: string
  message: string
  onDismiss: () => void
  onMute: () => void
}

interface UiTestEditorProps {
  kind: "chapter" | "outline"
  path: string
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
  draftMemoryHint?: { onDismiss: () => void; onMute: () => void } | null
  /** 新章节灵感提示（丙-4a）。与 `draftMemoryHint` 各自独立，可同时传入。 */
  inspirationHint?: { onDismiss: () => void; onMute: () => void } | null
  children: (mode: "read" | "edit") => ReactNode
}

/**
 * 把 `actions` 里带锚点属性的子元素各包一层 `.ui-test-editor-hint-anchor`，
 * 并在同一个 `<span>` 里追加一枚 `role="status"` 的说明气泡。
 *
 * 这是从原来的 `withDraftMemoryHint` **泛化**出来的（丙-4a）：新章节灵感气泡
 * 与草稿气泡是同一套机制，抄第三份只会让两份实现各自漂移。
 *
 * ⚠️ 泛化的**唯一**硬约束是草稿气泡的 DOM 逐字节不变。`classPrefix` 这个设计
 * 就是为了保证这点：`ui-test-editor-draft-hint` 前缀展开后仍然是
 * `ui-test-editor-draft-hint` / `-actions` / `-dismiss`，`<span>` 包裹、
 * `is-hint-target` 的拼法、`role="status"`、`<p>` 包裹、「知道了」/「不再提醒」
 * 的文案与 `type="button"` 都没动过（逐字节比对的探针结果见提交说明）。
 *
 * ⚠️ 不存在「找到第一个匹配就收工」：每个锚点属性**各命中一次**，
 * 所以同时传入两枚提示时两条气泡都会出现（用例在 ui-test-editor.spec.tsx）。
 */
function withAnchoredHint(actions: ReactNode, hints: AnchoredHint[]): ReactNode {
  const active = hints.filter((hint) => hint != null)
  if (active.length === 0) return actions
  const visit = (node: ReactNode): ReactNode => {
    if (!isValidElement(node)) return node
    if (node.type === Fragment) {
      const fragment = node as ReactElement<{ children?: ReactNode }>
      return cloneElement(fragment, fragment.props, Children.map(fragment.props.children, visit))
    }
    const props = node.props as { className?: string } & Record<string, unknown>
    const hint = active.find((item) => props[item.targetAttr] != null)
    if (!hint) return node
    return (
      <span className="ui-test-editor-hint-anchor">
        {cloneElement(node as ReactElement<{ className?: string }>, {
          className: [props.className, "is-hint-target"].filter(Boolean).join(" "),
        })}
        <div className={hint.classPrefix} role="status">
          <p>{hint.message}</p>
          <div className={`${hint.classPrefix}-actions`}>
            <button type="button" className={`${hint.classPrefix}-dismiss`} onClick={hint.onDismiss}>知道了</button>
            <button type="button" className={`${hint.classPrefix}-dismiss`} onClick={hint.onMute}>不再提醒</button>
          </div>
        </div>
      </span>
    )
  }
  return visit(actions)
}

/**
 * 底部保存状态文案。
 *
 * `pending`（等待自动保存）与 `saved` 刻意**没有**文案：例行自动保存
 * （间隔 3 分钟）不该在写作时冒提示 —— 用户反馈每按一次回车都弹保存提示很干扰。
 * 例行落盘因此连 `saving` 都不上报（见 preview-panel 的 runPendingChapterSave），
 * 所以还留在这里的 `saving` 只会来自**显式操作**（保存正式章节、一键排版、改标题），
 * 那些确实值得给一句反馈。失败与冲突任何时候都要显示。
 */
const SAVE_LABELS: Partial<Record<UiTestEditorSaveState["phase"], string>> = {
  saving: "正在保存…",
  error: "保存失败，修改尚未保存",
  conflict: "文件已在外部修改，当前内容尚未保存；请核对原文件",
  "load-error": "读取文件失败，请重新打开文档",
}

/** 只承载测试版展示和交互；读写、生成、快照仍由 PreviewPanel 原处理器负责。 */
export function UiTestEditor({
  kind, path, title, onTitleCommit, statusLabel, wordCount,
  actions, documentDetails, auxiliaryPanel, moreActions, saveState, taskStatus, onRetrySave, onClose, scrollRef, draftMemoryHint, inspirationHint, children,
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
    <div className="ui-test-editor" data-kind={kind}>
      <article className="ui-test-editor-document" aria-label={kind === "chapter" ? "章节编辑器" : "大纲编辑器"}>
        <header className="ui-test-editor-header">
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
            {withAnchoredHint(actions, [
              ...(draftMemoryHint
                ? [{
                    targetAttr: "data-draft-memory-target",
                    classPrefix: "ui-test-editor-draft-hint",
                    message: DRAFT_MEMORY_HINT_MESSAGE,
                    onDismiss: draftMemoryHint.onDismiss,
                    onMute: draftMemoryHint.onMute,
                  }]
                : []),
              ...(inspirationHint
                ? [{
                    targetAttr: "data-event-outline-target",
                    classPrefix: "ui-test-editor-inspiration-hint",
                    message: INSPIRATION_HINT_MESSAGE,
                    onDismiss: inspirationHint.onDismiss,
                    onMute: inspirationHint.onMute,
                  }]
                : []),
            ])}
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
        <div className="ui-test-editor-scroll" ref={scrollRef}>
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
        </div>
      </article>
    </div>
  )
}