import { useState, useMemo, useRef, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"
import { LLM_PRESETS } from "@/components/settings/llm-presets"

interface ChatModelSelectorProps {
  value: string
  onChange: (model: string) => void
}

interface ModelGroup {
  id: string
  label: string
  models: SavedModel[]
}

const DROPDOWN_MAX_HEIGHT = 400
const DROPDOWN_GAP = 6

export function ChatModelSelector({ value, onChange }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<{ left: number; top: number; width: number } | null>(null)
  const activePresetId = useWikiStore((s) => s.activePresetId)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  // 按预设/卡片分组：内置预设（activePresetId）置顶，然后所有 custom-* 卡片
  const modelGroups = useMemo<ModelGroup[]>(() => {
    const groups: ModelGroup[] = []

    if (activePresetId && !activePresetId.startsWith("custom-")) {
      const config = providerConfigs[activePresetId]
      if (config?.savedModels && config.savedModels.length > 0) {
        const preset = LLM_PRESETS.find((p) => p.id === activePresetId)
        groups.push({
          id: activePresetId,
          label: preset?.label || activePresetId,
          models: config.savedModels,
        })
      }
    }

    const customKeys = Object.keys(providerConfigs).filter((k) => k.startsWith("custom-"))
    for (const key of customKeys) {
      const config = providerConfigs[key]
      // 过滤掉已停用（enabled === false）的卡片
      if (config.enabled === false) continue
      if (config.savedModels && config.savedModels.length > 0) {
        groups.push({
          id: key,
          label: config.label || "自定义模型",
          models: config.savedModels,
        })
      }
    }

    return groups
  }, [activePresetId, providerConfigs])

  const selectedModel = useMemo(() => {
    if (!value) return null
    // 优先按 "providerId/modelId" 格式精确匹配
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
    // 回退：按纯模型名匹配（兼容旧数据）
    for (const group of modelGroups) {
      const found = group.models.find((m) => m.model === value)
      if (found) return found
    }
    return null
  }, [value, modelGroups])

  if (modelGroups.length === 0) {
    return null
  }

  useEffect(() => {
    if (!open) {
      setDropdownStyle(null)
      return
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(rect.width, 300)
      const availableAbove = rect.top
      const availableBelow = window.innerHeight - rect.bottom
      let top: number
      if (availableAbove >= DROPDOWN_MAX_HEIGHT + DROPDOWN_GAP || availableAbove >= availableBelow) {
        top = Math.max(4, rect.top - DROPDOWN_MAX_HEIGHT - DROPDOWN_GAP)
      } else {
        top = rect.bottom + DROPDOWN_GAP
      }
      setDropdownStyle({
        left: Math.min(rect.left, window.innerWidth - width - 4),
        top,
        width,
      })
    }
    updatePosition()
    window.addEventListener("resize", updatePosition)
    return () => window.removeEventListener("resize", updatePosition)
  }, [open])

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(!open)}
        className="h-8 min-w-[160px] justify-between gap-2 px-3 text-xs"
      >
        <span className="max-w-[200px] truncate">
          {selectedModel?.name ?? value ?? t("chat.selectModel")}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </Button>

      {open && dropdownStyle && createPortal(
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-50 rounded-md border bg-popover p-1 shadow-md"
            style={{
              left: dropdownStyle.left,
              top: dropdownStyle.top,
              width: dropdownStyle.width,
              maxHeight: DROPDOWN_MAX_HEIGHT,
              overflowY: "auto",
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
