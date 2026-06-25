import { useWikiStore } from "@/stores/wiki-store"
import { SoulDocEditor } from "./soul-doc-editor"
import { CharacterAuraView } from "./character-aura-view"
import { DeAiSkillEditor } from "./de-ai-skill-editor"

export function SoulView() {
  const selectedSoulId = useWikiStore((s) => s.selectedSoulId)
  const selectedSoulTab = useWikiStore((s) => s.selectedSoulTab)

  if (selectedSoulId === "de-ai-skill") {
    return (
      <div className="flex h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <DeAiSkillEditor />
        </div>
      </div>
    )
  }

  if (selectedSoulTab === "project" || selectedSoulId === "project-soul") {
    return (
      <div className="flex h-full overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <SoulDocEditor />
        </div>
      </div>
    )
  }

  return <CharacterAuraView hideSidebar />
}
