/**
 * 输出解析测试（设计 D3）。
 *
 * 这一组测试的立场：**模型不听话是常态**。加编号、加引号、加解释、返回空、
 * 返回半截 JSON —— 每一种都必须落到一个能展示的结果上，永远不抛错。
 * 所以每条"降级"路径都要有断言，否则某天有人为了"更严格"加个 throw，
 * 用户就会在点了生成之后看到红屏。
 */
import { describe, expect, it } from "vitest"
import { parseOutput } from "./output"
import type { ActionOutput } from "./types"

function listOutput(maxItems?: number): ActionOutput {
  return { mode: "list", presentation: "chips", maxItems, targets: [] }
}

function jsonOutput(maxItems?: number, schema?: unknown): ActionOutput {
  return { mode: "json", schema, maxItems, targets: [] }
}

const textOutput: ActionOutput = { mode: "text", targets: [] }

describe("parseOutput · list", () => {
  it("去掉编号、成对引号与空行", () => {
    const raw = "1. 《书名一》\n2. \"书名二\"\n\n3、书名三"
    const result = parseOutput(raw, listOutput())

    expect(result.kind).toBe("list")
    if (result.kind === "list") {
      expect(result.items).toHaveLength(3)
      expect(result.items).toEqual(["《书名一》", "书名二", "书名三"])
      // 不能把编号或引号带进"设为书名"的目标值
      for (const item of result.items) {
        expect(item).not.toMatch(/^\d+[.、)]/)
        expect(item).not.toMatch(/^["'“”「」]/)
      }
    }
  })

  it("项目符号、换行符 CRLF、全角引号都能处理", () => {
    const raw = "- 书名一\r\n• 书名二\r\n* 「书名三」\r\n"
    const result = parseOutput(raw, listOutput())

    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["书名一", "书名二", "书名三"])
  })

  it("maxItems 截断", () => {
    const result = parseOutput("1. A\n2. B\n3. C", listOutput(2))
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["A", "B"])
  })

  it("maxItems 写成 0 / 负数当没有上限", () => {
    const result = parseOutput("A\nB\nC", listOutput(0))
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toHaveLength(3)
  })

  it("一条都没解析出来时降级，并保留原文", () => {
    const raw = " \n\n \t "
    const result = parseOutput(raw, listOutput())
    expect(result.kind).toBe("degraded")
    if (result.kind === "degraded") {
      expect(result.reason).toBe("模型没有返回内容")
      expect(result.text).toBe(raw)
    }
  })

  it("只有编号没有内容时降级为「没有解析出任何条目」", () => {
    const raw = "1.\n2.\n-"
    const result = parseOutput(raw, listOutput())
    expect(result.kind).toBe("degraded")
    if (result.kind === "degraded") expect(result.reason).toBe("没有解析出任何条目")
  })
})

describe("parseOutput · text", () => {
  it("原样返回", () => {
    const raw = "  一段任意文字，含换行\n第二行  "
    const result = parseOutput(raw, textOutput)
    expect(result).toEqual({ kind: "text", text: raw })
  })

  it("空输出降级", () => {
    const result = parseOutput("", textOutput)
    expect(result.kind).toBe("degraded")
    if (result.kind === "degraded") expect(result.reason).toBe("模型没有返回内容")
  })
})

describe("parseOutput · json", () => {
  it("整体就是 JSON 数组", () => {
    const result = parseOutput('["A","B"]', jsonOutput())
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["A", "B"])
  })

  it("从带说明文字的输出里抽取数组片段", () => {
    // 模型最典型的输出形态：先客套一句，再给结果，再客套一句
    const raw = '好的，结果如下：\n["A","B"]\n希望满意'
    const result = parseOutput(raw, jsonOutput())
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["A", "B"])
  })

  it("从带说明文字的输出里抽取对象片段", () => {
    const result = parseOutput('结果：{"text":"正文内容"} 以上', jsonOutput())
    expect(result).toEqual({ kind: "text", text: "正文内容" })
  })

  it("对象优先取 text / content / result 字段", () => {
    expect(parseOutput('{"content":"C"}', jsonOutput())).toEqual({ kind: "text", text: "C" })
    expect(parseOutput('{"result":"R"}', jsonOutput())).toEqual({ kind: "text", text: "R" })
  })

  it("对象没有约定字段时整体 stringify", () => {
    const result = parseOutput('{"a":1,"b":[2]}', jsonOutput())
    expect(result.kind).toBe("text")
    if (result.kind === "text") {
      expect(result.text).toContain('"a": 1')
      expect(result.text).toContain('"b": [')
    }
  })

  it("数组里的非字符串元素被 stringify，而不是丢掉", () => {
    const result = parseOutput('[{"title":"A"},2,"B"]', jsonOutput())
    expect(result.kind).toBe("list")
    if (result.kind === "list") {
      expect(result.items[0]).toBe('{"title":"A"}')
      expect(result.items[1]).toBe("2")
      expect(result.items[2]).toBe("B")
    }
  })

  it("maxItems 对 JSON 数组同样生效", () => {
    const result = parseOutput('["A","B","C"]', jsonOutput(2))
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["A", "B"])
  })

  it("空数组是「解析成功但 0 条」，不是失败", () => {
    // 与 list 模式的分水岭：这里模型明确返回了 `[]`，是"没有结果"而不是"跑偏"。
    // UI 该显示空状态（可以重试），而不是把原文 `[]` 摊给用户。
    const result = parseOutput("[]", jsonOutput())
    expect(result).toEqual({ kind: "list", items: [], degraded: false })
  })

  it("解析成功但元素全被清理掉时也是空列表，不降级", () => {
    const result = parseOutput('["   "]', jsonOutput())
    expect(result).toEqual({ kind: "list", items: [], degraded: false })
  })

  it("schema.type 为 array 且返回数组 → 正常解析", () => {
    const result = parseOutput('["A","B"]', jsonOutput(undefined, { type: "array" }))
    expect(result.kind).toBe("list")
    if (result.kind === "list") expect(result.items).toEqual(["A", "B"])
  })

  it("schema.type 为 array 但模型返回对象 → 降级并说明期望与实际", () => {
    const raw = '{"title":"A"}'
    const result = parseOutput(raw, jsonOutput(undefined, { type: "array" }))
    expect(result.kind).toBe("degraded")
    if (result.kind === "degraded") {
      expect(result.reason).toContain("数组")
      expect(result.reason).toContain("对象")
      expect(result.text).toBe(raw)
    }
  })

  it("schema.type 为 string 但返回数组 → 降级；为 object 且返回对象 → 正常", () => {
    const mismatch = parseOutput('["A"]', jsonOutput(undefined, { type: "string" }))
    expect(mismatch.kind).toBe("degraded")

    const matched = parseOutput('{"text":"正文"}', jsonOutput(undefined, { type: "object" }))
    expect(matched).toEqual({ kind: "text", text: "正文" })
  })

  it("schema 缺失或 type 不认得时不校验顶层结构", () => {
    expect(parseOutput('{"a":1}', jsonOutput()).kind).toBe("text")
    expect(parseOutput('{"a":1}', jsonOutput(undefined, { type: "number" })).kind).toBe("text")
    expect(parseOutput('["A"]', jsonOutput(undefined, "array")).kind).toBe("list")
  })

  it("完全不是 JSON 时降级为原文", () => {
    const raw = "这不是 JSON，只是模型在说废话"
    const result = parseOutput(raw, jsonOutput())
    expect(result.kind).toBe("degraded")
    if (result.kind === "degraded") {
      expect(result.reason).toBe("JSON 解析失败")
      expect(result.text).toBe(raw)
    }
  })

  it("括号配不平也不抛错", () => {
    const result = parseOutput('["A","B"', jsonOutput())
    expect(result.kind).toBe("degraded")
  })

  it("裸字符串 JSON 直接当文本", () => {
    expect(parseOutput('"只有一句"', jsonOutput())).toEqual({ kind: "text", text: "只有一句" })
  })

  it("null 输出降级", () => {
    const result = parseOutput("null", jsonOutput())
    expect(result.kind).toBe("degraded")
  })
})
