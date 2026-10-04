import { ArrowDown } from "lucide-react"

export function ScrollToLatestButton({ isStreaming, onClick }: { isStreaming: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`ui-test-scroll-latest${isStreaming ? " is-streaming" : ""}`} onClick={onClick} title="下滑" aria-label="下滑">
      {isStreaming ? <span className="ui-test-stream-dots" aria-hidden="true"><i data-stream-dot /><i data-stream-dot /><i data-stream-dot /></span> : null}
      <ArrowDown className="ui-test-scroll-arrow" aria-hidden="true" />
      {isStreaming ? <span className="sr-only">正在生成</span> : null}
      <span className="ui-test-scroll-tooltip" aria-hidden="true">下滑</span>
    </button>
  )
}
