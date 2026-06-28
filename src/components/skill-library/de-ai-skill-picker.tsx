import { useEffect, useState } from "react"
import { WandSparkles, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import {
  loadDeAiSkillConfig,
  resolveAvailableDeAiSkills,
  resolveEffectiveDeAiSkill,
  type DeAiSkill,
} from "@/lib/novel/de-ai-skill-library"

interface DeAiSkillPickerProps {
  value?: string | null
  onChange: (skillId: string | null | undefined) => void
  includeDisableOption?: boolean
  buttonLabel?: string
}

export function DeAiSkillPicker({
  value,
  onChange,
  includeDisableOption = true,
  buttonLabel,
}: DeAiSkillPickerProps) {
  const project = useWikiStore((s) => s.project)
  const [open, setOpen] = useState(false)
  const [skills, setSkills] = useState<DeAiSkill[]>([])
  const [effectiveName, setEffectiveName] = useState("技能")

  useEffect(() => {
    let cancelled = false
    loadDeAiSkillConfig(project?.path)
      .then((config) => {
        if (cancelled) return
        const available = resolveAvailableDeAiSkills(config)
        setSkills(available)
        setEffectiveName(resolveEffectiveDeAiSkill(config, value)?.name ?? "未启用")
      })
      .catch(() => {
        if (!cancelled) {
          setSkills([])
          setEffectiveName("未启用")
        }
      })
    return () => {
      cancelled = true
    }
  }, [project?.path, value])

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        title="使用 / 调用命令和技能"
      >
        <WandSparkles className="h-4 w-4" />
        <span className="max-w-[8rem] truncate">{buttonLabel ?? effectiveName}</span>
      </button>
      {open ? (
        <div className="absolute bottom-9 left-0 z-50 w-64 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg">
          {skills.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">暂无可用去AI味技能</div>
          ) : skills.map((skill) => (
            <button
              key={skill.id}
              type="button"
              className="block w-full rounded px-2 py-2 text-left hover:bg-accent"
              onClick={() => {
                onChange(skill.id)
                setOpen(false)
              }}
            >
              <div className="truncate text-sm">{skill.name}</div>
              <div className="truncate text-xs text-muted-foreground">{skill.description}</div>
            </button>
          ))}
          {includeDisableOption ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-muted-foreground hover:bg-accent"
              onClick={() => {
                onChange(null)
                setOpen(false)
              }}
            >
              <X className="h-3.5 w-3.5" />
              关闭去AI味技能
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
