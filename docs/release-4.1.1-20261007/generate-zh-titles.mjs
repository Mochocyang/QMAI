/**
 * 从已校验的条目文件导出中文标题列表，供 check-dist-version.mjs 抽查产物。
 * 单一数据源：仍然读 changelog-entry-4.1.1.txt，不另抄一份。
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractArray } from "./parse-changelog-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, "changelog-entry-4.1.1.txt"), "utf8")
const zh = extractArray(source, "zh")

// 产物里是完整条目文本，取全文的短前缀做抽查（保留【】与标题）
const titles = zh.map((line) => line.slice(0, 24))
writeFileSync(resolve(here, "zh-titles.json"), JSON.stringify(titles, null, 2), "utf8")
console.log(`已导出 ${titles.length} 条中文标题前缀`)
