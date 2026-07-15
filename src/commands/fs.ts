import { invoke } from "@tauri-apps/api/core"
import type { FileNode, WikiProject } from "@/types/wiki"
import { ensureProjectId, upsertProjectInfo } from "@/lib/project-identity"

interface RawProject {
  name: string
  path: string
}

export type ProjectFileMutation = {
  type: "write" | "delete"
  path: string
}

const projectFileMutationListeners = new Set<(event: ProjectFileMutation) => void>()

export function subscribeProjectFileMutations(
  listener: (event: ProjectFileMutation) => void,
): () => void {
  projectFileMutationListeners.add(listener)
  return () => projectFileMutationListeners.delete(listener)
}

function notifyProjectFileMutation(event: ProjectFileMutation): void {
  for (const listener of projectFileMutationListeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn("文件变更订阅处理失败：", error)
    }
  }
}

export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path })
}

export async function writeFile(path: string, contents: string): Promise<void> {
  await invoke<void>("write_file", { path, contents })
  notifyProjectFileMutation({ type: "write", path })
}

export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await invoke<void>("write_file_atomic", { path, contents })
  notifyProjectFileMutation({ type: "write", path })
}

export async function writeFileIfAbsent(path: string, contents: string): Promise<boolean> {
  const created = await invoke<boolean>("write_file_if_absent", { path, contents })
  if (created) notifyProjectFileMutation({ type: "write", path })
  return created
}

/**
 * List a directory tree. Dot-prefixed entries (`.claude`, `.env`,
 * `.qmai`, …) are hidden by default; pass `includeHidden: true`
 * only for the `raw/sources` content area, where dotfolders are
 * legitimate user-added sources. See `entry_is_visible` in fs.rs.
 */
export interface ListDirectoryOptions {
  includeHidden?: boolean
  maxDepth?: number
}

// In-flight dedupe only: entries are removed when the request settles. Each
// caller receives its own tree copy when a request is actually shared, so
// accidental in-place mutations do not leak across concurrent waiters.
interface PendingListDirectory {
  request: Promise<FileNode[]>
  shared: boolean
}

const pendingListDirectory = new Map<string, PendingListDirectory>()

function cloneFileNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneFileNodes(node.children) : node.children,
  }))
}

export async function listDirectory(
  path: string,
  includeHiddenOrOptions: boolean | ListDirectoryOptions = false,
): Promise<FileNode[]> {
  const options =
    typeof includeHiddenOrOptions === "boolean"
      ? { includeHidden: includeHiddenOrOptions }
      : includeHiddenOrOptions
  const includeHidden = options.includeHidden ?? false
  const maxDepth = options.maxDepth
  const requestKey = JSON.stringify([path, includeHidden, maxDepth ?? null])
  const pending = pendingListDirectory.get(requestKey)
  if (pending) {
    pending.shared = true
    return pending.request.then(cloneFileNodes)
  }

  const request = invoke<FileNode[]>("list_directory", {
    path,
    includeHidden,
    maxDepth,
  }).finally(() => {
    pendingListDirectory.delete(requestKey)
  })
  const entry: PendingListDirectory = { request, shared: false }
  pendingListDirectory.set(requestKey, entry)
  return request.then((nodes) => (entry.shared ? cloneFileNodes(nodes) : nodes))
}

export async function copyFile(
  source: string,
  destination: string
): Promise<void> {
  return invoke("copy_file", { source, destination })
}

export async function copyDirectory(
  source: string,
  destination: string
): Promise<string[]> {
  return invoke<string[]>("copy_directory", { source, destination })
}

export async function preprocessFile(path: string): Promise<string> {
  return invoke<string>("preprocess_file", { path })
}

export async function deleteFile(path: string): Promise<void> {
  await invoke("delete_file", { path })
  notifyProjectFileMutation({ type: "delete", path })
}

export async function findRelatedWikiPages(
  projectPath: string,
  sourceName: string
): Promise<string[]> {
  return invoke<string[]>("find_related_wiki_pages", { projectPath, sourceName })
}

export async function createDirectory(path: string): Promise<void> {
  return invoke<void>("create_directory", { path })
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>("file_exists", { path })
}

export async function getFileModifiedTime(path: string): Promise<number> {
  return invoke<number>("get_file_modified_time", { path })
}

export async function getFileSize(path: string): Promise<number> {
  return invoke<number>("get_file_size", { path })
}

export async function getFileMd5(path: string): Promise<string> {
  return invoke<string>("get_file_md5", { path })
}

export interface FileBase64 {
  base64: string
  mimeType: string
}

export async function readFileAsBase64(path: string): Promise<FileBase64> {
  return invoke<FileBase64>("read_file_as_base64", { path })
}

export async function createProject(
  name: string,
  path: string,
): Promise<WikiProject> {
  const raw = await invoke<RawProject>("create_project", { name, path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProject(path: string): Promise<WikiProject> {
  const raw = await invoke<RawProject>("open_project", { path })
  const id = await ensureProjectId(raw.path)
  await upsertProjectInfo(id, raw.path, raw.name)
  return { id, name: raw.name, path: raw.path }
}

export async function openProjectFolder(path: string): Promise<void> {
  return invoke<void>("open_project_folder", { path })
}

export async function openFileLocation(path: string): Promise<void> {
  return invoke<void>("open_file_location", { path })
}

export async function getExecutableDir(): Promise<string> {
  return invoke<string>("get_executable_dir")
}

export async function getResourceDir(): Promise<string> {
  return invoke<string>("get_resource_dir")
}
