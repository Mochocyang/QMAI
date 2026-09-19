import { useState } from "react"
import { OutlineActionToolbar } from "@/components/sources/outline-action-toolbar"
import { openDefaultModelSettings } from "@/lib/open-settings"

/** 原大纲页的批量业务入口搬到更多工具中，隐藏面板不终止正在执行的任务。 */
export function UiTestOutlineTools() {
  const [result, setResult] = useState<string | null>(null)
  return <section className="ui-test-outline-tools" aria-label="批量大纲工具">
    <OutlineActionToolbar onBulkIngestResult={setResult} />
    {result && <p role="status" aria-live="polite">{result}</p>}
    <button type="button" className="ui-test-btn ghost" onClick={openDefaultModelSettings}>默认模型设置</button>
  </section>
}
