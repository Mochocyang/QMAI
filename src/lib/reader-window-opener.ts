import { invoke } from "@tauri-apps/api/core"
import { toast } from "@/lib/toast"
import { isTauri } from "@/lib/platform"
import {
  buildReaderWindowUrl,
  readerWindowLabel,
  type ReaderWindowKind,
  type ReaderWindowPayload,
  type ReaderWindowTheme,
} from "@/lib/reader-window"
import { readReaderWindowAppearance } from "@/lib/reader-window-appearance"
import { useWikiStore } from "@/stores/wiki-store"

/**
 * 建窗入口。
 *
 * 真正建窗的是 Rust 侧 `open_reader_window`：它先把 payload 序列化进
 * `initialization_script`（新窗口一起来就能读到，不依赖 URL 查询串），
 * 再 `WebviewWindowBuilder::build()`。之所以不在这儿 `new WebviewWindow()`，
 * 是因为 JS 侧拿不到建窗失败的真实原因 —— 命令调用至少能把错误原文带回来，
 * 出了问题能在界面上看见，而不是只在控制台留一行。
 *
 * 同一份文档（label 由路径哈希得到）重复右键由 Rust 侧识别为"已存在"，
 * 直接聚焦，不会长出一排内容相同的窗。
 */
function fileNameOf(path: string): string {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path
  return name.replace(/\.md$/i, "")
}

function currentTheme(): ReaderWindowTheme {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export async function openDocumentInReaderWindow(
  path: string,
  kind: ReaderWindowKind,
): Promise<void> {
  const projectPath = useWikiStore.getState().project?.path ?? null
  const label = readerWindowLabel(path)
  /*
   * 外观 / 排版快照必须**在建窗这一刻**取：独立窗口有自己的 WebView2 profile，
   * localStorage（皮肤）和 store（字体、字号、行距…）都不共享 —— 它自己读不到，
   * 只会退回出厂默认，用户看到的就是「新窗口没跟随设置」。
   */
  const payload: ReaderWindowPayload = {
    kind,
    path,
    projectPath,
    theme: currentTheme(),
    appearance: readReaderWindowAppearance(),
  }

  // 浏览器里跑（vite 直开）时退化成 window.open，方便验收布局。
  if (!isTauri()) {
    window.open(
      buildReaderWindowUrl(payload, typeof window !== "undefined" ? window.location.href : undefined),
      label,
      "width=920,height=780",
    )
    return
  }

  try {
    await invoke("open_reader_window", { label, title: fileNameOf(path), payload })
  } catch (error) {
    // 静默失败是最糟的结果：用户点了没反应，只会以为功能坏了。
    console.error("在独立窗口中打开失败:", error)
    toast.error(typeof error === "string" ? error : "独立窗口打开失败", {
      dedupeKey: "reader-window-open-failed",
    })
    throw error
  }
}
