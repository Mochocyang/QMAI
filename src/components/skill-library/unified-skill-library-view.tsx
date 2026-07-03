import { useWikiStore } from "@/stores/wiki-store"
import { SkillLibrarySidebarPanel, SkillLibraryView } from "./skill-library-view"
import { WritingSkillLibrarySidebarPanel, WritingSkillLibraryView } from "./writing-skill-library-view"

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
  const activeView = useWikiStore((s) => s.activeView)
  const showWritingSkill = activeView === "writingSkillLibrary"

  return (
    <div data-testid="unified-skill-library-sidebar" className="flex h-full flex-col overflow-hidden">
      <SkillLibraryTabs compact />
      <div className="min-h-0 flex-1 overflow-hidden">
        {showWritingSkill ? <WritingSkillLibrarySidebarPanel /> : <SkillLibrarySidebarPanel />}
      </div>
    </div>
  )
}
