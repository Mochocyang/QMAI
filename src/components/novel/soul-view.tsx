import { useWikiStore } from "@/stores/wiki-store"
import { IS_UI_TEST_BUILD } from "@/lib/ui-test"
import "@/components/uitest/ui-test-tools.css"
import { SoulDocEditor } from "./soul-doc-editor"
import { CharacterAuraView } from "./character-aura-view"

export function SoulView() {
  const selectedSoulId = useWikiStore((s) => s.selectedSoulId)
  const selectedSoulTab = useWikiStore((s) => s.selectedSoulTab)
  const selectedSoulSection = useWikiStore((s) => s.selectedSoulSection)
  const project = useWikiStore((s) => s.project)

  if (IS_UI_TEST_BUILD) {
    const isProjectSoul = selectedSoulTab === "project" || selectedSoulId === "project-soul"
    const section = isProjectSoul ? "project" : selectedSoulSection === "custom" ? "custom" : "role"
    return (
      <section data-ui-page="soul" data-ui-soul={section} data-ui-state={project ? "ready" : "empty"}>
        {isProjectSoul ? (
          project ? <div data-ui="soul-project-editor"><SoulDocEditor /></div>
            : <p className="ui-test-empty-state">请先打开一本书，再编辑项目灵魂。</p>
        ) : (
          <div data-ui="soul-role-content"><CharacterAuraView hideSidebar /></div>
        )}
      </section>
    )
  }

  if (selectedSoulTab === "project" || selectedSoulId === "project-soul") {
    return (
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        <SoulDocEditor />
      </div>
    )
  }

  return <CharacterAuraView hideSidebar />
}
