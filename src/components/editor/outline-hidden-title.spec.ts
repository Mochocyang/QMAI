import { describe, expect, it } from "vitest"
import { Schema } from "@milkdown/kit/prose/model"
import { EditorState, TextSelection } from "@milkdown/kit/prose/state"
import { guardOutlineHiddenTitle, isBackspaceIntoHiddenTitle } from "./outline-hidden-title"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    heading: { group: "block", content: "text*", attrs: { level: { default: 1 } } },
    text: {},
  },
})

const h1 = (text: string) => schema.nodes.heading.create({ level: 1 }, text ? schema.text(text) : undefined)
const p = (text: string) => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)

function stateAt(nodes: ReturnType<typeof h1>[], pos: number) {
  const doc = schema.nodes.doc.create(null, nodes)
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) })
}

describe("大纲隐藏标题守卫", () => {
  it("新建大纲只有隐藏的 h1 时，粘贴/输入会落进补上的正文段落，而不是标题", () => {
    const state = stateAt([h1("第一章")], 1)
    const tr = guardOutlineHiddenTitle(state)
    expect(tr).not.toBeNull()
    const next = state.apply(tr!).apply(state.apply(tr!).tr.insertText("粘贴的正文"))
    expect(next.doc.child(0).textContent).toBe("第一章")
    expect(next.doc.child(1).type.name).toBe("paragraph")
    expect(next.doc.child(1).textContent).toBe("粘贴的正文")
  })

  it("已有正文时，光标从标题挪到正文开头，不再补段落", () => {
    const state = stateAt([h1("标题"), p("正文")], 2)
    const next = state.apply(guardOutlineHiddenTitle(state)!)
    expect(next.doc.childCount).toBe(2)
    expect(next.selection.from).toBe(h1("标题").nodeSize + 1)
  })

  it("光标已在正文里、或首行不是 h1 时不干预", () => {
    const withBody = stateAt([h1("标题"), p("正文")], h1("标题").nodeSize + 2)
    expect(guardOutlineHiddenTitle(withBody)).toBeNull()
    expect(guardOutlineHiddenTitle(stateAt([p("正文")], 1))).toBeNull()
  })

  it("正文开头退格不会并入隐藏标题", () => {
    const start = h1("标题").nodeSize + 1
    expect(isBackspaceIntoHiddenTitle(stateAt([h1("标题"), p("正文")], start))).toBe(true)
    expect(isBackspaceIntoHiddenTitle(stateAt([h1("标题"), p("正文")], start + 1))).toBe(false)
  })
})
