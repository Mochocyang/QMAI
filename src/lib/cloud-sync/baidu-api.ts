/**
 * 百度网盘开放平台文件接口封装（xpan）。
 *
 * 全部走注入的 fetch（生产为 @tauri-apps/plugin-http，绕过 WebView CORS）。
 * 第三方应用只能在用户网盘的 /apps/<应用名>/ 目录下读写，这是平台限制。
 */

import type { FetchLike } from "./baidu-oauth"

export const BAIDU_API_BASE = "https://pan.baidu.com"
export const BAIDU_DOWNLOAD_BASE = "https://d.pcs.baidu.com"

/** xpan 常见 errno 的可读解释（缺省给原文）。 */
const ERRNO_HINTS: Record<number, string> = {
  [-6]: "登录状态已失效（access_token 无效或过期），请重新授权",
  2: "文件或目录不存在",
  12: "文件或目录已存在",
  111: "access_token 已失效，请重新授权",
  31034: "已达到接口调用频率上限，请稍后再试",
}

function withAccessToken(url: URL, accessToken: string): URL {
  url.searchParams.set("access_token", accessToken)
  return url
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 统一把 xpan 的 {errno, errmsg} / OAuth 的 {error} 转成可读中文异常。 */
async function readError(response: { status: number; json(): Promise<unknown> }): Promise<never> {
  let payload: Record<string, unknown> = {}
  try {
    payload = (await response.json()) as Record<string, unknown>
  } catch {
    // body 不是 JSON 时按 HTTP 状态处理
  }
  const errno = typeof payload.errno === "number" ? payload.errno : undefined
  if (errno !== undefined) {
    const hint = ERRNO_HINTS[errno]
    const errmsg = typeof payload.errmsg === "string" ? `（${payload.errmsg}）` : ""
    throw new Error(`百度网盘接口错误 errno=${errno}${errmsg}${hint ? `：${hint}` : ""}`)
  }
  const oauthError = typeof payload.error === "string" ? payload.error : ""
  throw new Error(
    `百度网盘接口错误 HTTP ${response.status}${oauthError ? `：${oauthError}` : ""}`,
  )
}

async function requestJson<T>(
  fetchFn: FetchLike,
  url: string,
  init?: Parameters<FetchLike>[1],
  tolerateErrno: number[] = [],
): Promise<T> {
  const response = await fetchFn(url, {
    headers: { "User-Agent": "QMaiWrite-CloudSync/1.0", ...(init?.headers ?? {}) },
    ...init,
  })
  if (!response.ok) {
    await readError(response)
  }
  const payload = (await response.json()) as T & { errno?: number }
  if (typeof payload.errno === "number" && payload.errno !== 0 && !tolerateErrno.includes(payload.errno)) {
    const hint = ERRNO_HINTS[payload.errno]
    throw new Error(
      `百度网盘接口错误 errno=${payload.errno}${hint ? `：${hint}` : ""}`,
    )
  }
  return payload
}

function formBody(params: Record<string, string>): string {
  return new URLSearchParams(params).toString()
}

export interface BaiduQuota {
  totalBytes: number
  usedBytes: number
}

/** 查询网盘容量：GET /api/quota。 */
export async function baiduQuota(fetchFn: FetchLike, accessToken: string): Promise<BaiduQuota> {
  const url = withAccessToken(
    new URL(`${BAIDU_API_BASE}/api/quota?checkfree=1&checkexpire=1`),
    accessToken,
  )
  const payload = await requestJson<{ total?: number; used?: number }>(fetchFn, url.toString())
  return { totalBytes: payload.total ?? 0, usedBytes: payload.used ?? 0 }
}

export interface BaiduUserInfo {
  baiduName: string
}

/** 查询授权账号昵称：GET /rest/2.0/xpan/nas?method=uinfo。 */
export async function baiduUserInfo(fetchFn: FetchLike, accessToken: string): Promise<BaiduUserInfo> {
  const url = withAccessToken(new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/nas?method=uinfo`), accessToken)
  const payload = await requestJson<{ baidu_name?: string; netdisk_name?: string }>(
    fetchFn,
    url.toString(),
  )
  return { baiduName: payload.baidu_name ?? payload.netdisk_name ?? "百度网盘用户" }
}

export interface BaiduListEntry {
  path: string
  serverFilename: string
  size: number
  isDir: boolean
  fsId: number
}

/** 列出目录：GET /rest/2.0/xpan/file?method=list。 */
export async function baiduList(
  fetchFn: FetchLike,
  accessToken: string,
  dir: string,
  limit = 100,
): Promise<BaiduListEntry[]> {
  const url = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=list&web=1&limit=${limit}`),
    accessToken,
  )
  url.searchParams.set("dir", dir)
  const payload = await requestJson<{ list?: Array<Record<string, unknown>> }>(fetchFn, url.toString())
  return (payload.list ?? []).map((entry) => ({
    path: String(entry.path ?? ""),
    serverFilename: String(entry.server_filename ?? ""),
    size: Number(entry.size ?? 0),
    isDir: Number(entry.isdir ?? 0) === 1,
    fsId: Number(entry.fs_id ?? 0),
  }))
}

/** 新建目录（已存在视作成功）：POST /rest/2.0/xpan/file?method=filemanager&opera=add。 */
export async function baiduCreateDir(
  fetchFn: FetchLike,
  accessToken: string,
  path: string,
): Promise<void> {
  const url = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=filemanager&opera=add`),
    accessToken,
  )
  // errno=12 = 目录已存在，视作成功
  await requestJson(fetchFn, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ path: JSON.stringify([path]), async: "0" }),
  }, [12])
}

/** 删除文件/目录：POST /rest/2.0/xpan/file?method=filemanager&opera=delete。 */
export async function baiduDeletePath(
  fetchFn: FetchLike,
  accessToken: string,
  path: string,
): Promise<void> {
  const url = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=filemanager&opera=delete`),
    accessToken,
  )
  await requestJson(fetchFn, url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({ filelist: JSON.stringify([path]) }),
  })
}

export interface BaiduUploadResult {
  fsId: number
  /** true = 命中秒传（return_type=2），未实际上传内容。 */
  instant: boolean
}

/**
 * 小文件（≤4MB，单分片）上传：precreate → superfile2 → create。
 * 命中秒传（return_type=2）时跳过内容上传。
 */
export async function baiduUploadSmallFile(
  fetchFn: FetchLike,
  accessToken: string,
  path: string,
  data: Uint8Array,
  md5Hex: string,
): Promise<BaiduUploadResult> {
  const size = data.byteLength
  const precreateUrl = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=precreate`),
    accessToken,
  )
  const precreate = await requestJson<{
    return_type?: number
    uploadid?: string
    block_list?: string[]
  }>(fetchFn, precreateUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      path,
      size: String(size),
      isdir: "0",
      autoinit: "1",
      block_list: JSON.stringify([md5Hex]),
    }),
  })
  const uploadId = precreate.uploadid ?? ""
  if (precreate.return_type === 2) {
    return finishCreate(fetchFn, accessToken, path, size, md5Hex, uploadId, true)
  }
  const uploadUrl = withAccessToken(
    new URL(
      `${BAIDU_DOWNLOAD_BASE}/rest/2.0/pcs/superfile2?method=upload&type=object&partseq=0`,
    ),
    accessToken,
  )
  uploadUrl.searchParams.set("uploadid", uploadId)
  uploadUrl.searchParams.set("path", path)
  await requestJson<{ md5?: string }>(fetchFn, uploadUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  })
  return finishCreate(fetchFn, accessToken, path, size, md5Hex, uploadId, false)
}

async function finishCreate(
  fetchFn: FetchLike,
  accessToken: string,
  path: string,
  size: number,
  md5Hex: string,
  uploadId: string,
  instant: boolean,
): Promise<BaiduUploadResult> {
  const createUrl = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=create`),
    accessToken,
  )
  const created = await requestJson<{ fs_id?: number }>(fetchFn, createUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      path,
      size: String(size),
      isdir: "0",
      uploadid: uploadId,
      block_list: JSON.stringify([md5Hex]),
    }),
  })
  return { fsId: created.fs_id ?? 0, instant }
}

export interface BaiduFileMeta {
  fsId: number
  path: string
  size: number
  dlink?: string
}

/** 查询文件元信息（含下载直链）：GET /rest/2.0/xpan/file?method=filemetas&dlink=1。 */
export async function baiduFileMeta(
  fetchFn: FetchLike,
  accessToken: string,
  fsId: number,
): Promise<BaiduFileMeta> {
  const url = withAccessToken(
    new URL(`${BAIDU_API_BASE}/rest/2.0/xpan/file?method=filemetas&dlink=1`),
    accessToken,
  )
  url.searchParams.set("fsids", JSON.stringify([fsId]))
  const payload = await requestJson<{ list?: Array<Record<string, unknown>> }>(
    fetchFn,
    url.toString(),
  )
  const entry = payload.list?.[0]
  if (!entry) {
    throw new Error("百度网盘接口错误：文件元信息为空（fs_id 可能已失效）")
  }
  return {
    fsId: Number(entry.fs_id ?? fsId),
    path: String(entry.path ?? ""),
    size: Number(entry.size ?? 0),
    dlink: typeof entry.dlink === "string" ? entry.dlink : undefined,
  }
}

/** 读取小文本文件内容：filemetas 拿 dlink → 下载。 */
export async function baiduDownloadText(
  fetchFn: FetchLike,
  accessToken: string,
  fsId: number,
): Promise<string> {
  const meta = await baiduFileMeta(fetchFn, accessToken, fsId)
  if (!meta.dlink) {
    throw new Error("百度网盘接口错误：未返回下载直链")
  }
  const link = meta.dlink.includes("access_token=")
    ? meta.dlink
    : `${meta.dlink}${meta.dlink.includes("?") ? "&" : "?"}access_token=${accessToken}`
  const response = await fetchFn(link, {
    method: "GET",
    headers: { "User-Agent": "QMaiWrite-CloudSync/1.0" },
  })
  if (!response.ok) {
    throw new Error(`下载文件失败 HTTP ${response.status}`)
  }
  return response.text()
}

/** 上传前的内容字节数工具（分片阈值判断用）。 */
export function byteLengthOf(text: string): number {
  return utf8Length(text)
}
