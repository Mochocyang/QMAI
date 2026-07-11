import { describe, expect, it, vi } from "vitest"
import { createConversationRunRegistry } from "./conversation-run-registry"

function controllerWithAbortSpy(): AbortController {
  const controller = new AbortController()
  vi.spyOn(controller, "abort")
  return controller
}

describe("conversation run registry", () => {
  it("aborts only the requested conversation", () => {
    const registry = createConversationRunRegistry()
    const aController = controllerWithAbortSpy()
    const bController = controllerWithAbortSpy()
    registry.register("a", aController)
    registry.register("b", bController)

    expect(registry.abort("a")).toBe(true)
    expect(aController.abort).toHaveBeenCalledOnce()
    expect(bController.abort).not.toHaveBeenCalled()
  })

  it("keeps a controller registered synchronously while replacing the old controller", () => {
    const registry = createConversationRunRegistry()
    const oldController = controllerWithAbortSpy()
    const replacementController = controllerWithAbortSpy()
    const listenerController = controllerWithAbortSpy()
    oldController.signal.addEventListener("abort", () => {
      registry.register("a", listenerController)
    })
    registry.register("a", oldController)

    registry.register("a", replacementController)

    expect(oldController.abort).toHaveBeenCalledOnce()
    expect(registry.get("a")).toBe(listenerController)
  })

  it("keeps a controller registered synchronously by an abort listener", () => {
    const registry = createConversationRunRegistry()
    const oldController = controllerWithAbortSpy()
    const nextController = controllerWithAbortSpy()
    oldController.signal.addEventListener("abort", () => {
      registry.register("a", nextController)
    })
    registry.register("a", oldController)

    expect(registry.abort("a")).toBe(true)
    expect(registry.get("a")).toBe(nextController)
  })

  it("does not let stale cleanup remove the replacement controller", () => {
    const registry = createConversationRunRegistry()
    const oldController = controllerWithAbortSpy()
    const nextController = controllerWithAbortSpy()
    registry.register("a", oldController)
    registry.register("a", nextController)

    registry.remove("a", oldController)

    expect(registry.get("a")).toBe(nextController)
  })
})
