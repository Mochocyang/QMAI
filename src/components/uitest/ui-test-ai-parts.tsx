import { cloneElement, useEffect, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react"
import { BookOpen, Sparkles } from "lucide-react"
import type { ReferenceInput } from "@/components/reference/ReferenceInput"
import { useWikiStore } from "@/stores/wiki-store"
import { getEffectiveSavedModels, getStableAvailableModelKey } from "@/lib/llm-model-keys"

export function UiTestAiIdentity({ conversationTitle, status }: {
  title?: string
  conversationTitle?: string
  status?: ReactNode
}) {
  return (
    <div className="ui-test-ai-identity">
      <span className="ui-test-ai-mark"><Sparkles aria-hidden="true" /></span>
      <div className="ui-test-ai-heading">
        <div className="ui-test-ai-title"><strong>{conversationTitle?.trim() || "标题"}</strong>{status}</div>
      </div>
    </div>
  )
}

export function UiTestAiContext({ projectName, selectedFile }: { projectName: string; selectedFile?: string | null }) {
  const documentName = selectedFile?.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/i, "")
  const label = documentName ? `${projectName} · ${documentName}` : projectName
  return <div className="ui-test-ai-context"><BookOpen aria-hidden="true" /><span title={label}>{label}</span></div>
}

export function UiTestAiAuthor({ running = false }: { running?: boolean }) {
  return <div className="ui-test-ai-author"><Sparkles aria-hidden="true" /><span>青幕{running ? " · 正在生成" : ""}</span></div>
}

export function UiTestAiEmpty({ kind, onGenerateOutline, generateDisabled, generateDisabledReason }: { kind: "chapter" | "outline"; onGenerateOutline?: () => void; generateDisabled?: boolean; generateDisabledReason?: string }) {
  return (
    <div className="ui-test-ai-empty">
      <Sparkles aria-hidden="true" />
      <h3>{kind === "outline" ? "从一个想法开始" : "一起写下一段故事"}</h3>
      <p>{kind === "outline" ? "聊聊故事方向，或用 @ 引用已有大纲和章节。" : "输入写作想法，或用 @ 引用章节、大纲和记忆。"}</p>
      {onGenerateOutline && <button type="button" onClick={onGenerateOutline} disabled={generateDisabled} title={generateDisabled ? generateDisabledReason : undefined}>生成小说大纲</button>}
    </div>
  )
}

/** 仅在测试版重新安放现有输入工具，不复制输入状态、引用逻辑或发送函数。 */
export function UiTestAiComposer({ enabled, children }: {
  enabled: boolean
  children: ReactElement<ComponentProps<typeof ReferenceInput>>
}) {
  if (!enabled) return children
  return (
    <>
      <div data-ui-ai-tools>{children.props.leftFooterControls}</div>
      {cloneElement(children, { leftFooterControls: undefined })}
    </>
  )
}

function UiTestAiModelLabel({ value, children }: { value: string; children: ReactNode }) {
  const providers = useWikiStore((state) => state.providerConfigs)
  const key = getStableAvailableModelKey(value, providers)
  const separator = key.indexOf("/")
  const provider = providers[key.slice(0, separator)]
  const model = provider && getEffectiveSavedModels(provider).find((entry) => entry.model === key.slice(separator + 1))
  const name = model?.name?.trim()
  const separatorInValue = value.indexOf("/")
  const modelId = separatorInValue > 0 ? value.slice(separatorInValue + 1) : value
  return <div className="ui-test-ai-model" title={name || modelId}>{children}</div>
}

export function UiTestAiModel({ enabled, value, children }: { enabled: boolean; value: string; children: ReactNode }) {
  return enabled ? <UiTestAiModelLabel value={value}>{children}</UiTestAiModelLabel> : children
}

/** 弹出菜单只使用视口内的可用空间；极矮窗口不强制最小高度。 */
export function getUiTestAiMenuStyle(anchor: Pick<DOMRect, "left" | "top" | "bottom">, preferredWidth = 288, preferAbove = false): CSSProperties {
  const gap = 8
  const width = Math.max(0, Math.min(preferredWidth, window.innerWidth - gap * 2))
  const above = Math.max(0, anchor.top - gap * 2)
  const below = Math.max(0, window.innerHeight - anchor.bottom - gap * 2)
  const openAbove = preferAbove ? above > 0 : below < 160 && above > below
  const maxHeight = Math.min(360, window.innerHeight * 0.6, Math.max(1, openAbove ? above : below))
  return {
    left: Math.max(gap, Math.min(anchor.left, window.innerWidth - width - gap)),
    ...(openAbove
      ? { bottom: Math.max(gap, window.innerHeight - anchor.top + gap) }
      : { top: Math.max(gap, Math.min(anchor.bottom + gap, window.innerHeight - maxHeight - gap)) }),
    width,
    maxHeight,
  }
}

/** 与原开关共用状态，只补测试版菜单的初始焦点、方向键和 Escape 返回。 */
export function useUiTestAiMenuFocus(
  open: boolean,
  menuRef: RefObject<HTMLDivElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
) {
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const buttons = () => Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
    buttons()[0]?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      } else if (menu.contains(event.target as Node) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = buttons()
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length
        items[next]?.focus()
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [open, menuRef, triggerRef, setOpen])
}