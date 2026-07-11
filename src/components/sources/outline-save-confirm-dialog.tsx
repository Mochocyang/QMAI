import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CharacterSaveDraft } from "@/lib/novel/character-save-extractor"
import type { OutlineSaveRequest } from "@/lib/novel/outline-save-request"

const OUTLINE_SAVE_FOLDER_OPTIONS = [
  "大纲",
  "卷纲",
  "章纲",
  "人物小传",
  "设定",
  "伏笔",
  "组织",
  "质量检查",
]

export interface OutlineSaveConfirmPayload {
  requests: OutlineSaveRequest[]
  characterDrafts: CharacterSaveDraft[]
}

interface OutlineSaveConfirmDialogProps {
  open: boolean
  title: string
  mode: "normal" | "character"
  requests: OutlineSaveRequest[]
  characterDrafts: CharacterSaveDraft[]
  onClose: () => void
  onConfirm: (payload: OutlineSaveConfirmPayload) => void
}

export function OutlineSaveConfirmDialog({
  open,
  title,
  mode,
  requests,
  characterDrafts,
  onClose,
  onConfirm,
}: OutlineSaveConfirmDialogProps) {
  const [drafts, setDrafts] = useState<CharacterSaveDraft[]>(characterDrafts)
  const [normalRequests, setNormalRequests] = useState<OutlineSaveRequest[]>(requests)
  const [deselectedFiles, setDeselectedFiles] = useState<Set<string>>(new Set())
  const selectedDrafts = useMemo(
    () => drafts.filter((draft) => draft.selected),
    [drafts],
  )
  const folderOptions = useMemo(
    () => Array.from(new Set([...OUTLINE_SAVE_FOLDER_OPTIONS, ...normalRequests.map((request) => request.targetFolder)])),
    [normalRequests],
  )

  useEffect(() => {
    if (!open) return
    setDrafts(characterDrafts)
    setNormalRequests(requests)
    setDeselectedFiles(new Set())
  }, [characterDrafts, open, requests])

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose()
    }}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[82vh] w-[680px] max-w-[calc(100vw-32px)] overflow-hidden p-0 sm:max-w-[680px]"
      >
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {mode === "character"
                  ? "检测到人物角色内容，请选择要保存的人物小传。"
                  : "请确认文件分类和保存位置。"}
              </DialogDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 max-h-[56vh] overflow-y-auto px-5 py-4">
          {mode === "character" ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                已识别 {drafts.length} 个角色，已选择 {selectedDrafts.length} 个。
              </div>
              {drafts.map((draft) => (
                <label
                  key={draft.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent"
                >
                  <input
                    aria-label={`保存 ${draft.roleType} - ${draft.characterName}`}
                    type="checkbox"
                    checked={draft.selected}
                    onChange={(event) => {
                      setDrafts((items) =>
                        items.map((item) =>
                          item.id === draft.id
                            ? { ...item, selected: event.target.checked }
                            : item,
                        ),
                      )
                    }}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {draft.roleType} - {draft.characterName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      文件名：{draft.fileName}
                    </span>
                    {draft.confidence !== "high" ? (
                      <span className="mt-1 block text-xs text-amber-600">
                        识别置信度较低，请保存前检查角色名称和定位。
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-2 text-sm">
              {normalRequests.map((request, index) => (
                <label
                  key={`${index}-${request.fileName}`}
                  className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 hover:bg-accent"
                >
                  <input
                    aria-label={`保存 ${request.fileName}`}
                    type="checkbox"
                    checked={!deselectedFiles.has(request.fileName)}
                    onChange={(e) => {
                      setDeselectedFiles((prev) => {
                        const next = new Set(prev)
                        if (e.target.checked) {
                          next.delete(request.fileName)
                        } else {
                          next.add(request.fileName)
                        }
                        return next
                      })
                    }}
                    className="mt-1 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 flex-1">
                    <div className="font-medium">{request.fileName}</div>
                    <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
                      <div>类型：{request.fileType}</div>
                      <div>写入方式：{request.writeMode}</div>
                      <div>来源：{request.sourceIntent || "未标注"}</div>
                      <div>
                        引用 skill：{request.referencedSkills.length > 0
                          ? request.referencedSkills.join("、")
                          : "无"}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-1.5 text-xs text-muted-foreground">
                      <label htmlFor={`outline-save-folder-${index}`}>
                        保存文件夹
                      </label>
                      <select
                        id={`outline-save-folder-${index}`}
                        aria-label={`选择 ${request.fileName} 的保存文件夹`}
                        value={request.targetFolder}
                        onChange={(event) => {
                          const targetFolder = event.target.value
                          setNormalRequests((items) =>
                            items.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, targetFolder } : item,
                            ),
                          )
                        }}
                        className="h-8 rounded-md border bg-background px-2 text-xs text-foreground"
                      >
                        {folderOptions.map((folder) => (
                          <option key={folder} value={folder}>
                            {folder}
                          </option>
                        ))}
                      </select>
                    </div>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="mx-0 mb-0">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={
              (mode === "character" && selectedDrafts.length === 0) ||
              (mode !== "character" && normalRequests.length - deselectedFiles.size === 0)
            }
            onClick={() => {
              const filteredRequests = normalRequests.filter(
                (r) => !deselectedFiles.has(r.fileName)
              )
              onConfirm({
                requests: mode === "character" ? requests : filteredRequests,
                characterDrafts: selectedDrafts,
              })
            }}
          >
            确认保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
