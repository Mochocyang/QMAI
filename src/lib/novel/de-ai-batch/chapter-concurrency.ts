import { useWikiStore } from "@/stores/wiki-store"
import { clampDeAiBatchConcurrency } from "./scheduler"

let active = 0
const waiters: Array<() => void> = []

function currentLimit(): number {
  return clampDeAiBatchConcurrency(useWikiStore.getState().novelConfig.deAiBatchConcurrency)
}

function pump(): void {
  while (waiters.length > 0 && active < currentLimit()) {
    const next = waiters.shift()
    next?.()
  }
}

export function notifyDeAiChapterConcurrencyChanged(): void {
  pump()
}

export function acquireDeAiChapterSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (active >= currentLimit()) {
        waiters.push(tryAcquire)
        return
      }
      active += 1
      let released = false
      resolve(() => {
        if (released) return
        released = true
        active = Math.max(0, active - 1)
        pump()
      })
    }
    tryAcquire()
  })
}

export function getDeAiChapterConcurrencySnapshot(): { active: number; queued: number; limit: number } {
  return { active, queued: waiters.length, limit: currentLimit() }
}

export function resetDeAiChapterConcurrencyForTests(): void {
  active = 0
  waiters.length = 0
}
