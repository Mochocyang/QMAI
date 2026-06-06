export function yieldToBrowserFrame(): Promise<void> {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0)
      })
    })
  }

  return new Promise((resolve) => setTimeout(resolve, 0))
}
