import { useEffect, useState, useRef } from "react"

export function useBatchedValue<T>(value: T, isStreaming: boolean): T {
  const [batched, setBatched] = useState(value)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<T>(value)
  const hasPendingRef = useRef(false)

  useEffect(() => {
    if (!isStreaming) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (hasPendingRef.current) {
        setBatched(pendingRef.current)
        hasPendingRef.current = false
      } else {
        setBatched(value)
      }
      return
    }

    pendingRef.current = value
    hasPendingRef.current = true

    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      if (hasPendingRef.current) {
        setBatched(pendingRef.current)
        hasPendingRef.current = false
      }
    })

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [value, isStreaming])

  return batched
}
