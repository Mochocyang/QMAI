import { normalizePath } from "./path-utils"
import type { GraphNode } from "./wiki-graph"

export interface EditableGraphNodePage {
  path: string
  pageId: string
  title: string
  content: string
}

const TYPE_TAGS: Record<string, string> = {
  character: "character",
  location: "location",
  organization: "organization",
  item: "item",
  event: "event",
  chapter: "chapter",
  outline: "outline",
  foreshadowing: "foreshadowing",
  secret: "secret",
  conflict: "conflict",
  "timeline-point": "timeline",
  "canon-rule": "canon",
}

function fileNameFromLabel(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-").trim() || "未命名节点"
}

function pageIdFromPath(path: string, fallback: string): string {
  const name = path.split(/[/\\]/).pop()?.replace(/\.md$/i, "")
  return name?.trim() || fallback
}

export function buildEditableGraphNodePage(projectPath: string, node: GraphNode): EditableGraphNodePage {
  const pp = normalizePath(projectPath)
  const title = node.label
  const path = node.path || `${pp}/wiki/entities/${fileNameFromLabel(node.label)}.md`
  const pageId = pageIdFromPath(path, fileNameFromLabel(node.label))
  const tag = (TYPE_TAGS[node.type] ?? node.type) || "entity"
  const today = new Date().toISOString().slice(0, 10)
  const content = [
    "---",
    `title: ${title}`,
    `tags: [${tag}]`,
    `updated: ${today}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## 基础信息",
    "",
    `- 类型：${tag}`,
    `- 关联数量：${node.linkCount}`,
    "",
    "## 事件记录",
    "",
    "- ",
    "",
    "## 人物关系",
    "",
    "- ",
    "",
    "## 补充设定",
    "",
    "- ",
    "",
  ].join("\n")

  return { path, pageId, title, content }
}
