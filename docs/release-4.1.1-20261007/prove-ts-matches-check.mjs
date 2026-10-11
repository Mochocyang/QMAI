/**
 * 证明 check-changelog-ts-matches.mjs 不是恒真。
 *
 * 它守的是"手工誊写 TS 时抄错"这个风险。一个永远输出"逐字一致"的脚本
 * 同样会这么说 —— 所以必须真的往 changelog.ts 里注入错字，看它是否变红。
 *
 * 变异逐条独立执行、逐条还原，最后用 SHA256 校验文件回到原样。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")
const target = resolve(root, "src/lib/changelog.ts")
const check = resolve(here, "check-changelog-ts-matches.mjs")

const original = readFileSync(target, "utf8")
const before = createHash("sha256").update(original).digest("hex")

/**
 * 行尾容忍的替换。
 *
 * changelog.ts 是 CRLF，而脚本以 LF 书写锚点 —— 多行锚点用 `\n` 写就
 * 永远匹配不到，两个变异会被静默跳过，看起来像"变异没落地"而不是
 * "脚本有 bug"。这与之前 ui-test-tools.css 踩的是同一个坑。
 * 先试原样，再试把锚点与目标都归一成同一种行尾。
 */
function applyReplace(text, from, to) {
  if (text.includes(from)) return text.replace(from, to)
  const crlfFrom = from.replace(/\n/g, "\r\n")
  const crlfTo = to.replace(/\n/g, "\r\n")
  if (text.includes(crlfFrom)) return text.replace(crlfFrom, crlfTo)
  return null
}

/** 每种变异模拟一类誊写失误。 */
const MUTATIONS = [
  {
    name: "中文改一个字（「绿点」→「红点」）",
    from: "已提取记忆的章节显示绿点",
    to: "已提取记忆的章节显示红点",
  },
  {
    name: "英文改一个词（green dot → red dot）",
    from: "extracted show a green dot",
    to: "extracted show a red dot",
  },
  {
    name: "删掉整条（【界面细节】）",
    from: '      "【界面细节】AI 回复时间更早的记录补月日与年月日；生成中的等待文案整段显示不再忽隐忽现；草稿「提取记忆」提示不再被正文盖住；自定义模型的上下文窗口与输出上限改用统一预设选择器",\n',
    to: "",
  },
  {
    name: "拆掉 allChangelog 首位接线",
    from: "    FOUR_POINT_ONE_ONE_CHANGELOG,\n",
    to: "",
  },
  {
    name: "改错版本号（4.1.1 → 4.1.2）",
    from: 'version: "4.1.1",',
    to: 'version: "4.1.2",',
  },
]

const results = []
let red = 0
try {
  for (const m of MUTATIONS) {
    const mutated = applyReplace(original, m.from, m.to)
    if (mutated === null) {
      results.push(`  ?? ${m.name} —— 锚点未找到，变异没落地`)
      continue
    }
    writeFileSync(target, mutated, "utf8")
    let failed = false
    try {
      execFileSync(process.execPath, [check], { stdio: "pipe" })
    } catch {
      failed = true
    }
    writeFileSync(target, original, "utf8")
    results.push(`  ${failed ? "变红" : "仍绿 ← 空话!"} ${m.name}`)
    if (failed) red += 1
  }
} finally {
  writeFileSync(target, original, "utf8")
}

console.log(results.join("\n"))
console.log(`\n变异 ${MUTATIONS.length} 项，如期变红 ${red} 项`)

const after = createHash("sha256").update(readFileSync(target, "utf8")).digest("hex")
console.log(`还原校验：${before === after ? "SHA256 一致，已按字节还原" : "不一致! 可能残留变异"}`)
if (red !== MUTATIONS.length || before !== after) process.exitCode = 1
