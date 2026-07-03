import type { ClassificationConfig, RouteRule, DataSourceCategory } from "./types"
import { DATA_SOURCE_CATEGORY_LABELS, ALL_DATA_SOURCE_CATEGORIES } from "./types"
import { DEFAULT_CLASSIFICATION_CONFIG } from "./default-routes"

const VERSION_MARKER = "<!-- classification-version:"
const ROUTE_START_MARKER = "<!-- AUTO-GENERATED-ROUTE:START -->"
const ROUTE_END_MARKER = "<!-- AUTO-GENERATED-ROUTE:END -->"

export function serializeClassificationToMarkdown(config: ClassificationConfig): string {
  const lines: string[] = []

  lines.push("# 意图路由配置 (classification.md)")
  lines.push("")
  lines.push(`${VERSION_MARKER}${config.version || "1.0.0"} -->`)
  lines.push("")
  lines.push("本文件定义了不同写作意图对应的数据源装载规则。")
  lines.push("")
  lines.push("## 路由规则说明")
  lines.push("")
  lines.push("- **必载 (required)**：必须加载的数据源，不可被裁剪")
  lines.push("- **选载 (optional)**：可选加载的数据源，可根据上下文裁剪")
  lines.push("- **禁载 (forbidden)**：禁止加载的数据源，始终排除")
  lines.push("")
  lines.push(ROUTE_START_MARKER)
  lines.push("")

  for (const route of config.routes) {
    lines.push(`### ${intentToLabel(route.intent)} (\`${route.intent}\`)`)
    lines.push("")
    lines.push("#### 必载数据源")
    lines.push("")
    if (route.required.length === 0) {
      lines.push("- 无")
    } else {
      for (const cat of route.required) {
        lines.push(`- ${DATA_SOURCE_CATEGORY_LABELS[cat] || cat} (\`${cat}\`)`)
      }
    }
    lines.push("")
    lines.push("#### 选载数据源")
    lines.push("")
    if (route.optional.length === 0) {
      lines.push("- 无")
    } else {
      for (const cat of route.optional) {
        lines.push(`- ${DATA_SOURCE_CATEGORY_LABELS[cat] || cat} (\`${cat}\`)`)
      }
    }
    lines.push("")
    lines.push("#### 禁载数据源")
    lines.push("")
    if (route.forbidden.length === 0) {
      lines.push("- 无")
    } else {
      for (const cat of route.forbidden) {
        lines.push(`- ${DATA_SOURCE_CATEGORY_LABELS[cat] || cat} (\`${cat}\`)`)
      }
    }
    lines.push("")
  }

  lines.push(ROUTE_END_MARKER)
  lines.push("")
  lines.push("## 数据源分类说明")
  lines.push("")
  for (const cat of ALL_DATA_SOURCE_CATEGORIES) {
    lines.push(`- \`${cat}\`：${DATA_SOURCE_CATEGORY_LABELS[cat] || cat}`)
  }
  lines.push("")

  return lines.join("\n")
}

export function deserializeClassificationFromMarkdown(markdown: string): ClassificationConfig | null {
  const version = extractVersion(markdown)
  const routeContent = extractRouteSection(markdown)
  if (!routeContent) return null

  const routes = parseRouteBlocks(routeContent)
  if (routes.length === 0) return null

  return {
    routes,
    version,
  }
}

export function generateDefaultClassificationMarkdown(): string {
  return serializeClassificationToMarkdown(DEFAULT_CLASSIFICATION_CONFIG)
}

function extractVersion(markdown: string): string {
  const match = markdown.match(/<!-- classification-version:([^\s]+)\s*-->/)
  return match ? match[1] : "1.0.0"
}

function extractRouteSection(markdown: string): string | null {
  const startIdx = markdown.indexOf(ROUTE_START_MARKER)
  if (startIdx === -1) return null
  const endIdx = markdown.indexOf(ROUTE_END_MARKER, startIdx + ROUTE_START_MARKER.length)
  if (endIdx === -1) return null
  return markdown.slice(startIdx + ROUTE_START_MARKER.length, endIdx).trim()
}

function parseRouteBlocks(content: string): RouteRule[] {
  const blocks = splitIntoRouteBlocks(content)
  const routes: RouteRule[] = []

  for (const block of blocks) {
    const route = parseSingleRoute(block)
    if (route) routes.push(route)
  }

  return routes
}

function splitIntoRouteBlocks(content: string): string[] {
  const lines = content.split("\n")
  const blocks: string[] = []
  let currentBlock: string[] = []
  let inBlock = false

  for (const line of lines) {
    if (/^### /.test(line)) {
      if (inBlock && currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n"))
      }
      currentBlock = [line]
      inBlock = true
    } else if (inBlock) {
      currentBlock.push(line)
    }
  }

  if (inBlock && currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n"))
  }

  return blocks
}

function parseSingleRoute(block: string): RouteRule | null {
  const intentMatch = block.match(/^### .+\(`([^`]+)`\)/m)
  if (!intentMatch) return null

  const intent = intentMatch[1] as RouteRule["intent"]

  const required = parseCategorySection(block, "必载数据源")
  const optional = parseCategorySection(block, "选载数据源")
  const forbidden = parseCategorySection(block, "禁载数据源")

  return {
    intent,
    required,
    optional,
    forbidden,
  }
}

function parseCategorySection(block: string, sectionTitle: string): DataSourceCategory[] {
  const sectionPattern = new RegExp(`#### ${escapeRegExp(sectionTitle)}\\s*\\n((?:[^#].*\\n?)*)`, "m")
  const match = block.match(sectionPattern)
  if (!match) return []

  const content = match[1].trim()
  if (content === "无" || content === "- 无") return []

  const categories: DataSourceCategory[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    const catMatch = line.match(/^-\s+[^(]+\(`([^`]+)`\)/)
    if (catMatch && ALL_DATA_SOURCE_CATEGORIES.includes(catMatch[1] as DataSourceCategory)) {
      categories.push(catMatch[1] as DataSourceCategory)
    }
  }

  return categories
}

function intentToLabel(intent: string): string {
  const labels: Record<string, string> = {
    write_chapter: "章节生成",
    continue_chapter: "章节续写",
    rewrite_chapter: "章节改写",
    polish_chapter: "章节润色",
    review_chapter: "AI 审稿",
    lint_chapter: "连贯性检查",
    generate_outline: "大纲生成",
    search_plot: "剧情搜索",
    extract_memory: "章节摄取",
    character_query: "人物查询",
    foreshadowing_query: "伏笔查询",
    timeline_query: "时间线查询",
    setting_query: "设定查询",
    general_chat: "一般对话",
  }
  return labels[intent] || intent
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
