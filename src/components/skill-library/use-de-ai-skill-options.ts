import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  isDeAiSkillConfigCorruptError,
  loadDeAiSkillConfig,
  resolveAvailableDeAiSkills,
  resolveEffectiveDeAiSkill,
  type DeAiSkill,
} from "@/lib/novel/de-ai-skill-library"
import { getDeAiSkillLoadErrorMessage } from "./de-ai-skill-errors"

interface UseDeAiSkillOptionsParams {
  projectPath?: string | null
  selectedSkillId?: string | null
  useLastChapterSkill?: boolean
}

interface DeAiSkillOptionsState {
  loading: boolean
  skills: DeAiSkill[]
  effectiveName: string
  currentSkillId: string | null
  defaultSkillId: string | null
  loadError: string
}

export function useDeAiSkillOptions({
  projectPath,
  selectedSkillId,
  useLastChapterSkill = false,
}: UseDeAiSkillOptionsParams): DeAiSkillOptionsState {
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const [state, setState] = useState<DeAiSkillOptionsState>({
    loading: true,
    skills: [],
    effectiveName: "技能",
    currentSkillId: null,
    defaultSkillId: null,
    loadError: "",
  })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, loading: true, loadError: "" }))
    loadDeAiSkillConfig(projectPath)
      .then((config) => {
        if (cancelled) return
        const skills = resolveAvailableDeAiSkills(config)
        const requestedSkillId = useLastChapterSkill && typeof selectedSkillId === "undefined"
          ? config.lastChapterDeAiSkillId
          : selectedSkillId
        const effectiveSkill = resolveEffectiveDeAiSkill(config, requestedSkillId)
        setState({
          loading: false,
          skills,
          effectiveName: effectiveSkill?.name ?? "未启用",
          currentSkillId: effectiveSkill?.id ?? null,
          defaultSkillId: config.defaultSkillId,
          loadError: "",
        })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          loading: false,
          skills: [],
          effectiveName: isDeAiSkillConfigCorruptError(error) ? "配置损坏" : "未启用",
          currentSkillId: null,
          defaultSkillId: null,
          loadError: getDeAiSkillLoadErrorMessage(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [dataVersion, projectPath, selectedSkillId, useLastChapterSkill])

  return state
}
