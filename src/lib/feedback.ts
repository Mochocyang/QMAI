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

  if (!message) throw new Error("请输入反馈内容")
  if (message.length > MAX_MESSAGE_LENGTH) throw new Error(`反馈内容不能超过 ${MAX_MESSAGE_LENGTH} 字`)
  if (contact.length > MAX_CONTACT_LENGTH) throw new Error(`联系方式不能超过 ${MAX_CONTACT_LENGTH} 字`)

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

  const response = isTauri()
    ? await sendWithTauri(request)
    : await fetch(FEEDBACK_URL, request)

  if (!response.ok) {
    throw new Error("反馈提交失败，请稍后再试")
  }
}

async function sendWithTauri(request: RequestInit): Promise<Response> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http")
  return tauriFetch(FEEDBACK_URL, request)
}
