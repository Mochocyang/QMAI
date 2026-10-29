import type { ReactNode } from "react"
import { CheckCircle2, Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { PluginMarketEntry } from "@/lib/plugins/api"

/**
 * 能力种类（索引里的 `kind`）的中文名。
 *
 * 为什么是**查表 + 原样兜底**而不是 switch：索引由第三方提交，后端将来加一类能力
 * （`hooks` / `commands` …）时，这里应当把新值原样显示出来。写成穷尽 switch 会让
 * 「多了一类能力」变成「卡片上什么都不显示」，用户看不到风险提示还以为是纯声明式插件。
 */
export const MARKET_KIND_LABELS: Record<string, string> = {
  declarative: "声明式",
  tools: "工具",
  providers: "模型",
}

/** kind 徽章的配色，按「越能做事 = 越要注意」排：声明式中性、工具琥珀、模型最重。 */
const KIND_CLASSNAMES: Record<string, string> = {
  declarative: "border-border bg-muted text-muted-foreground",
  tools: "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  providers: "border-destructive/30 bg-destructive/10 text-destructive",
}
const KIND_FALLBACK_CLASSNAME = "border-border bg-muted text-muted-foreground"

/** 已安装的判定结果：只需要版本号，其余展示交给市场条目自己。 */
export interface MarketCardInstalled {
  version?: string | null
}

export interface MarketCardProps {
  entry: PluginMarketEntry
  /** 非 null = 本机已装（由 plugin-center-view 与 `plugins_list` 交叉比对得出）。 */
  installed: MarketCardInstalled | null
  /** 这一条正在安装（同屏只允许一条）。 */
  installing: boolean
  /** 动作回调由宿主提供：本组件**不**直接调命令，纯展示才好单测。 */
  onInstall: (entry: PluginMarketEntry) => void
}

/**
 * 插件市场里的一张卡片。
 *
 * 纯展示 + 一个回调：所有命令调用都在 `plugin-center-view.tsx` 里。
 * 这不是洁癖 —— 卡片是市场页唯一需要「装了什么/能不能装」这份状态的组件，
 * 一旦它自己去 `invoke`，单测就必须在 DOM 里铺一整套 Tauri mock 才能验一个按钮。
 */
export function MarketCard({ entry, installed, installing, onInstall }: MarketCardProps) {
  const isInstalled = installed !== null
  const version = installed?.version ?? entry.version ?? null
  const kinds = entry.kind.length > 0 ? entry.kind : []

  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border px-4 py-3"
      data-market-card={entry.id}
      data-market-installed={isInstalled ? "true" : undefined}
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words font-medium">{entry.name || entry.id}</span>
            {isInstalled && version ? (
              <span className="text-xs text-muted-foreground">v{version}</span>
            ) : null}
          </div>
          {entriesMeta(entry)}
        </div>
        {/*
          已安装的卡片把按钮换成**不可再点**的「已安装」，而不是隐藏按钮：
          按钮突然消失时，用户会以为这张卡坏了或者市场没加载完。
        */}
        {isInstalled ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            data-market-action="installed"
            title="这个插件已经在本机安装。要启用、停用或卸载，请到「已安装」页。"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            已安装
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={installing}
            data-market-action="install"
            data-market-repo={entry.repo}
            onClick={() => onInstall(entry)}
          >
            {installing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            {installing ? "安装中…" : "安装"}
          </Button>
        )}
      </div>

      {entry.description ? (
        <p className="break-words text-sm leading-relaxed text-muted-foreground">
          {entry.description}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {kinds.map((kind) => (
          <span
            key={kind}
            title={`索引声明的能力种类：${kind}`}
            data-market-kind={kind}
            className={`rounded border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4 ${
              KIND_CLASSNAMES[kind] ?? KIND_FALLBACK_CLASSNAME
            }`}
          >
            {MARKET_KIND_LABELS[kind] ?? kind}
          </span>
        ))}
        {/*
          权限只显示条数、原文放 title：安装前就能看到「它要什么」是必要的，
          但把 6 个权限码铺在卡片上会把描述淹没。逐项可读文案（读取项目文件…）
          属于**启用确认层**（设置 → 插件），这里不再维护第二份映射表。
        */}
        {entry.permissions.length > 0 ? (
          <span
            className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.6875rem] leading-4 text-foreground/80"
            title={entry.permissions.join("、")}
            data-market-permission-count={entry.permissions.length}
          >
            申请 {entry.permissions.length} 项权限
          </span>
        ) : null}
      </div>

      {entry.categories.length > 0 || entry.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted-foreground">
          {entry.categories.length > 0 ? (
            <span data-market-categories="true">分类：{entry.categories.join("、")}</span>
          ) : null}
          {entry.tags.length > 0 ? (
            <span data-market-tags="true">标签：{entry.tags.join("、")}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** 作者 + 仓库来源那一行；两项都空时整行不渲染，避免卡片上留一条空白。 */
function entriesMeta(entry: PluginMarketEntry): ReactNode {
  const author = entry.author.trim()
  const repo = entry.repo.trim()
  if (!author && !repo) return null
  return (
    <p className="mt-0.5 break-all text-xs text-muted-foreground">
      {author ? <span data-market-author="true">{author}</span> : null}
      {author && repo ? <span className="mx-1">·</span> : null}
      {repo ? <span className="font-mono">{repo}</span> : null}
    </p>
  )
}
