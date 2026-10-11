// 找出某个 dist chunk 里所有出现指定文案的位置及上下文。
// 用途：verify-in-exe.mjs 报出「已入库」仍在 chat-panel-*.js 里时，
// 需要判断那是不是本次改动漏掉的残留（还是另一个功能本来就有的同名词）。
import { readFileSync } from "node:fs"

const [file, needle] = process.argv.slice(2)
const t = readFileSync(file, "utf8")
let i = 0, n = 0
while ((i = t.indexOf(needle, i)) !== -1 && n < 10) {
  console.log(`[${n + 1}] …${t.slice(Math.max(0, i - 90), i + 50).replace(/\s+/g, " ")}…`)
  i += needle.length
  n++
}
console.log(n ? `\n共找到 ${n} 处（上限 10）` : "\n没找到")
