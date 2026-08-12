import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_NOVEL_CONFIG, useWikiStore } from "@/stores/wiki-store"
import {
  acquireDeAiChapterSlot,
  getDeAiChapterConcurrencySnapshot,
  notifyDeAiChapterConcurrencyChanged,
  resetDeAiChapterConcurrencyForTests,
} from "./chapter-concurrency"

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("chapter de-AI concurrency gate", () => {
  afterEach(() => {
    resetDeAiChapterConcurrencyForTests()
    useWikiStore.setState({ novelConfig: DEFAULT_NOVEL_CONFIG })
  })

  it("reads deAiBatchConcurrency from novelConfig and queues overflow FIFO", async () => {
    useWikiStore.setState({
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, deAiBatchConcurrency: 2 },
    })
    const started: number[] = []
    const gates = [deferred(), deferred(), deferred()]

    const run = async (index: number) => {
      const release = await acquireDeAiChapterSlot()
      started.push(index)
      await gates[index].promise
      release()
    }

    const tasks = [run(0), run(1), run(2)]
    await flush()
    expect(started).toEqual([0, 1])
    expect(getDeAiChapterConcurrencySnapshot()).toMatchObject({ active: 2, queued: 1, limit: 2 })

    gates[0].resolve()
    await flush()
    expect(started).toEqual([0, 1, 2])

    gates[1].resolve()
    gates[2].resolve()
    await Promise.all(tasks)
    expect(getDeAiChapterConcurrencySnapshot()).toMatchObject({ active: 0, queued: 0 })
  })

  it("pumps queued work when the setting is raised", async () => {
    useWikiStore.setState({
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, deAiBatchConcurrency: 1 },
    })
    const started: number[] = []
    const gate = deferred()

    const run = async (index: number) => {
      const release = await acquireDeAiChapterSlot()
      started.push(index)
      await gate.promise
      release()
    }

    void run(0)
    void run(1)
    await flush()
    expect(started).toEqual([0])

    useWikiStore.setState({
      novelConfig: { ...DEFAULT_NOVEL_CONFIG, deAiBatchConcurrency: 3 },
    })
    notifyDeAiChapterConcurrencyChanged()
    await flush()
    expect(started).toEqual([0, 1])

    gate.resolve()
  })
})
