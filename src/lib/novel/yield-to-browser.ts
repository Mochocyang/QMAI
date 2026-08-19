export function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible"
}

export function yieldToBrowserFrame(): Promise<void> {
  if (!isDocumentVisible()) {
    return Promise.resolve()
  }

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0)
      })
    })
  }

  return new Promise((resolve) => setTimeout(resolve, 0))
}
