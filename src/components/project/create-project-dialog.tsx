import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ArrowRight, FolderOpen, X } from "lucide-react"
import { createProject, writeFile, createDirectory, getExecutableDir } from "@/commands/fs"
import { getTemplate } from "@/lib/templates"
import type { WikiProject } from "@/types/wiki"
import { normalizePath } from "@/lib/path-utils"
import { useWikiStore, type OutputLanguage } from "@/stores/wiki-store"
import { saveOutputLanguage } from "@/lib/project-store"
import { pickDirectory } from "@/lib/platform"
import { buildDefaultNovelDir } from "@/lib/default-paths"
import { IS_UI_TEST_BUILD } from "@/lib/ui-test"
import "@/components/uitest/ui-test-shelf.css"

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
  const [uiDefaultPath, setUiDefaultPath] = useState("")
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

  // 测试版只读路径预览独立等待，不改变正式版的初始化或创建流程。
  useEffect(() => {
    if (!IS_UI_TEST_BUILD) return
    if (!isOpen) {
      setUiDefaultPath("")
      return
    }
    let cancelled = false
    void resolveDefaultParentDir().then((defaultPath) => {
      if (!cancelled) setUiDefaultPath(defaultPath)
    })
    return () => { cancelled = true }
  }, [isOpen])

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

      const template = getTemplate("general")
      await writeFile(`${pp}/schema.md`, template.schema)
      await writeFile(`${pp}/purpose.md`, template.purpose)
      for (const dir of template.extraDirs) {
        await createDirectory(`${pp}/${dir}`)
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

  if (IS_UI_TEST_BUILD) {
    const uiError = error && (error === t("project.errorNameRequired")
      ? "请输入小说名称。"
      : /[\u4e00-\u9fff]/.test(error)
        ? error.replace(/^Error:\s*/, "")
        : "创建失败，请检查目录权限或是否已存在同名小说后重试。")

    return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!creating) onOpenChange(open) }}>
        <DialogContent
          className="ui-test-create-project-dialog"
          data-ui-test-dialog="create-project"
          showCloseButton={false}
          initialFocus={() => document.getElementById("ui-test-novel-name")}
        >
          <div className="ui-test-create-header">
            <div>
              <DialogTitle className="ui-test-create-title">让一个新故事开始</DialogTitle>
              <DialogDescription className="ui-test-create-caption">创建后直接进入大纲，从故事的起点开始。</DialogDescription>
            </div>
            <button
              type="button"
              className="ui-test-create-close"
              aria-label="关闭新建小说"
              title="关闭新建小说"
              disabled={creating}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <form
            className="ui-test-create-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!creating) void handleCreate()
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
                event.preventDefault()
              }
            }}
          >
            <div className="ui-test-create-body">
              <div className="ui-test-create-field">
                <Label htmlFor="ui-test-novel-name">小说名称</Label>
                <Input
                  id="ui-test-novel-name"
                  className="ui-test-create-name"
                  aria-required="true"
                  aria-invalid={!!uiError && error === t("project.errorNameRequired")}
                  aria-describedby={uiError ? "ui-test-create-error" : undefined}
                  value={name}
                  disabled={creating}
                  onChange={(event) => { setName(event.target.value); if (error) setError("") }}
                  placeholder="给你的故事起个名字"
                />
              </div>
              <div className="ui-test-create-field">
                <Label htmlFor="ui-test-novel-location">存放位置</Label>
                <div className="ui-test-create-location">
                  <output id="ui-test-novel-location" className="ui-test-create-path">{path || uiDefaultPath || "正在读取默认小说目录…"}</output>
                  <button
                    type="button"
                    className="ui-test-create-button browse"
                    disabled={creating}
                    onClick={() => {
                      void handleBrowse().catch(() => setError("无法打开目录选择器，请稍后重试。"))
                    }}
                  >
                    <FolderOpen aria-hidden="true" />
                    选择目录
                  </button>
                </div>
                <p className="ui-test-create-hint">使用本机默认小说目录，可另选位置。</p>
                {uiError && <p id="ui-test-create-error" className="ui-test-create-error" role="alert">{uiError}</p>}
              </div>
              <div className="ui-test-create-note">
                <p>先写清故事大纲，再开始第一章。</p>
                <p>已有资料也可以导入，手动写作不需要配置 AI 模型。</p>
              </div>
            </div>
            <div className="ui-test-create-footer">
              <button type="button" className="ui-test-create-button" disabled={creating} onClick={() => onOpenChange(false)}>取消</button>
              <button type="submit" className="ui-test-create-button primary" disabled={creating || !name.trim()}>
                <ArrowRight aria-hidden="true" />
                {creating ? "创建中…" : "创建并写大纲"}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    )
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
