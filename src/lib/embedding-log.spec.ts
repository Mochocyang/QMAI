import { describe, expect, it } from "vitest"
import {
  EMBEDDING_INDEX_LOG_REL,
  embeddingIndexLogPath,
  endpointHost,
  formatEmbeddingLogLine,
  trimLogLines,
} from "./embedding-log"

describe("embedding index log", () => {
  it("writes under the project .qmai directory", () => {
    expect(EMBEDDING_INDEX_LOG_REL).toBe(".qmai/embedding-index.log")
    expect(embeddingIndexLogPath("/Users/omi/xiaoshuo/Red_Alert")).toBe(
      "/Users/omi/xiaoshuo/Red_Alert/.qmai/embedding-index.log",
    )
  })

  it("keeps the host and drops query secrets", () => {
    expect(endpointHost("https://api.example.com/v1/embeddings?key=secret")).toBe("api.example.com")
    expect(endpointHost("http://127.0.0.1:8080/v1/embeddings")).toBe("127.0.0.1:8080")
    expect(endpointHost("not a url")).toBe("")
  })

  it("formats one JSON line and keeps the tail when the log is long", () => {
    const line = formatEmbeddingLogLine({
      at: "2026-09-22T10:00:00.000Z",
      event: "beat",
      done: 488,
      total: 1464,
      inFlight: 32,
      oldestMs: 45000,
    })
    expect(line.endsWith("\n")).toBe(true)
    expect(JSON.parse(line)).toMatchObject({
      event: "beat",
      done: 488,
      inFlight: 32,
      oldestMs: 45000,
    })
    expect(trimLogLines(["a", "b", "c"], 2)).toEqual(["b", "c"])
  })
})
