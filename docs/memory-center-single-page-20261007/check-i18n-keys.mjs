/**
 * 查 i18n 键是否存在。为什么单独写文件：本项目 shell 里 `node -e` 的长输出常被吞掉，
 * 得到空白却分不清"没问题"和"没执行"。
 *
 * 用法: node docs/memory-center-single-page-20261007/check-i18n-keys.mjs <键...>
 *       键用点号路径，如 novel.memoryCenter.back
 */
import { readFileSync } from "node:fs"

const zh = JSON.parse(readFileSync(new URL("../../src/i18n/zh.json", import.meta.url), "utf8"))
const keys = process.argv.slice(2)
if (keys.length === 0) {
  console.error("用法: node check-i18n-keys.mjs <键...>")
  process.exit(2)
}

let missing = 0
for (const key of keys) {
  const value = key.split(".").reduce((node, part) => (node == null ? node : node[part]), zh)
  if (typeof value === "string") {
    console.log(`  有   ${key} = ${JSON.stringify(value)}`)
  } else {
    missing += 1
    console.log(`  缺!  ${key}`)
  }
}
console.log(`\n共 ${keys.length} 个键，缺失 ${missing} 个`)
process.exitCode = missing === 0 ? 0 : 1
