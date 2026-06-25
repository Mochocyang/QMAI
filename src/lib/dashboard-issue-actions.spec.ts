import { describe, expect, it } from "vitest"
import { parseFactCheckInsertPlan } from "./dashboard-issue-actions"

describe("dashboard issue actions", () => {
  it("parses fact check insert plan returned with prompt field names", () => {
    const raw = `{
      "anchor_text": "黑玉残镜把手机放到桌上。",
      "insert_text": "在这之前，杨栋把手机交给黑玉残镜，补上了物品转移的过程。"
    }`

    const plan = parseFactCheckInsertPlan(raw)

    expect(plan).toEqual({
      anchorText: "黑玉残镜把手机放到桌上。",
      insertText: "在这之前，杨栋把手机交给黑玉残镜，补上了物品转移的过程。",
    })
  })
})
