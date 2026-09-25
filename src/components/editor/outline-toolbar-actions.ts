import { commandsCtx, editorViewCtx, serializerCtx } from "@milkdown/kit/core"
import { toggleMark } from "@milkdown/kit/prose/commands"
import { AllSelection, TextSelection } from "@milkdown/kit/prose/state"
import { $command, $markSchema } from "@milkdown/utils"

const underlineSchema = $markSchema("outline_underline", () => ({
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u", { style: "text-decoration: underline" }, 0],
  parseMarkdown: { match: () => false, runner: () => undefined },
  toMarkdown: { match: () => false, runner: () => undefined },
}))
export const toggleOutlineUnderlineCommand = $command("ToggleOutlineUnderline", (ctx) => () => toggleMark(underlineSchema.type(ctx)))
export const outlineUnderlinePlugin = [underlineSchema, toggleOutlineUnderlineCommand].flat()
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark"
import { insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm"
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history"
import type { Ctx } from "@milkdown/ctx"
import type { Editor } from "@milkdown/kit/core"
import { applyOutlineSourceFormat, type OutlineSourceFormat, type OutlineSourcePayload } from "@/lib/outline-source-format"

export type OutlineToolbarAction =
  | "bold" | "italic" | "strike" | "clear"
  | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "quote" | "hr" | "bullet" | "ordered" | "task"
  | "code" | "codeBlock" | "table" | "link" | "image"
  | "undo" | "redo"
  | OutlineSourceFormat

function run(ctx: Ctx, command: { key: string }, payload?: unknown) {
  return ctx.get(commandsCtx).call(command.key, payload)
}

function insertSource(ctx: Ctx, action: OutlineSourceFormat, payload?: OutlineSourcePayload) {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  const selected = view.state.doc.textBetween(from, to, "\n")
  const result = applyOutlineSourceFormat(selected, 0, selected.length, action, payload)
  const tr = view.state.tr.insertText(result.text, from, to)
  view.dispatch(tr.scrollIntoView())
  return true
}

export function runOutlineToolbarAction(editor: Pick<Editor, "action">, action: OutlineToolbarAction, payload?: OutlineSourcePayload): boolean {
  return editor.action((ctx) => runOutlineToolbarActionInCtx(ctx, action, payload))
}

function runOutlineToolbarActionInCtx(ctx: Ctx, action: OutlineToolbarAction, payload?: OutlineSourcePayload): boolean {
  if (action === "bold") return run(ctx, toggleStrongCommand)
  if (action === "italic") return run(ctx, toggleEmphasisCommand)
  if (action === "strike") return run(ctx, toggleStrikethroughCommand)
  if (action === "underline") return run(ctx, toggleOutlineUnderlineCommand)
  if (action === "clear") return run(ctx, turnIntoTextCommand)
  if (/^h[1-6]$/.test(action)) return run(ctx, wrapInHeadingCommand, Number(action.slice(1)))
  if (action === "quote") return run(ctx, wrapInBlockquoteCommand)
  if (action === "hr") return run(ctx, insertHrCommand)
  if (action === "bullet") return run(ctx, wrapInBulletListCommand)
  if (action === "ordered") return run(ctx, wrapInOrderedListCommand)
  if (action === "task") return insertTask(ctx)
  if (action === "code") return run(ctx, toggleInlineCodeCommand)
  if (action === "codeBlock") return run(ctx, createCodeBlockCommand)
  if (action === "table") return run(ctx, insertTableCommand, { row: 3, col: 3 })
  if (action === "link") return run(ctx, toggleLinkCommand, { href: payload?.href || "https://example.com" })
  if (action === "image") return run(ctx, insertImageCommand, { src: payload?.href || "", alt: payload?.note || "图片" })
  if (action === "undo") return run(ctx, undoCommand)
  if (action === "redo") return run(ctx, redoCommand)
  return insertSource(ctx, action, payload)
}

export function readOutlinePlainText(editor: Pick<Editor, "action">): string {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return ctx.get(serializerCtx)(view.state.doc) || view.state.doc.textBetween(0, view.state.doc.content.size, "\n")
  })
}

export function selectAllOutline(editor: Pick<Editor, "action">) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
    view.focus()
  })
}

export function replaceOutlinePlainText(editor: Pick<Editor, "action">, source: string, replacement: string, all: boolean): boolean {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const text = view.state.doc.textBetween(0, view.state.doc.content.size, "\n")
    const pattern = new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), all ? "gi" : "i")
    const next = text.replace(pattern, replacement)
    if (next === text) return false
    const tr = view.state.tr.insertText(next, 0, view.state.doc.content.size)
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1)).scrollIntoView())
    return true
  })
}

function insertTask(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  view.dispatch(view.state.tr.insertText("- [ ] 待办", from, to).scrollIntoView())
  return true
}
