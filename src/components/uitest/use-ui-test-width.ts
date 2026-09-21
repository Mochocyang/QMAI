import { useLayoutEffect, useState, type RefObject } from "react"

/** 只测量当前容器，不把整个窗口宽度当作编辑区宽度。 */
export function useUiTestWidth(ref: RefObject<HTMLElement | null>, initialWidth = window.innerWidth) {
  const [width, setWidth] = useState(initialWidth)
  useLayoutEffect(() => {
    const measure = () => {
      const next = ref.current?.getBoundingClientRect().width
      if (next && next > 0) setWidth(next)
    }
    measure()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    if (ref.current) observer?.observe(ref.current)
    window.addEventListener("resize", measure)
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure) }
  }, [ref])
  return width
}
