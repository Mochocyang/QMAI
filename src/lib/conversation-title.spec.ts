import { describe, expect, it } from "vitest"
import { CONVERSATION_TITLE_MAX_CHARS, deriveConversationTitle } from "@/lib/conversation-title"

describe("deriveConversationTitle", () => {
  it("短消息原样用作标题，只去掉句末标点", () => {
    expect(deriveConversationTitle("令牌与金手指")).toBe("令牌与金手指")
    expect(deriveConversationTitle("主角的能力设定。")).toBe("主角的能力设定")
  })

  it("在窗口内最靠后的停顿标点处断开，而不是硬截", () => {
    // 逗号在第 11 字（窗口内、且靠后）→ 断在那里，不硬截。
    expect(deriveConversationTitle("我想写一个关于众神陨落，金手指是令牌的故事"))
      .toBe("我想写一个关于众神陨落")
    expect(deriveConversationTitle("帮我设计主角的成长线，要有点曲折，最后成为至强者"))
      .toBe("帮我设计主角的成长线")
  })

  it("窗口内没有标点时硬截并加省略号", () => {
    const text = "这是一段完全没有标点符号的长文本需要被硬截断掉才对"
    const title = deriveConversationTitle(text)
    expect(title).toBe(`${Array.from(text).slice(0, CONVERSATION_TITLE_MAX_CHARS).join("")}…`)
    expect(title.endsWith("…")).toBe(true)
  })

  it("很短就出现的标点不算断点，宁可硬截也不产出没有信息量的标题", () => {
    // 「好，」只有 1 个字，低于 MIN_TITLE_CHARS 的 4 字门槛；后面再没有标点，
    // 于是走硬截。这是刻意的取舍：1 个字的标题（「好」）比硬截更没有信息量。
    expect(deriveConversationTitle("好，那我们就开始写一个修仙故事吧"))
      .toBe("好，那我们就开始写一个修…")
  })

  it("多行消息断在第一行，不会把两行粘起来", () => {
    // 换行保留为断点；行首列表符号被去掉。
    expect(deriveConversationTitle("   \n- 第一行内容\n- 第二行内容  ")).toBe("第一行内容")
    expect(deriveConversationTitle("### 标题式开头")).toBe("标题式开头")
  })

  it("按字符数而不是 UTF-16 码元计数，emoji 不被切断", () => {
    const title = deriveConversationTitle("🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉")
    expect(Array.from(title.replace("…", "")).length).toBe(CONVERSATION_TITLE_MAX_CHARS)
    // 不允许出现落单的代理项（那会渲染成 ）
    expect(title.includes("\uFFFD")).toBe(false)
  })

  it("空内容返回空字符串，让调用方保留原标题", () => {
    expect(deriveConversationTitle("")).toBe("")
    expect(deriveConversationTitle("   \n\t  ")).toBe("")
    expect(deriveConversationTitle("- ")).toBe("")
  })

  it("长英文同样受长度上限约束", () => {
    const title = deriveConversationTitle("Please help me design the protagonist arc for this novel")
    expect(Array.from(title).length).toBeLessThanOrEqual(CONVERSATION_TITLE_MAX_CHARS + 1)
  })
})
