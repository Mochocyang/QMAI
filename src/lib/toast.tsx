import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react"

export type ToastKind = "success" | "error" | "info"
export interface ToastAction { label: string; onClick: () => void }
export interface ToastOptions { title?: string; action?: ToastAction; persistent?: boolean; dedupeKey?: string }
export type ToastArgument = ToastAction | ToastOptions | undefined
interface ToastItem { id: number; key: string; kind: ToastKind; title?: string; message: string; createdAt: number; action?: ToastAction; persistent: boolean }
export interface ToastApi {
  success: (message: string, options?: ToastArgument) => void
  error: (message: string, options?: ToastArgument) => void
  info: (message: string, options?: ToastArgument) => void
}
const ToastContext = createContext<ToastApi | null>(null)
const TOAST_DURATION_MS = 4000
const MAX_VISIBLE_TOASTS = 3
function normalizeOptions(argument: ToastArgument): ToastOptions {
  if (!argument) return {}
  if ("label" in argument && "onClick" in argument) return { action: argument }
  return argument
}
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const itemsRef = useRef<ToastItem[]>([])
  const idRef = useRef(0)
  const keysRef = useRef(new Set<string>())
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())
  const dismiss = useCallback((id: number) => {
    const target = itemsRef.current.find((item) => item.id === id)
    if (target) keysRef.current.delete(target.key)
    itemsRef.current = itemsRef.current.filter((item) => item.id !== id)
    setItems(itemsRef.current)
    const timer = timersRef.current.get(id)
    if (timer) clearTimeout(timer)
    timersRef.current.delete(id)
  }, [])
  const push = useCallback((kind: ToastKind, message: string, argument?: ToastArgument) => {
    const options = normalizeOptions(argument)
    const key = options.dedupeKey ?? `${kind}:${options.title ?? ""}:${message}`
    if (keysRef.current.has(key)) return
    keysRef.current.add(key)
    const item: ToastItem = {
      id: ++idRef.current,
      key,
      kind,
      title: options.title,
      message,
      createdAt: Date.now(),
      action: options.action,
      persistent: options.persistent === true,
    }
    itemsRef.current = [...itemsRef.current, item]
    setItems(itemsRef.current)
  }, [])
  useEffect(() => {
    for (const item of items.slice(0, MAX_VISIBLE_TOASTS)) {
      if (item.persistent || item.action || timersRef.current.has(item.id)) continue
      const timer = setTimeout(() => dismiss(item.id), TOAST_DURATION_MS)
      timersRef.current.set(item.id, timer)
    }
  }, [dismiss, items])
  useEffect(() => () => {
    timersRef.current.forEach((timer) => clearTimeout(timer))
    timersRef.current.clear()
    keysRef.current.clear()
    itemsRef.current = []
  }, [])
  const api = useMemo<ToastApi>(() => ({
    success: (message, options) => push("success", message, options),
    error: (message, options) => push("error", message, options),
    info: (message, options) => push("info", message, options),
  }), [push])
  useEffect(() => {
    setToastApi(api)
    return () => clearToastApi(api)
  }, [api])
  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" && createPortal(
        <div aria-live="polite" data-toast-region="true" className="pointer-events-none fixed bottom-4 right-4 z-[1000] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {items.slice(0, MAX_VISIBLE_TOASTS).map((item) => <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />)}
        </div>, document.body,
      )}
    </ToastContext.Provider>
  )
}
function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const config = KIND_STYLES[item.kind]
  const Icon = config.icon
  const handleAction = () => { try { item.action?.onClick() } finally { onDismiss() } }
  return (
    <div role={item.kind === "error" ? "alert" : "status"} data-toast-card="true" className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-background p-3 shadow-lg ${config.container}`}>
      <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconClass}`} />
      <div className="min-w-0 flex-1">
        {item.title ? <div className="mb-0.5 text-sm font-medium text-foreground">{item.title}</div> : null}
        <div className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-5 text-foreground">{item.message}</div>
      </div>
      {item.action ? <button type="button" onClick={handleAction} className="ml-1 shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20">{item.action.label}</button> : null}
      <button type="button" onClick={onDismiss} className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="关闭提示"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
const KIND_STYLES: Record<ToastKind, { container: string; icon: typeof CheckCircle2; iconClass: string }> = {
  success: { container: "border-primary/30", icon: CheckCircle2, iconClass: "text-primary" },
  error: { container: "border-destructive/40", icon: AlertTriangle, iconClass: "text-destructive" },
  info: { container: "border-border", icon: Info, iconClass: "text-muted-foreground" },
}
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (ctx) return ctx
  return {
    success: (message, options) => dispatchExternal("success", message, options),
    error: (message, options) => dispatchExternal("error", message, options),
    info: (message, options) => dispatchExternal("info", message, options),
  }
}
type PendingExternalToast = { kind: ToastKind; message: string; options?: ToastArgument }
let externalApi: ToastApi | null = null
let pendingExternalToasts: PendingExternalToast[] = []
export function setToastApi(api: ToastApi | null) {
  externalApi = api
  if (!api || pendingExternalToasts.length === 0) return
  const pending = pendingExternalToasts
  pendingExternalToasts = []
  for (const item of pending) api[item.kind](item.message, item.options)
}
function clearToastApi(api: ToastApi) { if (externalApi === api) externalApi = null }
function dispatchExternal(kind: ToastKind, message: string, options?: ToastArgument) {
  if (externalApi) externalApi[kind](message, options)
  else pendingExternalToasts.push({ kind, message, options })
}
export const toast: ToastApi = {
  success: (message, options) => dispatchExternal("success", message, options),
  error: (message, options) => dispatchExternal("error", message, options),
  info: (message, options) => dispatchExternal("info", message, options),
}