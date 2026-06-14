/**
 * 轻量 Toast 提示工具
 * 不引入新依赖，复用项目里 React + createPortal 实现
 *
 * 用法：
 *   import { ToastProvider, toast } from "@/lib/toast"
 *   <ToastProvider />         // 放在应用根组件
 *   toast.success("已保存")
 *   toast.error("加载失败：xxx")
 *   toast.info("正在处理")
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react"

export type ToastKind = "success" | "error" | "info"

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  createdAt: number
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const TOAST_DURATION_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++idRef.current
      setItems((current) => [...current, { id, kind, message, createdAt: Date.now() }])
      const timer = setTimeout(() => dismiss(id), TOAST_DURATION_MS)
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
      info: (message) => push("info", message),
    }),
    [push],
  )

  useEffect(() => {
    setToastApi(api)
    return () => setToastApi(null)
  }, [api])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed top-4 right-4 z-[1000] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
          >
            {items.map((item) => (
              <ToastCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const config = KIND_STYLES[item.kind]
  const Icon = config.icon
  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-md border bg-background p-3 shadow-lg ${config.container}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.iconClass}`} />
      <div className="flex-1 whitespace-pre-wrap text-sm leading-5 text-foreground">{item.message}</div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
        aria-label="关闭提示"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

const KIND_STYLES: Record<ToastKind, { container: string; icon: typeof CheckCircle2; iconClass: string }> = {
  success: {
    container: "border-primary/30",
    icon: CheckCircle2,
    iconClass: "text-primary",
  },
  error: {
    container: "border-destructive/40",
    icon: AlertTriangle,
    iconClass: "text-destructive",
  },
  info: {
    container: "border-border",
    icon: Info,
    iconClass: "text-muted-foreground",
  },
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // 在没有 Provider 的环境（如 vitest 单测）回退到 console，避免硬崩
    return {
      success: (m) => console.info(`[toast:success] ${m}`),
      error: (m) => console.warn(`[toast:error] ${m}`),
      info: (m) => console.info(`[toast:info] ${m}`),
    }
  }
  return ctx
}

/**
 * 在组件外部调用 toast 时使用。
 * 通过 Provider 暴露的全局单例（由 setToastApi 注入）。
 * 没有 Provider 时退化为 console 提示，避免硬崩。
 */
let externalApi: ToastApi | null = null

export function setToastApi(api: ToastApi | null) {
  externalApi = api
}

export const toast: ToastApi = {
  success: (message) =>
    externalApi ? externalApi.success(message) : console.info(`[toast:success] ${message}`),
  error: (message) =>
    externalApi ? externalApi.error(message) : console.warn(`[toast:error] ${message}`),
  info: (message) =>
    externalApi ? externalApi.info(message) : console.info(`[toast:info] ${message}`),
}
