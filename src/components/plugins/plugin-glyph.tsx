import { Boxes, Puzzle, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 插件图标块的「种类」。
 *
 * 只分三类，因为界面上它决定的是**一眼可辨的轮廓**（盒子 / 扳手 / 拼图），
 * 不是精确的能力清单 —— 精确的那部分写在名称下面那行能力摘要里。
 */
export type PluginGlyphKind = "provider" | "tools" | "declarative"

/** 图标块要的判据：市场条目只有 `kind`，已安装插件只有 `providerIds` / `toolCount`。 */
export interface PluginGlyphInput {
  kind?: readonly string[]
  providerIds?: readonly string[]
  toolCount?: number
}

/**
 * 判断该画哪个图标。
 *
 * 优先级按「越能接管你的数据 = 越该被一眼认出」排：provider（会把对话发给上游）
 * 先判，其次是工具插件，剩下的才当声明式。
 *
 * 两条数据源都看：市场条目还没安装、读不到清单，只有索引里的 `kind`；
 * 已安装插件反过来只有 `providerIds` / `toolCount`。任何一条命中就算，都不命中
 * 才退回 `declarative`（拼图 = 「不知道它能做什么」，这是最保守的兜底）。
 */
export function pluginGlyphKind(input: PluginGlyphInput): PluginGlyphKind {
  const declared = input.kind ?? []
  if (declared.includes("providers")) return "provider"
  if ((input.providerIds?.length ?? 0) > 0) return "provider"
  if (declared.includes("tools")) return "tools"
  if ((input.toolCount ?? 0) > 0) return "tools"
  return "declarative"
}

const GLYPH_ICONS = {
  provider: Boxes,
  tools: Wrench,
  declarative: Puzzle,
} as const

export interface PluginGlyphProps {
  kind?: PluginGlyphKind
  /** 尺寸覆盖（默认 `h-10 w-10`）；颜色与圆角不外露，避免每个调用点各配一套。 */
  className?: string
}

/**
 * 插件图标块：一块带主色底的方形图标。
 *
 * 为什么要有它：列表与市场卡片上每一个插件都长得一样（名字 + 一行字），
 * 用户扫视时没有锚点。一个 40px 的色块能在「全是字」的界面里先把条目切开，
 * 让眼睛知道「这一坨是一张卡」。
 *
 * `aria-hidden`：图标纯装饰，插件名就在旁边，读屏再念一遍图标只会制造噪音。
 */
export function PluginGlyph({ kind = "declarative", className }: PluginGlyphProps) {
  const Icon = GLYPH_ICONS[kind]
  return (
    <div
      data-plugin-glyph={kind}
      aria-hidden="true"
      className={cn(
        "grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary",
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </div>
  )
}
