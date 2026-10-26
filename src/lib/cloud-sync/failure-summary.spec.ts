import { describe, expect, it } from "vitest"

import { describeFailures, groupFailuresByProvider } from "./failure-summary"
import type { SyncBatch, SyncEntry } from "./types"

function batch(batchId: string, provider: string | null): SyncBatch {
  return {
    batchId,
    startedAt: 1,
    trigger: "manual",
    state: "failed",
    counts: { upload: 0, download: 0, delete: 0, conflict: 0, skip: 0, failed: 1 },
    provider: provider as never,
  }
}

function entry(batchId: string, ok: boolean): SyncEntry {
  return {
    id: `${batchId}-${Math.random()}`,
    batchId,
    at: 1,
    direction: "upload",
    path: "a.md",
    ok,
  }
}

describe("按网盘汇总失败", () => {
  it("GitHub 失败时点名 GitHub", () => {
    const groups = groupFailuresByProvider([batch("b1", "github")], [entry("b1", false)])
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("GitHub")
    expect(groups[0].count).toBe(1)
  })

  it("网盘本地文件夹失败时点名「网盘本地文件夹」", () => {
    const groups = groupFailuresByProvider([batch("b1", "folder")], [entry("b1", false)])
    expect(groups[0].label).toBe("网盘本地文件夹")
  })

  it("坚果云（WebDAV）失败时点名坚果云", () => {
    const groups = groupFailuresByProvider([batch("b1", "webdav")], [entry("b1", false)])
    expect(groups[0].label).toBe("坚果云")
  })

  it("多个盘同时失败时分别列出，成功的不算进去", () => {
    const groups = groupFailuresByProvider(
      [batch("b1", "github"), batch("b2", "folder")],
      [entry("b1", false), entry("b1", false), entry("b1", true), entry("b2", false)],
    )
    expect(groups).toHaveLength(2)
    // 失败多的排前面
    expect(groups[0].label).toBe("GitHub")
    expect(groups[0].count).toBe(2)
    expect(groups[1].label).toBe("网盘本地文件夹")
    expect(groups[1].count).toBe(1)
  })

  it("老历史没有 provider 字段时给「未知网盘」而不是崩", () => {
    const groups = groupFailuresByProvider([batch("b1", null)], [entry("b1", false)])
    expect(groups[0].label).toBe("未知网盘")
  })

  it("没有失败时返回空数组", () => {
    expect(groupFailuresByProvider([batch("b1", "github")], [entry("b1", true)])).toEqual([])
  })

  it("描述文案点名到每个盘", () => {
    const groups = groupFailuresByProvider(
      [batch("b1", "github"), batch("b2", "webdav")],
      [entry("b1", false), entry("b2", false), entry("b2", false)],
    )
    expect(describeFailures(groups)).toBe("坚果云同步失败（2 项）；GitHub同步失败（1 项）")
  })
})
