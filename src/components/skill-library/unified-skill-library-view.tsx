import { useEffect, useMemo, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { getAllDeAiSkills, loadDeAiSkillConfig, type DeAiSkill } from "@/lib/novel/de-ai-skill-library"
import { loadUserSkillConfig } from "@/lib/novel/user-skill-store"
import type { UserSkill } from "@/lib/novel/skill-library"
import { SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibraryView } from "./writing-skill-library-view"

const skillLibraryTabs = [
  { view: "skillLibrary" as const, label: "去AI味技能" },
  { view: "writingSkillLibrary" as const, label: "写作 Skill" },
]

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
  const setSelectedSkillLibrarySkillId = useWikiStore((s) => s.setSelectedSkillLibrarySkillId)
  const setSelectedWritingSkillLibrarySkillId = useWikiStore((s) => s.setSelectedWritingSkillLibrarySkillId)
  const [deAiSkills, setDeAiSkills] = useState<DeAiSkill[]>([])
  const [writingSkills, setWritingSkills] = useState<UserSkill[]>([])
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("全部")

  useEffect(() => {
    let cancelled = false
    Promise.all([
      loadDeAiSkillConfig(project?.path).then((config) => getAllDeAiSkills(config)).catch(() => []),
      loadUserSkillConfig(project?.path).then((config) => config.skills).catch(() => []),
    ]).then(([nextDeAiSkills, nextWritingSkills]) => {
      if (cancelled) return
      setDeAiSkills(nextDeAiSkills)
      setWritingSkills(nextWritingSkills)
    })
    return () => {
      cancelled = true
    }
  }, [project?.path, dataVersion])

  const entries = useMemo(() => {
    const writingEntries = writingSkills.map((skill) => ({
      id: `writing:${skill.id}`,
      source: "writing" as const,
      skill,
      name: skill.name,
      description: skill.description,
      categories: ["写作", ...skill.kind.map((kind) => kind === "review" ? "审稿" : kind === "output" ? "输出" : "知识")],
    }))
    const deAiEntries = deAiSkills.map((skill) => ({
      id: `de-ai:${skill.id}`,
      source: "de-ai" as const,
      skill,
      name: skill.name,
      description: skill.description,
      categories: ["去AI味"],
    }))
    return [...writingEntries, ...deAiEntries]
  }, [deAiSkills, writingSkills])

  const filteredEntries = entries.filter((entry) => {
    const matchesCategory = category === "全部" || entry.categories.includes(category)
    const text = `${entry.name} ${entry.description}`.toLowerCase()
    const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase())
    return matchesCategory && matchesQuery
  })

  function handleSelect(entry: (typeof entries)[number]) {
    if (entry.source === "writing") {
      setActiveView("writingSkillLibrary")
      setSelectedWritingSkillLibrarySkillId(entry.skill.id)
    } else {
      setActiveView("skillLibrary")
      setSelectedSkillLibrarySkillId(entry.skill.id)
    }
  }

  return (
    <div data-testid="unified-skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <h1 className="text-sm font-semibold">技能库</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">统一管理写作 Skill 与去AI味技能。</p>
      </div>
      <div className="shrink-0 space-y-2 border-b px-3 py-2">
        <input
          data-testid="unified-skill-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索技能"
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="flex flex-wrap gap-1">
          {["全部", "写作", "去AI味", "审稿", "输出", "知识"].map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                category === item ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filteredEntries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-testid={`unified-skill-entry-${entry.id}`}
            onClick={() => handleSelect(entry)}
            className="mb-2 w-full rounded-md border px-3 py-2 text-left hover:bg-accent"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {entry.source === "writing" ? "写作" : "去AI味"}
              </span>
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{entry.description}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
