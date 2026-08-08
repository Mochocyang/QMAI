import { expect, test } from "vitest"
import {
  extractChapterBodyFromToolCalls,
  extractWorkflowFinalContent,
  getCopyableAssistantContent,
  isThinChapterAssistantContent,
  shouldPreferWorkflowChapterBody,
} from "./chat-copy-content"

function buildWorkflowResult(body: string): string {
  return [
    "章节工作流完成。",
    "是否返修：是",
    "任务书：outline",
    "",
    "最终正文：",
    body,
  ].join("\n")
}

const LONG_CHAPTER_BODY = [
  "# 第32章 查分夜",
  "",
  "六月下旬的晚上，长泰广场八楼的灯亮到很晚。".repeat(20),
  "",
  "陈远坐在评审位前，屏幕上是云记3.0的代码评审页面。".repeat(15),
  "",
  "苏晴把手机递过来，两人继续改搜索层级。".repeat(15),
].join("\n")

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

test("isThinChapterAssistantContent detects completion notices and short text", () => {
  expect(isThinChapterAssistantContent("第 32 章正文已按章纲重写完成。")).toBe(true)
  expect(isThinChapterAssistantContent("短文本")).toBe(true)
  expect(isThinChapterAssistantContent(LONG_CHAPTER_BODY)).toBe(false)
})

test("shouldPreferWorkflowChapterBody only when assistant is thin and workflow is long", () => {
  expect(
    shouldPreferWorkflowChapterBody("第 32 章正文已按章纲重写完成。", LONG_CHAPTER_BODY),
  ).toBe(true)
  expect(shouldPreferWorkflowChapterBody(LONG_CHAPTER_BODY, LONG_CHAPTER_BODY)).toBe(false)
  expect(shouldPreferWorkflowChapterBody("第 32 章正文已按章纲重写完成。", "短草稿")).toBe(false)
})

test("falls back to workflow final body when assistant content is a completion notice", () => {
  const copied = getCopyableAssistantContent("第 32 章正文已按章纲重写完成。", {
    toolCalls: [
      {
        name: "run_chapter_workflow",
        status: "done",
        result: buildWorkflowResult(LONG_CHAPTER_BODY),
      },
    ],
  })

  expect(copied).toContain("# 第32章 查分夜")
  expect(copied).toContain("长泰广场八楼")
  expect(copied).not.toContain("已按章纲重写完成")
})

test("keeps full assistant chapter body even when workflow also has final content", () => {
  const assistantBody = [
    "# 第32章 查分夜",
    "",
    "模型按章纲重写后的完整正文从这里开始。".repeat(40),
    "",
    "夜宵后苏晴发来周末见。".repeat(20),
  ].join("\n")

  const copied = getCopyableAssistantContent(assistantBody, {
    toolCalls: [
      {
        name: "run_chapter_workflow",
        status: "done",
        result: buildWorkflowResult(LONG_CHAPTER_BODY),
      },
    ],
  })

  expect(copied).toContain("模型按章纲重写后的完整正文")
  expect(copied).not.toContain("六月下旬的晚上")
})

test("keeps short assistant content when workflow body is unavailable", () => {
  expect(getCopyableAssistantContent("第 32 章正文已按章纲重写完成。")).toBe(
    "第 32 章正文已按章纲重写完成。",
  )
})
