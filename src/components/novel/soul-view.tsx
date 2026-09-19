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
    const sectionLabel = isProjectSoul ? "项目灵魂" : section === "custom" ? "自定义灵魂" : "角色灵魂"
    return (
      <section data-ui-page="soul" data-ui-soul={section} data-ui-state={project ? "ready" : "empty"}>
        <header data-ui="soul-heading">
          <nav aria-label="面包屑" className="ui-test-breadcrumb">
            <span>{project?.name ?? "未选择项目"}</span><span aria-hidden="true">/</span>
            <span>灵魂</span><span aria-hidden="true">/</span><span aria-current="page">{sectionLabel}</span>
          </nav>
          {isProjectSoul && <h1 className="ui-test-page-title">让故事，拥有自己的气质。</h1>}
        </header>
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
      <div className="flex h-full min-h-0 w-full overflow-y-auto">
        <SoulDocEditor />
      </div>
    )
  }

  return <CharacterAuraView hideSidebar />
}
