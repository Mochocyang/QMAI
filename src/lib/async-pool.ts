export interface MapWithConcurrencyOptions {
  signal?: AbortSignal
  onItemComplete?: (index: number) => void
}

/**
 * Map items with a fixed concurrency limit. Result order matches input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  options?: MapWithConcurrencyOptions,
): Promise<R[]> {
  if (items.length === 0) return []

  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      if (options?.signal?.aborted) return
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
      options?.onItemComplete?.(index)
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}
