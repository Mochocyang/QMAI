import { useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { submitFeedback, type FeedbackType } from "@/lib/feedback"

export function FeedbackSection() {
  const [type, setType] = useState<FeedbackType>("suggestion")
  const [message, setMessage] = useState("")
  const [contact, setContact] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState("")

  const canSubmit = message.trim().length > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setStatus("")
    try {
      await submitFeedback({ type, message, contact })
      setMessage("")
      setContact("")
      setStatus("反馈已提交，谢谢。")
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setStatus(text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">反馈与建议</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          反馈会发送到青幕 AI 写作的 Cloudflare D1 后台，用于排查问题和改进体验。
        </p>
      </div>

      <div className="space-y-4 rounded-md border border-border p-4">
        <div className="space-y-2">
          <Label htmlFor="feedback-type">反馈类型</Label>
          <select
            id="feedback-type"
            value={type}
            onChange={(event) => setType(event.target.value as FeedbackType)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
          >
            <option value="suggestion">功能建议</option>
            <option value="bug">问题反馈</option>
            <option value="other">其他</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-message">反馈内容</Label>
          <Textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={3000}
            rows={7}
            placeholder="请尽量描述你遇到的问题、期望的效果，或者建议的使用场景。"
          />
          <p className="text-xs text-muted-foreground">
            请勿提交 API Key、项目原文或隐私信息。
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feedback-contact">联系方式（选填）</Label>
          <Input
            id="feedback-contact"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            maxLength={200}
            placeholder="邮箱、微信或其他联系方式"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className={`text-sm ${status.includes("失败") || status.includes("请输入") ? "text-destructive" : "text-muted-foreground"}`}>
            {status}
          </p>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit} className="gap-2">
            <Send className="h-4 w-4" />
            {submitting ? "提交中..." : "提交反馈"}
          </Button>
        </div>
      </div>
    </div>
  )
}
