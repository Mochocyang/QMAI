import { useEffect, useRef, useState, type ReactNode } from "react"
import { Code2, LayoutTemplate, Pencil } from "lucide-react"
import {
  DOCUMENT_APPEARANCE_STYLE_ID,
  applyDocumentAppearance,
  useDocumentAppearance,
  useDocumentAppearanceHtml,
} from "@/lib/html-document-appearance"
import { extractEditedHtml, markEditableHtml } from "@/lib/novel/html-inline-edit"

interface OutlineDualPreviewProps {
  /** 同名 .html 伴生文件内容（卷纲折叠树 / 章纲卡片流 / 设定卡片流） */
  htmlContent: string
  /** MD 模式渲染内容（WikiEditor），编辑与保存链路由上层提供 */
  mdEditor: ReactNode
  /** 顶栏标题，默认「双格式」 */
  label?: string
  /**
   * HTML / MD 标识旁的附加操作（如大纲的「提取记忆 / 查看记忆」）。
   *
   * 这两枚按钮原先只长在 MD 编辑器工具栏里，而本组件默认就是 HTML 模式 ——
   * iframe 会把整条编辑器工具栏顶掉，于是 HTML 视图下按钮凭空消失，用户
   * 只能猜「是不是要切到 MD 才有」。提到顶栏后两种模式位置一致。
   */
  actions?: ReactNode
  /**
   * 提供后 HTML 视图多出「编辑」入口，保存时把改好的 HTML 回传，落盘由上层负责。
   *
   * 回传的是**去掉可编辑痕迹与预览皮肤**的干净 HTML：可编辑属性与编辑态样式块
   * 只属于这一次预览，外观配色也按当前皮肤实时注入，都不能写进磁盘文件。
   * 返回 `false` 表示保存失败 —— 此时保留编辑态与用户输入，让用户可以重试或取消。
   */
  onSaveHtml?: (html: string) => Promise<boolean | void> | boolean | void
  /**
   * 当前文档的标识（传路径即可）。
   *
   * 用户在编辑态里点了目录里的另一份大纲时，编辑副本属于**上一份文件** ——
   * 不退出编辑态的话，他接着点「保存」就会把 A 的内容写进 B 的同名 .html
   * （写盘路径由上层按当前选中文件推导）。所以标识一变就丢掉编辑态。
   */
  documentKey?: string
}

/**
 * 大纲双格式查看器：右上角 HTML / MD 双标识切换。
 * - HTML：iframe srcDoc 内嵌渲染自包含 HTML（可直接交互）
 * - MD：纯文字编辑（复用上层 WikiEditor，用户可改任何文字）
 * 默认进入 HTML 模式；MD 编辑保存后不同步重建 HTML（两格式独立）。
 *
 * HTML 就地编辑（本次新增）：点「编辑」后，预览换成一份给叶子元素打上
 * `contenteditable` 的副本，标题、正文、表格单元格都能直接改；「保存」把改完的
 * 内容回传给上层写盘。为什么按钮只能长在顶栏、长不到文档标题旁边：
 * 预览 iframe 不带 allow-scripts，文档内部点不出任何回调（详见 html-inline-edit.ts）。
 */
export function OutlineDualPreview({ htmlContent, mdEditor, label = "双格式", actions, onSaveHtml, documentKey }: OutlineDualPreviewProps) {
  const [mode, setMode] = useState<"html" | "md">("html")
  const [editing, setEditing] = useState(false)
  /**
   * 进入编辑时**冻结**的可编辑副本。
   *
   * 编辑期间上层若换了内容（重新生成 / 外部写入 / 切皮肤），不能让 iframe 在用户
   * 手底下换掉文字 —— 否则他改的是 A、存的是 B。所以整份 srcdoc 在点「编辑」的
   * 那一刻算好，编辑过程中不再随 props 变。
   */
  const [editDoc, setEditDoc] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState("")
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const skin = useDocumentAppearance()
  const previewHtml = useDocumentAppearanceHtml(htmlContent)
  const activeClass = "bg-accent text-accent-foreground"
  const idleClass = "hover:bg-accent"

  // 换文档就退出编辑态（见 documentKey 注释）。也覆盖首次挂载，代价是一次无害的 setState 批。
  useEffect(() => {
    setEditing(false)
    setEditDoc(null)
    setEditError("")
    setSaving(false)
  }, [documentKey])

  function startEdit() {
    setEditDoc(markEditableHtml(applyDocumentAppearance(htmlContent, skin)))
    setEditing(true)
    setEditError("")
  }

  function cancelEdit() {
    setEditing(false)
    setEditDoc(null)
    setEditError("")
    setSaving(false)
  }

  async function commitEdit() {
    // iframe 带 allow-same-origin（见下方 sandbox 注释），才能把改完的 DOM 读回来。
    const html = extractEditedHtml(iframeRef.current?.contentDocument, DOCUMENT_APPEARANCE_STYLE_ID)
    if (!html) {
      setEditError("预览还没准备好，请稍后重试。")
      return
    }
    setSaving(true)
    setEditError("")
    try {
      const result = await onSaveHtml?.(html)
      if (result === false) {
        setEditError("保存失败，修改仍在这里，可以重试或取消。")
        return
      }
      setEditing(false)
      setEditDoc(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "保存失败，请重试。")
    } finally {
      setSaving(false)
    }
  }

  const canEditHtml = Boolean(onSaveHtml)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏会随预览栏宽度收窄：排到一行放不下时换行，不要把「编辑」挤成半截。 */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1 gap-y-1 border-b border-border px-2 py-1">
        <span className="mr-auto text-xs font-medium text-muted-foreground">{label}</span>
        {editing ? (
          <div className="flex min-w-0 items-center gap-1" data-outline-html-edit-bar="">
            <span className="min-w-0 truncate text-xs text-muted-foreground" title="标题、正文、表格单元格都可以直接改；保存会覆盖同名 .html，MD 不受影响">
              {editError || "点击文字或表格单元格直接修改"}
            </span>
            <button
              type="button"
              onClick={() => void commitEdit()}
              disabled={saving}
              className={`shrink-0 rounded border px-2 py-1 text-xs ${activeClass}`}
              title="保存到同名 .html 文件"
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className={`shrink-0 rounded border px-2 py-1 text-xs ${idleClass}`}
              title="放弃这次修改"
            >
              取消
            </button>
          </div>
        ) : (
          <>
            {/*
              附加操作排在两个模式标识**左侧**（紧挨），用与编辑器工具栏相同的
              `ui-test-editor-action is-icon-only` 类，视觉上与别处的图标按钮一致。
            */}
            {actions ? <div className="flex items-center gap-1" data-outline-dual-actions="">{actions}</div> : null}
            {canEditHtml && mode === "html" ? (
              <button
                type="button"
                onClick={startEdit}
                className={`flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs ${idleClass}`}
                title="编辑这份 HTML（标题、正文、表格都能改）"
              >
                <Pencil className="h-3.5 w-3.5" />
                编辑
              </button>
            ) : null}
          </>
        )}
        <button
          type="button"
          onClick={() => setMode("html")}
          disabled={editing}
          title={editing ? "请先保存或取消编辑" : "以 HTML 折叠树渲染"}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${mode === "html" ? activeClass : idleClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          HTML
        </button>
        <button
          type="button"
          onClick={() => setMode("md")}
          disabled={editing}
          title={editing ? "请先保存或取消编辑" : "以纯文字编辑（MD）"}
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${mode === "md" ? activeClass : idleClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Code2 className="h-3.5 w-3.5" />
          MD
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "html" ? (
          <iframe
            ref={iframeRef}
            /*
             * 原先是不带任何令牌的 `sandbox=""`（连 same-origin 都不给）。
             * 就地编辑必须能把 iframe 里的 DOM 读回来，所以补上 allow-same-origin。
             * 注意**不能**再加 allow-scripts：只加 same-origin 时文档里的脚本依然
             * 一律不执行，隔离性与原来一致；两者同时给才是逃逸沙箱的组合。
             */
            key={editing ? "editable" : skin}
            title={`${label} HTML 预览`}
            srcDoc={editing ? editDoc ?? previewHtml : previewHtml}
            sandbox="allow-same-origin"
            className="h-full w-full border-0 bg-transparent"
          />
        ) : (
          mdEditor
        )}
      </div>
    </div>
  )
}
