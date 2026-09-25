import { useState } from "react"
import { runBulkChapterIngest, formatBulkChapterIngestResult } from "@/lib/novel/chapter-bulk-ingest"
import { runBulkOutlineIngest, formatBulkOutlineIngestResult, OutlineIngestNotReadyError } from "@/lib/novel/outline-generation"
import { useWikiStore } from "@/stores/wiki-store"

/** 测试版只确认并提取尚未提取记忆的大纲，不提供全量重提取或模型设置。 */
export function UiTestOutlineTools({ kind = "outline" }: { kind?: "outline" | "chapter" }) {
  const project = useWikiStore((state) => state.project)
  const [open, setOpen] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState("")

  async function confirm() {
    if (!project || running) return
    setRunning(true)
    setOpen(false)
    try {
      if (kind === "chapter") {
        setResult(formatBulkChapterIngestResult(await runBulkChapterIngest(project.path)))
      } else {
        setResult(formatBulkOutlineIngestResult(await runBulkOutlineIngest(project.path, { mode: "pending" })))
      }
    } catch (error) {
      setResult(error instanceof OutlineIngestNotReadyError || error instanceof Error ? error.message : "批量提取失败。")
    } finally {
      setRunning(false)
    }
  }

  return <section className="ui-test-outline-tools" aria-label="批量大纲提取确认">
    {open && <div className="ui-test-outline-confirm" role="dialog" aria-label="是否确认批量提取？">
      <p>是否确认批量提取？</p>
      <div><button type="button" className="cancel" onClick={() => setOpen(false)} disabled={running}>取消</button><button type="button" className="confirm" onClick={() => void confirm()} disabled={running}>确认</button></div>
    </div>}
    {result && <p role="status" aria-live="polite">{result}</p>}
  </section>
}
