/**
 * 证明修好锚点后的 verify-in-exe.mjs 仍然承重，而不是被"调松"了。
 *
 * 两类变异，各自独立执行、逐条还原、SHA256 校验：
 *
 *  M1 把禁词「待确认」塞回真正的拆书库 chunk
 *     → "拆书库 chunk 内已清除: 待确认" 必须变红。
 *     这条防的是：把定位改成只匹配空集合、或把断言删掉之类"调松"。
 *
 *  M2 把锚点换回脆弱的业务词「证据索引」
 *     → 新增的"未混入更新日志 chunk"自检必须变红。
 *     这条防的是：锚点自检本身是空话。
 *
 * 只做 M1 不够 —— 一个恒真的自检同样会让 M1 通过。
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../..")
const checkScript = resolve(root, "docs/skill-card-and-chapter-dot-20261007/verify-in-exe.mjs")
const assetsDir = resolve(root, "dist/assets")

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex")

/** 找到真正承载拆书库组件的 chunk（用同一个结构锚点）。 */
const workbenchChunk = readdirSync(assetsDir)
  .filter((f) => f.endsWith(".js"))
  .find((f) => readFileSync(resolve(assetsDir, f), "utf8").includes("wb-skill-grid"))

if (!workbenchChunk) {
  console.log("找不到拆书库 chunk，无法执行变异")
  process.exit(1)
}
const chunkPath = resolve(assetsDir, workbenchChunk)
console.log(`拆书库 chunk = ${workbenchChunk}`)

function runCheck() {
  try {
    const out = execFileSync(process.execPath, [checkScript], { encoding: "utf8", cwd: root })
    return { green: true, out }
  } catch (err) {
    return { green: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

const results = []

// ---------- M1：把禁词塞回拆书库 chunk ----------
{
  const before = sha(chunkPath)
  const original = readFileSync(chunkPath, "utf8")
  writeFileSync(chunkPath, `${original}\nvar __mutation_probe__="待确认";\n`, "utf8")
  const r = runCheck()
  writeFileSync(chunkPath, original, "utf8")
  const after = sha(chunkPath)
  const mentioned = /拆书库 chunk 内已清除: 待确认/.test(r.out)
  results.push(
    `  ${!r.green && mentioned ? "变红" : "未如期变红 ← 检查被削弱!"} M1 塞回「待确认」` +
      `（退出红=${!r.green}，命中该条=${mentioned}）`,
  )
  if (before !== after) results.push(`  !! M1 还原失败`)
}

// ---------- M2：锚点换回脆弱业务词，自检必须报错 ----------
{
  const before = sha(checkScript)
  const original = readFileSync(checkScript, "utf8")
  const mutated = original.replace('const WORKBENCH_ANCHOR = "wb-skill-grid"', 'const WORKBENCH_ANCHOR = "证据索引"')
  if (mutated === original) {
    results.push("  ?? M2 锚点未找到，变异没落地")
  } else {
    writeFileSync(checkScript, mutated, "utf8")
    const r = runCheck()
    writeFileSync(checkScript, original, "utf8")
    const after = sha(checkScript)
    const guardHit = /未混入更新日志 chunk/.test(r.out) && /混入/.test(r.out)
    results.push(
      `  ${!r.green && guardHit ? "变红" : "未如期变红 ← 自检是空话!"} M2 锚点换回「证据索引」` +
        `（退出红=${!r.green}，自检命中=${guardHit}）`,
    )
    if (before !== after) results.push(`  !! M2 还原失败`)
  }
}

console.log(results.join("\n"))

// 基线复核：还原后必须重新全绿
const baseline = runCheck()
console.log(`\n还原后基线：${baseline.green ? "全绿" : "仍红 ← 还原不干净"}`)
const summary = /通过 (\d+) 项，失败 (\d+) 项/.exec(baseline.out)
if (summary) console.log(`  ${summary[0]}`)

const allRed = results.filter((r) => r.includes("变红") && !r.includes("未如期")).length
const restoreFailures = results.filter((r) => r.includes("还原失败")).length
console.log(`\n变异 ${results.filter((r) => !r.includes("??")).length} 项，如期变红 ${allRed} 项`)
if (allRed !== 2 || !baseline.green || restoreFailures > 0) process.exitCode = 1
