/**
 * 连通性探针：确认当前能否取到 latest.json 并打印版本。
 *
 * 存在的理由：发布后的端到端验证第一次没弹出提示，需要区分
 * 「修复没生效」与「本机网络到 GitHub 不通」。这个探针只回答后者。
 */
const URL = "https://github.com/Mochocyang/QMAI/releases/latest/download/latest.json"

async function attempt(n) {
  const t0 = Date.now()
  try {
    const res = await fetch(URL, { redirect: "follow" })
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}`, ms }
    const j = await res.json()
    return { ok: true, ms, version: j.version, bytes: JSON.stringify(j).length }
  } catch (err) {
    return { ok: false, why: err.message, ms: Date.now() - t0 }
  }
}

let success = 0
for (let i = 1; i <= 4; i++) {
  const r = await attempt(i)
  if (r.ok) {
    success++
    console.log(`  第${i}次: 成功  ${r.ms}ms  version=${r.version}  ${r.bytes} bytes`)
  } else {
    console.log(`  第${i}次: 失败  ${r.ms}ms  ${r.why}`)
  }
  if (i < 4) await new Promise((r) => setTimeout(r, 2500))
}

console.log()
console.log(success > 0 ? `连通性正常（${success}/4 成功）` : "连通性异常（4/4 失败）—— 此时无法据此判断修复是否生效")
process.exitCode = success > 0 ? 0 : 1
