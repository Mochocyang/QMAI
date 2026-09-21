import type { BookAnalysisPipelineTask } from "@/lib/novel/book-analysis/analysis-pipeline-types"

type UsageTask = Pick<BookAnalysisPipelineTask, "requestTraces" | "requestUsageTotals" | "omittedRequestTraceCount" | "resultReuse">
const tokenCount = (value: number | undefined) => typeof value === "number" && Number.isFinite(value) && value >= 0
  ? Math.round(value).toLocaleString("zh-CN") : "未完整提供"
function stageLabel(stage?: string): string {
  if (stage === "verification") return "后台验证"
  if (stage === "recognition") return "角色识别"
  if (stage === "skill-generation") return "角色技能生成"
  const [skill, phase] = stage?.split(":") ?? []
  const label = ({ characters: "角色", story: "故事", style: "文风" } as Record<string, string>)[skill] ?? "分析"
  return label + (({ chunk: "区块", aggregate: "汇总", publish: "发布" } as Record<string, string>)[phase] ?? "请求")
}

export function BookAnalysisUsageSummary({ task }: { task: UsageTask }) {
  const usage = task.requestUsageTotals
  const reuse = task.resultReuse
  if (!usage && !reuse) return null
  const rate = usage?.inputTokens !== undefined && usage.inputTokens > 0 && usage.cachedInputTokens !== undefined
    && usage.cachedInputTokens >= 0 && usage.cachedInputTokens <= usage.inputTokens
    ? `${(usage.cachedInputTokens / usage.inputTokens * 100).toFixed(1)}%` : "未完整提供"
  return (
    <details className="my-3 min-w-0 max-w-full rounded-md border border-border bg-muted/20 p-3 text-xs" aria-label="本次分析用量">
      <summary className="cursor-pointer break-words font-medium">本次分析用量（含后台验证）</summary>
      <div className="mt-2 max-h-48 min-w-0 space-y-2 overflow-y-auto break-words pr-1">
        {reuse && <p>{`本地结果复用：区块 ${reuse.chunkHits}/${reuse.chunkChecks}，汇总 ${reuse.aggregateHits}/${reuse.aggregateChecks}`}</p>}
        <p>{`已记录请求：${usage?.requestCount ?? "未提供"} · 模型输入缓存命中率：${rate}`}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>输入 Token：{tokenCount(usage?.inputTokens)}</span>
          <span>输出 Token：{tokenCount(usage?.outputTokens)}</span>
          <span>缓存读取：{tokenCount(usage?.cachedInputTokens)}</span>
          <span>缓存写入：{tokenCount(usage?.cacheWriteInputTokens)}</span>
        </div>
        <p className="text-muted-foreground">本地复用表示跳过重复分析，不等于模型缓存折扣；模型数据以供应商上报为准，后台验证返回后继续累计。</p>
        {Boolean(task.omittedRequestTraceCount) && <p className="text-muted-foreground">{`另有 ${task.omittedRequestTraceCount} 条较早明细未展开，总量仍包含全部已记录请求。`}</p>}
        <ul className="space-y-1" aria-label="最近请求明细">
          {task.requestTraces?.map((trace, index) => (
            <li key={trace.requestId ?? index} className="min-w-0 break-all text-muted-foreground">
              {stageLabel(trace.stage)} · {trace.model} · 输入 {tokenCount(trace.inputTokens)} / 输出 {tokenCount(trace.outputTokens)} / 缓存读取 {tokenCount(trace.cacheReadTokens)}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
