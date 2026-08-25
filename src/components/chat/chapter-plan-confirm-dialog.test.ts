import { expect, test } from "vitest"
import {
  CHAPTER_PLAN_MARKER_END,
  CHAPTER_PLAN_MARKER_START,
  extractChapterPlan,
} from "./chapter-plan-confirm-dialog"

test("extracts plan wrapped in chapter_plan markers", () => {
  const fullContent = [
    "下面是本章计划：",
    CHAPTER_PLAN_MARKER_START,
    "### 1. 本章目标",
    "- 推进主线",
    CHAPTER_PLAN_MARKER_END,
    "请确认。",
  ].join("\n")

  const extracted = extractChapterPlan(fullContent)
  expect(extracted).not.toBeNull()
  expect(extracted!.plan).toContain("本章目标")
  expect(extracted!.plan).not.toContain(CHAPTER_PLAN_MARKER_START)
  expect(extracted!.body).toContain("下面是本章计划：")
  expect(extracted!.body).toContain("请确认。")
})

test("tolerates a missing end marker (truncated output)", () => {
  const fullContent = [
    CHAPTER_PLAN_MARKER_START,
    "### 1. 本章目标",
    "- 推进主线，但输出在这里被截断了",
  ].join("\n")

  const extracted = extractChapterPlan(fullContent)
  expect(extracted).not.toBeNull()
  expect(extracted!.plan).toContain("本章目标")
  expect(extracted!.plan).toContain("被截断了")
})

test("falls back to keyword sections when markers are absent", () => {
  const fullContent = [
    "### 本章目标",
    "- 推进主线",
    "",
    "### 分场景执行计划",
    "- S1：开场冲突",
  ].join("\n")

  const extracted = extractChapterPlan(fullContent)
  expect(extracted).not.toBeNull()
  expect(extracted!.plan).toContain("分场景执行计划")
})

test("returns null for content that is neither marked nor plan-shaped", () => {
  expect(extractChapterPlan("好的，我明白了。")).toBe(null)
  expect(extractChapterPlan("")).toBe(null)
})
