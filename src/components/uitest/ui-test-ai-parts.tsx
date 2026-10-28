import { cloneElement, useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from "react"
import { BookOpen, Pencil, Sparkles } from "lucide-react"
import type { ReferenceInput } from "@/components/reference/ReferenceInput"
import { useWikiStore } from "@/stores/wiki-store"
import { getEffectiveSavedModels, getStableAvailableModelKey } from "@/lib/llm-model-keys"
import { getConversationTabTitle } from "@/lib/workspace-layout"
import { CONVERSATION_TITLE_INPUT_MAX_CHARS, sanitizeConversationTitle } from "@/lib/conversation-title"

/** 头部标题的显示上限。比派生标题的上限（12 字 + 省略号）宽，确保新标题原样显示；
 *  它只用来兜住旧数据——历史上标题是首条消息的 50 字前缀，盘上已存了不少。 */
const IDENTITY_TITLE_MAX_CHARS = 16

export function UiTestAiIdentity({ conversationTitle, status, onRename }: {
  title?: string
  conversationTitle?: string
  status?: ReactNode
  /**
   * 提供后标题可改名：点铅笔或双击标题进入输入框，Enter 保存、Esc 取消、失焦保存。
   * 没提供（例如没有打开任何会话）就保持只读，避免点了没反应。
   */
  onRename?: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const displayTitle = conversationTitle?.trim() || "标题"
  const title = getConversationTabTitle(displayTitle, IDENTITY_TITLE_MAX_CHARS)

  useEffect(() => {
    if (!editing) return
    setDraft(displayTitle)
    // 等输入框挂载后再聚焦，否则 ref 还是 null
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [editing, displayTitle])

  const commit = () => {
    const next = sanitizeConversationTitle(draft)
    // 空标题 / 没改动都不提交，保持原标题
    if (next && next !== displayTitle) onRename?.(next)
    setEditing(false)
  }

  return (
    <div className="ui-test-ai-identity group/identity">
      <span className="ui-test-ai-mark"><Sparkles aria-hidden="true" /></span>
      <div className="ui-test-ai-heading">
        {editing ? (
          <input
            ref={inputRef}
            className="h-6 w-40 rounded border bg-background px-1.5 text-xs font-semibold outline-none focus:ring-1 focus:ring-primary"
            value={draft}
            maxLength={CONVERSATION_TITLE_INPUT_MAX_CHARS}
            aria-label="会话标题"
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                commit()
              } else if (event.key === "Escape") {
                event.preventDefault()
                setEditing(false)
              }
            }}
            onBlur={commit}
          />
        ) : (
          <div className="ui-test-ai-title" title={conversationTitle?.trim() || undefined}>
            <strong
              onDoubleClick={onRename ? () => setEditing(true) : undefined}
              className={onRename ? "cursor-text" : undefined}
            >
              {title}
            </strong>
            {status}
            {onRename ? (
              <button
                type="button"
                className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover/identity:opacity-100"
                aria-label="重命名会话"
                title="重命名会话"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        )}
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

/**
 * 空会话的中央引导区。
 *
 * ⚠️ 这里**只有**「生成小说大纲」一个入口。事件细纲（章节细纲）的入口
 * 已按用户要求搬去**章节区的标题栏**（见 `preview-panel.tsx` 的「生成章节细纲」），
 * 大纲面板不再提供它 —— 用户原话：「将『生成章节细纲』的按钮放在章节当中，
 * 放在章节的标题栏那里」/「我们不放在大纲那里了，只用一个按钮就可以了」。
 * 因此这里**没有**承载事件细纲那枚按钮的可选 prop：留着一个没有任何调用方的
 * prop 只会让下一个人以为还有第二条入口。
 *
 * ⚠️ 上面的说明刻意**不写出那个 prop 的字面名**：它已经不存在了，
 * 而 `preview-panel.chapter-toolbar.spec.tsx` 那条守卫会钉住「本文件里不出现这个名字」。
 * 那条守卫是**源码文本**级的（换 prop 名或换一种文案写法就能绕过去，详见那边的说明），
 * 真正的行为背书在 `outline-chat-panel.spec.tsx` 的
 * 「空会话只提供「生成小说大纲」一个入口，不再提供「生成章节细纲」」上。
 */
export function UiTestAiEmpty({ kind, onGenerateOutline, generateDisabled, generateDisabledReason }: { kind: "chapter" | "outline"; onGenerateOutline?: () => void; generateDisabled?: boolean; generateDisabledReason?: string }) {
  return (
    <div className="ui-test-ai-empty">
      <Sparkles aria-hidden="true" />
      <h3>{kind === "outline" ? "从一个想法开始" : "一起写下一段故事"}</h3>
      <p>{kind === "outline" ? "聊聊故事方向，或用 @ 引用已有大纲和章节。" : "输入写作想法，或用 @ 引用章节、大纲和记忆。"}</p>
      {onGenerateOutline && (
        <div className="ui-test-ai-empty-actions">
          <button type="button" data-guide="outline.generate" onClick={onGenerateOutline} disabled={generateDisabled} title={generateDisabled ? generateDisabledReason : undefined}>生成小说大纲</button>
        </div>
      )}
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