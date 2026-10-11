/**
 * 确认构建产物里的应用版本号是目标版本。
 *
 * 为什么不能直接找 "4.1.1"：上一版的 changelog 条目本身就含 4.1.0，
 * 本版条目含 4.1.1，所以"字符串出现"无法区分「版本号已更新」与
 * 「只是更新日志里提到了」。
 *
 * 用 instrument.ts 的 Sentry release 作为探针：
 *   release: `qmai@${__APP_VERSION__}`
 * 它只由 __APP_VERSION__ 产生，是应用版本号的唯一无歧义来源。
 *
 * 另外两个坑：
 * - rolldown 会把字符串字面量改写成反引号，按双引号找会 0 命中（我第一版就栽在这）
 * - 必须同时确认 __APP_VERSION__ 字面量已不存在，即 define 替换确实发生了
 */
import { readFileSync, readdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")
const assetsDir = resolve(root, "dist/assets")

const target = process.argv[2] ?? "4.1.1"
const previous = process.argv[3] ?? "4.1.0"

const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"))

const releaseProbe = /qmai@(\d+\.\d+\.\d+)/g
const found = new Map() // version -> [files]
let unreplacedToken = []

for (const file of files) {
  const text = readFileSync(resolve(assetsDir, file), "utf8")
  for (const match of text.matchAll(releaseProbe)) {
    const v = match[1]
    if (!found.has(v)) found.set(v, [])
    found.get(v).push(file)
  }
  if (text.includes("__APP_VERSION__")) unreplacedToken.push(file)
}

console.log(`扫描 dist/assets 下 ${files.length} 个 JS`)
console.log(`Sentry release 探针 qmai@<version> 命中：`)
for (const [v, list] of found) {
  console.log(`  ${v}  ← ${list.slice(0, 3).join(", ")}${list.length > 3 ? ` 等 ${list.length} 个` : ""}`)
}

const problems = []
const versions = [...found.keys()]
if (!versions.includes(target)) problems.push(`产物里没有 qmai@${target}`)
const wrong = versions.filter((v) => v !== target)
if (wrong.length) problems.push(`产物里还有其它版本：${wrong.join(", ")}`)
if (unreplacedToken.length) {
  problems.push(`__APP_VERSION__ 字面量未替换：${unreplacedToken.slice(0, 3).join(", ")}`)
}

// 更新日志条目是否真的进了产物：抽查首尾两条中文标题
const zh = JSON.parse(readFileSync(resolve(here, "zh-titles.json"), "utf8"))
const allJs = files.map((f) => readFileSync(resolve(assetsDir, f), "utf8")).join("\n")
const missingTitles = zh.filter((title) => !allJs.includes(title))
if (missingTitles.length) {
  problems.push(`更新日志有 ${missingTitles.length} 条未进产物，例如「${missingTitles[0].slice(0, 30)}」`)
}

if (problems.length) {
  console.log(`\n问题 ${problems.length} 处：`)
  for (const p of problems) console.log(`  FAIL ${p}`)
  process.exitCode = 1
} else {
  console.log(`\nOK 应用版本 ${target}，${zh.length} 条更新日志全部进产物，无未替换的 __APP_VERSION__`)
}
