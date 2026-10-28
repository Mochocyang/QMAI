/**
 * AI 手写网页的**安全清洗**与**美观体检**。
 *
 * 背景：从 2026-10-28 起，大纲 HTML 由模型直接写（模板已下线）。模型输出不能当成
 * 可信内容，必须过一道闸：
 *
 * 1. 安全：模型可能把 `<script>`、`on*=` 事件、外链资源一起写进来。
 *    预览 iframe 用的是 `sandbox="allow-same-origin"`（没有 allow-scripts），脚本跑不起来；
 *    但文件会落到磁盘、还可能被云同步到用户自己的仓库，用浏览器直接打开时脚本就会执行。
 *    所以在**保存前**就把可执行内容删掉，而不是只依赖预览沙箱。
 *
 * 2. 隐私：模型看得到项目路径、记忆库、用户粘贴的设定。它不该把这些原样搬进页面。
 *    这里做兜底：绝对路径与常见密钥前缀一律打码。
 *
 * 3. 美观：用户明确要求「必须好看，不能只是一张简单表格」。这里做一次低成本体检，
 *    不达标时给出中文提示让用户重生成（不自动重试，避免白烧 token）。
 */

/** 需要整段删除的标签（连同内容）：能执行代码或加载外部资源的元素。 */
const DROP_WITH_CONTENT = ["script", "iframe", "object", "embed", "noscript", "link", "meta"]

/** 只删标签、保留内部文字的容器。 */
const DROP_TAG_ONLY = ["base", "form", "input", "button", "textarea", "select", "option"]

const EVENT_ATTRIBUTE = /\son[a-z]+\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+)/gi
const JS_URL = /\s(href|src|xlink:href)\s*=\s*("|')?\s*javascript:[^"'\s>]*("|')?/gi
const DATA_HTML_URL = /\s(href|src)\s*=\s*("|')?\s*data:text\/html[^"'\s>]*("|')?/gi
/** 外部资源（http/https/protocol-relative）：离线打不开，也等于把阅读行为发给第三方。 */
const EXTERNAL_ATTR = /\s(src|srcset|poster|data-src)\s*=\s*("|')?\s*(https?:)?\/\/[^"'\s>]*("|')?/gi
const EXTERNAL_LINK = /\s(href)\s*=\s*("|')?\s*(https?:)?\/\/[^"'\s>]*("|')?/gi

/** 绝对路径：C:\…、C:/…、/Users/…、/home/…、file:///… */
const ABSOLUTE_PATH =
  /(?:[A-Za-z]:[\\/][^\s"'<>）)]{2,}|file:\/\/\/[^\s"'<>）)]{2,}|\/(?:Users|home)\/[^\s"'<>）)]{2,})/g

/** 常见密钥前缀：命中即打码（宁可错杀，也别把真 key 写进要同步的文件）。 */
const SECRET_PATTERN =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,}|tvly-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{12,}|xoxb-[A-Za-z0-9-]{10,})\b/g

export interface HtmlSafetyReport {
  /** 被删掉的标签名。 */
  removedTags: string[]
  /** 是否打码过路径。 */
  maskedPaths: number
  /** 是否打码过疑似密钥。 */
  maskedSecrets: number
}

export interface SanitizeResult {
  html: string
  report: HtmlSafetyReport
}

/** 清洗 AI 写的网页：去可执行内容、去外链、打码路径与密钥。 */
export function sanitizeAiHtml(input: string): SanitizeResult {
  let html = input
  const removedTags: string[] = []

  for (const tag of DROP_WITH_CONTENT) {
    const paired = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi")
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi")
    const before = html
    html = html.replace(paired, "").replace(selfClosing, "")
    if (before !== html) removedTags.push(tag)
  }

  for (const tag of DROP_TAG_ONLY) {
    const pattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi")
    const before = html
    html = html.replace(pattern, "")
    if (before !== html) removedTags.push(tag)
  }

  html = html.replace(EVENT_ATTRIBUTE, "")
  html = html.replace(JS_URL, "")
  html = html.replace(DATA_HTML_URL, "")
  html = html.replace(EXTERNAL_ATTR, "")
  html = html.replace(EXTERNAL_LINK, "")

  let maskedPaths = 0
  html = html.replace(ABSOLUTE_PATH, () => {
    maskedPaths += 1
    return "（本机路径已隐藏）"
  })

  let maskedSecrets = 0
  html = html.replace(SECRET_PATTERN, () => {
    maskedSecrets += 1
    return "***"
  })

  return { html, report: { removedTags: [...new Set(removedTags)], maskedPaths, maskedSecrets } }
}

export interface AestheticsReport {
  ok: boolean
  /** 给用户看的中文问题清单。 */
  problems: string[]
}

const SECTION_TAG = /<(section|article|div|li|tr|section)\b/gi

/**
 * 美观体检：只检查「结构上是否像一份正经网页」，不做主观评分。
 *
 * 判定标准（不达标即提示重生成）：
 * - 有 `<style>`（否则是裸标签，天生难看）；
 * - 有 `<h1>` 页头；
 * - 至少 3 个分区（section/article/div/li/tr 计数）；
 * - 不是「一张表格走天下」：表格单元格数量占比过高时判定过于简略；
 * - 没有内联 `style="..."` 滥用不算错（模型常用），但要求总样式里至少 3 条规则。
 */
export function auditAiHtml(html: string): AestheticsReport {
  const problems: string[] = []
  const lower = html.toLowerCase()

  if (!/<style[\s>]/.test(lower)) problems.push("没有内联样式表（<style>），页面会退化成浏览器默认样式")
  if (!/<h1[\s>]/.test(lower)) problems.push("没有 <h1> 页头，缺少标题层级")

  const styleRules = (html.match(/[^{}]+\{[^{}]*\}/g) ?? []).length
  if (styleRules < 3) problems.push("样式规则太少（少于 3 条），基本没有设计")

  const sections = (html.match(SECTION_TAG) ?? []).length
  if (sections < 3) problems.push("分区太少（少于 3 个），内容没有组织成卡片/章节")

  const tableCells = (html.match(/<t[dh][\s>]/gi) ?? []).length
  const paragraphs = (html.match(/<p[\s>]/gi) ?? []).length
  const listItems = (html.match(/<li[\s>]/gi) ?? []).length
  const textBlocks = paragraphs + listItems
  if (tableCells > 0 && textBlocks === 0) {
    problems.push("整页只有表格，没有段落或卡片：这正是用户反馈“像简单表格”的形态")
  } else if (tableCells > textBlocks * 6 && tableCells > 12) {
    problems.push("表格占比过高，建议改成分区卡片 + 少量对照表")
  }

  return { ok: problems.length === 0, problems }
}

/** 一次跑完清洗 + 体检（保存链路用）。 */
export function prepareAiHtml(input: string): {
  html: string
  safety: HtmlSafetyReport
  aesthetics: AestheticsReport
} {
  const { html, report } = sanitizeAiHtml(input)
  return { html, safety: report, aesthetics: auditAiHtml(html) }
}
