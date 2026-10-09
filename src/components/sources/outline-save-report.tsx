import { AlertTriangle } from "lucide-react"

import type { OutlineSaveReport } from "@/stores/outline-chat-store"

/**
 * 保存前校验的问题清单，渲染在**生成结果下方**。
 *
 * 为什么不做成浮层（toast）：这类问题不阻止保存，用户需要的是
 * 「这段生成结果缺哪几项，我该补全还是照样保存」。实测故障里
 * 100+ 条问题被塞进一个带滚动条的小浮层，既和内容脱节又读不完。
 *
 * 明细默认折叠：条数可能上百，展开后自身可滚动，不把对话撑长。
 */
export function OutlineSaveReportPanel({ report }: { report: OutlineSaveReport }) {
  const label = report.fileType === "volume-outline" ? "卷纲" : "章纲"
  return (
    <div className="mt-2 rounded-md border border-amber-200/80 bg-amber-50/55 px-3 py-2.5 text-xs dark:border-amber-900/45 dark:bg-amber-950/15">
      <div className="flex items-start gap-1.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            {label}内容不完整（{report.problems.length} 项）
            {report.repairAttempted ? "，已自动补全过一次仍未通过" : ""}
          </p>
          <p className="mt-1 text-amber-800/90 dark:text-amber-300/90">
            待保存文件：{report.fileName}。可以保存当前内容，或让 AI 重新生成。
          </p>
          <details className="mt-1.5">
            <summary className="cursor-pointer list-none text-amber-700 underline decoration-dotted dark:text-amber-300">
              查看 {report.problems.length} 项明细
            </summary>
            <ul className="mt-1.5 max-h-[min(20rem,45vh)] space-y-0.5 overflow-y-auto overscroll-contain rounded border border-amber-200/70 bg-background/80 p-2 text-[0.6875rem] leading-5 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
              {report.problems.map((problem, index) => (
                <li key={index} className="[overflow-wrap:anywhere]">· {problem}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    </div>
  )
}
