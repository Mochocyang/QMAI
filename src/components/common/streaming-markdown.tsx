import { useEffect, useRef, useState, ReactNode, memo } from "react"
import { StreamingSpinner } from "./streaming-spinner"

interface StreamingMarkdownProps {
  content: string
  isStreaming: boolean
  renderCommitted: (content: string) => ReactNode
  showCursor?: boolean
}

function StreamingMarkdownImpl({
  content,
  isStreaming,
  renderCommitted,
  showCursor = true,
}: StreamingMarkdownProps) {
  // 对齐 Zed: 已提交行保持不变，只在换行时重新解析 Markdown（等效 should_reparse 防抖）
  const lastCommittedRef = useRef("")
  const [committed, setCommitted] = useState("")
  const [activeLine, setActiveLine] = useState("")

  useEffect(() => {
    if (!isStreaming) {
      // 对齐 Zed: reset 时不立即清空，保持旧内容可见直到新解析完成
      if (lastCommittedRef.current !== content) {
        lastCommittedRef.current = content
        setCommitted(content)
      }
      setActiveLine("")
      return
    }

    // 对齐 Zed: update_text_in_place - 检测前缀扩展，只更新变化部分
    const idx = content.lastIndexOf("\n")
    if (idx < 0) {
      // 还没有完整行，全部在 activeLine 中
      if (lastCommittedRef.current !== "") {
        lastCommittedRef.current = ""
        setCommitted("")
      }
      setActiveLine(content)
      return
    }

    const newCommitted = content.slice(0, idx + 1)
    const newActive = content.slice(idx + 1)

    // 对齐 Zed: append - 只在 committed 内容实际变化时才重新解析
    if (newCommitted !== lastCommittedRef.current) {
      lastCommittedRef.current = newCommitted
      setCommitted(newCommitted)
    }
    setActiveLine(newActive)
  }, [content, isStreaming])

  return (
    <>
      {renderCommitted(committed)}
      {activeLine !== "" && (
        <span className="streaming-active-line whitespace-pre-wrap break-words">
          {activeLine}
        </span>
      )}
      {/* 对齐 Zed: 用 Braille spinner 替代闪烁方块光标 */}
      {showCursor && isStreaming && <StreamingSpinner />}
    </>
  )
}

export const StreamingMarkdown = memo(StreamingMarkdownImpl)