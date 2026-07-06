import { useEffect, useMemo, useState } from "react"
import { open, save } from "@tauri-apps/plugin-dialog"
import { readFile, writeFile } from "@/commands/fs"
import { useWikiStore } from "@/stores/wiki-store"
import {
  createBlankProjectDeAiSkill,
  getAllDeAiSkills,
  loadDeAiSkillConfig,
  normalizeDeAiSkillConfig,
  saveDeAiSkillConfig,
  type DeAiSkill,
} from "@/lib/novel/de-ai-skill-library"
import {
  createBlankWritingSkill,
  exportSkillToJson,
  importLinkedSkill,
  importSkillFromJson,
  importWritingSkill,
  loadUserSkillConfig,
  normalizeUserSkillConfig,
  saveUserSkillConfig,
} from "@/lib/novel/user-skill-store"
import type { SkillKind, UserSkill } from "@/lib/novel/skill-library"
import { SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibraryView } from "./writing-skill-library-view"

const skillLibraryTabs = [
  { view: "skillLibrary" as const, label: "去AI味技能" },
  { view: "writingSkillLibrary" as const, label: "写作 Skill" },
]

type UnifiedSkillCategory = "all" | "writing" | "de-ai" | SkillKind

interface UnifiedSkillEntry {
  id: string
  sourceId: string
  type: "writing" | "de-ai"
  name: string
  description: string
  content: string
  kinds: SkillKind[]
}

const unifiedSkillCategories: { id: UnifiedSkillCategory; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "writing", label: "写作" },
  { id: "de-ai", label: "去AI味" },
  { id: "review", label: "审稿" },
  { id: "output", label: "输出" },
  { id: "knowledge", label: "知识" },
]

function deAiSkillToEntry(skill: DeAiSkill): UnifiedSkillEntry {
  return {
    id: `de-ai:${skill.id}`,
    sourceId: skill.id,
    type: "de-ai",
    name: skill.name,
    description: skill.description,
    content: skill.content,
    kinds: ["rewrite", "style"],
  }
}

function writingSkillToEntry(skill: UserSkill): UnifiedSkillEntry {
  return {
    id: `writing:${skill.id}`,
    sourceId: skill.id,
    type: "writing",
    name: skill.name,
    description: skill.description,
    content: skill.content,
    kinds: skill.kind,
  }
}

function fileBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || "未命名 Skill"
}

function stripSkillFileExtension(name: string): string {
  return name.replace(/\.(json|md|txt)$/i, "")
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string; body: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) return { body: content }
  const yamlBlock = match[1]
  const nameMatch = yamlBlock.match(/^name:\s*(.+?)\s*$/m)
  const descMatch = yamlBlock.match(/^description:\s*(.+?)\s*$/m)
  return {
    name: nameMatch ? nameMatch[1].trim() : undefined,
    description: descMatch ? descMatch[1].trim() : undefined,
    body: content.slice(match[0].length),
  }
}

function importedDeAiSkillFromContent(path: string, content: string): DeAiSkill | null {
  const now = Date.now()
  const nameFromPath = stripSkillFileExtension(fileBaseName(path))
  if (/\.json$/i.test(path)) {
    try {
      const parsed = JSON.parse(content)
      if (!parsed || typeof parsed !== "object") return null
      const raw = parsed as Record<string, unknown>
      if (typeof raw.name !== "string" || !raw.name.trim()) return null
      if (typeof raw.content !== "string" || !raw.content.trim()) return null
      return {
        id: `project:${now}`,
        name: raw.name.trim(),
        description: typeof raw.description === "string" ? raw.description.trim() : "",
        templateId: typeof raw.templateId === "string" ? raw.templateId : "custom",
        content: raw.content.trim(),
        source: "project",
        createdAt: now,
        updatedAt: now,
      }
    } catch {
      return null
    }
  }

  const parsed = parseSkillFrontmatter(content)
  const body = parsed.body.trim()
  if (!body) return null
  return {
    id: `project:${now}`,
    name: parsed.name || nameFromPath || "未命名去AI味 Skill",
    description: parsed.description || "",
    templateId: "custom",
    content: body,
    source: "project",
    createdAt: now,
    updatedAt: now,
  }
}

function SkillLibraryHeader({ compact = false }: { compact?: boolean }) {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const activeTab = activeView === "writingSkillLibrary" ? "writingSkillLibrary" : "skillLibrary"

  return (
    <div className={`flex shrink-0 flex-wrap items-center justify-between gap-2 border-b ${compact ? "px-2 py-2" : "px-4 py-3"}`}>
      <div className="flex items-center gap-1">
        {skillLibraryTabs.map((tab) => (
          <button
            key={tab.view}
            type="button"
            aria-pressed={activeTab === tab.view}
            onClick={() => setActiveView(tab.view)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              activeTab === tab.view
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <SkillLibraryHeaderActions activeTab={activeTab} />
    </div>
  )
}

function SkillLibraryHeaderActions({ activeTab }: { activeTab: "skillLibrary" | "writingSkillLibrary" }) {
  const project = useWikiStore((s) => s.project)
  const bumpDataVersion = useWikiStore((s) => s.bumpDataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const selectedWritingSkillId = useWikiStore((s) => s.selectedWritingSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)

  async function persistWritingConfig(nextConfig: ReturnType<typeof normalizeUserSkillConfig>, nextSkillId: string | null) {
    if (!project || saving) return
    setSaving(true)
    try {
      await saveUserSkillConfig(project.path, nextConfig)
      if (nextSkillId) setSelectedWritingSkillId(nextSkillId)
      setActiveView("writingSkillLibrary")
      bumpDataVersion()
      setMessage("写作 Skill 已保存")
    } catch {
      setMessage("写作 Skill 保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function persistDeAiConfig(nextConfig: ReturnType<typeof normalizeDeAiSkillConfig>, nextSkillId: string) {
    if (!project || saving) return
    setSaving(true)
    try {
      await saveDeAiSkillConfig(project.path, nextConfig)
      setSelectedSkillId(nextSkillId)
      setActiveView("skillLibrary")
      bumpDataVersion()
      setMessage("去AI味技能已保存")
    } catch {
      setMessage("去AI味技能保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateDeAiSkill() {
    if (!project || saving) return
    const config = await loadDeAiSkillConfig(project.path)
    const now = Date.now()
    const next = createBlankProjectDeAiSkill(config, now)
    await persistDeAiConfig(next, `project:${now}`)
  }

  async function handleImportDeAiSkillFile() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "去AI味 Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const imported = importedDeAiSkillFromContent(selected, content)
      if (!imported) {
        setMessage("导入失败：文件内容不是有效的去AI味 Skill")
        return
      }
      const config = await loadDeAiSkillConfig(project.path)
      const next = normalizeDeAiSkillConfig({
        ...config,
        defaultSkillId: imported.id,
        projectSkills: [imported, ...config.projectSkills],
      })
      await persistDeAiConfig(next, imported.id)
    } catch {
      setMessage("导入去AI味 Skill 失败")
    }
  }

  async function handleImportDeAiSkillFolder() {
    if (!project || saving) return
    try {
      const selected = await open({ multiple: false, directory: true })
      if (!selected || typeof selected !== "string") return
      const skillPath = `${selected.replace(/[\\/]+$/, "")}/SKILL.md`
      const content = await readFile(skillPath)
      const imported = importedDeAiSkillFromContent(skillPath, content)
      if (!imported) {
        setMessage("导入失败：文件夹中未找到有效的 SKILL.md")
        return
      }
      const config = await loadDeAiSkillConfig(project.path)
      const next = normalizeDeAiSkillConfig({
        ...config,
        defaultSkillId: imported.id,
        projectSkills: [imported, ...config.projectSkills],
      })
      await persistDeAiConfig(next, imported.id)
    } catch {
      setMessage("导入失败：文件夹中未找到有效的 SKILL.md")
    }
  }

  async function handleCreateWritingSkill() {
    if (!project || saving) return
    const config = await loadUserSkillConfig(project.path)
    const next = createBlankWritingSkill(config)
    await persistWritingConfig(next, next.selectedSkillId)
  }

  async function handleImportWritingSkill() {
    if (!project || saving) return
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "Skill 文件", extensions: ["json", "md", "txt"] }],
      })
      if (!selected || typeof selected !== "string") return
      const content = await readFile(selected)
      const fileName = fileBaseName(selected)
      const config = await loadUserSkillConfig(project.path)
      const next = /\.json$/i.test(fileName)
        ? (() => {
            const imported = importSkillFromJson(content)
            if (!imported) return null
            return normalizeUserSkillConfig({
              ...config,
              selectedSkillId: imported.id,
              skills: [imported, ...config.skills],
            })
          })()
        : importWritingSkill(config, {
            name: fileName.replace(/\.(md|txt)$/i, ""),
            content,
          })

      if (!next) {
        setMessage("JSON 文件格式不正确，导入失败")
        return
      }
      await persistWritingConfig(next, next.selectedSkillId)
    } catch {
      setMessage("导入 Skill 失败")
    }
  }

  async function handleImportWritingSkillFolder() {
    if (!project || saving) return
    try {
      const selected = await open({ multiple: false, directory: true })
      if (!selected || typeof selected !== "string") return
      const config = await loadUserSkillConfig(project.path)
      const next = await importLinkedSkill(config, selected)
      if (!next.selectedSkillId) {
        setMessage("导入失败：文件夹中未找到有效的 Skill 文件")
        return
      }
      await persistWritingConfig(next, next.selectedSkillId)
    } catch {
      setMessage("导入失败：文件夹中未找到有效的 Skill 文件")
    }
  }

  async function handleExportCurrentWritingSkill() {
    if (!project || saving) return
    try {
      const config = await loadUserSkillConfig(project.path)
      const selected = selectedWritingSkillId
        ? config.skills.find((skill) => skill.id === selectedWritingSkillId)
        : config.skills[0]
      if (!selected) {
        setMessage("请先选择写作 Skill")
        return
      }
      const filePath = await save({
        defaultPath: `${selected.name}.json`,
        filters: [{ name: "JSON 文件", extensions: ["json"] }],
      })
      if (!filePath) return
      await writeFile(filePath, exportSkillToJson(selected))
      setMessage("导出成功")
    } catch {
      setMessage("导出 Skill 失败")
    }
  }

  const buttonClass = "rounded-md border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
  const disabled = !project || saving

  return (
    <div data-testid="skill-library-header-actions" className="flex flex-wrap items-center justify-end gap-2">
      {activeTab === "skillLibrary" ? (
        <>
          <button type="button" onClick={() => void handleCreateDeAiSkill()} disabled={disabled} className={buttonClass}>
            新建技能
          </button>
          <span className="text-xs text-muted-foreground">导入技能</span>
          <button type="button" onClick={() => void handleImportDeAiSkillFile()} disabled={disabled} className={buttonClass}>
            导入文件
          </button>
          <button type="button" onClick={() => void handleImportDeAiSkillFolder()} disabled={disabled} className={buttonClass}>
            导入文件夹
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => void handleCreateWritingSkill()} disabled={disabled} className={buttonClass}>
            新建 Skill
          </button>
          <span className="text-xs text-muted-foreground">导入 Skill</span>
          <button type="button" onClick={() => void handleImportWritingSkill()} disabled={disabled} className={buttonClass}>
            导入文件
          </button>
          <button type="button" onClick={() => void handleImportWritingSkillFolder()} disabled={disabled} className={buttonClass}>
            导入文件夹
          </button>
          <button type="button" onClick={() => void handleExportCurrentWritingSkill()} disabled={disabled} className={buttonClass}>
            导出当前
          </button>
        </>
      )}
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
    </div>
  )
}

export function UnifiedSkillLibraryView() {
  const activeView = useWikiStore((s) => s.activeView)
  const showWritingSkill = activeView === "writingSkillLibrary"

  return (
    <div data-testid="unified-skill-library-view" className="flex h-full flex-col overflow-hidden">
      <SkillLibraryHeader />
      <div className="min-h-0 flex-1 overflow-hidden">
        {showWritingSkill ? <WritingSkillLibraryView /> : <SkillLibraryView />}
      </div>
    </div>
  )
}

export function UnifiedSkillLibrarySidebarPanel() {
  const project = useWikiStore((s) => s.project)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const selectedSkillId = useWikiStore((s) => s.selectedSkillLibrarySkillId)
  const selectedWritingSkillId = useWikiStore((s) => s.selectedWritingSkillLibrarySkillId)
  const setSelectedSkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const [entries, setEntries] = useState<UnifiedSkillEntry[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<UnifiedSkillCategory>("all")
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoadError("")
    Promise.all([
      loadUserSkillConfig(project?.path),
      loadDeAiSkillConfig(project?.path),
    ])
      .then(([writingConfig, deAiConfig]) => {
        if (cancelled) return
        setEntries([
          ...writingConfig.skills.map(writingSkillToEntry),
          ...getAllDeAiSkills(deAiConfig).map(deAiSkillToEntry),
        ])
      })
      .catch(() => {
        if (cancelled) return
        setEntries([])
        setLoadError("技能库加载失败")
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, project?.path])

  const activeEntryId = useMemo(() => {
    if (selectedWritingSkillId) return `writing:${selectedWritingSkillId}`
    if (selectedSkillId) return `de-ai:${selectedSkillId}`
    return ""
  }, [selectedSkillId, selectedWritingSkillId])

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (category === "writing" && entry.type !== "writing") return false
      if (category === "de-ai" && entry.type !== "de-ai") return false
      if (
        category !== "all" &&
        category !== "writing" &&
        category !== "de-ai" &&
        !entry.kinds.includes(category)
      ) {
        return false
      }
      if (!keyword) return true
      return [entry.name, entry.description, entry.content]
        .some((value) => value.toLowerCase().includes(keyword))
    })
  }, [category, entries, query])

  function handleSelectEntry(entry: UnifiedSkillEntry) {
    if (entry.type === "writing") {
      setSelectedWritingSkillId(entry.sourceId)
      setActiveView("writingSkillLibrary")
      return
    }
    setSelectedSkillId(entry.sourceId)
    setActiveView("skillLibrary")
  }

  return (
    <div data-testid="unified-skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">技能库</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">统一检索写作 Skill 和去AI味技能。</p>
      </div>
      <div className="shrink-0 border-b px-3 py-2">
        <input
          data-testid="unified-skill-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索技能名称、说明或规则"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unifiedSkillCategories.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={category === item.id}
              onClick={() => setCategory(item.id)}
              className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                category === item.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {loadError ? (
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">{loadError}</div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredEntries.length === 0 ? (
          <div className="rounded-md border border-dashed p-3 text-xs leading-5 text-muted-foreground">
            没有匹配的技能。
          </div>
        ) : null}
        {filteredEntries.map((entry) => {
          const active = entry.id === activeEntryId
          return (
            <div
              key={entry.id}
              data-testid={`unified-skill-entry-${entry.id}`}
              role="button"
              tabIndex={0}
              onClick={() => handleSelectEntry(entry)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  handleSelectEntry(entry)
                }
              }}
              className={`mb-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent ${
                active ? "border-primary bg-accent/60" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {entry.type === "writing" ? "写作" : "去AI味"}
                </span>
              </div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {entry.description || "未填写说明"}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
