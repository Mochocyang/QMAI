import { isTauri } from "@/lib/platform"

const FEEDBACK_URL = "https://qmai-analytics.qmai.workers.dev/feedback"
const MAX_MESSAGE_LENGTH = 3000
const MAX_CONTACT_LENGTH = 200

export type FeedbackType = "bug" | "suggestion" | "other"

export interface FeedbackInput {
  type: FeedbackType
  message: string
  contact?: string
}

export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const message = input.message.trim()
  const contact = input.contact?.trim() ?? ""

  if (!message) throw new Error("\u8bf7\u8f93\u5165\u53cd\u9988\u5185\u5bb9")
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error(`\u53cd\u9988\u5185\u5bb9\u4e0d\u80fd\u8d85\u8fc7 ${MAX_MESSAGE_LENGTH} \u5b57`)
  if (contact.length > MAX_CONTACT_LENGTH) throw new Error(`\u8054\u7cfb\u65b9\u5f0f\u4e0d\u80fd\u8d85\u8fc7 ${MAX_CONTACT_LENGTH} \u5b57`)

  const body = JSON.stringify({
    type: input.type,
    message,
    contact,
    appVersion: __APP_VERSION__,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  })

  const request = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  }

  const response = await sendFeedbackRequest(request)

  if (!response.ok) {
    throw new Error("\u53cd\u9988\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5")
  }
}

async function sendFeedbackRequest(request: RequestInit): Promise<Response> {
  if (!isTauri()) return fetch(FEEDBACK_URL, request)

  try {
    return await sendWithTauri(request)
  } catch (tauriError) {
    try {
      return await fetch(FEEDBACK_URL, request)
    } catch {
      const message = tauriError instanceof Error ? tauriError.message : String(tauriError)
      throw new Error(`\u53cd\u9988\u63d0\u4ea4\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\uff1a${message}`)
    }
  }
}

async function sendWithTauri(request: RequestInit): Promise<Response> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http")
  return tauriFetch(FEEDBACK_URL, request)
}
