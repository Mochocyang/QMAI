import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { WandSparkles, X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { type DeAiSkill } from "@/lib/novel/de-ai-skill-library"
import { useDeAiSkillOptions } from "./use-de-ai-skill-options"

interface DeAiSkillPickerProps {
  value?: string | null
  onChange: (skillId: string | null | undefined) => void
  includeDisableOption?: boolean
  buttonLabel?: string
  iconOnly?: boolean
  showLibraryShortcut?: boolean
}

export { getDeAiSkillLoadErrorMessage } from "./de-ai-skill-errors"

interface DeAiSkillOptionsPanelProps {
  loading: boolean
  errorMessage: string
  emptyMessage: string
  skills: DeAiSkill[]
  currentSkillId?: string | null
  defaultSkillId?: string | null
  modifiedSkillIds: string[]
  onPick: (skillId: string) => void
  onClose?: () => void
}

function getPickerPanelStyle(anchor: HTMLElement): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const panelWidth = 256
  const gap = 8
  const viewportWidth = window.innerWidth || panelWidth
  const left = Math.min(Math.max(rect.left, gap), Math.max(gap, viewportWidth - panelWidth - gap))
  if (rect.top > 320) {
    return {
      left,
      bottom: Math.max(gap, (window.innerHeight || rect.top) - rect.top + gap),
    }
  }
  return {
    left,
    top: rect.bottom + gap,
  }
}

export function DeAiSkillOptionsPanel({
  loading,
  errorMessage,
  emptyMessage,
  skills,
  currentSkillId,
  defaultSkillId,
  modifiedSkillIds,
  onPick,
  onClose,
}: DeAiSkillOptionsPanelProps) {
  const skillIds = useMemo(() => skills.map((skill) => skill.id), [skills])
  const [focusedSkillId, setFocusedSkillId] = useState<string | null>(null)
  const listboxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (skills.length === 0) {
      setFocusedSkillId(null)
      return
    }
    setFocusedSkillId(currentSkillId && skillIds.includes(currentSkillId) ? currentSkillId : skills[0].id)
  }, [currentSkillId, skillIds, skills])

  useEffect(() => {
    if (!loading && !errorMessage && skills.length > 0) {
      listboxRef.current?.focus()
    }
  }, [errorMessage, loading, skills.length])

  if (loading) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">正在读取技能...</div>
  }
  if (errorMessage) {
    return <div className="px-2 py-3 text-xs text-destructive">{errorMessage}</div>
  }
  if (skills.length === 0) {
    return <div className="px-2 py-3 text-xs text-muted-foreground">{emptyMessage}</div>
  }
  return (
    <div
      ref={listboxRef}
      role="listbox"
      tabIndex={0}
      className="max-h-72 overflow-y-auto outline-none"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose?.()
          return
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return
        event.preventDefault()
        const currentIndex = Math.max(0, skillIds.indexOf(focusedSkillId ?? ""))
        if (event.key === "Enter") {
          const pickedSkillId = focusedSkillId ?? skills[currentIndex]?.id
          if (pickedSkillId) onPick(pickedSkillId)
          return
        }
        const offset = event.key === "ArrowDown" ? 1 : -1
        const nextIndex = (currentIndex + offset + skills.length) % skills.length
        setFocusedSkillId(skills[nextIndex].id)
      }}
    >
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          role="option"
          aria-selected={skill.id === focusedSkillId}
          aria-current={skill.id === currentSkillId ? "true" : undefined}
          className={`block w-full rounded px-2 py-2 text-left hover:bg-accent ${
            skill.id === currentSkillId ? "bg-accent text-foreground" : ""
          } ${skill.id === focusedSkillId ? "ring-1 ring-primary/40" : ""}`}
          onMouseEnter={() => setFocusedSkillId(skill.id)}
          onClick={() => onPick(skill.id)}
        >
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">{skill.name}</span>
            {skill.id === currentSkillId ? (
              <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                当前
              </span>
            ) : null}
            {skill.id === defaultSkillId ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                默认
              </span>
            ) : null}
            {modifiedSkillIds.includes(skill.id) ? (
              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
                已修改
              </span>
            ) : null}
          </div>
          {skill.description ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{skill.description}</div>
          ) : null}
        </button>
      ))}
    </div>
  )
}

export function DeAiSkillPicker({
  value,
  onChange,
  includeDisableOption = true,
  buttonLabel,
  iconOnly = false,
  showLibraryShortcut = false,
}: DeAiSkillPickerProps) {
  const project = useWikiStore((s) => s.project)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({ left: 8, top: 8 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const {
    loading,
    skills,
    effectiveName,
    currentSkillId,
    defaultSkillId,
    modifiedSkillIds,
    loadError,
  } = useDeAiSkillOptions({ projectPath: project?.path, selectedSkillId: value })
  const triggerTitle = buttonLabel === "技能库" ? "技能库：选择写作 Skill 或去AI味 Skill" : `当前去AI味 Skill：${effectiveName}`
  const iconTriggerDescription = buttonLabel === "技能库"
    ? `${triggerTitle}。点击打开技能选择`
    : `${triggerTitle}。点击选择去AI味 Skill`

  useEffect(() => {
    if (!open) return
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={(event) => {
          if (!open) {
            setPanelStyle(getPickerPanelStyle(event.currentTarget))
          }
          setOpen((next) => !next)
        }}
        className={iconOnly
          ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          : "flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"}
        title={iconOnly ? iconTriggerDescription : triggerTitle}
        aria-label={iconOnly ? iconTriggerDescription : triggerTitle}
      >
        <WandSparkles className="h-4 w-4" />
        {iconOnly ? null : (
          <span className="max-w-[10rem] truncate">
            {buttonLabel ?? (effectiveName === "未启用" ? "去AI味" : `去AI味：${effectiveName}`)}
          </span>
        )}
      </button>
      {open ? (
        <div
          data-testid="de-ai-skill-picker-popover"
          className="fixed z-50 w-64 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
          style={panelStyle}
        >
          <DeAiSkillOptionsPanel
            loading={loading}
            errorMessage={loadError}
            emptyMessage="暂无可用去AI味技能"
            skills={skills}
            currentSkillId={currentSkillId}
            defaultSkillId={defaultSkillId}
            modifiedSkillIds={modifiedSkillIds}
            onClose={() => setOpen(false)}
            onPick={(skillId) => {
              onChange(skillId)
              setOpen(false)
            }}
          />
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
          {showLibraryShortcut ? (
            <button
              type="button"
              className="mt-1 flex w-full items-center gap-2 rounded border-t px-2 py-2 text-left text-muted-foreground hover:bg-accent"
              onClick={() => {
                setOpen(false)
                setActiveView("writingSkillLibrary")
              }}
            >
              打开完整技能库
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
