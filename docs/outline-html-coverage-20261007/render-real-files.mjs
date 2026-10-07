/**
 * 用**真实项目里的文件**验证兜底渲染：这些文件正是「有 .md 但没有 .html」的那批。
 * 输出到 %TEMP%，人工打开确认渲染结果可用（不是空白、不是错误标签）。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { attachOutlineHtml } from "../../src/lib/novel/outline-save-request.ts"

const CASES = [
  { path: "D:/QM-BOOK/他，只想活着/QM/outlines/卷纲/《他，只想活着》全书大纲.md", fileType: "volume-outline", folder: "卷纲" },
  { path: "D:/QM-BOOK/他，只想活着/QM/outlines/章纲/第3章-荒地穿行.md", fileType: "chapter-outline", folder: "章纲" },
  { path: "D:/QM-BOOK/黑雨之下/QM/outlines/力量体系.md", fileType: "outline", folder: "大纲" },
  { path: "D:/QM-BOOK/楚白/QM/outlines/卷纲/第一卷卷纲｜觉醒复族（1-60章）.md", fileType: "volume-outline", folder: "卷纲" },
]

for (const [index, item] of CASES.entries()) {
  let content = ""
  try { content = readFileSync(item.path, "utf8") } catch { console.log(`  跳过（读不到）：${item.path}`); continue }
  const attached = attachOutlineHtml(
    { fileType: item.fileType, fileName: item.path.split("/").pop(), targetFolder: item.folder, content },
    content,
  )
  const html = attached.htmlContent ?? ""
  const eyebrow = html.match(/class="eyebrow"[^>]*>([^<]*)</)?.[1] ?? "(无)"
  const cards = (html.match(/<details class="cc"/g) ?? []).length
  const ok = html.includes("<html") && !html.includes("cards 为空")
  console.log(`\n[${index + 1}] ${item.path.split("/").pop()}`)
  console.log(`    fileType=${item.fileType}  产出HTML=${Boolean(html.trim())}  自包含=${html.includes("<html")}  头部="${eyebrow}"  卡片数=${cards}`)
  console.log(`    判定=${ok ? "可用" : "!! 需复查"}`)
  if (html) writeFileSync(`${process.env.TEMP}/real-${index + 1}-${item.fileType}.html`, html, "utf8")
}
console.log(`\n样例已写到 ${process.env.TEMP}/real-*.html`)
