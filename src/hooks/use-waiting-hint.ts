import { useEffect, useState } from "react"
import { WAITING_HINTS } from "@/lib/novel/waiting-hints"

/** 文案最短停留时间（毫秒），保证短句也来得及看清。 */
export const WAITING_HINT_MIN_MS = 4000
/** 每个字额外停留的时间（毫秒），保证长句不会被匆匆跳过。 */
export const WAITING_HINT_MS_PER_CHAR = 220

function randomHintIndex(): number {
  return Math.floor(Math.random() * WAITING_HINTS.length)
}

/** 一句文案该停留多久：按字数给足阅读时间。 */
export function waitingHintDurationMs(hint: string): number {
  return WAITING_HINT_MIN_MS + hint.length * WAITING_HINT_MS_PER_CHAR
}

/**
 * 等待期文案轮播。
 *
 * `active` 为真时随机抽一条显示，看完一句才切下一句；为假时返回 null。
 */
export function useWaitingHint(active: boolean): string | null {
  const [index, setIndex] = useState(randomHintIndex)

  // 进入等待时随机选一句开头
  useEffect(() => {
    if (!active) return
    setIndex(randomHintIndex())
  }, [active])

  // 当前这一句停留够了再随机换下一句，每句的时长按字数计算。
  // 步长取 1..len-1，保证一定跳到另一条，否则 index 不变会导致定时器不再续上。
  useEffect(() => {
    if (!active || WAITING_HINTS.length <= 1) return
    const hint = WAITING_HINTS[index]
    if (!hint) return
    const timer = setTimeout(() => {
      const length = WAITING_HINTS.length
      const step = 1 + Math.floor(Math.random() * (length - 1))
      setIndex((prev) => (prev + step) % length)
    }, waitingHintDurationMs(hint))
    return () => clearTimeout(timer)
  }, [active, index])

  if (!active) return null
  return WAITING_HINTS[index] ?? null
}