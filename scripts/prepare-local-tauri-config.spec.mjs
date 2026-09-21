import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { prepareLocalTauriConfig } from "./prepare-local-tauri-config.mjs"

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "qmai-frontend-config-"))
  const tauriDir = path.join(root, "src-tauri")
  const frontendDir = path.join(root, ".codex-temp", "验证 目录", "frontend")
  mkdirSync(tauriDir, { recursive: true })
  mkdirSync(path.join(frontendDir, "assets"), { recursive: true })
  writeFileSync(path.join(frontendDir, "index.html"), '<div id="root"></div><script src="/assets/main.js"></script>')
  writeFileSync(path.join(frontendDir, "assets", "main.js"), 'console.log("本地资源")')
  return { root, tauriDir, frontendDir }
}

describe("本地 Tauri 打包入口配置", () => {
  it("Windows绝对路径不会进入frontendDist，目录相对src-tauri定位并使用内嵌首页", () => {
    const { tauriDir, frontendDir } = fixture()
    const config = prepareLocalTauriConfig(tauriDir, frontendDir)
    expect(config.build.frontendDist).toMatch(/^\.\.?\//)
    expect(config.build.frontendDist).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)
    expect(config.build.frontendDist).not.toContain("\\")
    expect(path.resolve(tauriDir, config.build.frontendDist)).toBe(frontendDir)
    expect(config.app?.windows).toBeUndefined()
    expect(config.identifier).toBeUndefined()
    expect(config.version).toBeUndefined()
    expect(config.bundle.targets).toEqual(["nsis"])
  })

  it("缺少index.html时失败，不能把只有目录的产物交给打包器", () => {
    const { root, tauriDir } = fixture()
    const incomplete = path.join(root, "incomplete")
    mkdirSync(incomplete)
    expect(() => prepareLocalTauriConfig(tauriDir, incomplete)).toThrow("index.html")
  })

  it("不同磁盘无法得到相对路径时拒绝生成，而不是回退为盘符URL", () => {
    if (process.platform !== "win32") return
    const { tauriDir } = fixture()
    const otherDrive = path.parse(tauriDir).root.startsWith("Z:") ? "Y:" : "Z:"
    expect(() => prepareLocalTauriConfig(tauriDir, `${otherDrive}/frontend`)).toThrow("同一磁盘")
  })

  it("命令行只新建配置文件，不能覆盖已有文件", () => {
    const { frontendDir, root } = fixture()
    const output = path.join(root, "override.json")
    const script = fileURLToPath(new URL("./prepare-local-tauri-config.mjs", import.meta.url))
    const result = spawnSync(process.execPath, [script, frontendDir, output], { encoding: "utf8" })
    expect(result.status).toBe(0)
    const before = readFileSync(output, "utf8")
    expect(JSON.parse(before).build.frontendDist).not.toMatch(/^[A-Za-z]:/)
    const repeated = spawnSync(process.execPath, [script, frontendDir, output], { encoding: "utf8" })
    expect(repeated.status).not.toBe(0)
    expect(readFileSync(output, "utf8")).toBe(before)
  })
})
