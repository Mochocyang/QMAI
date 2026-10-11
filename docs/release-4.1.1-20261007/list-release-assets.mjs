// 列出 v4.1.1 的 Release 资产并做完整性判定。
// 用脚本而非 PowerShell 内联：--jq 表达式里的 .name/括号会被 cmd 或
// PowerShell 拆成命令（实测报"无法将 .name 项识别为 cmdlet"）。
import { execFileSync } from "node:child_process"

const repo = "Mochocyang/QMAI"
const tag = process.argv[2] ?? "v4.1.1"

function gh(args) {
  try {
    return { ok: true, out: execFileSync("gh", args, { encoding: "utf8", shell: true }).trim() }
  } catch (err) {
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? err.message}` }
  }
}

const r = gh(["release", "view", tag, "-R", repo, "--json", "assets,tagName,isDraft,isPrerelease,url"])
if (!r.ok) {
  console.log(`查询失败：${r.out}`)
  process.exit(1)
}
const data = JSON.parse(r.out)
const assets = data.assets ?? []

console.log(`Release ${data.tagName}  草稿=${data.isDraft}  预发布=${data.isPrerelease}`)
console.log(`${data.url}\n`)
console.log(`资产 ${assets.length} 个：`)
for (const a of assets) {
  const mb = (a.size / 1024 / 1024).toFixed(1)
  console.log(`  ${a.name.padEnd(52)} ${String(a.size).padStart(12)} bytes  (${mb} MB)`)
}

// 按三个平台归类，确认每个平台都真的产出了可下载文件（而非空作业）
const groups = {
  Windows: assets.filter((a) => /\.exe$|windows|setup/i.test(a.name)),
  macOS: assets.filter((a) => /\.dmg$|\.app\.tar\.gz$|macos|aarch64|darwin/i.test(a.name)),
  Linux: assets.filter((a) => /\.deb$|\.AppImage$|linux/i.test(a.name)),
  "updater/其它": assets.filter(
    (a) => !/\.exe$|windows|setup|\.dmg$|\.app\.tar\.gz$|macos|aarch64|darwin|\.deb$|\.AppImage$|linux/i.test(a.name),
  ),
}

console.log("\n按平台归类：")
const problems = []
for (const [name, list] of Object.entries(groups)) {
  const big = list.filter((a) => a.size > 1024) // 排除 0 字节/占位
  console.log(`  ${name}: ${list.length} 个（非空 ${big.length}）`)
  for (const a of list) console.log(`    - ${a.name}`)
  if (name !== "updater/其它" && big.length === 0) problems.push(`${name} 没有非空资产`)
}

// 全部资产都不得为 0 字节
const empty = assets.filter((a) => a.size === 0)
if (empty.length) problems.push(`有 ${empty.length} 个 0 字节资产：${empty.map((a) => a.name).join(", ")}`)

if (problems.length) {
  console.log("\n问题：")
  for (const p of problems) console.log(`  FAIL ${p}`)
  process.exitCode = 1
} else {
  console.log("\nOK 三平台资产齐备且均非空")
}
