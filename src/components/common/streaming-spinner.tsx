import { useEffect, useState } from "react"

/**
 * Zed 风格的生成指示器。
 *
 * 对齐 Zed SpinnerLabel（Dots 变体）：
 * - 10 帧 Braille 点阵动画：⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
 * - 1000ms 循环（100ms/帧）
 * - 使用 with_animation + Animation::repeat() 等效的 CSS 动画
 */
const DOTS_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const FRAME_MS = 100

export function StreamingSpinner() {
  const [frameIdx, setFrameIdx] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrameIdx((prev) => (prev + 1) % DOTS_FRAMES.length)
    }, FRAME_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <span
      className="inline-block w-[1ch] text-muted-foreground/80 select-none"
      style={{ fontVariantEmoji: "text" }}
      aria-label="正在生成"
    >
      {DOTS_FRAMES[frameIdx]}
    </span>
  )
}
