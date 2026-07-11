export function createConversationRunRegistry() {
  const controllers = new Map<string, AbortController>()

  return {
    register(id: string, controller: AbortController) {
      const previousController = controllers.get(id)
      controllers.set(id, controller)
      if (previousController && previousController !== controller) previousController.abort()
    },
    get: (id: string) => controllers.get(id),
    has: (id: string) => controllers.has(id),
    abort(id: string) {
      const controller = controllers.get(id)
      if (!controller) return false
      if (controllers.get(id) === controller) controllers.delete(id)
      controller.abort()
      return true
    },
    remove(id: string, controller: AbortController) {
      if (controllers.get(id) === controller) controllers.delete(id)
    },
  }
}

export const chatConversationRunRegistry = createConversationRunRegistry()
export const outlineConversationRunRegistry = createConversationRunRegistry()
