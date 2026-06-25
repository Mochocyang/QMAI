import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"

export function useNovelLabel(originalKey: string, novelKey: string): string {
  const { t } = useTranslation()
  const novelMode = useWikiStore((s) => s.novelMode)
  return novelMode ? t(novelKey) : t(originalKey)
}

export function useNovelMode(): boolean {
  return useWikiStore((s) => s.novelMode)
}
