import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const root = resolve(__dirname, "..")

const workflow = readFileSync(".github/workflows/prerelease.yml", "utf8")
const official = readFileSync(".github/workflows/build.yml", "utf8")

describe("Windows prerelease workflow", () => {
  it("only runs on the prerelease branch or manual dispatch", () => {
    expect(workflow).toMatch(/branches:\s*\n\s+- prerelease/)
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).not.toMatch(/tags:\s*\n\s+- ["']v\*/)
  })

  it("builds Windows only", () => {
    expect(workflow).toContain("runs-on: windows-latest")
    expect(workflow).toContain("--bundles nsis")
    expect(workflow).not.toMatch(/macos-latest|macos-15-intel|ubuntu-22\.04/)
    expect(workflow).not.toMatch(/--bundles dmg|--bundles deb/)
  })

  it("publishes a GitHub prerelease without touching the stable updater channel", () => {
    expect(workflow).toContain("--prerelease")
    expect(workflow).toContain("--latest=false")
    expect(workflow).toContain('tag="prerelease"')
    expect(workflow).toContain("QMaiWrite_*_prerelease.exe")
    expect(workflow).not.toMatch(/gh release (create|upload)[\s\S]*latest\.json/)
    expect(official).toMatch(/gh release upload[\s\S]*latestPath/)
  })
})


/*
 * 安装包下载地址必须走加速镜像。
 *
 * 实测（国内同一网络，同一台机器）：
 *   HEAD 直连 exe → 12 秒超时
 *   HEAD 镜像 exe → 1.6 秒 200，143MB
 * 清单（latest.json）能加速、但安装包地址仍直连的话，用户体感还是"更新超慢"。
 * 所以发版脚本与 CI workflow 都必须给 platforms.*.url 加镜像前缀。
 * 镜像只转发公开的 release 资产，签名校验（pubkey）不变 —— 改过的包装不上。
 */
describe("latest.json 的安装包地址走加速镜像", () => {
  it("prepare-github-release.mjs 给 url 加镜像前缀", () => {
    const text = readFileSync(resolve(root, "scripts/prepare-github-release.mjs"), "utf8")
    expect(text).toContain("https://gh-proxy.com/https://github.com/")
  })

  it("CI 的 build.yml 也给 url 加镜像前缀", () => {
    const text = readFileSync(resolve(root, ".github/workflows/build.yml"), "utf8")
    expect(text).toContain('$assetMirrorBase = "https://gh-proxy.com/"')
    expect(text).toContain('url = "$assetMirrorBase$assetUrlDirect"')
  })
})
