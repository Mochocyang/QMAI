import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useWikiStore } from "@/stores/wiki-store"
import { readSoulDoc, writeSoulDoc } from "@/lib/novel/soul-doc"
import i18n from "@/i18n"

export function SoulDocEditor() {
  const project = useWikiStore((s) => s.project)
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (!project) return
    readSoulDoc(project.path).then(setContent).catch(() => setContent(""))
  }, [project?.path])

  async function handleSave() {
    if (!project) return
    setSaving(true)
    try {
      await writeSoulDoc(project.path, content)
      setMessage(i18n.t("novel.soul.saveProjectSoulSuccess"))
    } catch {
      setMessage(i18n.t("novel.soul.saveProjectSoulFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <Label>{i18n.t("novel.soul.projectSoul")}</Label>
        <p className="text-sm text-muted-foreground mt-1">
          {i18n.t("novel.soul.projectSoulDesc")}
        </p>
      </div>
      <Textarea
        className="min-h-[300px] font-mono text-sm"
        placeholder={i18n.t("novel.soul.projectSoulPlaceholder")}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || content.trim() === ""}>
          {saving ? "..." : i18n.t("novel.soul.saveProjectSoul")}
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  )
}