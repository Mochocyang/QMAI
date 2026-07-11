import { useEffect, useRef, useState } from "react"

/**
 * Zed 风格的流式文本缓冲 hook。
 *
 * 核心策略（对齐 Zed StreamingTextBuffer）：
 * - 不立即显示收到的 token，而是缓冲到 pending
 * - 16ms tick 逐步揭示，总时间控制在 ~200ms
 * - 待揭示文本越多，每 tick 揭示的字节越多
 * - 流式结束后立即 flush 全部剩余文本
 * - 定时器独立于 token 到达，不会因 token 频率而重建
 *
 * 这创造了平滑的打字机效果，避免 choppy chunk-at-a-time 更新。
 */
const TICK_MS = 16
const REVEAL_TARGET_MS = 200
const TICKS_PER_TARGET = Math.max(1, Math.round(REVEAL_TARGET_MS / TICK_MS))

export function useStreamingText(rawText: string, isStreaming: boolean): string {
  const [revealed, setRevealed] = useState(rawText)
  const revealedRef = useRef(rawText)
  const pendingRef = useRef("")
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastRawRef = useRef(rawText)

  // 处理文本变化：将新增内容追加到 pending 缓冲
  useEffect(() => {
    if (!isStreaming) {
      // 流式结束：停止定时器，立即 flush 全部内容
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      pendingRef.current = ""
      if (revealedRef.current !== rawText) {
        revealedRef.current = rawText
        setRevealed(rawText)
      }
      lastRawRef.current = rawText
      return
    }

    // 对齐 Zed update_text_in_place: 检测前缀扩展
    const prev = lastRawRef.current
    if (rawText.startsWith(prev)) {
      // 增量追加（常见流式情况）
      pendingRef.current += rawText.slice(prev.length)
    } else {
      // 内容被重置（非前缀扩展），全量替换
      // 对齐 Zed reset: 不立即清空 revealed，保持旧内容可见
      pendingRef.current = rawText
      revealedRef.current = ""
      setRevealed("")
    }
    lastRawRef.current = rawText
  }, [rawText, isStreaming])

  // 独立的揭示定时器：isStreaming 为 true 时启动，false 时停止
  // 对齐 Zed: 定时器独立于 token 到达频率，16ms tick 持续揭示 pending
  useEffect(() => {
    if (!isStreaming) return

    timerRef.current = setInterval(() => {
      const pending = pendingRef.current
      if (pending.length === 0) return

      // 对齐 Zed: bytes_to_reveal_per_tick = ceil(pending.len / TICKS_PER_TARGET)
      // 待揭示文本越多，每 tick 揭示的字节越多，总时间控制在 ~200ms
      const bytesPerTick = Math.max(1, Math.ceil(pending.length / TICKS_PER_TARGET))

      // 找到安全的 UTF-8 字符边界（避免截断多字节字符）
      let revealEnd = Math.min(bytesPerTick, pending.length)
      while (revealEnd < pending.length && (pending.charCodeAt(revealEnd) & 0xc0) === 0x80) {
        revealEnd++
      }

      const chunk = pending.slice(0, revealEnd)
      pendingRef.current = pending.slice(revealEnd)

      const newRevealed = revealedRef.current + chunk
      revealedRef.current = newRevealed
      setRevealed(newRevealed)
    }, TICK_MS)

    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isStreaming])

  return revealed
}
