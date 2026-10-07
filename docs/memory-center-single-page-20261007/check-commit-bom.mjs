/**
 * 直接读 git 原始对象的字节，确认提交信息首行是否带 BOM。
 * 为什么需要：PowerShell 5.1 的控制台会吃掉/显示错 BOM，通过它看不可靠。
 * 用法: node docs/memory-center-single-page-20261007/check-commit-bom.mjs [提交数]
 */
import { execFileSync } from "node:child_process"

const count = Number(process.argv[2] ?? 5)
const hashes = execFileSync("git", ["log", `-${count}`, "--format=%H"], { encoding: "utf8" })
  .trim().split("\n")

let bad = 0
for (const hash of hashes) {
  const raw = execFileSync("git", ["cat-file", "commit", hash], { encoding: "buffer" })
  // 提交对象：头部若干行 + 空行 + 标题。取第一个空行之后的第一行。
  const separator = raw.indexOf("\n\n")
  const subjectBytes = raw.subarray(separator + 2)
  const firstLine = subjectBytes.subarray(0, subjectBytes.indexOf(0x0a))
  const startsWithBom = firstLine[0] === 0xef && firstLine[1] === 0xbb && firstLine[2] === 0xbf
  if (startsWithBom) bad += 1
  console.log(`  ${hash.slice(0, 7)}  ${startsWithBom ? "带 BOM!" : "无 BOM "}  ${firstLine.toString("utf8").replace(/^\ufeff/, "")}`)
}
console.log(`\n共 ${hashes.length} 个提交，带 BOM 的 ${bad} 个`)
process.exitCode = bad === 0 ? 0 : 1
