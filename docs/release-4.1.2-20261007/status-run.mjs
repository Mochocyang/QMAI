/** 打印一次工作流各 job 的状态（用 node 调 gh，避开 shell 与重定向编码问题）。 */
import { execFileSync } from "node:child_process"

const RUN_ID = process.argv[2] ?? "37595851144"

const out = execFileSync(
  "gh",
  ["run", "view", RUN_ID, "--json", "status,conclusion,createdAt,updatedAt,jobs"],
  { encoding: "utf8", stdio: "pipe" },
)
const j = JSON.parse(out)

console.log(`run 状态 : ${j.status} ${j.conclusion || ""}`)
console.log(`创建     : ${j.createdAt}`)
console.log(`更新     : ${j.updatedAt}`)
console.log()
for (const job of j.jobs ?? []) {
  const state = `${job.status}/${job.conclusion || "-"}`
  console.log(`  ${state.padEnd(26)} ${job.name}`)
  // 失败时打印第一个失败步骤，省去再查一次
  if (job.conclusion && job.conclusion !== "success") {
    for (const s of job.steps ?? []) {
      if (s.conclusion && s.conclusion !== "success") {
        console.log(`      ↳ 步骤失败: ${s.name} (${s.conclusion})`)
      }
    }
  }
}
