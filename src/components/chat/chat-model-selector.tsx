import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
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

export function ChatModelSelector({ value, onChange }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
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
    for (const group of modelGroups) {
      const found = group.models.find((m) => m.model === value)
      if (found) return found
    }
    return null
  }, [value, modelGroups])

  if (modelGroups.length === 0) {
    return null
  }

  return (
    <div className="relative">
      <Button
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

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-[300px] rounded-md border bg-popover p-1 shadow-md">
            <div className="max-h-[400px] overflow-y-auto">
              {modelGroups.map((group, groupIdx) => (
                <div key={group.id}>
                  {groupIdx > 0 && <div className="my-1 h-px bg-border" />}
                  <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.label}
                  </div>
                  {group.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        onChange(model.model)
                        setOpen(false)
                      }}
                      className="flex w-full items-start gap-2 rounded-sm px-3 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <Check
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          value === model.model ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{model.name}</div>
                        <code className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {model.model}
                        </code>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
