import { expect, test } from "vitest"
import {
  extractChapterBodyFromToolCalls,
  extractWorkflowFinalContent,
  getCopyableAssistantContent,
} from "./chat-copy-content"

test("copies generated chapter edit content instead of surrounding context", () => {
  const content = [
    "Outline context that should not be copied.",
    "",
    '<file_edit path="wiki/chapters/chapter-003.md">',
    "<search>",
    "Old chapter text.",
    "</search>",
    "<replace>",
    "# Chapter 3",
    "",
    "The usable chapter body starts here.",
    "</replace>",
    "</file_edit>",
  ].join("\n")

  const copied = getCopyableAssistantContent(content)

  expect(copied).toContain("The usable chapter body starts here.")
  expect(copied).not.toContain("Outline context")
  expect(copied).not.toContain("<file_edit")
})

test("strips trailing 出错 suffix when copying assistant content", () => {
  const content = [
    "# 第22章 大学同学局",
    "",
    "周六下午，陈远到了 NEAT。",
    "",
    "出错：HTTP 503: Service Unavailable — upstream connect error",
  ].join("\n")

  expect(getCopyableAssistantContent(content)).toBe(
    "# 第22章 大学同学局\n\n周六下午，陈远到了 NEAT。",
  )
})

test("extracts final chapter body from run_chapter_workflow tool result", () => {
  const workflowResult = [
    "章节工作流完成。",
    "是否返修：是",
    "任务书：# 第22章-大学同学局",
    "",
    "最终正文：",
    "# 第22章 大学同学局",
    "",
    "周六下午一点四十五，陈远把车停在安福路。",
    "",
    "产品要活下来，得先学会在真实世界里呼吸。",
  ].join("\n")

  expect(extractWorkflowFinalContent(workflowResult)).toContain("第22章 大学同学局")
  expect(extractWorkflowFinalContent(workflowResult)).toContain("真实世界里呼吸")
  expect(extractChapterBodyFromToolCalls([
    {
      name: "run_chapter_workflow",
      status: "done",
      result: workflowResult,
    },
  ])).toContain("真实世界里呼吸")
})

test("recovers chapter body from tool calls when message content is only an error", () => {
  const workflowResult = [
    "章节工作流完成。",
    "是否返修：是",
    "任务书：outline",
    "",
    "最终正文：",
    "# 第22章 大学同学局",
    "",
    "周六下午，陈远推开 NEAT 的门。",
  ].join("\n")

  const copied = getCopyableAssistantContent(
    "出错：HTTP 503: Service Unavailable — upstream connect error or disconnect/reset before headers. retried and the latest reset reason: remote connection failure, transport failure reason: delayed connect error: Connection refused",
    {
      toolCalls: [
        {
          name: "chapter_final_polish",
          status: "done",
          result: "简单审查与去AI味完成，最终正文约 4506 字。",
        },
        {
          name: "run_chapter_workflow",
          status: "done",
          result: workflowResult,
        },
        {
          name: "chapter_execution_repair",
          status: "error",
          result: "HTTP 503: Service Unavailable",
        },
      ],
    },
  )

  expect(copied).toContain("# 第22章 大学同学局")
  expect(copied).toContain("推开 NEAT 的门")
  expect(copied).not.toContain("出错：")
  expect(copied).not.toContain("HTTP 503")
  expect(copied).not.toContain("任务书：")
})
