import { copyDirectory, createDirectory, deleteFile, fileExists, readFile } from "@/commands/fs"
import { joinPath, normalizePath } from "@/lib/path-utils"

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

export interface SkillSyncReport {
  status: "skipped" | "unchanged" | "kept-newer" | "updated"
  message: string
  fromVersion?: string | null
  toVersion?: string
}

export function parseSkillVersion(markdown: string): string | null {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatter) return null
  const version = frontmatter[1].match(/^\s*version:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m)?.[1]
  return version && VERSION_PATTERN.test(version) ? version : null
}

export function compareSemver(left: string, right: string): number | null {
  const parse = (value: string) => {
    const match = value.match(VERSION_PATTERN)
    if (!match) return null
    return [Number(match[1]), Number(match[2]), Number(match[3])] as const
  }
  const a = parse(left)
  const b = parse(right)
  if (!a || !b) return null
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

export function decideSkillSync(input: {
  parentExists: boolean
  bundledVersion: string | null
  installedVersion: string | null
}): SkillSyncReport {
  if (!input.parentExists) {
    return { status: "skipped", message: "Agent skills 目录不存在，未创建" }
  }
  if (!input.bundledVersion) {
    return { status: "skipped", message: "随包 skill 没有可用的版本号" }
  }
  if (!input.installedVersion) {
    return {
      status: "updated",
      message: `已将 qmai-mcp 更新到 ${input.bundledVersion}`,
      fromVersion: input.installedVersion,
      toVersion: input.bundledVersion,
    }
  }
  const order = compareSemver(input.installedVersion, input.bundledVersion)
  if (order === null) {
    return {
      status: "updated",
      message: `已将 qmai-mcp 更新到 ${input.bundledVersion}`,
      fromVersion: null,
      toVersion: input.bundledVersion,
    }
  }
  if (order === 0) return { status: "unchanged", message: `qmai-mcp 已是 ${input.bundledVersion}` }
  if (order > 0) {
    return {
      status: "kept-newer",
      message: `已保留较新副本 ${input.installedVersion}，随包版本是 ${input.bundledVersion}`,
      fromVersion: input.installedVersion,
      toVersion: input.bundledVersion,
    }
  }
  return {
    status: "updated",
    message: `已将 qmai-mcp 从 ${input.installedVersion} 更新到 ${input.bundledVersion}`,
    fromVersion: input.installedVersion,
    toVersion: input.bundledVersion,
  }
}

export interface SkillSyncIo {
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<string>
  copyDir(source: string, destination: string): Promise<void>
  remove(path: string): Promise<void>
}

let syncQueue: Promise<unknown> = Promise.resolve()

export function syncQmaiMcpSkill(input: {
  bundledDir: string
  agentSkillsDir: string
  io: SkillSyncIo
}): Promise<SkillSyncReport> {
  const run = syncQueue.then(() => syncQmaiMcpSkillOnce(input))
  syncQueue = run.then(() => undefined, () => undefined)
  return run
}

async function syncQmaiMcpSkillOnce(input: {
  bundledDir: string
  agentSkillsDir: string
  io: SkillSyncIo
}): Promise<SkillSyncReport> {
  const parent = normalizePath(input.agentSkillsDir).replace(/\/+$/, "")
  if (!parent) return { status: "skipped", message: "未填写 Agent skills 目录" }
  const parentExists = await input.io.exists(parent)
  let bundledVersion: string | null = null
  try {
    bundledVersion = parseSkillVersion(await input.io.readFile(joinPath(input.bundledDir, "SKILL.md")))
  } catch {
    bundledVersion = null
  }
  const installedPath = joinPath(parent, "qmai-mcp", "SKILL.md")
  let installedVersion: string | null = null
  if (await input.io.exists(installedPath)) {
    try {
      installedVersion = parseSkillVersion(await input.io.readFile(installedPath))
    } catch {
      installedVersion = null
    }
  }
  const decision = decideSkillSync({ parentExists, bundledVersion, installedVersion })
  if (decision.status !== "updated") return decision
  const staging = joinPath(parent, `.qmai-mcp-staging-${Date.now()}`)
  const target = joinPath(parent, "qmai-mcp")
  await input.io.copyDir(input.bundledDir, staging)
  if (await input.io.exists(target)) await input.io.remove(target)
  await input.io.copyDir(staging, target)
  await input.io.remove(staging)
  return decision
}

export function createTauriSkillSyncIo(): SkillSyncIo {
  return {
    exists: fileExists,
    readFile,
    copyDir: async (source, destination) => {
      await createDirectory(destination)
      await copyDirectory(source, destination)
    },
    remove: deleteFile,
  }
}
