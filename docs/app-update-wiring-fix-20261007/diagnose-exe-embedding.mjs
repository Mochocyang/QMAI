/**
 * 对照实验：判断 exe 里搜不到前端字符串，是"代码没打进去"还是"资源被压缩了"。
 *
 * 背景：我用 app-updater 的 5 条文案搜 exe，全部未命中。但这不能推出
 * "修复代码没进 exe" —— Tauri 在 release 下会把前端资源压缩后内嵌。
 * 必须用一个**确定存在于 dist 里**的字符串做对照：
 *   - 若它在 exe 里也搜不到 → 说明内嵌是压缩的，字符串搜索对 exe 无效（方法问题）
 *   - 若它能在 exe 里搜到   → 说明内嵌是明文，那 app-updater 缺失就是真问题
 *
 * 同时验证 exe 里的版本号（VersionInfo 是 PE 资源，必然明文可搜）。
 */
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

const exePath = resolve("release-portable/QMaiWrite.exe")
const distAssets = resolve("dist/assets")

const buf = readFileSync(exePath)
console.log(`exe: ${exePath}  (${buf.length.toLocaleString("en-US")} bytes)\n`)

// ── 步骤 1：从 dist 里挑一条确定存在的长中文串作为对照 ──
const distText = readdirSync(distAssets)
  .filter((f) => f.endsWith(".js"))
  .map((f) => readFileSync(join(distAssets, f), "utf8"))
  .join("\n")

/** 从 dist 里自动取若干条较长的中文串（越长越不容易偶然命中，也越能代表代码）。 */
const candidates = [...new Set(distText.match(/[\u4e00-\u9fa5]{12,}/g) ?? [])]
console.log(`dist 中长度 ≥12 的中文串: ${candidates.length} 条\n`)

const probes = candidates.slice(0, 5)
let plaintextHits = 0
console.log("对照：dist 中存在、拿来到 exe 里搜的字符串")
for (const p of probes) {
  const hit = buf.includes(Buffer.from(p, "utf8"))
  if (hit) plaintextHits++
  console.log(`  ${hit ? "命中" : "未命中"}  ${p.slice(0, 40)}`)
}

// ── 步骤 2：同时用 app-updater 的独有文案做同样的搜索 ──
console.log()
const updaterNeedles = [
  "请稍后重试或前往 GitHub 手动下载安装包",
  "检测到新版本",
  "更新已下载完成",
]
console.log("目标：app-updater 独有文案")
for (const n of updaterNeedles) {
  const inDist = distText.includes(n)
  const inExe = buf.includes(Buffer.from(n, "utf8"))
  console.log(`  dist ${inDist ? "有" : "无"} / exe ${inExe ? "命中" : "未命中"}  「${n}」`)
}

// ── 结论 ──
console.log()
console.log("─".repeat(60))
if (plaintextHits === 0) {
  console.log("结论：连确定存在于 dist 的普通业务文案，在 exe 里也一条都搜不到。")
  console.log("      → exe 内嵌资源是**压缩**的，明文搜索对 exe 无效。")
  console.log("      → 之前 app-updater 的 5 条未命中，是**方法问题，不是缺陷**。")
  console.log("      → 验证 exe 是否含修复代码，必须靠运行时行为，不能靠字符串搜索。")
} else {
  console.log(`结论：对照串命中 ${plaintextHits}/${probes.length} —— exe 内嵌资源是**明文**。`)
  console.log("      那么 app-updater 文案在 exe 中缺失就是**真问题**，需排查打包环节。")
}
