export interface StreamSessionGuard {
  /** 为指定会话创建一个新的流式会话，返回 sessionId */
  start: (conversationId: string) => number
  /** 检查指定会话的 sessionId 是否仍然活跃 */
  isActive: (conversationId: string, sessionId: number) => boolean
  /** 如果仍然活跃则执行回调 */
  runIfActive: (conversationId: string, sessionId: number, callback: () => void) => void
  /** 结束指定会话的流式会话，如果 sessionId 仍活跃则执行回调 */
  finish: (conversationId: string, sessionId: number, callback: () => void) => void
  /** 停止指定会话的流式会话（同 finish） */
  stop: (conversationId: string, sessionId: number, callback: () => void) => void
}

/**
 * 创建按会话独立的流式会话守卫。
 * 每个会话有自己的 sessionId 计数器，互不干扰。
 * A 会话的 start() 不会使 B 会话的 sessionId 失效。
 */
export function createStreamSessionGuard(): StreamSessionGuard {
  // 每个会话独立的 sessionId 计数器
  const sessionCounters: Record<string, number> = {}

  const getCounter = (conversationId: string) => sessionCounters[conversationId] ?? 0

  const isActive = (conversationId: string, sessionId: number) =>
    sessionId === getCounter(conversationId)

  const finish = (conversationId: string, sessionId: number, callback: () => void) => {
    if (!isActive(conversationId, sessionId)) return
    callback()
    sessionCounters[conversationId] = (sessionCounters[conversationId] ?? 0) + 1
  }

  return {
    start: (conversationId) => {
      sessionCounters[conversationId] = (sessionCounters[conversationId] ?? 0) + 1
      return sessionCounters[conversationId]
    },
    isActive,
    runIfActive: (conversationId, sessionId, callback) => {
      if (isActive(conversationId, sessionId)) callback()
    },
    finish,
    stop: finish,
  }
}
