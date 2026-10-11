/** 导出线上某版本 Release 正文，供比对发布说明的组织方式。 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"

const tag = process.argv[2]
const target = process.argv[3]
const body = execFileSync(
  "gh",
  ["release", "view", tag, "-R", "Mochocyang/QMAI", "--json", "body", "--jq", ".body"],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
)
writeFileSync(target, body, "utf8")
console.log(`已写出 ${tag} 的正文，共 ${body.split("\n").length} 行`)
