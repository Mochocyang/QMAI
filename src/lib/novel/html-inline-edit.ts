/**
 * 大纲 HTML 文档的「就地编辑」：把渲染好的 HTML 变成可改的副本，再把改完的结果还原成干净的 HTML。
 *
 * 为什么用 contenteditable 属性而不是往 iframe 里塞脚本：
 * 预览 iframe 只带 `allow-same-origin`、**不带 allow-scripts**，文档里的 `<script>`
 * 一律不执行 —— 这是既有约定（生成的 HTML 只允许模板自带的样式）。所以"可编辑"必须在
 * **父窗口**这边一次性写进 srcdoc：给需要改的元素加上 `contenteditable`，再补一段只做
 * 视觉提示的样式。保存时从 iframe 的 document 把内容读回来，把这两个痕迹（属性 + 样式块）抹掉。
 *
 * 只标「叶子」元素：`<li><p>x</p></li>` 只标 li。嵌套 contenteditable 在浏览器里
 * 内层会吃掉焦点、外层退化成容器，光标行为变得不可预期，所以一律跳过已有可编辑祖先的节点。
 */

/** 编辑态样式块的 id：保存时必须整块剥掉，不能写进文件。 */
export const INLINE_EDIT_STYLE_ID = "qmai-inline-edit-style"

/** 可编辑标记属性：既是样式钩子，也用来在保存时精确回收。 */
export const INLINE_EDITABLE_ATTR = "data-qm-editable"

/** 直接成块的文本元素：命中就标，不必再看子节点。 */
const BLOCK_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "li", "td", "th", "dt", "dd", "caption", "figcaption",
])

/**
 * **整棵子树都不许可编辑**的标签（用 closest 判，所以内部的 span 也一起跳过）。
 *
 * - `a`：大纲里有页内锚点导航，必须保留可点；
 * - `summary`：章纲的折叠树是 `<details><summary>…` —— 一旦把 summary 里的文字
 *   变成可编辑，点标题就不再折叠，而是进编辑态，折叠功能直接废掉（真机必踩）；
 * - `button/select/input/textarea/label`：控件本身有交互语义；
 * - `svg/style/script/template`：改了会破坏文档或本来就不可见；
 * - `pre/code`：代码块里的换行与缩进被 contenteditable 一改就散。
 * 媒体类（img/video/canvas/iframe/br/hr）没有文字子节点，靠"叶子且有文字"这一条
 * 自然被排除，不必列在这里。
 */
const SKIP_SUBTREE_SELECTOR = "a,button,select,input,textarea,label,summary,svg,style,script,template,pre,code"

/*
 * 编辑态提示样式。
 *
 * 用文档里已有的设计令牌（`--brand` / `--border` / `--brand-soft`，模板自带一份、
 * 预览外观按当前皮肤又覆写一遍），不要用 `color-mix()`：后者要 Chromium 111+，
 * 老一点的 WebView2 会整条声明失效 —— 用户看到的就是"能改但完全没有提示"，
 * 而这正是本次要解决的问题。每个 var 都留了中性灰兜底。
 */
const EDIT_AFFORDANCE_CSS = `
[${INLINE_EDITABLE_ATTR}]{border-radius:4px;cursor:text;transition:box-shadow .12s ease,background-color .12s ease}
[${INLINE_EDITABLE_ATTR}]:hover{box-shadow:inset 0 0 0 1px var(--brand,#45624f);background:var(--brand-soft,rgba(128,128,128,.07))}
[${INLINE_EDITABLE_ATTR}]:focus{outline:none;box-shadow:inset 0 0 0 2px var(--brand,#45624f);background:var(--brand-soft,rgba(128,128,128,.1))}
td[${INLINE_EDITABLE_ATTR}]:focus,th[${INLINE_EDITABLE_ATTR}]:focus{background:var(--brand-soft2,rgba(128,128,128,.12))}
`

function parseHtmlDocument(html: string): Document | null {
  if (typeof DOMParser === "undefined") return null
  const doc = new DOMParser().parseFromString(html, "text/html")
  return doc?.documentElement ? doc : null
}

function hasDoctype(html: string): boolean {
  return /<!doctype/i.test(html)
}

function serialize(doc: Document, withDoctype: boolean): string {
  const markup = doc.documentElement.outerHTML
  return withDoctype ? `<!DOCTYPE html>\n${markup}` : markup
}

/** 只有文本（或注释）子节点、且真的有文字 —— 这类 span/div/strong 也算可改。 */
function isTextLeaf(element: Element): boolean {
  const nodes = Array.from(element.childNodes)
  if (!nodes.length) return false
  const onlyText = nodes.every((node) => node.nodeType === 3 || node.nodeType === 8)
  if (!onlyText) return false
  return (element.textContent ?? "").trim().length > 0
}

function markElement(element: Element): void {
  /*
   * `plaintext-only` 而不是 `true`：粘贴进来的富文本会被塞成
   * `<span style="font-family:宋体">` 这类内联样式，直接冲掉模板版式，
   * 而且在表格单元格里会插出一串 div。只收纯文本，结构由模板决定。
   * WebView 不支持该值时按 `true` 处理（降级为普通可编辑），不会变成不可编辑。
   */
  element.setAttribute("contenteditable", "plaintext-only")
  element.setAttribute(INLINE_EDITABLE_ATTR, "")
}

/**
 * 生成「可编辑副本」：返回新的 HTML 字符串，入参不变。
 * 已经有可编辑祖先的节点一律跳过（见文件头注释）。
 */
export function markEditableHtml(html: string): string {
  const doc = parseHtmlDocument(html)
  if (!doc?.body) return html

  for (const element of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    const tag = element.tagName.toLowerCase()
    if (element.closest(SKIP_SUBTREE_SELECTOR)) continue
    if (element.closest(`[${INLINE_EDITABLE_ATTR}]`)) continue
    if (!BLOCK_TAGS.has(tag) && !isTextLeaf(element)) continue
    markElement(element)
  }

  const head = doc.head ?? doc.documentElement
  doc.getElementById(INLINE_EDIT_STYLE_ID)?.remove()
  const style = doc.createElement("style")
  style.id = INLINE_EDIT_STYLE_ID
  style.textContent = EDIT_AFFORDANCE_CSS
  head.appendChild(style)

  return serialize(doc, hasDoctype(html))
}

/**
 * 从编辑完的 iframe 文档里取回 HTML。
 *
 * 要抹掉三样东西：可编辑属性、编辑态样式块、预览外观样式块
 * （外观按当前皮肤实时注入，绝不能固化进磁盘文件 —— 换皮肤后颜色会打架）。
 * 取不到文档时返回 null，由调用方提示"预览尚未就绪"。
 */
export function extractEditedHtml(
  doc: Document | null | undefined,
  appearanceStyleId = "qmai-document-appearance",
): string | null {
  if (!doc?.documentElement) return null
  const clone = doc.documentElement.cloneNode(true) as Element
  for (const element of Array.from(clone.querySelectorAll(`[${INLINE_EDITABLE_ATTR}]`))) {
    element.removeAttribute("contenteditable")
    element.removeAttribute(INLINE_EDITABLE_ATTR)
  }
  clone.querySelector(`#${INLINE_EDIT_STYLE_ID}`)?.remove()
  if (appearanceStyleId) clone.querySelector(`#${appearanceStyleId}`)?.remove()
  return `<!DOCTYPE html>\n${clone.outerHTML}`
}
