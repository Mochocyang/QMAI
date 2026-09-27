import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

/** Pinned so a later package publish cannot swap filenames under us. */
const LOBE_ICON_CDN = "https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.95.1/icons"

/**
 * Lobe Icons static SVG slugs. `mono` marks glyphs that ship as
 * `fill="currentColor"`; an `<img>` paints those black, so the dark skin
 * inverts them.
 */
const PROVIDER_BRAND_ICONS: Record<string, { slug: string; mono?: boolean }> = {
  anthropic: { slug: "claude-color" },
  "claude-code-cli": { slug: "claudecode-color" },
  "codex-cli": { slug: "codex-color" },
  openai: { slug: "openai", mono: true },
  google: { slug: "gemini" },
  azure: { slug: "azure-color" },
  deepseek: { slug: "deepseek-color" },
  groq: { slug: "groq", mono: true },
  xai: { slug: "xai", mono: true },
  "nvidia-nim": { slug: "nvidia-color" },
  kimi: { slug: "moonshot", mono: true },
  "kimi-cn": { slug: "moonshot", mono: true },
  "kimi-coding-plan": { slug: "moonshot", mono: true },
  zhipu: { slug: "zhipu-color" },
  "minimax-global": { slug: "minimax-color" },
  "minimax-cn": { slug: "minimax-color" },
  "bailian-coding": { slug: "bailian-color" },
  "xiaomi-mimo": { slug: "xiaomimimo", mono: true },
  "volcengine-ark": { slug: "volcengine-color" },
  "ollama-local": { slug: "ollama", mono: true },
  "ollama-cloud": { slug: "ollama", mono: true },
  atlascloud: { slug: "atlascloud", mono: true },
  "cursor-cli": { slug: "cursor", mono: true },
}

export function modelSaveLabel(persisted: boolean, dirty: boolean) {
  if (!persisted) return "未保存"
  if (dirty) return "有未保存修改"
  return "已保存"
}

export function modelEnableLabel(enabled: boolean) {
  return enabled ? "已启用" : "已停用"
}

export function CustomModelMark() {
  return (
    <svg className="model-brand-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.25" y="1.25" width="13.5" height="13.5" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 4.75v6.5M4.75 8h6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function ProviderBrandIcon({ presetId }: { presetId: string }) {
  const spec = PROVIDER_BRAND_ICONS[presetId]
  const [failed, setFailed] = useState(false)
  if (!spec || failed) return null
  return (
    <img
      className={spec.mono ? "model-brand-icon is-mono" : "model-brand-icon"}
      src={`${LOBE_ICON_CDN}/${spec.slug}.svg`}
      alt=""
      width={16}
      height={16}
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

export function ModelConfigTitle({
  expanded,
  onToggle,
  controlsId,
  name,
  saveLabel,
  enableLabel,
  hint,
  mark,
  title,
}: {
  expanded: boolean
  onToggle: () => void
  controlsId?: string
  name: string
  saveLabel: string
  enableLabel: string
  hint?: string
  mark: ReactNode
  title?: string
}) {
  return (
    <button
      type="button"
      className="model-provider-title"
      aria-expanded={expanded}
      aria-controls={controlsId}
      title={title}
      onClick={onToggle}
    >
      <ChevronDown className={expanded ? "" : "is-collapsed"} />
      {mark}
      <span className="model-provider-main">
        <span className="model-provider-line">
          <span className="model-provider-name">{name}</span>
          <span className="model-provider-status">{saveLabel}</span>
          <span className="model-provider-status">{enableLabel}</span>
        </span>
        {hint ? <span className="model-provider-hint">{hint}</span> : null}
      </span>
    </button>
  )
}
