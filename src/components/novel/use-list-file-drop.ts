import { useCallback, useEffect, useRef, useState } from "react"

import { isTauri } from "@/lib/platform"
import {
  describeUnsupportedDrop,
  dropRectFromBounds,
  filterDroppablePaths,
  isDropInsideList,
  type ListKind,
} from "@/lib/novel/drop-import"

/**
 * 让大纲/章节列表**直接接住从桌面拖进来的文件**。
 *
 * 为什么不是普通的 HTML5 拖放：这个是 Tauri 桌面应用，webview 默认开着
 * `dragDropEnabled`，系统级拖放事件在到达 DOM 之前就被 Tauri 接走了 ——
 * 所以 React 的 onDrop / dataTransfer 在这里**永远收不到**桌面文件，
 * 必须改用 `getCurrentWebview().onDragDropEvent`。
 *
 * 三条必须处理的坑：
 *   1. 事件里的坐标是**物理像素**，DOM 矩形是 CSS 像素，要按 devicePixelRatio 换算
 *      （见 drop-import.ts）。不然 125%/150% 缩放的高分屏上判定框会整体偏移。
 *   2. 这个监听器是**整个 webview 级**的：不管用户此刻把文件拖在窗口哪个位置都会收到。
 *      所以必须拿列表自己的矩形做命中判定，只有落在列表上才当作"拖进列表导入"，
 *      拖到编辑器区域不能也触发导入。
 *   3. jsdom 里既没有 `__TAURI_INTERNALS__` 也没有 IPC，模块必须**动态引入**，
 *      否则所有挂到 SidebarPanel 的测试都会在 import 阶段就炸掉。
 *
 * 返回的 `containerRef` 要挂到列表容器上，`isDraggingOver` 用来画拖拽高亮。
 */
export function useListFileDrop({
  enabled,
  kind,
  onDropPaths,
  onUnsupportedDrop,
}: {
  /** 关掉它（比如没有打开项目、或正在导入中）时不注册监听。 */
  enabled: boolean
  kind: ListKind
  onDropPaths: (paths: string[]) => void
  /** 拖进来的东西一个都不能导入时调用，由调用方决定怎么提示。 */
  onUnsupportedDrop?: (message: string) => void
}): {
  containerRef: React.RefObject<HTMLDivElement | null>
  isDraggingOver: boolean
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isDraggingOver, setIsDraggingOver] = useState(false)

  // 回调与 kind 都放进 ref：监听器只注册一次（进出拖动状态时不该反复解绑重绑），
  // 但它必须看到最新的回调，否则"拖进来时项目还没打开"这类时序变化会被旧闭包吃掉。
  const kindRef = useRef(kind)
  const onDropPathsRef = useRef(onDropPaths)
  const onUnsupportedDropRef = useRef(onUnsupportedDrop)
  useEffect(() => {
    kindRef.current = kind
    onDropPathsRef.current = onDropPaths
    onUnsupportedDropRef.current = onUnsupportedDrop
  }, [kind, onDropPaths, onUnsupportedDrop])

  const currentRect = useCallback(() => {
    const element = containerRef.current
    if (!element) return null
    return dropRectFromBounds(element.getBoundingClientRect())
  }, [])

  useEffect(() => {
    if (!enabled || !isTauri()) return
    let disposed = false
    let unlisten: (() => void) | null = null

    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview")
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return
          const payload = event.payload
          if (payload.type === "leave") {
            setIsDraggingOver(false)
            return
          }
          if (payload.type === "enter" || payload.type === "over") {
            setIsDraggingOver(
              isDropInsideList(payload.position, currentRect(), window.devicePixelRatio),
            )
            return
          }
          // drop：先收掉高亮，再判定落点。
          setIsDraggingOver(false)
          if (!isDropInsideList(payload.position, currentRect(), window.devicePixelRatio)) return

          const accepted = filterDroppablePaths(payload.paths, kindRef.current)
          if (accepted.length === 0) {
            onUnsupportedDropRef.current?.(
              describeUnsupportedDrop(payload.paths, kindRef.current),
            )
            return
          }
          // 目录名可能碰巧带扩展名，交给导入流程自己按内容判断；
          // 这里只做"值不值得走一趟导入"的粗筛。
          onDropPathsRef.current(accepted)
        })
        if (disposed) {
          // 组件在 await 期间被卸载了：立刻退订，别留一个指向已卸载组件的监听器。
          stop()
          return
        }
        unlisten = stop
      } catch (error) {
        // 拿不到原生拖拽（开发浏览器里跑、权限缺失）时静默降级：
        // 拖拽导入只是锦上添花，菜单导入仍然可用，不该为此打断界面。
        console.warn("[useListFileDrop] 原生拖拽监听注册失败:", error)
      }
    })()

    return () => {
      disposed = true
      unlisten?.()
      setIsDraggingOver(false)
    }
  }, [enabled, currentRect])

  return { containerRef, isDraggingOver }
}
