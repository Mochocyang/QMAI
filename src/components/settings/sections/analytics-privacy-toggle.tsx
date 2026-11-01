import { useEffect, useState } from "react"

import { Switch } from "@/components/ui/switch"
import { isAnalyticsEnabled, setAnalyticsEnabled } from "@/lib/analytics"

/**
 * 「使用统计上报」开关。
 *
 * 存在的唯一理由：隐私政策对用户承诺了「你可以在设置中关闭使用统计上报」。
 * 只要条款写了这句话，产品就必须真有一个能关的开关 —— 否则又是一句
 * 兑现不了的承诺（与当初「条款说可注销、代码里没有注销接口」同一类问题）。
 *
 * 关闭后 `initAnalytics` 会直接返回：不发 /open、不装心跳、不发 /close，
 * 也就是说关掉之后一个请求都不会再发出。
 */
export function AnalyticsPrivacyToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void isAnalyticsEnabled().then((value) => {
      if (!cancelled) setEnabled(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(next: boolean) {
    setSaving(true)
    // 乐观更新：开关必须立刻响应，否则用户会以为没点上。
    setEnabled(next)
    try {
      await setAnalyticsEnabled(next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 rounded-lg border p-3" data-ui="analytics-privacy-toggle">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">上报使用统计</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            仅上报随机的设备标识、软件版本与系统平台，<strong>不与你的账号关联</strong>，也不包含任何写作内容。
            关闭后不会再发出任何统计请求。
          </p>
        </div>
        <Switch
          checked={enabled ?? true}
          disabled={enabled === null || saving}
          onChange={(next) => void toggle(next)}
          label="上报使用统计"
        />
      </div>
    </div>
  )
}
