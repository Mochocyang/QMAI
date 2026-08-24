/**
 * 主题工具函数：检测系统主题、应用主题、监听系统主题变化
 */

export type ThemeMode = "light" | "dark" | "system"

/**
 * 检测系统是否为深色模式
 */
function isSystemDark(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

/**
 * 获取系统当前对应的实际主题（light 或 dark）
 */
function getSystemTheme(): "light" | "dark" {
  return isSystemDark() ? "dark" : "light"
}

/**
 * 应用主题到 documentElement
 */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return

  const html = document.documentElement
  html.classList.remove("dark")

  let actualTheme = theme
  if (theme === "system") {
    actualTheme = getSystemTheme()
  }

  if (actualTheme === "dark") {
    html.classList.add("dark")
  }
}

/**
 * 监听系统主题变化，当主题为system模式时自动切换
 * 返回一个取消监听的函数
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = () => onChange()

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", handler)
    return () => mediaQuery.removeEventListener("change", handler)
  } else {
    // 兼容旧浏览器
    mediaQuery.addListener(handler)
    return () => mediaQuery.removeListener(handler)
  }
}
