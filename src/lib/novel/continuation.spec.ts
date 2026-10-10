import { describe, expect, it } from "vitest"
import {
  CONTINUATION_EMPTY_INSTRUCTION,
  CONTINUATION_POPOVER_MAX_HEIGHT,
  CONTINUATION_POPOVER_WIDTH,
  CONTINUATION_SOURCE_HEAD_CHARS,
  CONTINUATION_SOURCE_LIMIT_CHARS,
  CONTINUATION_SOURCE_TAIL_CHARS,
  CONTINUATION_TARGET_MAX_CHARS,
  CONTINUATION_TARGET_MIN_CHARS,
  CONTINUATION_TRUNCATION_MARK,
  buildContinuationMessages,
  buildContinuationSource,
  clampContinuationPopoverPosition,
  countContinuationChars,
  insertContinuationBody,
} from "./continuation"

describe("buildContinuationSource", () => {
  it("不超过上限时原样送模", () => {
    const body = "　　他推开门。"
    expect(buildContinuationSource(body)).toBe(body)
  })

  it("恰好等于上限时不截断", () => {
    const body = "乙".repeat(CONTINUATION_SOURCE_LIMIT_CHARS)
    expect(buildContinuationSource(body)).toBe(body)
  })

  it("超过上限只送开头 + 省略标记 + 结尾", () => {
    // 首中尾用不同字符：整段都是同一个字的话，endsWith 在「尾部被换成了开头」
    // 时也会通过 —— 那条断言就永远绿了。
    const head = "甲".repeat(CONTINUATION_SOURCE_HEAD_CHARS)
    const middle = "丙".repeat(1000)
    const tail = "乙".repeat(CONTINUATION_SOURCE_TAIL_CHARS)
    const source = buildContinuationSource(head + middle + tail)
    expect(source.startsWith(head)).toBe(true)
    expect(source.endsWith(tail)).toBe(true)
    expect(source).not.toContain("丙")
    expect(source).toContain("省略")
    expect(source.length).toBeLessThan((head + middle + tail).length)
  })

  it("输出硬上限是「开头 + 标记 + 结尾」，即使正文只比上限多几个字", () => {
    // 已知无害瑕疵：head + tail 正好等于上限，标记是额外加的，所以正文长度在
    // 8001–8017 之间时，截断后的输出会比原文长一点点（输出恒为 8017）。
    // 这里把硬上限钉住：以后谁把 head/tail 调大，这条会立刻红。
    const body = "甲".repeat(CONTINUATION_SOURCE_LIMIT_CHARS + 5)
    const source = buildContinuationSource(body)
    expect(source.length).toBe(
      CONTINUATION_SOURCE_HEAD_CHARS + CONTINUATION_TRUNCATION_MARK.length + CONTINUATION_SOURCE_TAIL_CHARS,
    )
    expect(source).toContain(CONTINUATION_TRUNCATION_MARK)
  })
})

describe("buildContinuationMessages", () => {
  it("两条消息，system 写清目标字数与「只输出续写的正文」", () => {
    const messages = buildContinuationMessages("　　他推开门。", "")
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].content).toContain(String(CONTINUATION_TARGET_MIN_CHARS))
    expect(messages[0].content).toContain(String(CONTINUATION_TARGET_MAX_CHARS))
    expect(messages[0].content).toContain("只输出续写的正文")
    expect(messages[1].role).toBe("user")
  })

  it("正文进 user 消息", () => {
    const messages = buildContinuationMessages("　　雨还在下。", "")
    expect(messages[1].content).toContain("　　雨还在下。")
  })

  it("指令为空时用「自行判断」，不留空白", () => {
    const messages = buildContinuationMessages("正文", "   ")
    expect(messages[1].content).toContain(CONTINUATION_EMPTY_INSTRUCTION)
  })

  it("指令非空时原样进 user 消息，且不出现「自行判断」", () => {
    const messages = buildContinuationMessages("正文", "让他发现门没锁")
    expect(messages[1].content).toContain("让他发现门没锁")
    expect(messages[1].content).not.toContain(CONTINUATION_EMPTY_INSTRUCTION)
  })

  it("正文为空时改成「从章首开始写」", () => {
    const messages = buildContinuationMessages("", "开场")
    expect(messages[1].content).toContain("本章正文为空")
  })
})

describe("insertContinuationBody", () => {
  const anchorAt = (body: string, at: number) => ({ at, bodySnapshot: body })

  it("正文为空时直接落成第一段", () => {
    const result = insertContinuationBody("", anchorAt("", 0), "他推开门。")
    expect(result).toEqual({ ok: true, body: "　　他推开门。", caret: "　　他推开门。".length })
  })

  it("插到正文末尾时自成一段", () => {
    const body = "　　甲。"
    const result = insertContinuationBody(body, anchorAt(body, body.length), "乙。")
    expect(result).toEqual({ ok: true, body: "　　甲。\n　　乙。", caret: "　　甲。\n　　乙。".length })
  })

  it("插到正文开头时后面补一个换行", () => {
    const body = "　　甲。"
    const result = insertContinuationBody(body, anchorAt(body, 0), "乙。")
    expect(result).toEqual({ ok: true, body: "　　乙。\n　　甲。", caret: "　　乙。".length })
  })

  it("插到段落中间时前后各补一个换行，不挪动已有文字", () => {
    const body = "　　他推开门。"
    const result = insertContinuationBody(body, anchorAt(body, 6), "雨还在下。")
    expect(result).toEqual({
      ok: true,
      body: "　　他推开门\n　　雨还在下。\n。",
      caret: "　　他推开门\n　　雨还在下。".length,
    })
  })

  it("插入点前面已经是换行时不重复补", () => {
    const body = "　　甲。\n"
    const result = insertContinuationBody(body, anchorAt(body, body.length), "乙。")
    expect(result).toEqual({ ok: true, body: "　　甲。\n　　乙。", caret: "　　甲。\n　　乙。".length })
  })

  it("插入点后面已经是换行时不重复补", () => {
    const body = "\n　　甲。"
    const result = insertContinuationBody(body, anchorAt(body, 0), "乙。")
    expect(result).toEqual({ ok: true, body: "　　乙。\n　　甲。", caret: "　　乙。".length })
  })

  it("补上全角缩进与中英间距（对齐正文 house style）", () => {
    const result = insertContinuationBody("", anchorAt("", 0), "共3个人。")
    expect(result).toEqual({ ok: true, body: "　　共 3 个人。", caret: "　　共 3 个人。".length })
  })

  it("型号连字符不被 pangu 改坏", () => {
    const result = insertContinuationBody("", anchorAt("", 0), "苏-35飞过。")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.body).toContain("苏-35 飞过。")
  })

  it("只排版插入的片段，不重排整章", () => {
    // 这一整段是用户手写的、没有 　　 缩进 —— 插入之后它必须原样保留。
    const body = "他推开门。"
    const result = insertContinuationBody(body, anchorAt(body, body.length), "雨还在下。")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.body.startsWith("他推开门。")).toBe(true)
      expect(result.body).toBe("他推开门。\n　　雨还在下。")
    }
  })

  it("正文快照不一致时拒绝写入", () => {
    const result = insertContinuationBody("被别人改过了", anchorAt("原来的正文", 3), "乙。")
    expect(result).toEqual({ ok: false, reason: "changed" })
  })

  it("续写内容为空或纯空白时拒绝写入", () => {
    const body = "　　甲。"
    expect(insertContinuationBody(body, anchorAt(body, body.length), "")).toEqual({ ok: false, reason: "empty" })
    expect(insertContinuationBody(body, anchorAt(body, body.length), "  \n  ")).toEqual({ ok: false, reason: "empty" })
  })

  it("锚点越界时夹回正文范围内，不抛错", () => {
    const body = "　　甲。"
    const result = insertContinuationBody(body, anchorAt(body, 9999), "乙。")
    expect(result).toEqual({ ok: true, body: "　　甲。\n　　乙。", caret: "　　甲。\n　　乙。".length })
  })
})

describe("countContinuationChars", () => {
  it("按计数字符口径去掉所有空白（含全角空格）", () => {
    // 雨还在下。他走了。 = 9 个计数字符，两个 　　 与那个换行都不算
    expect(countContinuationChars("　　雨还在下。\n　　他走了。")).toBe(9)
  })

  it("空串算 0 字", () => {
    expect(countContinuationChars("")).toBe(0)
  })

  it("中英混排里空格不计数", () => {
    // 他打开iPhone的门。 = 12 个计数字符
    expect(countContinuationChars("他打开 iPhone 的门。")).toBe(12)
  })

  it("纯空白算 0 字", () => {
    expect(countContinuationChars("　　\n  ")).toBe(0)
  })
})

describe("clampContinuationPopoverPosition", () => {
  const viewport = { width: 1000, height: 800 }
  // 计划里这里写的是字面量 360/320；改用常量是为了让上面那两个 import 不被
  // noUnusedLocals 判成 TS6133，数值与计划完全一致。
  const size = { width: CONTINUATION_POPOVER_WIDTH, height: CONTINUATION_POPOVER_MAX_HEIGHT }

  it("视口中央时水平居中、放在锚点下方", () => {
    expect(clampContinuationPopoverPosition({ x: 500, y: 200 }, viewport, size))
      .toEqual({ left: 320, top: 212 })
  })

  it("靠右时被夹进视口内", () => {
    expect(clampContinuationPopoverPosition({ x: 990, y: 200 }, viewport, size).left).toBe(632)
  })

  it("靠左时不出现负坐标", () => {
    expect(clampContinuationPopoverPosition({ x: 0, y: 200 }, viewport, size).left).toBe(8)
  })

  it("锚点靠近底部时改放到上方", () => {
    const position = clampContinuationPopoverPosition({ x: 500, y: 700 }, viewport, size)
    expect(position.top).toBe(700 - 320 - 12)
    expect(position.top + size.height).toBeLessThan(700)
  })

  it("浮层比视口还高时贴顶，不出现负坐标", () => {
    const tiny = { width: 1000, height: 200 }
    expect(clampContinuationPopoverPosition({ x: 500, y: 100 }, tiny, size).top).toBe(8)
  })

  it("视口比浮层还窄时贴左边距，不出现负坐标", () => {
    const narrow = { width: 300, height: 800 }
    expect(clampContinuationPopoverPosition({ x: 150, y: 200 }, narrow, size).left).toBe(8)
  })
})
