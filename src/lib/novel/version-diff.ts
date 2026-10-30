import { diffLines } from "diff"

/** 行级差异中一行的类型。 */
export type DiffLineKind = "same" | "added" | "removed"

export interface DiffLine {
  kind: DiffLineKind
  text: string
  /** 旧版本里的行号（1 起；新增行没有）。 */
  oldLine?: number
  /** 新版本里的行号（1 起；删除行没有）。 */
  newLine?: number
}

/**
 * 计算「历史版本」与「当前内容」的行级差异。
 *
 * 为什么只做行级：中文小说正文没有空格分词，逐字符 diff 会把一处标点改动
 * 放大成前后几十个字的删除/新增，界面上一片红绿，读者完全看不出改了什么。
 * 章节正文本身按段落分行，行级 diff 的粒度恰好等于「哪一段被改了」，
 * 可读性远高于字符级；代价是行内的小改动会整行标记，这正是想要的效果。
 */
export function buildLineDiff(oldText: string, newText: string): DiffLine[] {
  const lines: DiffLine[] = []
  // 行号分开记：界面是左右两栏对齐展示，新增行只在右栏、删除行只在左栏，
  // 若共用一个计数器，任何增删都会让下文的行号全错位。
  let oldLine = 1
  let newLine = 1

  for (const part of diffLines(oldText, newText)) {
    // diffLines 的 value 带换行符；以换行结尾时会多切出一个末尾空串，
    // 它不是真实的一行（只是"最后一行有换行"的副产物），必须丢掉。
    const texts = part.value.split("\n")
    if (texts.length > 0 && texts[texts.length - 1] === "") {
      texts.pop()
    }

    for (const text of texts) {
      if (part.added) {
        lines.push({ kind: "added", text, newLine })
        newLine += 1
      } else if (part.removed) {
        lines.push({ kind: "removed", text, oldLine })
        oldLine += 1
      } else {
        lines.push({ kind: "same", text, oldLine, newLine })
        oldLine += 1
        newLine += 1
      }
    }
  }

  return lines
}

/** 统计新增/删除的行数，用于弹窗上的「+x −y」摘要。 */
export function summarizeDiff(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === "added") added += 1
    else if (line.kind === "removed") removed += 1
  }
  return { added, removed }
}
