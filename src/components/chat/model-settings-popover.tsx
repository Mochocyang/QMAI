import { useCallback, useMemo, useState, type CSSProperties, type Ref } from "react"
import { useTranslation } from "react-i18next"
import { useWikiStore, type ProviderOverride } from "@/stores/wiki-store"
import { findLlmPresetById } from "@/components/settings/llm-presets"
import { CONTEXT_PRESETS } from "@/components/settings/context-size-selector"
import { OUTPUT_TOKEN_PRESETS } from "@/components/settings/output-tokens-selector"
import { saveProviderConfigs } from "@/lib/project-store"
import {
  MIN_USER_LLM_CONTEXT_SIZE,
  normalizeUserLlmContextSize,
  normalizeUserLlmMaxOutputTokens,
} from "@/lib/llm-context-size"
import {
  DEFAULT_REASONING_DEPTH,
  REASONING_DEPTH_STEPS,
  type ReasoningDepth,
} from "@/lib/reasoning-depth"
import { resolveModelConfig } from "@/lib/novel/model-resolver"
import { modelSupportsReasoningControl } from "@/lib/llm-providers"
import { safeModelError } from "@/components/uitest/models/model-feedback"

/**
 * 面板宽度。320px 是按「上下文窗口」六个档位（200K/256K/300K/400K/512K/1M）
 * 单排放下量出来的：280px 时 1M 会被挤到第二行，加宽到这里才一行装得下。
 * 改宽度要连 `getModelSettingsPanelStyle` 的钳制逻辑一起看。
 */
export const MODEL_SETTINGS_PANEL_WIDTH = 320
/** 弹窗与模型按钮之间的缝（悬停移入时靠它过渡）。 */
const PANEL_GAP = 8
const PANEL_MAX_HEIGHT = 430

export interface ModelSettingsPanelStyle {
  right: number
  bottom: number
  width: number
  maxHeight: number
}

/**
 * 弹窗开在模型按钮**左侧**、底边对齐（按钮在聊天框右下角，往下没有空间）。
 *
 * 纯函数：只吃两个矩形，返回 fixed 定位要的四个数，方便单独测。
 */
export function getModelSettingsPanelStyle(
  rect: Pick<DOMRect, "top" | "bottom" | "left">,
  viewport: { width: number; height: number },
): ModelSettingsPanelStyle {
  const width = Math.min(MODEL_SETTINGS_PANEL_WIDTH, Math.max(0, viewport.width - 8))
  const desiredRight = viewport.width - rect.left + PANEL_GAP
  // 面板整体必须留在窗口里：左侧空间不够时往右贴，不让它被切掉。
  const right = Math.max(4, Math.min(desiredRight, Math.max(4, viewport.width - width - 4)))
  const bottom = Math.max(4, viewport.height - rect.bottom)
  return {
    right,
    bottom,
    width,
    maxHeight: Math.max(160, Math.min(PANEL_MAX_HEIGHT, rect.bottom - 12)),
  }
}

/** 当前值可能来自旧配置（不在档位表里），取最近的一档高亮，与设置页选择器一致。 */
function closestIndex<T extends { value: number }>(presets: readonly T[], value: number): number {
  return presets.reduce(
    (best, preset, index) =>
      Math.abs(preset.value - value) < Math.abs(presets[best].value - value) ? index : best,
    0,
  )
}

interface ModelSettingsPopoverProps {
  /** 形如 `zifeiyu/kimi-k2`；写回时按它定位供应商配置。 */
  providerId: string
  modelId: string
  /** 模型显示名（由选择器算好传进来，避免两个组件互相 import）。 */
  modelTitle: string
  style: ModelSettingsPanelStyle
  onPointerEnter: () => void
  onPointerLeave: () => void
  /**
   * 点在面板里的任意位置（含档位胶囊、开关）都要告诉选择器「用户已经在用了」：
   * 那样它就不再因为鼠标离开而收起，只等点击外部或点模型按钮才关。
   */
  onPointerDown: () => void
  /** 交给选择器做「点外面才关」的命中判断。 */
  panelRef?: Ref<HTMLDivElement>
}

/**
 * 模型悬停弹窗：推理程度 / 上下文窗口 / 输出上限 / 启用 Function Calling。
 *
 * 改动即时写回「设置 → 模型设置 → 该供应商」，与设置页共用同一份 `providerConfigs`，
 * 因此这里没有「保存」按钮：改完就作用于下一次请求。
 *
 * 输出上限的最矮档位是 48K，已经高于任何思考档需要的 16K 底线，
 * 所以这里不需要像设置页那样把档位与输出预算联动抬高。
 */
export function ModelSettingsPopover({
  providerId,
  modelId,
  modelTitle,
  style,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  panelRef,
}: ModelSettingsPopoverProps) {
  const { t } = useTranslation()
  const providerConfigs = useWikiStore((s) => s.providerConfigs)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const override = providerConfigs[providerId]
  const preset = useMemo(() => findLlmPresetById(providerId) ?? findLlmPresetById("custom"), [providerId])

  const contextValue = normalizeUserLlmContextSize(
    override?.maxContextSize ?? preset?.suggestedContextSize ?? MIN_USER_LLM_CONTEXT_SIZE,
  )
  const outputValue = normalizeUserLlmMaxOutputTokens(
    override?.maxOutputTokens ?? preset?.suggestedMaxOutputTokens,
  )
  const reasoningMode: ReasoningDepth = override?.reasoning?.mode === "auto"
    ? DEFAULT_REASONING_DEPTH
    : (REASONING_DEPTH_STEPS as readonly string[]).includes(String(override?.reasoning?.mode))
      ? (override?.reasoning?.mode as ReasoningDepth)
      : DEFAULT_REASONING_DEPTH
  const reasoningIsCustom = override?.reasoning?.mode === "custom"
  const functionCalling = override?.functionCallingEnabled !== false

  // 模型浏览器控制不了思考时不给旋钮：宁可写清原因，也不给一个点了没反应的按钮。
  const reasoningSupported = useMemo(
    () => modelSupportsReasoningControl(resolveModelConfig(`${providerId}/${modelId}`, llmConfig, providerConfigs)),
    [providerId, modelId, llmConfig, providerConfigs],
  )

  const patch = useCallback(
    async (next: Partial<ProviderOverride>) => {
      if (saving) return
      const state = useWikiStore.getState()
      const current = state.providerConfigs[providerId] ?? {}
      const merged = { ...state.providerConfigs, [providerId]: { ...current, ...next } }
      setSaving(true)
      setError(null)
      try {
        // 先落盘再改运行配置：写失败时界面与真正生效的值保持一致。
        await saveProviderConfigs(merged)
        useWikiStore.getState().setProviderConfigs(merged)
      } catch (cause) {
        setError(`保存失败：${safeModelError(cause, [current.apiKey ?? ""])}；本次改动未生效。`)
      } finally {
        setSaving(false)
      }
    },
    [providerId, saving],
  )

  const pillClass = (active: boolean) =>
    // `whitespace-nowrap`：单个档位再长也不在内部断行，只允许整颗换行。
    `rounded-[5px] border px-[7px] py-[3.5px] text-[0.65625rem] leading-[1.3] whitespace-nowrap transition-colors ${
      active
        ? "border-primary bg-primary font-semibold text-primary-foreground"
        : "border-border bg-transparent text-muted-foreground hover:bg-accent"
    } ${saving ? "cursor-not-allowed opacity-60" : ""}`

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${modelTitle} 的生成设置`}
      data-model-settings-panel={providerId}
      className="rounded-md border bg-popover shadow-lg"
      style={{ ...(style as CSSProperties), position: "fixed", zIndex: 9999, overflowY: "auto" }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      onMouseDown={onPointerDown}
    >
      <div className="border-b px-3 py-2.5">
        <div className="truncate text-xs font-semibold">{modelTitle}</div>
        <div className="mt-0.5 truncate text-[0.625rem] text-muted-foreground">
          {preset?.label ?? override?.label ?? providerId} · 当前对话使用中
        </div>
      </div>

      <div className="px-1 py-1">
        <section className="border-b border-dashed px-2 py-2.5">
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-[0.71875rem] text-muted-foreground">推理程度</span>
            {reasoningSupported ? (
              <span className="text-[0.71875rem] font-semibold">
                {reasoningIsCustom
                  ? `自定义 ${override?.reasoning?.budgetTokens ?? ""}`.trim()
                  : t(`chat.reasoningDepth.${reasoningMode}`)}
              </span>
            ) : (
              <span className="rounded bg-amber-50 px-1 py-0.5 text-[0.59375rem] text-amber-700 dark:bg-amber-950 dark:text-amber-500">
                该模型不支持
              </span>
            )}
          </div>
          <div className={`flex flex-wrap gap-1 ${reasoningSupported ? "" : "opacity-40"}`}>
            {REASONING_DEPTH_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                disabled={saving || !reasoningSupported}
                aria-pressed={!reasoningIsCustom && reasoningMode === step}
                onClick={() => void patch({ reasoning: { ...override?.reasoning, mode: step } })}
                className={pillClass(!reasoningIsCustom && reasoningMode === step)}
              >
                {t(`chat.reasoningDepth.${step}`)}
              </button>
            ))}
            {reasoningIsCustom && (
              <button type="button" disabled className={pillClass(true)} aria-pressed>
                自定义
              </button>
            )}
          </div>
        </section>

        <section className="border-b border-dashed px-2 py-2.5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-muted-foreground">上下文窗口</span>
            <span className="text-[0.71875rem] font-semibold">
              {CONTEXT_PRESETS[closestIndex(CONTEXT_PRESETS, contextValue)].label}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {CONTEXT_PRESETS.map((item, index) => (
              <button
                key={item.value}
                type="button"
                disabled={saving}
                aria-pressed={index === closestIndex(CONTEXT_PRESETS, contextValue)}
                onClick={() => void patch({ maxContextSize: item.value })}
                className={pillClass(index === closestIndex(CONTEXT_PRESETS, contextValue))}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="border-b border-dashed px-2 py-2.5">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[0.71875rem] text-muted-foreground">输出上限</span>
            <span className="text-[0.71875rem] font-semibold">
              {OUTPUT_TOKEN_PRESETS[closestIndex(OUTPUT_TOKEN_PRESETS, outputValue)].label}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {OUTPUT_TOKEN_PRESETS.map((item, index) => (
              <button
                key={item.value}
                type="button"
                disabled={saving}
                aria-pressed={index === closestIndex(OUTPUT_TOKEN_PRESETS, outputValue)}
                onClick={() => void patch({ maxOutputTokens: item.value })}
                className={pillClass(index === closestIndex(OUTPUT_TOKEN_PRESETS, outputValue))}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-between gap-2 px-2 py-2.5">
          {/*
            文案用「开启工具调用」而不是「Function Calling」：后者是技术名词，
            用户看不出这个开关会影响读资料、写章节、搜索这些动作。
            详细说明只放在设置页，弹窗里不铺文字。
          */}
          <span className="text-[0.71875rem] text-muted-foreground">开启工具调用</span>
          <button
            type="button"
            role="switch"
            aria-checked={functionCalling}
            aria-label="开启工具调用"
            disabled={saving}
            onClick={() => void patch({ functionCallingEnabled: !functionCalling })}
            className={`relative h-[17px] w-[30px] shrink-0 rounded-full transition-colors ${
              functionCalling ? "bg-primary" : "bg-muted"
            } ${saving ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <span
              className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-background transition-[left] ${
                functionCalling ? "left-[15px]" : "left-[2px]"
              }`}
            />
          </button>
        </section>
      </div>

      {/* 平时不占地方：只在写盘失败时才出现，把原因说清楚。 */}
      {error && (
        <div className="border-t px-3 py-2 text-[0.59375rem] leading-[1.55] text-amber-600 dark:text-amber-500">
          {error}
        </div>
      )}
    </div>
  )
}
