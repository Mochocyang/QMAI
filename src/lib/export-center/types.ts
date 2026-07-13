export type ExportSource =
  | "chapters"
  | "outlines"
  | "book-analysis"
  | "story-simulation"
  | "soul-works"

export type ExportFormat = "txt" | "docx"

export interface ExportDocumentBlock {
  title: string
  paragraphs: string[]
}

export interface ExportDocument {
  title: string
  source: ExportSource
  blocks: ExportDocumentBlock[]
}
