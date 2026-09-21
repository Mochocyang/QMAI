import { describe, expect, it } from "vitest"
import {
  CHAPTER_INGEST_LOG_REL,
  chapterIngestLogPath,
  formatChapterIngestLogLine,
  previewLlmOutput,
} from "./chapter-ingest-log"

describe("chapter ingest log", () => {
  it("writes under the project .qmai directory", () => {
    expect(CHAPTER_INGEST_LOG_REL).toBe(".qmai/chapter-ingest.log")
    expect(chapterIngestLogPath("/Users/omi/book")).toBe("/Users/omi/book/.qmai/chapter-ingest.log")
  })

  it("formats one JSON line and truncates long model output", () => {
    const line = formatChapterIngestLogLine({
      at: "2026-09-02T04:00:00.000Z",
      event: "fail",
      chapterNumber: 298,
      failReason: "extract_failed",
      error: "cursor-api-proxy is not reachable",
    })
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toMatchObject({
      event: "fail",
      chapterNumber: 298,
      error: "cursor-api-proxy is not reachable",
    })
    expect(previewLlmOutput("a".repeat(10), 4)).toBe("aaaa…[truncated 6 chars]")
  })
})
