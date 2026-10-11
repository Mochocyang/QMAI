import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  formatBulkChapterIngestResult,
  runBulkChapterIngest,
  type BulkChapterIngestMode,
} from "@/lib/novel/chapter-bulk-ingest"
import {
  formatBulkOutlineIngestResult,
  OutlineIngestNotReadyError,
  runBulkOutlineIngest,
} from "@/lib/novel/outline-generation"
import { openDefaultModelSettings } from "@/lib/open-settings"
import { normalizePath } from "@/lib/path-utils"
import { toast } from "@/lib/toast"
import { useImportProgressStore } from "@/stores/import-progress-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 「一键提取」的确认面板：先选范围（提取全部 / 仅未提取），再执行。
 *
 * 提取期间必须给得出反馈。早先这里只有一个确认框，点完确认后整段提取期间
 * 界面**一字不显示**（没有进度、没有转圈、没有「提取中」），用户看到的就是
 * 「点了没反应」。所以现在：进度与取消读全局进度任务，模型没配好时给一条
 * 能直接跳到设置项的提示。
 */
export function UiTestOutlineTools({ kind = "outline" }: { kind?: "outline" | "chapter" }) {
  const project = useWikiStore((state) => state.project)
  const [open, setOpen] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState("")

  const progressTask = useImportProgressStore((state) =>
    state.tasks.find((task) =>
      task.status === "running" &&
      task.kind === kind &&
      project != null &&
      task.projectPath === normalizePath(project.path),
    ),
  )
  const active = running || progressTask != null
  const label = kind === "chapter" ? "章节" : "大纲"

  async function run(mode: BulkChapterIngestMode) {
    if (!project || active) return
    setOpen(false)
    setRunning(true)
    setResult("")
    try {
      if (kind === "chapter") {
        setResult(formatBulkChapterIngestResult(await runBulkChapterIngest(project.path, { mode })))
      } else {
        setResult(formatBulkOutlineIngestResult(await runBulkOutlineIngest(project.path, { mode })))
      }
    } catch (error) {
      // 模型没配好是最常见的失败原因：给一条能直接跳到设置项的提示，
      // 而不是把一句错误原样摊在面板里让用户自己猜去哪儿配。
      if (error instanceof OutlineIngestNotReadyError) {
        toast.error(error.message, { onClick: openDefaultModelSettings })
      }
      setResult(error instanceof Error ? error.message : "批量提取失败。")
    } finally {
      setRunning(false)
    }
  }

  function cancel() {
    if (!progressTask) return
    useImportProgressStore.getState().cancelTask(progressTask.id)
  }

  return <section className="ui-test-outline-tools" aria-label={`${label}批量提取`}>
    {open && !active && <div className="ui-test-outline-confirm" role="dialog" aria-label="选择提取范围">
      <p>选择提取范围</p>
      <div>
        <button type="button" className="cancel" onClick={() => setOpen(false)}>取消</button>
        <button type="button" className="pending" onClick={() => void run("pending")}>仅未提取</button>
        <button type="button" className="confirm" onClick={() => void run("all")}>提取全部</button>
      </div>
    </div>}
    {active && <div className="ui-test-outline-running" role="status" aria-live="polite">
      <Loader2 className="animate-spin" aria-hidden="true" />
      <span>{progressTask ? `正在提取${label}记忆 ${progressTask.completed}/${progressTask.total}` : `正在启动${label}提取…`}</span>
      <button type="button" className="cancel" onClick={cancel} disabled={!progressTask}>取消</button>
    </div>}
    {!active && result && <p role="status" aria-live="polite">{result}</p>}
  </section>
}
