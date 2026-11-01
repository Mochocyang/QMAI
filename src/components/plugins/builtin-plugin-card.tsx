import { Globe, LayoutDashboard, Search } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import type { BuiltinPlugin } from "@/lib/plugins/builtin"
import { cn } from "@/lib/utils"

/**
 * 「内置插件」的**九宫格卡片**（网格视图）。
 *
 * ── 为什么要两种视图 ────────────────────────────────────────
 * 列表视图信息密度高：描述 + 关闭后果一行行读下来，适合"我要把某个功能关掉"
 * 这种带明确目标的操作。
 * 网格视图扫视效率高：图标大、名字短，一屏看完 9 个，适合"我有什么、哪些开着"
 * 这种巡视。两者不是谁替代谁，所以做成可切换。
 *
 * ── 网格版丢了什么（有意为之）────────────────────────────────
 * 不显示 `offEffect`（关闭后会发生什么）—— 九宫格里塞三行字就不是九宫格了。
 * 那句话没有消失：卡片上挂 `title`，鼠标悬停能看到；同时列表视图里仍然完整展示。
 * 开关仍然在卡片里，因为"扫一眼就知道开没开"正是网格视图的价值。
 */
export interface BuiltinPluginCardProps {
  plugin: BuiltinPlugin
  enabled: boolean
  onToggle: (next: boolean) => void
}

function iconFor(plugin: BuiltinPlugin) {
  if (plugin.id === "web-search") return Globe
  if (plugin.kind === "capability") return Search
  return LayoutDashboard
}

export function BuiltinPluginCard({ plugin, enabled, onToggle }: BuiltinPluginCardProps) {
  const Icon = iconFor(plugin)

  return (
    <li
      data-builtin-plugin-card={plugin.id}
      data-builtin-plugin-kind={plugin.kind}
      data-builtin-plugin-enabled={enabled ? "true" : "false"}
      title={plugin.offEffect}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:bg-accent/20",
        !enabled && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <Icon className="h-4 w-4" />
        </div>
        <Switch
          checked={enabled}
          label={`${enabled ? "关闭" : "开启"}内置插件「${plugin.name}」`}
          data-ui="builtin-plugin-switch"
          onChange={onToggle}
        />
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">{plugin.name}</span>
          <span
            title="随软件提供的功能，不是从市场安装的第三方插件"
            className="shrink-0 rounded border px-1 text-[11px] leading-4 text-muted-foreground"
          >
            内置
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {plugin.description}
        </p>
      </div>
    </li>
  )
}
