import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FolderOpen } from "lucide-react"
import { createProject, writeFile, createDirectory, getExecutableDir } from "@/commands/fs"
import { getTemplate } from "@/lib/templates"
import type { WikiProject } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore, type OutputLanguage } from "@/stores/wiki-store"
import { saveOutputLanguage } from "@/lib/project-store"
import { isTauri, pickDirectory } from "@/lib/platform"
import { getWebFs } from "@/lib/web-fs"
import { buildDefaultNovelDir } from "@/lib/default-paths"

interface CreateProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (project: WikiProject) => void
}

export function CreateProjectDialog({ open: isOpen, onOpenChange, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [path, setPath] = useState("")
  const [error, setError] = useState("")
  const [creating, setCreating] = useState(false)
  const [hasInitializedPath, setHasInitializedPath] = useState(false)
  const setOutputLanguage = useWikiStore((s) => s.setOutputLanguage)

  async function resolveDefaultParentDir(): Promise<string> {
    let defaultPath = buildDefaultNovelDir("")
    try {
      const executableDir = await getExecutableDir()
      defaultPath = buildDefaultNovelDir(executableDir)
    } catch {
      // Keep fallback path.
    }
    return defaultPath
  }

  useEffect(() => {
    if (!isOpen) {
      setHasInitializedPath(false)
      setPath("")
      return
    }
    if (hasInitializedPath || path.trim()) {
      return
    }

    let cancelled = false
    setHasInitializedPath(true)

    const initializePath = async () => {
      const defaultPath = await resolveDefaultParentDir()

      if (!cancelled) {
        setPath((currentPath) => (currentPath.trim() ? currentPath : defaultPath))
      }
    }

    void initializePath()

    return () => {
      cancelled = true
    }
  }, [hasInitializedPath, isOpen, path])

  async function handleBrowse() {
    const dir = await pickDirectory()
    if (dir) setPath(dir)
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError(t("project.errorNameRequired"))
      return
    }
    setCreating(true)
    setError("")
    try {
      const parentDir = normalizePath(path.trim() || await resolveDefaultParentDir())
      if (!parentDir.trim()) {
        setError(t("project.errorNameRequired"))
        return
      }

      setPath(parentDir)
      await createDirectory(parentDir)

      const project = await createProject(name.trim(), parentDir)
      const pp = normalizePath(project.path)

      if (isTauri()) {
        const template = getTemplate("general")
        await writeFile(`${pp}/schema.md`, template.schema)
        await writeFile(`${pp}/purpose.md`, template.purpose)
        for (const dir of template.extraDirs) {
          await createDirectory(`${pp}/${dir}`)
        }
      } else {
        const template = getTemplate("general")
        await getWebFs().initProjectWithTemplate(pp, template)
      }

      const lang: OutputLanguage = "Chinese"
      setOutputLanguage(lang)
      await saveOutputLanguage(lang, project.id)

      onCreated(project)
      onOpenChange(false)
      setName("")
      setPath("")
    } catch (err) {
      setError(String(err))
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("project.createTitle")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!creating) {
              void handleCreate()
            }
          }}
        >
          <div className="flex flex-col gap-4 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">{t("project.name")}</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("project.namePlaceholder")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="path">{t("project.parentDir")}</Label>
              <div className="flex gap-2">
                <Input id="path" value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("project.parentDirPlaceholder")} className="flex-1" />
                <Button variant="outline" size="icon" onClick={handleBrowse} type="button">
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("project.cancel")}</Button>
            <Button type="submit" disabled={creating}>{creating ? t("project.creating") : t("project.create")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
