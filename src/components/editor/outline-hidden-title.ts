import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@milkdown/kit/prose/state"
import type { EditorView } from "@milkdown/kit/prose/view"
import { $prose } from "@milkdown/utils"

/*
 * 大纲文件的第一行 `# 标题` 在测试版编辑器里被 CSS 隐藏了
 * （ui-test-editor.css：`[data-kind="outline"] … > h1:first-child { display: none; }`），
 * 标题改由编辑器头部的标题栏显示与编辑。
 *
 * 但这个 h1 仍在 ProseMirror 文档里。新建大纲时文件只有 `# 标题` 一行，
 * 文档里**只有**这个隐藏的 h1：点正文区、粘贴、打字，光标都只能落进 h1，
 * 内容于是被写进了标题（用户看到的就是「粘贴的正文跑进了标题栏」，
 * 逐字输入时光标还会在隐藏节点里乱跳，出现倒序）。
 *
 * 这里的守卫保证：光标落进隐藏标题时，挪到标题之后的正文段落；
 * 正文为空就先补一个空段落。
 */
export function guardOutlineHiddenTitle(state: EditorState): Transaction | null {
  const first = state.doc.firstChild
  if (!first || first.type.name !== "heading" || first.attrs.level !== 1) return null
  const { selection } = state
  if (!(selection instanceof TextSelection)) return null
  const titleEnd = first.nodeSize
  if (selection.to >= titleEnd) return null
  let tr = state.tr
  if (state.doc.childCount === 1) {
    const paragraph = state.schema.nodes.paragraph
    if (!paragraph) return null
    tr = tr.insert(titleEnd, paragraph.create())
  }
  return tr.setSelection(TextSelection.near(tr.doc.resolve(titleEnd + 1)))
}

/** 正文第一段开头按退格，不能把正文并进隐藏的标题。 */
export function isBackspaceIntoHiddenTitle(state: EditorState): boolean {
  const first = state.doc.firstChild
  if (!first || first.type.name !== "heading" || first.attrs.level !== 1) return false
  const { selection } = state
  return selection.empty && selection.from === first.nodeSize + 1
}

function applyGuard(view: EditorView) {
  const tr = guardOutlineHiddenTitle(view.state)
  if (tr) view.dispatch(tr)
}

export const outlineHiddenTitleGuardPlugin = $prose(() => new Plugin({
  key: new PluginKey("outline-hidden-title-guard"),
  appendTransaction: (_transactions, _oldState, newState) => guardOutlineHiddenTitle(newState),
  props: {
    handleKeyDown: (view, event) => {
      if (event.key === "Backspace" && !event.isComposing && isBackspaceIntoHiddenTitle(view.state)) return true
      return false
    },
    handlePaste: (view) => { applyGuard(view); return false },
    handleTextInput: (view) => { applyGuard(view); return false },
    handleDOMEvents: {
      focus: (view) => { applyGuard(view); return false },
    },
  },
}))
