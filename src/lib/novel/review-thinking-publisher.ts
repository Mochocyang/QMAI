const REVIEW_THINKING_UPDATE_INTERVAL_MS = 300
const REVIEW_THINKING_MAX_CHARS = 12000

interface ReviewThinkingPublisherOptions {
  publish: (thinking: string) => void
  minIntervalMs?: number
  maxChars?: number
  now?: () => number
}

export interface ReviewThinkingPublisher {
  publish: (thinking: string) => void
  flush: () => void
}

export function createReviewThinkingPublisher({
  publish,
  minIntervalMs = REVIEW_THINKING_UPDATE_INTERVAL_MS,
  maxChars = REVIEW_THINKING_MAX_CHARS,
  now = () => Date.now(),
}: ReviewThinkingPublisherOptions): ReviewThinkingPublisher {
  let latestThinking: string | null = null
  let lastPublishedThinking = ""
  let lastPublishedAt: number | null = null

  const publishLatest = (force: boolean) => {
    if (latestThinking === null) return
    const currentTime = now()
    if (!force && lastPublishedAt !== null && currentTime - lastPublishedAt < minIntervalMs) {
      return
    }
    if (latestThinking === lastPublishedThinking) return

    lastPublishedAt = currentTime
    lastPublishedThinking = latestThinking
    publish(latestThinking)
  }

  return {
    publish: (thinking: string) => {
      latestThinking = truncateReviewThinking(thinking, maxChars)
      publishLatest(false)
    },
    flush: () => {
      publishLatest(true)
    },
  }
}

export function truncateReviewThinking(thinking: string, maxChars = REVIEW_THINKING_MAX_CHARS): string {
  if (thinking.length <= maxChars) return thinking
  return [
    `[前方 ${thinking.length - maxChars} 字审阅过程已折叠，避免页面卡顿]`,
    thinking.slice(-maxChars),
  ].join("\n")
}
