import { useState, useMemo, useEffect, useRef } from "react"
import { Plus, Trash2, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useWikiStore, type ProviderOverride, type SavedModel, type ReasoningConfig } from "@/stores/wiki-store"
import { ContextSizeSelector } from "../context-size-selector"
import { resolveConfig } from "../preset-resolver"
import { fetchLlmModelList } from "@/lib/settings-model-list"
import { testSettingsLlmModel } from "@/lib/settings-model-test"
import { useTranslation } from "react-i18next"
import { ReasoningControls } from "./llm-provider-section"

interface CustomProviderCard {
  id: string
  label: string
  apiMode: "chat_completions" | "responses" | "anthropic_messages"
  baseUrl: string
  apiKey: string
  model: string
  maxContextSize?: number
  reasoning?: ReasoningConfig
  enabled: boolean
  savedModels: SavedModel[]
}

export function CustomProviderCards() {
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const setProviderConfigs = useWikiStore((s) => s.setProviderConfigs)
  const activePresetId = useWikiStore((s) => s.activePresetId)
  const setActivePresetId = useWikiStore((s) => s.setActivePresetId)

  // Load existing custom provider configs as cards
  const [cards, setCards] = useState<CustomProviderCard[]>(() => {
    const customKeys = Object.keys(providerConfigs).filter((k) => k.startsWith("custom-"))
    return customKeys.map((key) => {
      const config = providerConfigs[key]
      return {
        id: key,
        label: config.label || "自定义模型",
        apiMode: config.apiMode || "chat_completions",
        baseUrl: config.baseUrl || "",
        apiKey: config.apiKey || "",
        model: config.model || "",
        maxContextSize: config.maxContextSize,
        reasoning: config.reasoning,
        enabled: config.enabled ?? true,
        savedModels: config.savedModels || [],
      }
    })
  })

  function addCard() {
    const newId = `custom-${Date.now()}`
    const newCard: CustomProviderCard = {
      id: newId,
      label: "自定义模型",
      apiMode: "chat_completions",
      baseUrl: "",
      apiKey: "",
      model: "",
      enabled: true,
      savedModels: [],
    }
    setCards([...cards, newCard])

    // Also add to store
    const newConfigs = {
      ...providerConfigs,
      [newId]: {
        label: newCard.label,
        apiMode: newCard.apiMode,
        baseUrl: newCard.baseUrl,
        apiKey: newCard.apiKey,
        model: newCard.model,
        enabled: true,
        savedModels: newCard.savedModels,
      },
    }
    setProviderConfigs(newConfigs)
    persistConfigs(newConfigs)
  }

  function updateCard(id: string, updates: Partial<CustomProviderCard>) {
    setCards(cards.map((c) => (c.id === id ? { ...c, ...updates } : c)))

    // Update store — 用 ?? 回退到 store 已有值，避免 updates 中未指定的字段被 undefined 覆盖
    const prev = providerConfigs[id] ?? {}
    const updatedConfig: ProviderOverride = {
      ...prev,
      label: updates.label ?? prev.label,
      apiMode: updates.apiMode ?? prev.apiMode,
      baseUrl: updates.baseUrl ?? prev.baseUrl,
      apiKey: updates.apiKey ?? prev.apiKey,
      model: updates.model ?? prev.model,
      maxContextSize: updates.maxContextSize ?? prev.maxContextSize,
      reasoning: updates.reasoning ?? prev.reasoning,
      enabled: updates.enabled ?? prev.enabled ?? true,
      savedModels: updates.savedModels ?? prev.savedModels,
    }
    const newConfigs = {
      ...providerConfigs,
      [id]: updatedConfig,
    }
    setProviderConfigs(newConfigs)
    persistConfigs(newConfigs)
  }

  function deleteCard(id: string) {
    if (!confirm("确定删除此配置吗？")) return

    setCards(cards.filter((c) => c.id !== id))

    // Remove from store
    const newConfigs = { ...providerConfigs }
    delete newConfigs[id]
    setProviderConfigs(newConfigs)

    // If this was active, deactivate
    if (activePresetId === id) {
      setActivePresetId(null)
      persistActiveId(null)
    }

    persistConfigs(newConfigs)
  }

  function toggleEnabled(id: string) {
    const card = cards.find((c) => c.id === id)
    if (!card) return
    updateCard(id, { enabled: !card.enabled })
  }

  async function persistConfigs(newConfigs: typeof providerConfigs) {
    const { saveProviderConfigs } = await import("@/lib/project-store")
    await saveProviderConfigs(newConfigs)
  }

  async function persistActiveId(id: string | null) {
    const { saveActivePresetId } = await import("@/lib/project-store")
    await saveActivePresetId(id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium">自定义模型配置</h3>
        <Button type="button" variant="outline" size="sm" onClick={addCard}>
          <Plus className="mr-1.5 h-4 w-4" />
          添加模型
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          暂未添加任何模型配置
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((card) => (
            <CustomProviderCardItem
              key={card.id}
              card={card}
              isEnabled={card.enabled}
              onUpdate={(updates) => updateCard(card.id, updates)}
              onDelete={() => deleteCard(card.id)}
              onToggleEnabled={() => toggleEnabled(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface CustomProviderCardItemProps {
  card: CustomProviderCard
  isEnabled: boolean
  onUpdate: (updates: Partial<CustomProviderCard>) => void
  onDelete: () => void
  onToggleEnabled: () => void
}

function CustomProviderCardItem({
  card,
  isEnabled,
  onUpdate,
  onDelete,
  onToggleEnabled,
}: CustomProviderCardItemProps) {
  const { t } = useTranslation()
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isCardExpanded, setIsCardExpanded] = useState(false)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [modelListState, setModelListState] = useState<{
    loading: boolean
    success: boolean
    message: string
  } | null>(null)
  const [modelTestState, setModelTestState] = useState<{
    loading: boolean
    success: boolean
    message: string
  } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const llmConfig = useWikiStore((s) => s.llmConfig)

  // 自动调整 textarea 高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px"
    }
  }, [card.savedModels])

  const resolvedConfig = useMemo(() => {
    const preset = {
      id: card.id,
      label: card.label,
      provider: "custom" as const,
      baseUrl: card.baseUrl,
      apiMode: card.apiMode,
      defaultModel: card.model,
    }
    const override = {
      apiKey: card.apiKey,
      model: card.model,
      baseUrl: card.baseUrl,
      apiMode: card.apiMode,
      maxContextSize: card.maxContextSize,
    }
    return resolveConfig(preset, override, llmConfig)
  }, [card, llmConfig])

  async function loadModelOptions() {
    setModelListState({
      loading: true,
      success: false,
      message: t("settings.sections.shared.loadingModels"),
    })

    try {
      const result = await fetchLlmModelList(resolvedConfig)
      setModelOptions(result.models)

      // 自动将所有模型设置为可用（如果之前没有选择）
      if (card.savedModels.length === 0) {
        const autoSavedModels: SavedModel[] = result.models.map((modelId, index) => ({
          id: `model-${Date.now()}-${index}`,
          name: modelId,
          model: modelId,
          apiKey: card.apiKey,
          customEndpoint: card.baseUrl,
          createdAt: Date.now(),
        }))
        onUpdate({ savedModels: autoSavedModels })
      }

      // 拉取成功后自动展开模型选择区域
      setIsExpanded(true)

      setModelListState({
        loading: false,
        success: true,
        message: `已拉取 ${result.models.length} 个模型`,
      })
    } catch (error) {
      setModelListState({
        loading: false,
        success: false,
        message: t("settings.sections.shared.modelListFailed", {
          message: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }

  async function testSelectedModels() {
    if (card.savedModels.length === 0) {
      setModelTestState({
        loading: false,
        success: false,
        message: "没有选择任何模型",
      })
      return
    }

    setModelTestState({
      loading: true,
      success: false,
      message: `正在测试 ${card.savedModels.length} 个模型...`,
    })

    const results: { model: string; success: boolean; error?: string }[] = []

    for (const savedModel of card.savedModels) {
      const testConfig = {
        ...resolvedConfig,
        model: savedModel.model,
      }

      try {
        await testSettingsLlmModel(testConfig)
        results.push({ model: savedModel.model, success: true })
      } catch (error) {
        results.push({
          model: savedModel.model,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failedModels = results.filter((r) => !r.success)

    if (successCount === card.savedModels.length) {
      setModelTestState({
        loading: false,
        success: true,
        message: `测试完成：${successCount}/${card.savedModels.length} 个模型可用`,
      })
    } else {
      setModelTestState({
        loading: false,
        success: false,
        message: `测试完成：${successCount}/${card.savedModels.length} 个模型可用，${failedModels.map((f) => f.model).join(", ")} 不可用`,
      })
    }
  }

  function toggleModelSelection(modelId: string) {
    const isSelected = card.savedModels.some((m) => m.model === modelId)

    let updatedModels: SavedModel[]

    if (isSelected) {
      updatedModels = card.savedModels.filter((m) => m.model !== modelId)
    } else {
      const newModel: SavedModel = {
        id: `model-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: modelId,
        model: modelId,
        apiKey: card.apiKey,
        customEndpoint: card.baseUrl,
        createdAt: Date.now(),
      }
      updatedModels = [...card.savedModels, newModel]
    }

    onUpdate({ savedModels: updatedModels })
  }

  // 从 baseUrl 中提取 host 用于 hint 提示，例如 "https://api.openai.com/v1" → "api.openai.com"
  const baseUrlHint = useMemo(() => {
    if (!card.baseUrl) return "未配置"
    try {
      const url = new URL(card.baseUrl)
      return url.host || card.baseUrl
    } catch {
      return card.baseUrl
    }
  }, [card.baseUrl])

  return (
    <div
      className={`rounded-lg border transition-all ${
        isEnabled ? "border-primary/60 bg-primary/5" : "border-border"
      }`}
    >
      {/* Header — 与 PresetRow 完全一致的结构（label + hint 两行） */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setIsCardExpanded(!isCardExpanded)}
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent"
          title={isCardExpanded ? "收起" : "展开"}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isCardExpanded ? "" : "-rotate-90"}`}
          />
        </button>
        <div className="min-w-0 flex-1 text-left">
          {isEditingLabel ? (
            <div className="flex items-center gap-2">
              <Input
                autoFocus
                value={card.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                onBlur={() => setIsEditingLabel(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    setIsEditingLabel(false)
                  }
                }}
                className="min-w-0 flex-1 border-0 shadow-none focus-visible:ring-0 text-sm h-auto px-1 py-0"
                placeholder="配置名称"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingLabel(true)}
              className="block w-full text-left"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium hover:text-primary">
                  {card.label || "配置名称"}
                </span>
              </div>
            </button>
          )}
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {baseUrlHint}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleEnabled}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors ${
              isEnabled
                ? "border-primary bg-primary"
                : "border-muted-foreground/30 bg-muted-foreground/20 hover:bg-muted-foreground/30"
            }`}
            title={isEnabled ? "停用" : "启用"}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm ring-1 ring-black/10 transition-transform ${
                isEnabled ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Card Content - Collapsible */}
      {isCardExpanded && (
        <div className="space-y-4 border-t bg-background/50 px-4 py-3">
          {/* API Mode */}
          <div className="space-y-2">
            <Label className="text-xs">API 模式</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: "chat_completions", label: "OpenAI 兼容" },
                { value: "responses", label: "Responses API" },
                { value: "anthropic_messages", label: "Anthropic 兼容" },
              ].map((mode) => (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => onUpdate({ apiMode: mode.value as any })}
                  className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                    card.apiMode === mode.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-accent"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor={`${card.id}-url`} className="text-xs">
              接口地址
            </Label>
            <Input
              id={`${card.id}-url`}
              value={card.baseUrl}
              onChange={(e) => onUpdate({ baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
              className="text-sm"
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor={`${card.id}-key`} className="text-xs">
              API 密钥
            </Label>
            <Input
              id={`${card.id}-key`}
              type="password"
              value={card.apiKey}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="text-sm"
            />
          </div>

          {/* Fetched Models Display and Selection */}
          {modelOptions.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="flex items-center gap-2 text-xs font-medium hover:text-primary"
                >
                  <span>已拉取 {modelOptions.length} 个模型</span>
                  <span className="text-muted-foreground">已选择 {card.savedModels.length} 个</span>
                </button>
              </div>

              {isExpanded && (
                <>
                  <div className="text-xs text-muted-foreground">
                    点击模型标签选择/取消，未选择时默认全部可用
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {modelOptions.map((modelId) => {
                      const isSelected = card.savedModels.some((m) => m.model === modelId)
                      return (
                        <button
                          key={modelId}
                          type="button"
                          onClick={() => toggleModelSelection(modelId)}
                          className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background hover:bg-accent"
                          }`}
                        >
                          {modelId}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Model - Display selected models */}
          <div className="space-y-2">
            <Label htmlFor={`${card.id}-model`} className="text-xs">
              模型
            </Label>
            <textarea
              ref={textareaRef}
              id={`${card.id}-model`}
              value={modelOptions.length > 0 ? card.savedModels.map((m) => m.model).join(", ") : ""}
              readOnly
              placeholder="请先拉取并选择模型"
              className="flex min-h-[40px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              rows={1}
            />
          </div>

          {/* Test and Fetch Buttons */}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadModelOptions()}
                disabled={modelListState?.loading || modelTestState?.loading}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelListState?.loading
                  ? t("settings.sections.llm.loadingModels")
                  : t("settings.sections.llm.fetchModels")}
              </button>
              <button
                type="button"
                onClick={() => void testSelectedModels()}
                disabled={modelListState?.loading || modelTestState?.loading || card.savedModels.length === 0}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              >
                {modelTestState?.loading
                  ? t("settings.sections.shared.testing")
                  : t("settings.sections.shared.testModel")}
              </button>
            </div>
            {modelListState?.message ? (
              <p className={`text-xs ${modelListState.success ? "text-emerald-600" : "text-destructive"}`}>
                {modelListState.message}
              </p>
            ) : null}
            {modelTestState?.message ? (
              <p className={`text-xs ${modelTestState.success ? "text-emerald-600" : "text-destructive"}`}>
                {modelTestState.message}
              </p>
            ) : null}
          </div>

          {/* Context Size */}
          <div className="space-y-2">
            <Label className="text-xs">{t("settings.sections.llm.contextWindow")}</Label>
            <ContextSizeSelector
              value={card.maxContextSize ?? 131072}
              onChange={(v) => onUpdate({ maxContextSize: v })}
            />
          </div>

          {/* Reasoning / thinking */}
          <ReasoningControls
            value={card.reasoning ?? { mode: "auto" }}
            onChange={(reasoning) => onUpdate({ reasoning })}
          />

          {/* Delete */}
          <div className="flex justify-end border-t pt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              删除此配置
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
