import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

export function UserMessageMeta({ content, timestamp }: { content: string; timestamp?: number }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState("")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const date = typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : null
  const validDate = date && Number.isFinite(date.getTime()) ? date : null
  const time = validDate ? `${String(validDate.getHours()).padStart(2, "0")}:${String(validDate.getMinutes()).padStart(2, "0")}` : ""
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setError("")
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
      setError("复制失败，请检查剪贴板权限后重试。")
    }
  }
  return (
    <footer className="ui-test-user-message-meta" data-user-message-meta>
      {validDate ? <time dateTime={validDate.toISOString()} title={validDate.toLocaleString("zh-CN", { hour12: false })}>{time}</time> : null}
      <button type="button" onClick={() => void copy()} aria-label={copied ? "已复制" : "复制消息"} title={copied ? "已复制" : "复制消息"}>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      {error ? <span role="status">{error}</span> : null}
    </footer>
  )
}
