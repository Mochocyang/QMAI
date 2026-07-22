import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"
import { getEffectiveSavedModels } from "@/lib/llm-model-keys"

interface ChatModelSelectorProps {
  value: string
  onChange: (model: string) => void
  disabled?: boolean
}

interface ModelGroup {
  id: string
  label: string
  models: SavedModel[]
}

const DROPDOWN_MAX_HEIGHT = 360
const DROPDOWN_GAP = 4

export function ChatModelSelector({ value, onChange, disabled }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<{ right: number; bottom: number; width: number; maxHeight: number } | null>(null)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  const modelGroups = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    const builtinKeys = Object.keys(providerConfigs).filter((k) => !k.startsWith("custom-"))
    for (const key of builtinKeys) {
      const config = providerConfigs[key]
      const hasConfig = config.enabled === true
        || ((config.apiKey || config.savedModels?.length) && (config.model || config.savedModels?.length))
      if (!hasConfig) continue
      const models = getEffectiveSavedModels(config)
      if (models.length > 0) {
        const preset = LLM_PRESETS.find((p) => p.id === key)
        groups.push({
          id: key,
          label: preset?.label || config.label || key,
          models,
        })
      }
    }

    const customKeys = Object.keys(providerConfigs).filter((k) => k.startsWith("custom-"))
    for (const key of customKeys) {
      const config = providerConfigs[key]
      if (config.enabled === false) continue
      const models = getEffectiveSavedModels(config)
      if (models.length > 0) {
        groups.push({
          id: key,
          label: config.label || "自定义模型",
          models,
        })
      }
    }

    return groups
  }, [providerConfigs])

  const selectedModel = useMemo(() => {
    if (!value) return null
    const slashIdx = value.indexOf("/")
    if (slashIdx > 0) {
      const providerId = value.slice(0, slashIdx)
      const modelId = value.slice(slashIdx + 1)
      const group = modelGroups.find((g) => g.id === providerId)
      if (group) {
        const found = group.models.find((m) => m.model === modelId)
        if (found) return found
      }
    }
    for (const group of modelGroups) {
      const found = group.models.find((m) => m.model === value)
      if (found) return found
    }
    return null
  }, [value, modelGroups])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.max(rect.width, 280)
    const right = Math.max(4, viewportWidth - rect.right)
    const spaceAbove = rect.top
    const spaceBelow = viewportHeight - rect.bottom
    let maxHeight: number
    let bottom: number
    if (spaceBelow >= 200) {
      maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, spaceBelow - DROPDOWN_GAP - 4)
      bottom = viewportHeight - rect.bottom - DROPDOWN_GAP
    } else {
      maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, Math.max(150, spaceAbove - DROPDOWN_GAP - 4))
      bottom = viewportHeight - rect.top + DROPDOWN_GAP
    }
    setDropdownStyle({ right, bottom, width, maxHeight })
  }, [])

  useEffect(() => {
    if (!open) {
      setDropdownStyle(null)
      return
    }
    let frame2 = 0
    const frame1 = requestAnimationFrame(() => {
      frame2 = requestAnimationFrame(() => {
        updatePosition()
      })
    })
    const handleReposition = () => updatePosition()
    window.addEventListener("resize", handleReposition)
    window.addEventListener("scroll", handleReposition, true)
    return () => {
      cancelAnimationFrame(frame1)
      cancelAnimationFrame(frame2)
      window.removeEventListener("resize", handleReposition)
      window.removeEventListener("scroll", handleReposition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open])

  if (modelGroups.length === 0) {
    return null
  }

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="h-8 w-32 justify-between gap-2 px-3 text-xs"
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {selectedModel?.name ?? (value && value.trim() ? value : t("chat.selectModel"))}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {open && dropdownStyle && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            ref={dropdownRef}
            className="fixed rounded-md border bg-popover p-1 shadow-lg model-selector-dropdown"
            style={{
              right: dropdownStyle.right,
              bottom: dropdownStyle.bottom,
              width: dropdownStyle.width,
              maxHeight: dropdownStyle.maxHeight,
              overflowY: "auto",
              zIndex: 9999,
            }}
          >
            {modelGroups.map((group, groupIdx) => (
              <div key={group.id}>
                {groupIdx > 0 && <div className="my-1 h-px bg-border" />}
                <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </div>
                {group.models.map((model) => {
                  const modelKey = `${group.id}/${model.model}`
                  return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => {
                      onChange(modelKey)
                      setOpen(false)
                    }}
                    className="flex w-full items-start gap-2 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Check
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        value === modelKey ? "opacity-100" : "opacity-0"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{model.name}</div>
                      <code className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {model.model}
                      </code>
                    </div>
                  </button>
                  )
                })}
              </div>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
