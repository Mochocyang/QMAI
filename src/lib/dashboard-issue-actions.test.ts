import { expect, test } from "vitest"
import { parseFactCheckInsertPlan } from "./dashboard-issue-actions"

test("parses fact-check insert plan using the snake_case keys requested by the prompt", () => {
  const plan = parseFactCheckInsertPlan(JSON.stringify({
    anchor_text: "宋惊蛰走到楼梯口。",
    insert_text: "他先确认身后的脚步声已经消失，才贴着墙面继续往前。",
  }))

  expect(plan).toEqual({
    anchorText: "宋惊蛰走到楼梯口。",
    insertText: "他先确认身后的脚步声已经消失，才贴着墙面继续往前。",
  })
})
