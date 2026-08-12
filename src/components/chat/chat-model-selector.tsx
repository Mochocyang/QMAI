import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { getEffectiveSavedModels, isProviderAvailable } from "@/lib/llm-model-keys"

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
/** Prefer opening downward when at least this much space exists below the trigger. */
const DROPDOWN_PREFER_BELOW_PX = 200

export type ChatModelDropdownStyle = {
  right: number
  width: number
  maxHeight: number
} & ({ top: number; bottom?: undefined } | { bottom: number; top?: undefined })

/** Pure layout helper — open below when space allows; otherwise open above. */
export function getChatModelDropdownStyle(
  rect: Pick<DOMRect, "top" | "bottom" | "right" | "width">,
  viewport: { width: number; height: number } = {
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  },
): ChatModelDropdownStyle {
  const width = Math.max(rect.width, 280)
  const right = Math.max(4, viewport.width - rect.right)
  const spaceAbove = rect.top
  const spaceBelow = viewport.height - rect.bottom
  const openBelow =
    spaceBelow >= DROPDOWN_PREFER_BELOW_PX || spaceBelow >= spaceAbove

  if (openBelow) {
    return {
      right,
      width,
      top: rect.bottom + DROPDOWN_GAP,
      maxHeight: Math.min(
        DROPDOWN_MAX_HEIGHT,
        Math.max(120, spaceBelow - DROPDOWN_GAP - 4),
      ),
    }
  }

  return {
    right,
    width,
    bottom: viewport.height - rect.top + DROPDOWN_GAP,
    maxHeight: Math.min(
      DROPDOWN_MAX_HEIGHT,
      Math.max(120, spaceAbove - DROPDOWN_GAP - 4),
    ),
  }
}

export function ChatModelSelector({ value, onChange, disabled }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<ChatModelDropdownStyle | null>(null)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  const modelGroups = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    const builtinKeys = Object.keys(providerConfigs).filter((k) => !k.startsWith("custom-"))
    for (const key of builtinKeys) {
      const config = providerConfigs[key]
      if (!isProviderAvailable(key, config)) continue
      const models = getEffectiveSavedModels(config)
      if (models.length > 0) {
        const preset = findLlmPresetById(key)
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
      if (!isProviderAvailable(key, config)) continue
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
    setDropdownStyle(
      getChatModelDropdownStyle(trigger.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    )
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
              top: dropdownStyle.top,
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
