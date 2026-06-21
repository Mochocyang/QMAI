import { useTranslation } from "react-i18next"
import { useWikiStore } from "@/stores/wiki-store"
import { Filter, SlidersHorizontal, RefreshCw, CircleHelp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GRAPH_MODE_LABELS, type GraphMode } from "@/lib/graph-mode"
import { openExternalUrl } from "@/lib/open-external-url"

type ColorMode = "type" | "community"
type GraphDisplayMode = "graph" | "document" | "mindmap"
type GraphLabelDisplayMode = "all" | "auto" | "focused"
type GraphEdgeStyle = "curve" | "arrow" | "line"

export function GraphSidebarPanel() {
  const { t } = useTranslation()
  const graphMode = useWikiStore((s) => s.graphMode) as GraphMode
  const setGraphMode = useWikiStore((s) => s.setGraphMode)
  const displayMode = useWikiStore((s) => s.graphDisplayMode) as GraphDisplayMode
  const setGraphDisplayMode = useWikiStore((s) => s.setGraphDisplayMode)
  const colorMode = useWikiStore((s) => s.graphColorMode) as ColorMode
  const setColorMode = useWikiStore((s) => s.setGraphColorMode)
  const labelDisplayMode = useWikiStore((s) => s.graphLabelDisplayMode) as GraphLabelDisplayMode
  const setLabelDisplayMode = useWikiStore((s) => s.setGraphLabelDisplayMode)
  const showFilters = useWikiStore((s) => s.graphShowFilters)
  const setShowFilters = useWikiStore((s) => s.setGraphShowFilters)
  const showEdgeControls = useWikiStore((s) => s.graphShowEdgeControls)
  const setShowEdgeControls = useWikiStore((s) => s.setGraphShowEdgeControls)
  const edgeStyle = useWikiStore((s) => s.graphEdgeStyle) as GraphEdgeStyle
  const setEdgeStyle = useWikiStore((s) => s.setGraphEdgeStyle)
  const edgeColorHex = useWikiStore((s) => s.graphEdgeColorHex)
  const setEdgeColorHex = useWikiStore((s) => s.setGraphEdgeColorHex)
  const edgeStrengthPercent = useWikiStore((s) => s.graphEdgeStrengthPercent)
  const setEdgeStrengthPercent = useWikiStore((s) => s.setGraphEdgeStrengthPercent)
  const graphStats = useWikiStore((s) => s.graphStats)
  const refreshGraph = useWikiStore((s) => s.refreshGraph)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span
            role="button"
            tabIndex={0}
            className="cursor-pointer text-foreground transition-colors hover:text-primary"
            title="小说图谱功能使用说明"
            onClick={(e) => {
              e.stopPropagation()
              void openExternalUrl("https://tcnk9ik08e1c.feishu.cn/wiki/WlOpwrEQYiqczGkSohtcy3U0n7g?from=from_copylink")
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation()
                void openExternalUrl("https://tcnk9ik08e1c.feishu.cn/wiki/WlOpwrEQYiqczGkSohtcy3U0n7g?from=from_copylink")
              }
            }}
          >
            {t("novel.graph.title")}
          </span>
          <CircleHelp className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={() => refreshGraph?.()}
          disabled={!refreshGraph}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">图谱模式</label>
          <select
            value={graphMode}
            onChange={(e) => setGraphMode(e.target.value as GraphMode)}
            className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {(Object.keys(GRAPH_MODE_LABELS) as GraphMode[]).map((mode) => (
              <option key={mode} value={mode}>{t(`novel.graph.modeLabels.${mode}`, { defaultValue: GRAPH_MODE_LABELS[mode] })}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">显示模式</label>
          <select
            value={displayMode}
            onChange={(e) => setGraphDisplayMode(e.target.value as GraphDisplayMode)}
            className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="graph">{t("novel.graph.displayModeGraph")}</option>
            <option value="document">{t("novel.graph.displayModeDocument")}</option>
            <option value="mindmap">{t("novel.graph.displayModeMindmap")}</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">颜色模式</label>
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
            className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="type">{t("graph.type")}</option>
            <option value="community">{t("graph.community")}</option>
          </select>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">标签显示</label>
          <select
            value={labelDisplayMode}
            onChange={(e) => setLabelDisplayMode(e.target.value as GraphLabelDisplayMode)}
            className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">{t("graph.labelDisplayAll")}</option>
            <option value="auto">{t("graph.labelDisplayAuto")}</option>
            <option value="focused">{t("graph.labelDisplayFocused")}</option>
          </select>
        </div>

        <div className="flex gap-2">
          <Button
            variant={showFilters ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="flex-1 text-xs gap-1"
          >
            <Filter className="h-3 w-3" />
            {t("graph.filter")}
          </Button>
          <Button
            variant={showEdgeControls ? "secondary" : "outline"}
            size="sm"
            onClick={() => setShowEdgeControls(!showEdgeControls)}
            className="flex-1 text-xs gap-1"
          >
            <SlidersHorizontal className="h-3 w-3" />
            线条设置
          </Button>
        </div>

        {showEdgeControls && (
          <div className="space-y-2 rounded-md border bg-card p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">线型</span>
              <select
                value={edgeStyle}
                onChange={(e) => setEdgeStyle(e.target.value as GraphEdgeStyle)}
                className="flex-1 h-6 rounded border border-input bg-background px-1 text-[11px] outline-none"
              >
                <option value="curve">曲线避让</option>
                <option value="arrow">箭头</option>
                <option value="line">直线避让</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">{t("graph.edgeColor")}</span>
              <input
                type="color"
                value={edgeColorHex}
                onChange={(e) => setEdgeColorHex(e.target.value)}
                className="h-6 w-8 cursor-pointer rounded border border-input bg-background p-0.5"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground whitespace-nowrap">{t("graph.edgeStrength")}</span>
              <input
                type="range"
                min={100}
                max={260}
                step={10}
                value={edgeStrengthPercent}
                onChange={(e) => setEdgeStrengthPercent(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-11 text-right text-muted-foreground">{edgeStrengthPercent}%</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5">{graphStats.filteredNodeCount}/{graphStats.nodeCount} {t("graph.pages", { count: graphStats.nodeCount })}</span>
          <span className="rounded bg-muted px-1.5 py-0.5">{graphStats.filteredEdgeCount}/{graphStats.edgeCount} {t("graph.links", { count: graphStats.edgeCount })}</span>
          {graphStats.hiddenCount > 0 && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
              {graphStats.hiddenCount} {t("graph.hidden")}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
