import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Brain } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "@/components/ui/button"
import { getChatModelDropdownStyle } from "@/components/chat/chat-model-selector"
import { modelSupportsReasoningControl } from "@/lib/llm-providers"
import {
  REASONING_DEPTH_STEPS,
  reasoningDepthFromIndex,
  reasoningDepthToIndex,
  type ReasoningDepth,
} from "@/lib/reasoning-depth"
import type { LlmConfig } from "@/stores/wiki-store"

interface ReasoningDepthControlProps {
  value: ReasoningDepth
  onChange: (depth: ReasoningDepth) => void
  /**
   * The config the depth will be stamped onto. `null`, or a model whose
   * thinking cannot be steered, hides the control entirely — a visible knob
   * that the wire would drop is worse than no knob.
   */
  modelConfig: LlmConfig | null
  disabled?: boolean
}

const SLIDER_TRACK_FILLED = "#4f46e5"
const SLIDER_TRACK_EMPTY = "#e5e7eb"

export function ReasoningDepthControl({
  value,
  onChange,
  modelConfig,
  disabled,
}: ReasoningDepthControlProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [dropdownStyle, setDropdownStyle] = useState<
    ReturnType<typeof getChatModelDropdownStyle> | null
  >(null)

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

  if (!modelConfig || !modelSupportsReasoningControl(modelConfig)) return null

  const activeIndex = reasoningDepthToIndex(value)
  const lastIndex = REASONING_DEPTH_STEPS.length - 1
  const filledPercent = (activeIndex / lastIndex) * 100

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        title={t("chat.reasoningDepth.label")}
        aria-label={t("chat.reasoningDepth.label")}
        className="h-8 shrink-0 gap-1.5 px-2 text-xs"
      >
        <Brain className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="truncate">{t(`chat.reasoningDepth.${value}`)}</span>
      </Button>

      {open && dropdownStyle && createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed rounded-md border bg-popover p-3 shadow-lg"
            style={{
              right: dropdownStyle.right,
              top: dropdownStyle.top,
              bottom: dropdownStyle.bottom,
              width: dropdownStyle.width,
              zIndex: 9999,
            }}
          >
            <div className="mb-2 text-xs font-medium">
              {t("chat.reasoningDepth.label")}
            </div>
            <input
              type="range"
              min={0}
              max={lastIndex}
              step={1}
              value={activeIndex}
              aria-label={t("chat.reasoningDepth.label")}
              onChange={(e) => onChange(reasoningDepthFromIndex(Number(e.target.value)))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg accent-primary"
              style={{
                background: `linear-gradient(to right, ${SLIDER_TRACK_FILLED} ${filledPercent}%, ${SLIDER_TRACK_EMPTY} ${filledPercent}%)`,
              }}
            />
            <div className="mt-1 flex justify-between">
              {REASONING_DEPTH_STEPS.map((step, index) => (
                <button
                  key={step}
                  type="button"
                  onClick={() => onChange(step)}
                  // The first stop means "defer to the provider setting", not
                  // "less than off", so it is italicised out of the ramp.
                  className={`px-0.5 text-[9px] ${index === 0 ? "italic" : ""} ${
                    index === activeIndex
                      ? "font-bold text-primary"
                      : "text-muted-foreground/50"
                  }`}
                >
                  {t(`chat.reasoningDepth.${step}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {t("chat.reasoningDepth.hint")}
            </p>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
