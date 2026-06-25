type ServerEventHandler = (event: { type: string; payload: unknown }) => void

class ServerEventManager {
  private es: EventSource | null = null
  private handlers: Map<string, Set<ServerEventHandler>> = new Map()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect() {
    if (this.es) return
    if (typeof window === "undefined" || typeof EventSource === "undefined") return

    const url = `http://${window.location.hostname}:5800/api/events`
    this.es = new EventSource(url)

    this.es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data)
        const type: string = event.type
        const payload = event.payload
        const handlers = this.handlers.get(type)
        if (handlers) {
          handlers.forEach((h) => h({ type, payload }))
        }
      } catch {
        // Ignore malformed messages
      }
    }

    this.es.onerror = () => {
      // Auto-reconnect after 3 seconds
      this.disconnect()
      this.reconnectTimer = setTimeout(() => {
        this.connect()
      }, 3000)
    }
  }

  disconnect() {
    this.es?.close()
    this.es = null
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  on(eventType: string, handler: ServerEventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set())
    }
    this.handlers.get(eventType)!.add(handler)
    return () => {
      this.handlers.get(eventType)?.delete(handler)
    }
  }

  off(eventType: string, handler: ServerEventHandler) {
    this.handlers.get(eventType)?.delete(handler)
  }
}

export const serverEvents = new ServerEventManager()
