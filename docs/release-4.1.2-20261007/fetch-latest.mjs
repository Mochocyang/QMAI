/**
 * 读取 GitHub latest.json（用 node 原生 fetch，带重试）。
 *
 * 不用 curl：本机 schannel 链路不稳定，curl 常报
 * "schannel: failed to receive handshake"（实测连续 3 次全失败）。
 * 但 node fetch 也会间歇 ECONNRESET（对 github.com 的 TLS 握手被重置），
 * 所以必须重试 —— 单次失败不能当成"发布没生效"。
 */
const URL = "https://github.com/Mochocyang/QMAI/releases/latest/download/latest.json"

async function fetchJson(url, attempts = 6) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" })
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`)
      } else {
        return { json: await res.json(), attempts: i }
      }
    } catch (err) {
      lastErr = err
    }
    // 退避：2s, 4s, 6s, 8s, 10s
    await new Promise((r) => setTimeout(r, i * 2000))
  }
  throw new Error(`重试 ${attempts} 次仍失败：${lastErr?.message ?? lastErr}`)
}

const { json: j, attempts } = await fetchJson(URL)
console.log(`  （第 ${attempts} 次尝试成功）`)
console.log(`  version  : ${j.version}`)
console.log(`  pub_date : ${j.pub_date ?? "(无)"}`)
const p = j.platforms ?? {}
for (const [k, v] of Object.entries(p)) {
  console.log(`  [${k}]`)
  console.log(`    url       : ${v.url}`)
  console.log(`    signature : ${v.signature ? `${v.signature.slice(0, 24)}… (${v.signature.length} 字符)` : "(缺失)"}`)
}
const notes = String(j.notes ?? "")
console.log(`  notes 行数: ${notes.split("\n").length}`)
console.log(`  notes 第1行: ${notes.split("\n")[0]?.slice(0, 80)}`)
console.log(`  notes 含手动更新指引: ${notes.includes("手动更新一次")}`)

// 目标版本由调用方给出，用来做断言而不是仅打印
const expected = process.argv[2]
if (expected) {
  console.log()
  if (j.version === expected) console.log(`  OK latest 已指向 ${expected}`)
  else {
    console.log(`  FAIL latest 仍为 ${j.version}，期望 ${expected}`)
    process.exitCode = 1
  }
}
