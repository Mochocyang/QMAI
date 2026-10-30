import { Globe, LayoutDashboard, Search } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { builtinPlugin, type BuiltinPlugin } from "@/lib/plugins/builtin"
import { cn } from "@/lib/utils"

/**
 * 「内置插件」的一行。
 *
 * ── 为什么不复用 `InstalledRow` ────────────────────────────────
 * `InstalledRow` 吃的是 `PluginSummary`（来自后端的市场插件清单：进程状态、
 * 已授权限、版本、工具数量…）。内置插件根本没有进程 —— 它是我们自己的功能，
 * 字段对不上。硬塞就要先造一个假的 `PluginSummary`，于是界面上会出现
 * "运行中 / 已授权"这类对内置插件**纯属虚构**的状态，那比多写一个组件更糟。
 *
 * 视觉语言（图标块 + 名称 + 描述 + 右侧开关）与 `InstalledRow` 保持一致，
 * 这样同一页里两个分区看起来是一家人。
 *
 * ── 为什么没有「⋯」菜单 ──────────────────────────────────────
 * 市场插件的菜单里是「设置 / 卸载」。内置插件两者都不成立：
 *   · 没有独立配置项（开关就是它全部的设置）；
 *   · **不能卸载**（见下方诚实性说明）。留一个只有一项「恢复默认」的菜单
 *     只会让用户误以为这里也能卸载。
 */
export interface BuiltinPluginRowProps {
  plugin: BuiltinPlugin
  enabled: boolean
  /** 开关切到 `next`（true = 开启）。 */
  onToggle: (next: boolean) => void
}

/** `capability` = 能力闸门（联网/检索这类"发生或不发生"），`view` = 一个界面。 */
const KIND_ICONS = {
  capability: Globe,
  view: LayoutDashboard,
} as const

/**
 * 该画哪个图标。
 *
 * 能力类里只有「网页搜索」是"对外联网"，用 `Globe` 最能一眼分辨；
 * 其余能力类用 `Search`（本地检索）。`kind` 决定轮廓大类，`id` 只在这一类内部做区分 ——
 * 这样以后新增内置插件时，不写映射也能落到一个合理的默认图标。
 */
export function builtinPluginIconId(plugin: Pick<BuiltinPlugin, "id" | "kind">): string {
  if (plugin.id === "web-search") return "globe"
  return plugin.kind
}

function iconFor(plugin: BuiltinPlugin) {
  if (plugin.id === "web-search") return Globe
  if (plugin.kind === "capability") return Search
  return KIND_ICONS[plugin.kind] ?? LayoutDashboard
}

export function BuiltinPluginRow({ plugin, enabled, onToggle }: BuiltinPluginRowProps) {
  const Icon = iconFor(plugin)

  return (
    <li
      data-builtin-plugin-row={plugin.id}
      data-builtin-plugin-kind={plugin.kind}
      data-builtin-plugin-enabled={enabled ? "true" : "false"}
      className={cn(
        "rounded-xl border bg-card p-3 transition-colors hover:bg-accent/20",
        // 关闭态整体降一档对比度：一眼能扫出"这一条是关的"，而不是靠读开关位置。
        !enabled && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {/*
          图标块沿用 `PluginGlyph` 的尺寸/配色（`h-10 w-10` + 主色底），
          但图标按 `kind` 选 —— `PluginGlyph` 的三档是"provider / tools / declarative"，
          那是市场插件的分类，跟内置插件的"能力闸门 / 界面"不是一回事。
        */}
        <div
          data-builtin-plugin-glyph={builtinPluginIconId(plugin)}
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{plugin.name}</span>
            {/*
              「内置」徽章：必须让人分清"自带"和"市场装的"。
              没有它，用户会在插件页里找它的卸载按钮，然后找不到、以为界面坏了。
            */}
            <span
              data-builtin-plugin-badge="true"
              title="随软件提供的功能，不是从市场安装的第三方插件"
              className="shrink-0 rounded border px-1 text-[11px] leading-4 text-muted-foreground"
            >
              内置
            </span>
          </div>

          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>

          {/*
            关闭后会发生什么：**次要小字**，不占一行大字。
            `title` 也挂上同一句话，被截断时悬停仍能读全（见 line-clamp-1）。
          */}
          <p
            data-builtin-plugin-off-effect="true"
            title={plugin.offEffect}
            className="mt-1 line-clamp-1 text-[11px] leading-4 text-muted-foreground/80"
          >
            关闭后：{plugin.offEffect}
          </p>
        </div>

        <div className="flex shrink-0 items-center">
          {/*
            `label` 是必填项：开关本身没有可见文字，读屏只能靠它。
            文案用「开启/关闭」而不是「启用/停用」—— 内置插件不是进程，
            说"停用"会暗示它"本来在跑"，那又与市场插件混淆了。
          */}
          <Switch
            checked={enabled}
            label={`${enabled ? "关闭" : "开启"}内置插件「${plugin.name}」`}
            data-ui="builtin-plugin-switch"
            onChange={onToggle}
          />
        </div>
      </div>
    </li>
  )
}

/** 由 id 现取清单条目的便捷包装（插件页按 id 列表渲染时用它）。 */
export function BuiltinPluginRowById(props: {
  id: BuiltinPlugin["id"]
  enabled: boolean
  onToggle: (next: boolean) => void
}) {
  const plugin = builtinPlugin(props.id)
  if (!plugin) return null
  return <BuiltinPluginRow plugin={plugin} enabled={props.enabled} onToggle={props.onToggle} />
}
