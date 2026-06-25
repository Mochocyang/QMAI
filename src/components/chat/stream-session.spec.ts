import { describe, expect, it, vi } from "vitest"
import { createStreamSessionGuard } from "./stream-session"

describe("createStreamSessionGuard", () => {
  it("finalizes immediately on stop and ignores late stream callbacks", () => {
    const guard = createStreamSessionGuard()
    const conversationId = "conv-1"
    const sessionId = guard.start(conversationId)
    const finalize = vi.fn()

    guard.stop(conversationId, sessionId, () => finalize("已停止生成。"))
    guard.runIfActive(conversationId, sessionId, () => finalize("迟到的模型输出"))

    expect(finalize).toHaveBeenCalledTimes(1)
    expect(finalize).toHaveBeenCalledWith("已停止生成。")
  })
})
