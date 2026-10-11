/**
 * 等待 v4.1.2 的打包工作流结束，然后核对发布资产。
 *
 * 为什么用 node 而不是 shell：`gh ... --jq ".name"` 里的引号与点号经过
 * cmd / PowerShell 两层会被拆错（本项目多次踩到）。execFileSync 直接传 argv。
 *
 * 按 qmai-release 不变量：工作流与必需资产未完成前，不声称发版完成。
 * 所以这里必须等到终态，而不是"启动了就报成功"。
 */
import { execFileSync } from "node:child_process"

const RUN_ID = process.argv[2] ?? "37595851144"
const TAG = process.argv[3] ?? "v4.1.2"

function gh(args, { allowFail = false } = {}) {
  try {
    return { ok: true, out: execFileSync("gh", args, { encoding: "utf8", stdio: "pipe" }) }
  } catch (err) {
    if (!allowFail) throw err
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log(`[watch] 等待工作流 run ${RUN_ID} 结束（每 60 秒查一次状态）...`)

let status = "unknown"
let conclusion = ""
for (let i = 1; i <= 90; i++) {
  const r = gh(
    ["run", "view", RUN_ID, "--json", "status,conclusion,headSha,displayTitle"],
    { allowFail: true },
  )
  if (r.ok) {
    let j = null
    try {
      j = JSON.parse(r.out)
    } catch {
      // gh 偶发返回残缺 JSON，本轮跳过
    }
    if (j) {
      const prev = status
      status = j.status ?? "unknown"
      conclusion = j.conclusion ?? ""
      if (status !== prev) {
        console.log(`[watch] ${new Date().toISOString().slice(11, 19)}  状态 = ${status}${conclusion ? ` / ${conclusion}` : ""}`)
      }
      if (status === "completed") break
    }
  } else {
    console.log(`[watch] 第 ${i} 次查询失败（可能是瞬时网络错误），继续`)
  }
  await sleep(60_000)
}

console.log(`\n[watch] 终态: status=${status} conclusion=${conclusion}`)

// 工作流里各平台的 job 状态
const jobs = gh(["run", "view", RUN_ID, "--json", "jobs"], { allowFail: true })
if (jobs.ok) {
  try {
    const list = JSON.parse(jobs.out).jobs ?? []
    console.log("\n各 job：")
    for (const j of list) {
      console.log(`  ${(j.conclusion ?? j.status ?? "?").padEnd(10)} ${j.name}`)
    }
  } catch {
    console.log("  (jobs JSON 解析失败)")
  }
}

// 发布资产
const rel = gh(["release", "view", TAG, "--json", "tagName,isDraft,isPrerelease,assets"], { allowFail: true })
if (!rel.ok) {
  console.log(`\n[资产] 尚无法读取 release ${TAG}（可能仍在创建）`)
  process.exitCode = 1
} else {
  const j = JSON.parse(rel.out)
  console.log(`\n[资产] release ${TAG}  draft=${j.isDraft} prerelease=${j.isPrerelease}`)
  const assets = j.assets ?? []
  if (assets.length === 0) {
    console.log("  尚无资产")
    process.exitCode = 1
  } else {
    for (const a of assets) {
      console.log(`  ${String(Math.round((a.size ?? 0) / 1024 / 1024)).padStart(4)} MB  ${a.name}`)
    }
  }
  // 必需资产：三平台安装包 + latest.json
  const names = assets.map((a) => a.name).join(" ")
  const required = [
    ["windows 安装包", /windows_X64\.exe/],
    ["windows 便携版", /portable\.exe/],
    ["latest.json", /latest\.json/],
    ["macOS dmg", /\.dmg/],
    ["Linux deb", /\.deb/],
    ["Linux AppImage", /\.AppImage/],
  ]
  console.log("\n必需资产核对：")
  let missing = 0
  for (const [label, re] of required) {
    const ok = re.test(names)
    if (!ok) missing++
    console.log(`  ${ok ? "OK  " : "缺失"}  ${label}`)
  }
  if (missing || conclusion !== "success") process.exitCode = 1
  else console.log("\n发布完成：工作流成功且必需资产齐全。")
}
