import { useWikiStore } from "@/stores/wiki-store"
import { useTranslation } from "react-i18next"

export function StorySimulationView() {
  const { t } = useTranslation()
  const projectPath = useWikiStore((s) => s.project?.path)

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
      <h2 className="text-2xl font-bold">{t("storySimulation.title")}</h2>
      <p className="text-muted-foreground">{t("storySimulation.description")}</p>
      <p className="text-sm text-muted-foreground">项目路径: {projectPath}</p>
    </div>
  )
}
