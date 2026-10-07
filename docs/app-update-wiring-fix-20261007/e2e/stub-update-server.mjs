/**
 * 端到端验证用的桩更新服务。
 *
 * 用途：让被测的 release 版应用"发现"一个比自身更高的版本（9.9.9），
 * 从而验证旧版本启动时确实会弹出更新提示 —— 这正是用户报告失效的功能。
 *
 * 为什么用 9.9.9 这种不可能出现的版本号：一眼能看出是验证用的桩，
 * 不会与真实发布混淆。
 *
 * 注意 check() 阶段不校验签名（tauri-plugin-updater 的 verify_signature
 * 只在 download() 里调用），所以这里的签名是占位串。本次验证只走到弹窗，
 * 不会真的下载。
 */
import { createServer } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.argv[2] ?? 8731)

const body = readFileSync(resolve(here, "latest-stub.json"))

const server = createServer((req, res) => {
  console.log(`[stub] ${req.method} ${req.url}`)
  if (req.url?.startsWith("/latest.json")) {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": body.length,
    })
    res.end(body)
    return
  }
  res.writeHead(404, { "Content-Type": "text/plain" })
  res.end("not found")
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[stub] 桩更新服务已启动: http://127.0.0.1:${PORT}/latest.json`)
  console.log(`[stub] 对外宣告版本 9.9.9（被测应用为 4.1.1，应判定为有更新）`)
})
