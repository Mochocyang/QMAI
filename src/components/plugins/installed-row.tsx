import { useEffect, useRef, useState } from "react"
import { MoreHorizontal, Settings, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { PluginGlyph, pluginGlyphKind } from "@/components/plugins/plugin-glyph"
import type { PluginSummary } from "@/lib/plugins/types"

/**
 * 已安装插件的一行。
 *
 * 与市场卡片的分工：这里**只管一个已经装好的插件**（状态、开关、卸载入口），
 * 所以是横向的一行而不是一张卡 —— 用户的视线只需要在「名称 → 状态 → 开关」
 * 这条横线上扫过去，不必在每张卡里再找一次按钮。
 *
 * 纯展示 + 回调：所有命令调用都在 `plugin-center-view.tsx`。理由与 `MarketCard` 相同 ——
 * 一旦这一行自己 `invoke`，验一个开关就要在 DOM 里铺一整套 Tauri mock。
 */

/** 进程状态 → 状态点颜色 + 中文文案。 */
export interface PluginStatusView {
  label: string
  /** 小圆点的颜色类；`text-muted-foreground` 表示"没在跑"。 */
  dotClassName: string
}

/**
 * 状态展示。
 *
 * `declarative` 单独一档（靛蓝）：它不是"停着"，而是"不需要跑"。
 * 混进灰色的"已停止"会让用户以为插件没启用成功，然后反复点开关。
 * 崩溃/启动失败都归琥珀：它们是同一类事（要用户看一眼 lastError），
 * 只有措辞不同 —— 颜色分四档已经够用，再多就没人分得清了。
 */
export function pluginStatusView(plugin: Pick<PluginSummary, "processState">): PluginStatusView {
  switch (plugin.processState) {
    case "running":
      return { label: "运行中", dotClassName: "text-emerald-600" }
    case "starting":
      return { label: "启动中", dotClassName: "text-amber-600" }
    case "declarative":
      return { label: "声明式", dotClassName: "text-indigo-600" }
    case "failed":
      return { label: "启动失败", dotClassName: "text-amber-600" }
    case "crashed":
      return { label: "异常退出", dotClassName: "text-amber-600" }
    case "disabled_by_crash":
      return { label: "已停用·异常退出", dotClassName: "text-amber-600" }
    case "stopped":
    default:
      // 默认落到"已停止"：后端将来多一个状态时，界面显示"没在跑"是保守方向，
      // 不会把"其实崩了"说成"运行中"。
      return { label: "已停止", dotClassName: "text-muted-foreground" }
  }
}

/** 已知权限的可读说明；未知值原样保留，避免吞掉后端新增的权限。 */
const PERMISSION_LABELS: Record<string, string> = {
  "fs:project-read": "读取项目文件",
  "fs:project-write": "写入项目文件",
  "net:https": "访问网络",
  "net:listen": "在本机开一个端口",
  "llm:use": "调用模型",
  "data:write": "写入插件数据",
}

/**
 * 能力摘要（一行小字）。
 *
 * 为什么要它、又为什么只给一行：用户扫列表时真正的问题是"它到底能干什么"，
 * 而完整清单会把这一行变成一段话（用户的原话就是"全是字"）。所以这里只留
 * **三类事实**：给了几个工具、有没有模型渠道、已经授了什么权限。
 *
 * 三项都没有时返回 `null` —— 调用方整行不渲染，而不是留一个空 `<p>` 占位。
 */
export function pluginCapabilitySummary(
  plugin: Pick<PluginSummary, "toolCount" | "providerIds" | "grantedPermissions">,
): string | null {
  const parts: string[] = []
  if (plugin.toolCount > 0) parts.push(`提供 ${plugin.toolCount} 个工具`)
  if ((plugin.providerIds?.length ?? 0) > 0) parts.push("提供模型渠道")
  const granted = plugin.grantedPermissions ?? []
  if (granted.length > 0) {
    const labels = granted.map((permission) => PERMISSION_LABELS[permission] ?? permission)
    parts.push(`已授权：${labels.join("、")}`)
  }
  return parts.length > 0 ? parts.join(" · ") : null
}

/**
 * 该插件是否声明了配置项（决定「设置」菜单项出不出现）。
 *
 * 判据与设置页 `hasPluginConfig` 同源（清单静态声明面 `preview.hasConfig`），
 * 但**故意不 import 它**：那会把整个设置页的插件管理区（含同步管道、插槽索引）
 * 拖进插件页的按需加载块里 —— 只为读一个布尔值不值得。
 * 形状不认识时一律当"没有配置"：多显示一个点了会报错的入口比少显示更糟。
 */
export function rowHasConfig(plugin: Pick<PluginSummary, "preview">): boolean {
  const preview = plugin.preview
  if (typeof preview !== "object" || preview === null || Array.isArray(preview)) return false
  return (preview as Record<string, unknown>).hasConfig === true
}

export interface InstalledRowProps {
  plugin: PluginSummary
  /** 这一行有动作在进行（开关 / 卸载）：开关 disabled，防止连点。 */
  busy: boolean
  /** 开关切到 `next`（true = 启用）。 */
  onToggle: (plugin: PluginSummary, next: boolean) => void
  /** 「设置」：交给宿主决定去哪儿配（本页不内嵌配置表单）。 */
  onConfigure: (plugin: PluginSummary) => void
  /** 「卸载」：确认与命令都在宿主侧。 */
  onUninstall: (plugin: PluginSummary) => void
}

export function InstalledRow({ plugin, busy, onToggle, onConfigure, onUninstall }: InstalledRowProps) {
  const name = plugin.name.trim() || plugin.id
  const status = pluginStatusView(plugin)
  const capabilities = pluginCapabilitySummary(plugin)
  const configurable = rowHasConfig(plugin)
  const version = plugin.version.trim()

  return (
    <li
      data-plugin-row={plugin.id}
      /* 与设置页卡片同名的标识：一个 DOM 节点 = 一个插件，跨页面复用同一套定位。 */
      data-plugin-id={plugin.id}
      className="rounded-xl border bg-card p-3 transition-colors hover:bg-accent/20"
    >
      <div className="flex min-w-0 items-start gap-3">
        <PluginGlyph
          kind={pluginGlyphKind({
            providerIds: plugin.providerIds,
            toolCount: plugin.toolCount,
          })}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">{name}</span>
            {version ? (
              <span
                data-plugin-version="true"
                className="shrink-0 rounded border px-1 py-px text-[11px] leading-4 text-muted-foreground"
              >
                v{version}
              </span>
            ) : null}
            <span
              data-plugin-status={plugin.processState}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
            >
              <span aria-hidden="true" className={status.dotClassName}>
                ●
              </span>
              {status.label}
            </span>
          </div>

          {plugin.description.trim() ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {plugin.description}
            </p>
          ) : null}

          {capabilities ? (
            <p
              data-plugin-capabilities="true"
              className="mt-1 text-[11px] leading-4 text-muted-foreground"
            >
              {capabilities}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/*
            开关 = 启用 / 停用。文案走 `aria-label`（开关本身没有可见文字）：
            `enabled` 只是"用户想让它跑"，`processState` 才是"它现在到底在不在跑"，
            两者不一致（比如崩溃后 enabled 仍为 true）时，是状态点负责说实话。
          */}
          <Switch
            checked={plugin.enabled}
            disabled={busy}
            label={`${plugin.enabled ? "停用" : "启用"}「${name}」`}
            data-ui="plugin-row-switch"
            onChange={(next) => onToggle(plugin, next)}
          />
          <RowMenu
            plugin={plugin}
            name={name}
            busy={busy}
            configurable={configurable}
            onConfigure={onConfigure}
            onUninstall={onUninstall}
          />
        </div>
      </div>

      {/*
        失败原因：只有后端给了 `lastError` 才出现（目前是崩溃时填）。
        放在卡片底部而不是状态旁边 —— 它经常是一整句中文，塞进标题行会把名称挤掉。
      */}
      {plugin.lastError?.trim() ? (
        <p data-plugin-error="true" className="mt-2 break-words text-xs text-destructive">
          {plugin.lastError}
        </p>
      ) : null}
    </li>
  )
}

interface RowMenuProps {
  plugin: PluginSummary
  name: string
  busy: boolean
  configurable: boolean
  onConfigure: (plugin: PluginSummary) => void
  onUninstall: (plugin: PluginSummary) => void
}

/**
 * 行尾的「⋯」菜单。
 *
 * 为什么用菜单而不是并排两个按钮：卸载是不可逆动作，与「设置」并列在两个
 * 一模一样的小按钮里，误点成本太高；收进菜单后它才有一次"刻意选择"。
 *
 * 自己管开合（仓库里没有现成的 dropdown 基础件，`@base-ui/react/menu` 只被
 * uitest 用过）：点外部关闭 + Esc 关闭，够用即可，不引新库。
 */
function RowMenu({ plugin, name, busy, configurable, onConfigure, onUninstall }: RowMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`「${name}」更多操作`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-plugin-row-menu="true"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal />
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label={`「${name}」更多操作`}
          className="absolute right-0 top-full z-20 mt-1 w-32 rounded-lg border bg-popover p-1 shadow-md"
        >
          {configurable ? (
            <button
              type="button"
              role="menuitem"
              data-plugin-row-action="configure"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/40"
              onClick={() => {
                setOpen(false)
                onConfigure(plugin)
              }}
            >
              <Settings className="h-3.5 w-3.5" />
              设置
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-plugin-row-action="uninstall"
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            onClick={() => {
              setOpen(false)
              onUninstall(plugin)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            卸载
          </button>
        </div>
      ) : null}
    </div>
  )
}
