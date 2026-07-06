import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useWikiStore } from "@/stores/wiki-store"
import {
  createEmptyProjectSoulStyle,
  loadProjectSoulStyleStore,
  saveProjectSoulStyleStore,
  type ProjectSoulStyle,
  type ProjectSoulStyleStore,
} from "@/lib/novel/project-soul-style-store"
import i18n from "@/i18n"

export function SoulDocEditor() {
  const project = useWikiStore((s) => s.project)
  const [store, setStore] = useState<ProjectSoulStyleStore | null>(null)
  const [selectedStyleId, setSelectedStyleId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const styles = store?.styles ?? []
  const selectedStyle = useMemo(
    () => styles.find((style) => style.id === selectedStyleId) ?? styles[0] ?? null,
    [selectedStyleId, styles],
  )

  useEffect(() => {
    if (!project) return
    let cancelled = false
    loadProjectSoulStyleStore(project.path)
      .then((loadedStore) => {
        if (cancelled) return
        setStore(loadedStore)
        setSelectedStyleId(loadedStore.enabledStyleId ?? loadedStore.styles[0]?.id ?? null)
      })
      .catch(() => {
        if (cancelled) return
        setStore(null)
        setSelectedStyleId(null)
      })
    return () => {
      cancelled = true
    }
  }, [project?.path])

  function updateStyles(updater: (styles: ProjectSoulStyle[]) => ProjectSoulStyle[]) {
    setStore((current) => {
      if (!current) return current
      const nextStyles = updater(current.styles)
      const enabledStyleId = nextStyles.find((style) => style.enabled)?.id ?? nextStyles[0]?.id ?? null
      return {
        ...current,
        enabledStyleId,
        styles: nextStyles.map((style) => ({
          ...style,
          enabled: style.id === enabledStyleId,
        })),
      }
    })
  }

  function handleAddStyle() {
    const style = createEmptyProjectSoulStyle(`写作风格 ${styles.length + 1}`)
    setStore((current) => {
      if (!current) {
        return {
          version: 1,
          enabledStyleId: null,
          styles: [style],
        }
      }
      return {
        ...current,
        styles: [...current.styles, style],
      }
    })
    setSelectedStyleId(style.id)
    setMessage("")
  }

  function handleEnableStyle(styleId: string) {
    setSelectedStyleId(styleId)
    setStore((current) => {
      if (!current) return current
      return {
        ...current,
        enabledStyleId: styleId,
        styles: current.styles.map((style) => ({
          ...style,
          enabled: style.id === styleId,
          updatedAt: style.id === styleId ? Date.now() : style.updatedAt,
        })),
      }
    })
    setMessage("")
  }

  function handleDeleteStyle(styleId: string) {
    if (styles.length <= 1) {
      setMessage("至少保留一个写作风格")
      return
    }
    const deletingEnabled = store?.enabledStyleId === styleId
    const remaining = styles.filter((style) => style.id !== styleId)
    const nextSelectedId = selectedStyleId === styleId ? remaining[0]?.id ?? null : selectedStyleId
    setStore((current) => {
      if (!current) return current
      const enabledStyleId = deletingEnabled ? remaining[0]?.id ?? null : current.enabledStyleId
      return {
        ...current,
        enabledStyleId,
        styles: remaining.map((style) => ({
          ...style,
          enabled: style.id === enabledStyleId,
        })),
      }
    })
    setSelectedStyleId(nextSelectedId)
    setMessage("")
  }

  function handleStyleFieldChange(styleId: string, patch: Partial<Pick<ProjectSoulStyle, "name" | "content">>) {
    updateStyles((currentStyles) =>
      currentStyles.map((style) =>
        style.id === styleId
          ? {
              ...style,
              ...patch,
              updatedAt: Date.now(),
            }
          : style,
      ),
    )
    setMessage("")
  }

  async function handleSave() {
    if (!project || !store) return
    setSaving(true)
    try {
      const savedStore = await saveProjectSoulStyleStore(project.path, store)
      setStore(savedStore)
      setSelectedStyleId(savedStore.enabledStyleId ?? savedStore.styles[0]?.id ?? null)
      setMessage(i18n.t("novel.soul.saveProjectSoulSuccess"))
    } catch {
      setMessage(i18n.t("novel.soul.saveProjectSoulFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full max-w-none flex-col gap-5 px-8 py-7">
      <div className="space-y-1">
        <Label className="text-base font-semibold">{i18n.t("novel.soul.projectSoul")}</Label>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          定义本项目的核心气质、创作边界、叙事原则和长期写作总则。当前启用的写作风格会同步写入 soul.md，并进入 AI 会话、大纲和推演上下文。
        </p>
      </div>

      <div className="grid min-h-[34rem] flex-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col rounded-md border bg-background/35">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="text-sm font-medium">写作风格</div>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleAddStyle}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              新增写作风格
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {styles.map((style) => (
              <button
                key={style.id}
                type="button"
                onClick={() => setSelectedStyleId(style.id)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  selectedStyle?.id === style.id ? "border-primary/70 bg-primary/10" : "border-border bg-background/70 hover:bg-accent"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={style.enabled}
                    onChange={(event) => {
                      event.stopPropagation()
                      handleEnableStyle(style.id)
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`启用写作风格：${style.name}`}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1 truncate text-sm font-medium">{style.name || "未命名风格"}</div>
                  {style.enabled ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {style.content.trim() || "还没有填写这个写作风格"}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-col rounded-md border bg-background/35 p-4">
          {selectedStyle ? (
            <>
              <div className="mb-3 flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">风格名称</Label>
                  <Input
                    value={selectedStyle.name}
                    onChange={(event) => handleStyleFieldChange(selectedStyle.id, { name: event.target.value })}
                    placeholder="例如：冷峻写实、轻松吐槽、史诗感叙事"
                  />
                </div>
                <Button
                  type="button"
                  variant={selectedStyle.enabled ? "default" : "outline"}
                  size="sm"
                  className="mt-5 shrink-0"
                  onClick={() => handleEnableStyle(selectedStyle.id)}
                >
                  {selectedStyle.enabled ? "已启用" : "启用"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-5 shrink-0 px-2 text-muted-foreground"
                  onClick={() => handleDeleteStyle(selectedStyle.id)}
                  title="删除写作风格"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Textarea
                className="min-h-0 flex-1 resize-none rounded-md bg-background/60 p-4 text-sm leading-7"
                placeholder={[
                  "在这里填写当前写作风格的规则...",
                  "",
                  "例如：",
                  "- 核心气质：克制、冷静、现实压力强",
                  "- 叙事原则：每个场景必须推动目标或制造代价",
                  "- 语言边界：避免华丽堆砌，少用感叹和空泛比喻",
                  "- 节奏控制：每 500 字至少出现一个新信息点",
                ].join("\n")}
                value={selectedStyle.content}
                onChange={(event) => handleStyleFieldChange(selectedStyle.id, { content: event.target.value })}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              请选择或新增一个写作风格
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={saving || !store}>
          {saving ? "..." : i18n.t("novel.soul.saveProjectSoul")}
        </Button>
        {message && <span className="text-sm text-muted-foreground">{message}</span>}
      </div>
    </div>
  )
}
