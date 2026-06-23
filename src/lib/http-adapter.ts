import type { FileNode } from "@/types/wiki"

// Detect the API base URL from the current page location
function getApiBase(): string {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost"
  return `http://${hostname}:5800/api`
}

// Generic API call helper
async function apiCall<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }
  const json = await res.json()
  if (!json.ok) {
    throw new Error(json.error || "Unknown server error")
  }
  return json.data
}

// ============ File System ============

export const httpFs = {
  readFile: (path: string) => apiCall<string>("/fs/read-file", { path }),
  writeFile: (path: string, contents: string) => apiCall<void>("/fs/write-file", { path, contents }),
  writeFileAtomic: (path: string, contents: string) => apiCall<void>("/fs/write-file-atomic", { path, contents }),
  listDirectory: (path: string) => apiCall<FileNode[]>("/fs/list-directory", { path }),
  copyFile: (source: string, destination: string) => apiCall<void>("/fs/copy-file", { source, destination }),
  copyDirectory: (source: string, destination: string) => apiCall<string[]>("/fs/copy-directory", { source, destination }),
  preprocessFile: (path: string) => apiCall<string>("/fs/preprocess-file", { path }),
  deleteFile: (path: string) => apiCall<void>("/fs/delete-file", { path }),
  findRelatedWikiPages: (projectPath: string, sourceName: string) => apiCall<string[]>("/fs/find-related-wiki-pages", { projectPath, sourceName }),
  createDirectory: (path: string) => apiCall<void>("/fs/create-directory", { path }),
  fileExists: (path: string) => apiCall<boolean>("/fs/file-exists", { path }),
  getFileModifiedTime: (path: string) => apiCall<number>("/fs/get-file-modified-time", { path }),
  getFileSize: (path: string) => apiCall<number>("/fs/get-file-size", { path }),
  getFileMd5: (path: string) => apiCall<string>("/fs/get-file-md5", { path }),
  readFileAsBase64: (path: string) => apiCall<{ base64: string; mimeType: string }>("/fs/read-file-as-base64", { path }),
  getExecutableDir: () => apiCall<string>("/fs/get-executable-dir", undefined, "GET"),
  getResourceDir: () => apiCall<string>("/fs/get-resource-dir", undefined, "GET"),
  uploadFiles: async (files: File[], relativePaths?: string[]): Promise<{ tempDir: string; paths: string[] }> => {
    const formData = new FormData()
    if (relativePaths && relativePaths.length === files.length) {
      formData.append("paths", JSON.stringify(relativePaths))
    }
    for (const file of files) {
      formData.append("file", file)
    }
    const res = await fetch(`${getApiBase()}/fs/upload-files`, {
      method: "POST",
      body: formData,
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    const json = await res.json()
    if (!json.ok) {
      throw new Error(json.error || "Unknown server error")
    }
    return json.data
  },
}

// ============ Vector Store ============

export const httpVector = {
  upsert: (projectPath: string, pageId: string, embedding: number[]) =>
    apiCall<void>("/vector/upsert", { projectPath, pageId, embedding }),
  search: (projectPath: string, queryEmbedding: number[], topK: number) =>
    apiCall<Array<{ pageId: string; score: number }>>("/vector/search", { projectPath, queryEmbedding, topK }),
  delete: (projectPath: string, pageId: string) =>
    apiCall<void>("/vector/delete", { projectPath, pageId }),
  count: (projectPath: string) =>
    apiCall<number>("/vector/count", { projectPath }),
  upsertChunks: (projectPath: string, pageId: string, chunks: Array<{ chunkIndex: number; chunkText: string; headingPath: string; embedding: number[] }>) =>
    apiCall<void>("/vector/upsert-chunks", { projectPath, pageId, chunks }),
  searchChunks: (projectPath: string, queryEmbedding: number[], topK: number) =>
    apiCall<Array<{ chunkId: string; pageId: string; chunkIndex: number; chunkText: string; headingPath: string; score: number }>>("/vector/search-chunks", { projectPath, queryEmbedding, topK }),
  deletePage: (projectPath: string, pageId: string) =>
    apiCall<void>("/vector/delete-page", { projectPath, pageId }),
  countChunks: (projectPath: string) =>
    apiCall<number>("/vector/count-chunks", { projectPath }),
  legacyRowCount: (projectPath: string) =>
    apiCall<number>("/vector/legacy-row-count", { projectPath }),
  dropLegacy: (projectPath: string) =>
    apiCall<void>("/vector/drop-legacy", { projectPath }),
}

// ============ Project ============

export const httpProject = {
  create: (name: string, path: string) =>
    apiCall<{ name: string; path: string }>("/project/create", { name, path }),
  open: (path: string) =>
    apiCall<{ name: string; path: string }>("/project/open", { path }),
  openFolder: (path: string) =>
    apiCall<void>("/project/open-folder", { path }),
  openFileLocation: (path: string) =>
    apiCall<void>("/project/open-file-location", { path }),
}

// ============ Backup ============

export const httpBackup = {
  export: (params: unknown) =>
    apiCall<unknown>("/backup/export", { params }),
  import: (params: unknown) =>
    apiCall<unknown>("/backup/import", { params }),
}

// ============ Extract ============

export const httpExtract = {
  pdfImages: (path: string) =>
    apiCall<unknown[]>("/extract/pdf-images", { path }),
  officeImages: (path: string) =>
    apiCall<unknown[]>("/extract/office-images", { path }),
  savePdfImages: (sourcePath: string, destDir: string, relTo: string) =>
    apiCall<unknown[]>("/extract/save-pdf-images", { sourcePath, destDir, relTo }),
  saveOfficeImages: (sourcePath: string, destDir: string, relTo: string) =>
    apiCall<unknown[]>("/extract/save-office-images", { sourcePath, destDir, relTo }),
}

// ============ CLI ============

export const httpCli = {
  claudeDetect: () =>
    apiCall<{ installed: boolean; path?: string }>("/cli/claude-detect", {}),
  claudeSpawn: (streamId: string, model: string, messages: unknown[], isolateLocalConfig: boolean) =>
    apiCall<void>("/cli/claude-spawn", { streamId, model, messages, isolateLocalConfig }),
  claudeKill: (streamId: string) =>
    apiCall<void>("/cli/claude-kill", { streamId }),
  codexDetect: () =>
    apiCall<{ installed: boolean; path?: string }>("/cli/codex-detect", {}),
  codexSpawn: (streamId: string, model: string, prompt: string, isolateLocalConfig: boolean, timeoutMinutes?: number) =>
    apiCall<void>("/cli/codex-spawn", { streamId, model, prompt, isolateLocalConfig, timeoutMinutes }),
  codexKill: (streamId: string) =>
    apiCall<void>("/cli/codex-kill", { streamId }),
}

// ============ File Sync ============

export const httpSync = {
  start: (projectId: string, projectPath: string, sourceWatchConfig?: unknown) =>
    apiCall<unknown>("/sync/start", { projectId, projectPath, sourceWatchConfig }),
  stop: () =>
    apiCall<void>("/sync/stop", {}),
  rescan: (projectId: string, projectPath: string, sourceWatchConfig?: unknown) =>
    apiCall<unknown>("/sync/rescan", { projectId, projectPath, sourceWatchConfig }),
  queue: (projectPath: string) =>
    apiCall<unknown>("/sync/queue", { projectPath }),
  retry: (projectId: string, projectPath: string, taskId: string) =>
    apiCall<unknown>("/sync/retry", { projectId, projectPath, taskId }),
  ignore: (projectId: string, projectPath: string, taskId: string) =>
    apiCall<unknown>("/sync/ignore", { projectId, projectPath, taskId }),
}

// ============ Clip Server ============

export const httpClip = {
  status: () => apiCall<string>("/clip/status", undefined, "GET"),
  getConfig: () => apiCall<unknown>("/clip/config", undefined, "GET"),
  setConfig: (config: unknown) => apiCall<unknown>("/clip/config", { config }),
  stop: () => apiCall<unknown>("/clip/stop", {}),
}

// ============ Proxy ============

export const httpProxy = {
  set: (config: unknown) => apiCall<string>("/proxy/set", { config }),
}
