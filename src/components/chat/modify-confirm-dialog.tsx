import { useState, useMemo, useEffect } from "react"
import { X, Check, FileText, GitCompare, Edit3, Eye, BookOpen, Brain } from "lucide-react"
import { computeLineDiff } from "@/lib/utils/diff"

type ModifyConfirmType = "chapter" | "outline" | "memory" | "classification" | "breakpoint"

interface ModifyConfirmDialogProps {
  open: boolean
  originalContent: string
  modifiedContent: string
  itemName: string
  intentLabel: string
  type?: ModifyConfirmType
  editable?: boolean
  onConfirm: (finalContent: string) => void
  onCancel: () => void
}

type ViewMode = "diff" | "split" | "unified"

const TYPE_CONFIG: Record<ModifyConfirmType, {
  title: string
  icon: typeof FileText
  iconColor: string
  originalLabel: string
  modifiedLabel: string
}> = {
  chapter: {
    title: "确认修改章节",
    icon: FileText,
    iconColor: "text-amber-500",
    originalLabel: "原文",
    modifiedLabel: "修改后",
  },
  outline: {
    title: "确认写入大纲",
    icon: BookOpen,
    iconColor: "text-blue-500",
    originalLabel: "原大纲",
    modifiedLabel: "新内容",
  },
  memory: {
    title: "确认写入记忆",
    icon: Brain,
    iconColor: "text-purple-500",
    originalLabel: "原记忆",
    modifiedLabel: "新内容",
  },
  classification: {
    title: "确认恢复 classification.md",
    icon: FileText,
    iconColor: "text-emerald-500",
    originalLabel: "当前配置",
    modifiedLabel: "默认配置",
  },
  breakpoint: {
    title: "继续未完成任务",
    icon: Brain,
    iconColor: "text-blue-500",
    originalLabel: "断点摘要",
    modifiedLabel: "恢复提示词",
  },
}

export function ModifyConfirmDialog({
  open,
  originalContent,
  modifiedContent,
  itemName,
  intentLabel,
  type = "chapter",
  editable = true,
  onConfirm,
  onCancel,
}: ModifyConfirmDialogProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("diff")
  const [editedContent, setEditedContent] = useState(modifiedContent)
  const config = TYPE_CONFIG[type]
  const Icon = config.icon

  useEffect(() => {
    if (open) {
      setEditedContent(modifiedContent)
      setViewMode("diff")
    }
  }, [open, modifiedContent])

  const diffLines = useMemo(
    () => computeLineDiff(originalContent, editedContent),
    [originalContent, editedContent],
  )

  const stats = useMemo(() => {
    let adds = 0
    let removes = 0
    for (const l of diffLines) {
      if (l.type === "add") adds++
      else if (l.type === "remove") removes++
    }
    return { adds, removes }
  }, [diffLines])

  const isNew = !originalContent.trim()

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[85vh] w-full max-w-6xl flex-col rounded-lg border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Icon className={`h-5 w-5 ${config.iconColor}`} />
            <div>
              <h3 className="font-semibold">{config.title}</h3>
              <p className="text-xs text-muted-foreground">
                {itemName} · {intentLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              <span className="text-green-600 dark:text-green-400">+{stats.adds}</span>
              {" / "}
              <span className="text-red-500">-{stats.removes}</span>
              {" 行"}
            </span>
            <button
              onClick={onCancel}
              className="rounded-md p-1 hover:bg-accent"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex gap-1 border-b px-4 py-2">
          <button
            onClick={() => setViewMode("diff")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              viewMode === "diff" ? "bg-accent font-medium" : "hover:bg-accent/50"
            }`}
          >
            <GitCompare className="h-3.5 w-3.5" />
            Diff 视图
          </button>
          <button
            onClick={() => setViewMode("split")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              viewMode === "split" ? "bg-accent font-medium" : "hover:bg-accent/50"
            }`}
          >
            <Eye className="h-3.5 w-3.5" />
            左右对比
          </button>
          {editable && (
            <button
              onClick={() => setViewMode("unified")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                viewMode === "unified" ? "bg-accent font-medium" : "hover:bg-accent/50"
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              编辑模式
            </button>
          )}
          {isNew && (
            <span className="ml-auto text-xs text-blue-600 dark:text-blue-400">
              新建
            </span>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {viewMode === "diff" && (
            <div className="h-full overflow-auto p-4 font-mono text-xs leading-relaxed">
              {diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap px-2 py-0.5 ${
                    line.type === "add"
                      ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300"
                      : line.type === "remove"
                        ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300"
                        : "text-muted-foreground"
                  }`}
                >
                  <span className="mr-2 inline-block w-5 select-none text-right opacity-50">
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  {line.content || " "}
                </div>
              ))}
            </div>
          )}

          {viewMode === "split" && (
            <div className="grid h-full grid-cols-2 divide-x">
              <div className="flex flex-col overflow-hidden">
                <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {config.originalLabel}
                  {isNew && <span className="ml-2 text-muted-foreground">（无）</span>}
                </div>
                <div className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {originalContent || "（暂无内容）"}
                </div>
              </div>
              <div className="flex flex-col overflow-hidden">
                <div className="border-b px-3 py-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                  {config.modifiedLabel}
                </div>
                <div className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-green-800 dark:text-green-300">
                  {editedContent}
                </div>
              </div>
            </div>
          )}

          {viewMode === "unified" && editable && (
            <div className="flex h-full flex-col">
              <div className="border-b px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                编辑模式 - 可直接修改后确认保存
              </div>
              <textarea
                value={editedContent}
                onChange={(e) => setEditedContent(e.target.value)}
                className="flex-1 resize-none p-3 font-mono text-xs leading-relaxed bg-background focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded-md border px-4 py-1.5 text-sm hover:bg-accent"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(editedContent)}
            className="flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            <Check className="h-4 w-4" />
            确认保存
          </button>
        </div>
      </div>
    </div>
  )
}
