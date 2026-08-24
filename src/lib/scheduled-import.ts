

let scanTimer: ReturnType<typeof setInterval> | null = null
let activeRunId = 0

export function stopScheduledImport(): void {
  activeRunId += 1
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}
