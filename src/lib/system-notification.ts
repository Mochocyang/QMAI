import { isTauri } from "@/lib/platform"
import { isChapterWritingIntent } from "@/lib/novel/task-router"

const FAILURE_BODY_MAX_CHARS = 120

export interface SystemNotificationBindings {
  isTauri: () => boolean
  isPermissionGranted: () => Promise<boolean>
  requestPermission: () => Promise<string>
  sendNotification: (options: { title: string; body: string; sound: string }) => void
  userAgent: () => string
  platform: () => string
  warn: (message: string, error: unknown) => void
}

const defaultBindings: SystemNotificationBindings = {
  isTauri,
  isPermissionGranted: async () => {
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification")
    return isPermissionGranted()
  },
  requestPermission: async () => {
    const { requestPermission } = await import("@tauri-apps/plugin-notification")
    return requestPermission()
  },
  sendNotification: (options) => {
    void import("@tauri-apps/plugin-notification").then(({ sendNotification }) => {
      sendNotification(options)
    }).catch((error) => {
      defaultBindings.warn("[system-notification] 发送失败", error)
    })
  },
  userAgent: () => (typeof navigator === "undefined" ? "" : navigator.userAgent),
  platform: () => (typeof navigator === "undefined" ? "" : navigator.platform),
  warn: (message, error) => console.warn(message, error),
}

export function resolveNotificationSound(
  userAgent = defaultBindings.userAgent(),
  platform = defaultBindings.platform(),
): string {
  if (/Mac|iPhone|iPad/i.test(userAgent) || /^Mac/i.test(platform)) {
    return "Ping"
  }
  return "Default"
}

export function shouldNotifyChapterWriting(input: {
  intent?: string | null
  planOnly?: boolean
}): boolean {
  return isChapterWritingIntent(input.intent) && !input.planOnly
}

export function buildChapterWritingNotification(input: {
  ok: boolean
  chapterNumber?: number
  error?: string
}): { title: string; body: string } {
  if (input.ok) {
    return {
      title: "章节写作完成",
      body: typeof input.chapterNumber === "number" && input.chapterNumber > 0
        ? `第 ${input.chapterNumber} 章已完成`
        : "章节已完成",
    }
  }

  const error = (input.error ?? "生成失败").trim() || "生成失败"
  return {
    title: "章节写作失败",
    body: error.length > FAILURE_BODY_MAX_CHARS
      ? `${error.slice(0, FAILURE_BODY_MAX_CHARS)}…`
      : error,
  }
}

export async function ensureSystemNotificationPermission(
  bindings: SystemNotificationBindings = defaultBindings,
): Promise<boolean> {
  if (!bindings.isTauri()) return false
  try {
    if (await bindings.isPermissionGranted()) return true
    return (await bindings.requestPermission()) === "granted"
  } catch (error) {
    bindings.warn("[system-notification] 请求权限失败", error)
    return false
  }
}

export async function notifyChapterWritingOutcome(
  input: {
    intent?: string | null
    planOnly?: boolean
    ok: boolean
    chapterNumber?: number
    error?: string
  },
  bindings: SystemNotificationBindings = defaultBindings,
): Promise<void> {
  if (!shouldNotifyChapterWriting(input)) return
  if (!bindings.isTauri()) return

  try {
    if (!(await ensureSystemNotificationPermission(bindings))) return
    const payload = buildChapterWritingNotification(input)
    bindings.sendNotification({
      ...payload,
      sound: resolveNotificationSound(bindings.userAgent(), bindings.platform()),
    })
  } catch (error) {
    bindings.warn("[system-notification] 发送失败", error)
  }
}
