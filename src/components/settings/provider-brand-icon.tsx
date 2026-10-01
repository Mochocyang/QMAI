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

/** 自定义模型配置标记的专属色：赭金，在浅色、羊皮纸、深绿三种皮肤上都能与品牌图标区分。 */
const CUSTOM_MARK_COLOR = "#c07c1c"

export function CustomModelMark() {
  return (
    <svg className="model-brand-icon" viewBox="0 0 16 16" aria-hidden="true">
      <text
        x="8"
        y="8"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13.5"
        fontWeight="500"
        fill={CUSTOM_MARK_COLOR}
        fontFamily='"PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif'
      >
        自
      </text>
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
