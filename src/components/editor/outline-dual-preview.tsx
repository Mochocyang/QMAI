import { useState, type ReactNode } from "react"
import { Code2, LayoutTemplate } from "lucide-react"
import { useDocumentAppearance, useDocumentAppearanceHtml } from "@/lib/html-document-appearance"

interface OutlineDualPreviewProps {
  /** 同名 .html 伴生文件内容（卷纲折叠树） */
  htmlContent: string
  /** MD 模式渲染内容（WikiEditor），编辑与保存链路由上层提供 */
  mdEditor: ReactNode
}

/**
 * 卷纲双格式查看器：右上角 HTML / MD 双标识切换。
 * - HTML：iframe srcDoc 内嵌渲染折叠树（自包含 HTML，可直接交互）
 * - MD：纯文字编辑（复用上层 WikiEditor，用户可改任何文字）
 * 默认进入 HTML 模式；MD 编辑保存后不同步重建 HTML（两格式独立）。
 */
export function OutlineDualPreview({ htmlContent, mdEditor }: OutlineDualPreviewProps) {
  const [mode, setMode] = useState<"html" | "md">("html")
  const skin = useDocumentAppearance()
  const previewHtml = useDocumentAppearanceHtml(htmlContent)
  const activeClass = "bg-accent text-accent-foreground"
  const idleClass = "hover:bg-accent"

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1">
        <span className="mr-auto text-xs font-medium text-muted-foreground">卷纲双格式</span>
        <button
          type="button"
          onClick={() => setMode("html")}
          title="以 HTML 折叠树渲染"
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${mode === "html" ? activeClass : idleClass}`}
        >
          <LayoutTemplate className="h-3.5 w-3.5" />
          HTML
        </button>
        <button
          type="button"
          onClick={() => setMode("md")}
          title="以纯文字编辑（MD）"
          className={`flex items-center gap-1 rounded border px-2 py-1 text-xs ${mode === "md" ? activeClass : idleClass}`}
        >
          <Code2 className="h-3.5 w-3.5" />
          MD
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "html" ? (
          <iframe
            key={skin}
            title="卷纲 HTML 预览"
            srcDoc={previewHtml}
            sandbox=""
            className="h-full w-full border-0 bg-transparent"
          />
        ) : (
          mdEditor
        )}
      </div>
    </div>
  )
}
