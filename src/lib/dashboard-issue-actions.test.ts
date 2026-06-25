import { expect, test } from "vitest"
import { parseFactCheckInsertPlan } from "./dashboard-issue-actions"

test("parses fact-check insert plan using snake_case keys", () => {
  const plan = parseFactCheckInsertPlan(JSON.stringify({
    anchor_text: "The hero reached the stairwell.",
    insert_text: "He checked that the footsteps behind him had faded.",
  }))

  expect(plan).toEqual({
    anchorText: "The hero reached the stairwell.",
    insertText: "He checked that the footsteps behind him had faded.",
  })
})
