import { useEffect, useState } from "react"
import { Archive, LogIn } from "lucide-react"

import { useAccountStore } from "@/stores/account-store"

/**
 * 「账号模型已备份」提示条。
 *
 * 场景：退出登录（或登录态过期）后，属于账号的模型从「我的模型设置」
 * 列表里消失了。它们没有丢 —— 已加密备份在本机，登录原账号即恢复。
 * 若界面什么都不说，用户第一反应是「软件把我的模型删了」，
 * 这正是最初那条投诉的来源。
 *
 * 文案（用户给的句子主语混乱——备份的是模型而不是账号，
 * 「登录已同步的账号」定语也别扭，改成主语动作都对得上的表述）：
 *   「账号的 N 个模型已在本机加密备份，登录该账号后即可恢复显示。」
 *
 * 显示条件严格限定为「未登录 且 计数 > 0」：
 * · 已登录时列表本来就显示着账号模型，这句话只会添乱；
 * · 计数为 0（从没同步过的全新用户）也不显示——否则像吓唬人。
 *
 * 计数要真解一遍密才能得出（条目名在密文里，明文存数量等于泄露
 * 「这个账号配过哪些模型」）。这个代价可以接受：只在未登录时查一次，
 * 不轮询、不渲染列表时才触发。
 */
export function ModelArchiveNotice() {
  const status = useAccountStore((state) => state.status)
  const openDialog = useAccountStore((state) => state.openDialog)
  const [hiddenCount, setHiddenCount] = useState(0)

  useEffect(() => {
    if (status !== "anonymous") {
      setHiddenCount(0)
      return
    }
    let cancelled = false
    void import("@/lib/model-sync/account-hook")
      .then(({ countHiddenModelsForNotice }) => countHiddenModelsForNotice())
      .then((count) => {
        if (!cancelled) setHiddenCount(count)
      })
      .catch(() => {
        // 环境不支持安全仓库 / 备份损坏：没有可展示的备份，安静隐身。
        if (!cancelled) setHiddenCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [status])

  if (status !== "anonymous" || hiddenCount === 0) return null

  return (
    <div
      className="model-archive-notice"
      data-ui="model-archive-notice"
      role="status"
    >
      <Archive className="model-archive-notice-icon" aria-hidden="true" />
      <span className="model-archive-notice-text">
        账号的 {hiddenCount} 个模型已在本机加密备份，登录该账号后即可恢复显示。
        <button
          type="button"
          className="model-archive-notice-login"
          onClick={() => openDialog("login")}
          data-ui="model-archive-login"
        >
          <LogIn className="h-3.5 w-3.5" aria-hidden="true" />
          立即登录
        </button>
      </span>
    </div>
  )
}
