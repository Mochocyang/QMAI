/**
 * 核实各版本是否**包含本次修复**，据此判断用户能否自动收到修复。
 *
 * 这个判断直接决定处置方式：
 *  - 若某版本已含修复 → 该版本用户能自动收到后续更新
 *  - 若不含修复       → 自动检查是死的，用户**永远**收不到任何提示，
 *                       无论我们再发多少新版本；必须先手动更新一次
 */
import { execFileSync } from "node:child_process"

const TAGS = ["v3.2.16", "v4.0.0", "v4.0.2", "v4.0.4", "v4.1.0", "v4.1.1"]

/** 启动接线是否存在：App.tsx 里既有 import 又有调用。 */
function checkTag(tag) {
  try {
    const app = execFileSync("git", ["show", `${tag}:src/App.tsx`], { encoding: "utf8" })
    const imported = app.includes('import { checkForAppUpdate } from "@/lib/app-updater"')
    const called = /void\s+checkForAppUpdate\s*\(\s*\)/.test(app)
    return { ok: true, imported, called }
  } catch (err) {
    return { ok: false, err: String(err.stderr ?? err.message).trim().split("\n")[0] }
  }
}

console.log("版本        import  调用  自动更新提示")
console.log("─".repeat(52))
const broken = []
for (const tag of TAGS) {
  const r = checkTag(tag)
  if (!r.ok) {
    console.log(`${tag.padEnd(11)} ?       ?     (读取失败: ${r.err})`)
    continue
  }
  const works = r.imported && r.called
  if (!works) broken.push(tag)
  console.log(
    `${tag.padEnd(11)} ${r.imported ? "有" : "无"}     ${r.called ? "有" : "无"}    ${works ? "正常" : "失效 ✗"}`,
  )
}

console.log()
if (broken.length === 0) {
  console.log("所有版本接线完好。")
} else {
  console.log(`接线失效的版本：${broken.join(", ")}`)
  console.log()
  console.log("重要结论：这些版本的用户**永远收不到**自动更新提示 ——")
  console.log("  他们的自动检查本身是死的，再发多少新版本都不会被感知。")
  console.log("  必须先通过「设置 → 更新日志 → 检查更新」手动更新一次；")
  console.log("  此后自动更新即恢复正常。")
}
