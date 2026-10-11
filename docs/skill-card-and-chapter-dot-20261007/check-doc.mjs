/**
 * 设计文档完整性检查：HTML 标签是否平衡、有没有 U+FFFD（编码坏掉的信号）。
 *
 * 为什么单独写个文件而不是 `node -e`：本项目的 shell 里 `node -e` 的输出经常被吞掉，
 * 得到一片空白却分不清"没问题"和"没执行"。
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] ?? join(here, "design.html")
const text = readFileSync(target, "utf8")

const tags = ["div", "table", "tr", "td", "th", "p", "section", "main", "body", "html", "h2", "h3", "footer", "b", "code"]
let unbalanced = []
for (const tag of tags) {
  const open = (text.match(new RegExp(`<${tag}\\b`, "g")) ?? []).length
  const close = (text.match(new RegExp(`</${tag}>`, "g")) ?? []).length
  // 自闭合/无闭合的标签不参与（这里列的都是必须有闭合的）。
  if (open !== close) unbalanced.push(`${tag}: 开 ${open} / 闭 ${close}`)
}

const replacement = (text.match(/\uFFFD/g) ?? []).length
// 中文乱码的另一个典型特征：UTF-8 被当 latin1 读出来的典型序列。
const mojibake = (text.match(/[ÃÂåäçèé][\x80-\xBF]/g) ?? []).length

console.log(`文件: ${target}`)
console.log(`字节: ${Buffer.byteLength(text)}  行数: ${text.split("\n").length}`)
console.log(`标签平衡: ${unbalanced.length === 0 ? "OK" : "不平衡 → " + unbalanced.join("; ")}`)
console.log(`U+FFFD: ${replacement}`)
console.log(`疑似乱码序列: ${mojibake}`)
console.log(`结论: ${unbalanced.length === 0 && replacement === 0 ? "通过" : "需要修"}`)
process.exitCode = unbalanced.length === 0 && replacement === 0 ? 0 : 1
