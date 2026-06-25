import { useState } from "react"
import { useTranslation } from "react-i18next"
import { FilePlus, Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useWikiStore } from "@/stores/wiki-store"
import { streamChat } from "@/lib/llm-client"
import { writeFile, listDirectory, createDirectory } from "@/commands/fs"
import { PROMPTS } from "@/lib/novel/prompt-templates"
import { normalizePath } from "@/lib/path-utils"
import type { OutlineType } from "@/lib/novel/chapter-meta"

const OUTLINE_TYPES: { value: OutlineType; labelKey: string }[] = [
  { value: "story-outline", labelKey: "novel.outline.type.story" },
  { value: "volume-outline", labelKey: "novel.outline.type.volume" },
  { value: "chapter-outline", labelKey: "novel.outline.type.chapter" },
]

interface OutlineCreatorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OutlineCreatorDialog({
  open,
  onOpenChange,
}: OutlineCreatorDialogProps) {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setFileTree = useWikiStore((s) => s.setFileTree)

  const [outlineType, setOutlineType] = useState<OutlineType>("story-outline")
  const [title, setTitle] = useState("")
  const [volumeNumber, setVolumeNumber] = useState("")
  const [chapterNumber, setChapterNumber] = useState("")
  const [premise, setPremise] = useState("")
  const [useAi, setUseAi] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function reset() {
    setOutlineType("story-outline")
    setTitle("")
    setVolumeNumber("")
    setChapterNumber("")
    setPremise("")
    setUseAi(false)
    setError(null)
    setDone(false)
  }

  async function handleCreate() {
    if (!project) return

    if (!title.trim()) {
      setError(t("novel.outline.titleRequired"))
      return
    }

    if (useAi && !premise.trim()) {
      setError(t("novel.outline.premiseRequired"))
      return
    }

    setGenerating(true)
    setError(null)

    try {
      let content = ""

      if (useAi) {
        const outlineTypeLabel = t(`novel.outline.type.${outlineType}`)
        const prompt = PROMPTS.outlineGeneration(outlineTypeLabel, "", premise)

        const errorRef = { current: null as Error | null }
        await streamChat(llmConfig, [{ role: "user", content: prompt }], {
          onToken: (token) => {
            content += token
          },
          onDone: () => {},
          onError: (err) => {
            errorRef.current = err
          },
        })

        if (errorRef.current) {
          setError(errorRef.current.message)
          setGenerating(false)
          return
        }
      }

      const pp = normalizePath(project.path)
      const outlinesDir = `${pp}/wiki/outlines`
      await createDirectory(outlinesDir)

      const escapedTitle = title.trim().replace(/"/g, '\\"')
      const frontmatterLines = [
        "---",
        `title: "${escapedTitle}"`,
        `type: outline`,
        `outline_type: ${outlineType}`,
      ]

      if (outlineType === "volume-outline" && volumeNumber) {
        frontmatterLines.push(`volume_number: ${volumeNumber}`)
      }
      if (outlineType === "chapter-outline" && chapterNumber) {
        frontmatterLines.push(`chapter_number: ${chapterNumber}`)
      }

      frontmatterLines.push("---")
      frontmatterLines.push("")

      let fileName = title.trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .toLowerCase()

      if (outlineType === "volume-outline" && volumeNumber) {
        fileName = `volume-${volumeNumber}-${fileName}`
      } else if (outlineType === "chapter-outline" && chapterNumber) {
        fileName = `chapter-${chapterNumber}-${fileName}`
      }

      const filePath = `${outlinesDir}/${fileName}.md`
      const fullContent = frontmatterLines.join("\n") + (content || `# ${title.trim()}\n\n`)
      await writeFile(filePath, fullContent)

      const tree = await listDirectory(pp)
      setFileTree(tree)
      useWikiStore.getState().bumpDataVersion()

      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("novel.outline.createTitle")}</DialogTitle>
          <DialogDescription>
            {t("novel.outline.createDescription")}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
              {t("novel.outline.created")}
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>
                {t("project.cancel")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>{t("novel.outline.type.label")}</Label>
                <select
                  value={outlineType}
                  onChange={(e) => setOutlineType(e.target.value as OutlineType)}
                  disabled={generating}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {OUTLINE_TYPES.map((ot) => (
                    <option key={ot.value} value={ot.value}>
                      {t(ot.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>{t("novel.outline.title")}</Label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("novel.outline.titlePlaceholder")}
                  disabled={generating}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {outlineType === "volume-outline" && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("novel.outline.volumeNumber")}</Label>
                  <input
                    type="number"
                    value={volumeNumber}
                    onChange={(e) => setVolumeNumber(e.target.value)}
                    placeholder="1"
                    min={1}
                    disabled={generating}
                    className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {outlineType === "chapter-outline" && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("novel.outline.chapterNumber")}</Label>
                  <input
                    type="number"
                    value={chapterNumber}
                    onChange={(e) => setChapterNumber(e.target.value)}
                    placeholder="1"
                    min={1}
                    disabled={generating}
                    className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use-ai"
                  checked={useAi}
                  onChange={(e) => setUseAi(e.target.checked)}
                  disabled={generating}
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="use-ai" className="text-sm cursor-pointer">
                  {t("novel.outline.useAi")}
                </Label>
              </div>

              {useAi && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t("novel.outline.premise")}</Label>
                  <textarea
                    value={premise}
                    onChange={(e) => setPremise(e.target.value)}
                    placeholder={t("novel.outline.premisePlaceholder")}
                    disabled={generating}
                    rows={3}
                    className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={generating}
              >
                {t("project.cancel")}
              </Button>
              <Button onClick={handleCreate} disabled={generating || !title.trim()}>
                {generating ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    {t("novel.outline.generating")}
                  </>
                ) : useAi ? (
                  <>
                    <Sparkles className="mr-1 h-4 w-4" />
                    {t("novel.outline.createWithAi")}
                  </>
                ) : (
                  <>
                    <FilePlus className="mr-1 h-4 w-4" />
                    {t("novel.outline.create")}
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}