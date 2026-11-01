import { Puzzle } from "lucide-react"

import { BUILTIN_PLUGINS } from "@/lib/plugins/builtin"
import type { WikiState } from "@/stores/wiki-store"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 「这个功能被关掉了」的提示页。
 *
 * 为什么需要它，而不是让导航入口消失就够了：
 *   导航会过滤掉被关闭的视图，但用户仍可能落到这里 ——
 *   · 上一次会话的 `activeView` 被恢复了（关掉插件之后重启，store 里还是那个值）；
 *   · 别的代码 `setActiveView("reviewCenter")` 了一个已关闭的视图。
 *   这两种情况下如果什么都不画，用户看到的是**一片空白**，第一反应是"软件坏了"，
 *   而不是"我把这个功能关了"。空白是缺陷，明说不是。
 */
export function BuiltinViewDisabledNotice({ view }: { view: NonNullable<WikiState["activeView"]> }) {
  const setActiveView = useWikiStore((state) => state.setActiveView)
  const plugin = BUILTIN_PLUGINS.find((item) => item.view === view)
  const name = plugin?.name ?? "这个功能"

  return (
    <div
      data-ui-page="builtin-disabled"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <div className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
        <Puzzle className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="text-base font-medium">「{name}」已关闭</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {plugin?.offEffect ?? "它作为一个内置插件被关闭了。"}
      </p>
      <button
        type="button"
        className="mt-1 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        onClick={() => setActiveView("plugins")}
      >
        打开插件页
      </button>
    </div>
  )
}
