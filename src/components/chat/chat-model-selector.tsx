import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ChevronDown, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWikiStore, type SavedModel } from "@/stores/wiki-store"

interface ChatModelSelectorProps {
  value: string
  onChange: (model: string) => void
}

export function ChatModelSelector({ value, onChange }: ChatModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const activePresetId = useWikiStore((s) => s.activePresetId)
  const providerConfigs = useWikiStore((s) => s.providerConfigs)

  const savedModels = useMemo(() => {
    if (!activePresetId) return []
    const config = providerConfigs[activePresetId]
    return config?.savedModels ?? []
  }, [activePresetId, providerConfigs])

  const selectedModel = useMemo(() => {
    if (!value) return null
    const saved = savedModels.find((m) => m.model === value)
    return saved ?? null
  }, [value, savedModels])

  if (savedModels.length === 0) {
    return null
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(!open)}
        className="h-8 justify-between gap-2 px-3 text-xs"
      >
        <span className="max-w-[160px] truncate">
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
          <div className="absolute left-0 top-full z-50 mt-1 w-[300px] rounded-md border bg-popover p-1 shadow-md">
            <div className="max-h-[300px] overflow-auto">
              {savedModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onChange(model.model)
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      value === model.model ? "opacity-100" : "opacity-0"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                    </div>
                    <code className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {model.model}
                    </code>
                    {model.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {model.description}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
