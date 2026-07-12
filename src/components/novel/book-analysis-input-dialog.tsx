import { useEffect, useRef, useState } from "react"
import { AlertCircle, FileText, X } from "lucide-react"
import { getFileSize } from "@/commands/fs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { BatchImportCandidate } from "@/lib/novel/book-analysis/batch-import-types"
import { normalizePath } from "@/lib/path-utils"

interface BookAnalysisInputDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (files: BatchImportCandidate[]) => Promise<void> | void
}

function getFileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function getPathKey(path: string) {
  const normalizedPath = normalizePath(path)
  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedPath) || normalizedPath.startsWith("//")
  return isWindowsPath ? normalizedPath.toLowerCase() : normalizedPath
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${Number((bytes / 1024 / 1024).toFixed(1))} MB`
  return `${Number((bytes / 1024 / 1024 / 1024).toFixed(1))} GB`
}

export function BookAnalysisInputDialog({
  open,
  onOpenChange,
  onSubmit,
}: BookAnalysisInputDialogProps) {
  const [files, setFiles] = useState<BatchImportCandidate[]>([])
  const [error, setError] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSelecting, setIsSelecting] = useState(false)
  const filesRef = useRef<BatchImportCandidate[]>([])
  const isSubmittingRef = useRef(false)
  const isSelectingRef = useRef(false)
  const openRef = useRef(open)
  const sessionTokenRef = useRef(0)
  const selectionTokenRef = useRef(0)
  openRef.current = open

  const replaceFiles = (
    nextFiles: BatchImportCandidate[] | ((currentFiles: BatchImportCandidate[]) => BatchImportCandidate[]),
  ) => {
    setFiles((currentFiles) => {
      const resolvedFiles = typeof nextFiles === "function" ? nextFiles(currentFiles) : nextFiles
      filesRef.current = resolvedFiles
      return resolvedFiles
    })
  }

  const resetDialogState = () => {
    sessionTokenRef.current += 1
    selectionTokenRef.current += 1
    filesRef.current = []
    isSubmittingRef.current = false
    isSelectingRef.current = false
    setFiles([])
    setError("")
    setIsSubmitting(false)
    setIsSelecting(false)
  }

  useEffect(() => {
    if (!open) resetDialogState()

    return () => {
      sessionTokenRef.current += 1
      selectionTokenRef.current += 1
    }
  }, [open])

  const isSelectionSessionActive = (sessionToken: number, selectionToken: number) => (
    openRef.current
    && sessionTokenRef.current === sessionToken
    && selectionTokenRef.current === selectionToken
  )

  const handleSelectFiles = async () => {
    if (isSubmittingRef.current || isSelectingRef.current) return

    isSelectingRef.current = true
    setIsSelecting(true)
    const sessionToken = sessionTokenRef.current
    const selectionToken = ++selectionTokenRef.current
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog")
      if (!isSelectionSessionActive(sessionToken, selectionToken)) return

      const selected = await openDialog({
        multiple: true,
        filters: [
          {
            name: "文本文件",
            extensions: ["txt"],
          },
        ],
      })
      if (!isSelectionSessionActive(sessionToken, selectionToken)) return

      const selectedPaths = (typeof selected === "string" ? [selected] : selected ?? [])
        .filter((path): path is string => typeof path === "string")
      const knownPaths = new Set(filesRef.current.map((file) => getPathKey(file.sourcePath)))
      const nextFiles: BatchImportCandidate[] = []
      const failureMessages: string[] = []

      for (const sourcePath of selectedPaths) {
        const fileName = getFileName(sourcePath)
        if (!fileName.toLowerCase().endsWith(".txt")) {
          failureMessages.push(`仅支持 TXT 文件，已跳过“${fileName}”`)
          continue
        }

        const pathKey = getPathKey(sourcePath)
        if (knownPaths.has(pathKey)) {
          failureMessages.push(`重复文件“${fileName}”，已跳过`)
          continue
        }
        knownPaths.add(pathKey)

        try {
          const fileSize = await getFileSize(sourcePath)
          if (!isSelectionSessionActive(sessionToken, selectionToken)) return
          nextFiles.push({ sourcePath, fileName, fileSize })
        } catch (err) {
          if (!isSelectionSessionActive(sessionToken, selectionToken)) return
          failureMessages.push(`读取文件“${fileName}”失败，已跳过该文件`)
          console.error(err)
        }
      }

      if (!isSelectionSessionActive(sessionToken, selectionToken)) return
      if (nextFiles.length > 0) {
        replaceFiles((currentFiles) => [...currentFiles, ...nextFiles])
      }
      setError(failureMessages.join("\n"))
    } catch (err) {
      if (!isSelectionSessionActive(sessionToken, selectionToken)) return
      setError("选择文件失败，请重试")
      console.error(err)
    } finally {
      if (isSelectionSessionActive(sessionToken, selectionToken)) {
        isSelectingRef.current = false
        setIsSelecting(false)
      }
    }
  }

  const handleRemove = (index: number) => {
    if (isSubmittingRef.current || isSelectingRef.current) return
    replaceFiles((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index))
  }

  const handleSubmit = async () => {
    if (isSubmittingRef.current || isSelectingRef.current || filesRef.current.length === 0) return

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setError("")
    selectionTokenRef.current += 1
    const sessionToken = sessionTokenRef.current
    const submittedFiles = [...filesRef.current]
    const submittedPathKeys = new Set(submittedFiles.map((file) => getPathKey(file.sourcePath)))

    try {
      await onSubmit(submittedFiles)
      if (sessionTokenRef.current !== sessionToken) return
      replaceFiles((currentFiles) => (
        currentFiles.filter((file) => !submittedPathKeys.has(getPathKey(file.sourcePath)))
      ))
    } catch (err) {
      if (sessionTokenRef.current !== sessionToken) return
      setError("开始导入失败，请重试")
      console.error(err)
    } finally {
      if (sessionTokenRef.current === sessionToken) {
        isSubmittingRef.current = false
        setIsSubmitting(false)
      }
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (isSubmittingRef.current || isSelectingRef.current) return
      resetDialogState()
    }
    onOpenChange(nextOpen)
  }

  const isBusy = isSelecting || isSubmitting

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-[640px]"
        showCloseButton={!isBusy}
      >
        <DialogHeader>
          <DialogTitle>批量导入小说</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium">已选择 {files.length} 本小说</p>
              <p className="text-xs text-muted-foreground">仅支持 TXT 文件</p>
            </div>
            <Button onClick={handleSelectFiles} variant="outline" disabled={isBusy}>
              <FileText className="mr-2 h-4 w-4" />
              {isSelecting ? "正在读取…" : files.length > 0 ? "继续添加" : "选择文件"}
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {files.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                暂未选择小说文件
              </div>
            ) : (
              files.map((file, index) => (
                <div key={getPathKey(file.sourcePath)} className="flex items-start gap-3 rounded-md border p-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{file.fileName}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatFileSize(file.fileSize)}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{file.sourcePath}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    aria-label={`移除${file.fileName}`}
                    disabled={isBusy}
                    onClick={() => handleRemove(index)}
                  >
                    <X className="mr-1 h-4 w-4" />
                    移除
                  </Button>
                </div>
              ))
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="flex max-h-32 items-start gap-2 overflow-y-auto rounded-md bg-destructive/10 p-3 text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="whitespace-pre-line text-sm">{error}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isBusy}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={files.length === 0 || isBusy}>
            {isSubmitting ? "正在导入…" : "开始导入"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}