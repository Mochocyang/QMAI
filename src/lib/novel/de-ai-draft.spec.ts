import { describe, expect, it } from "vitest"
import {
  resolveAvailableDeAiDraftPath,
  saveDeAiDraftWithoutOverwrite,
} from "./de-ai-draft"

describe("resolveAvailableDeAiDraftPath", () => {
  it("uses the standard draft name when it is available", async () => {
    const result = await resolveAvailableDeAiDraftPath(
      "C:\\Book\\wiki\\chapters\\第一章.md",
      async () => false,
    )

    expect(result).toBe("C:/Book/wiki/chapters/第一章-去AI味稿.md")
  })

  it("adds a sequence number instead of overwriting an existing draft", async () => {
    const existing = new Set([
      "C:/Book/第一章-去AI味稿.md",
      "C:/Book/第一章-去AI味稿-2.md",
    ])

    const result = await resolveAvailableDeAiDraftPath(
      "C:/Book/第一章.md",
      async (path) => existing.has(path),
    )

    expect(result).toBe("C:/Book/第一章-去AI味稿-3.md")
  })

  it("atomically retries another name when a draft appears during saving", async () => {
    const attempts: string[] = []
    const result = await saveDeAiDraftWithoutOverwrite(
      "C:/Book/第一章.md",
      "候选正文",
      async (path, content) => {
        attempts.push(path)
        expect(content).toBe("候选正文")
        return attempts.length > 1
      },
    )

    expect(attempts).toEqual([
      "C:/Book/第一章-去AI味稿.md",
      "C:/Book/第一章-去AI味稿-2.md",
    ])
    expect(result).toBe("C:/Book/第一章-去AI味稿-2.md")
  })

  it("keeps probing unique timestamp names after the numbered range is full", async () => {
    let attempts = 0
    const result = await saveDeAiDraftWithoutOverwrite(
      "C:/Book/第一章.md",
      "候选正文",
      async () => {
        attempts += 1
        return attempts > 100
      },
      () => 123456,
    )

    expect(attempts).toBe(101)
    expect(result).toBe("C:/Book/第一章-去AI味稿-123456-2.md")
  })
})
