import { useEffect, useMemo, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  getAllDeAiSkills,
  loadDeAiSkillConfig,
  type DeAiSkill,
} from "@/lib/novel/de-ai-skill-library"
import { loadUserSkillConfig } from "@/lib/novel/user-skill-store"
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

function SkillLibraryTabs({ compact = false }: { compact?: boolean }) {
  const activeView = useWikiStore((s) => s.activeView)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const activeTab = activeView === "writingSkillLibrary" ? "writingSkillLibrary" : "skillLibrary"

  return (
    <div className={`flex shrink-0 items-center gap-1 border-b ${compact ? "px-2 py-2" : "px-4 py-3"}`}>
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
  )
}

export function UnifiedSkillLibraryView() {
  const activeView = useWikiStore((s) => s.activeView)
  const showWritingSkill = activeView === "writingSkillLibrary"

  return (
    <div data-testid="unified-skill-library-view" className="flex h-full flex-col overflow-hidden">
      <SkillLibraryTabs />
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
