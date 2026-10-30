import { invoke } from "@tauri-apps/api/core"

import type { UpdateChannelPlanItem } from "@/lib/updater-channel"

/**
 * 用选出来的通道把更新包下载到内存里；拿不到就返回 `null`。
 *
 * 为什么失败一律返回 `null` 而不是抛错：这条路径是"加速"，不是"唯一手段"。
 * 调用方（`runAppUpdateFlow`）拿到 `null` 会退回插件自己的 `update.download()`，
 * 那才是真正保证更新能装上的那条路。在这里抛错等于因为加速通道抽风
 * 让本来能成功的更新彻底失败 —— 恰好和最开始的抱怨相反。
 *
 * 为什么前缀来自 `plan.manifestPrefix` 而不是前端自己按 `channelId` 判断：
 * 改写规则（identity / prefix / jsdelivr）只该存在一份，就在 Rust 的
 * `map_release_url` 里。前端多写一遍，两处迟早漂移，而且漂移只表现为
 * "某个通道静默 404"——最难查的那种。
 * 签名上的 `T extends { url: string }` 只是为了让调用方传 `Update` 之类的对象
 * 时获得更贴切的类型提示；这里只用得到 `url` 字符串本身，所以用 `_T` 标明
 * 「刻意不读」。泛型不能删：删掉后调用方得先自己的类型再传字符串，
 * 每个调用点都要多写一行解包 —— 那是为了满足检查而写的噪声。
 */
export async function downloadViaChannel<_T extends { url: string }>(
  plan: UpdateChannelPlanItem | null,
  url: string,
): Promise<Uint8Array | null> {
  // 没有计划、或计划里没有前缀（jsDelivr 不支持 release 资产）→ 让调用方退回插件。
  // 注意空前缀 `""` 是合法的"直连"，必须与 null 区分开。
  const prefix = plan?.manifestPrefix
  if (typeof prefix !== "string") return null
  // 原始地址为空时拼出来的前缀地址毫无意义，直接降级。
  if (!url) return null

  try {
    const bytes = await invoke<number[]>("updater_download_bytes", { url: `${prefix}${url}` })
    if (!Array.isArray(bytes) || bytes.length === 0) return null
    return Uint8Array.from(bytes)
  } catch (error) {
    // 白名单拒绝、网络失败、超时都走这里：静默降级，只留一条日志便于排障。
    console.warn("[updater] 通道下载失败，退回插件下载：", error)
    return null
  }
}
