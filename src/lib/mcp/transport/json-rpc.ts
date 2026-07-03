export interface StdioTransport {
  send(data: string): Promise<void>
  receive(timeoutMs?: number): Promise<string | null>
  close(): Promise<void>
}

interface JsonRpcSuccess<T> {
  jsonrpc: "2.0"
  id: number
  result: T
}

interface JsonRpcFailure {
  jsonrpc: "2.0"
  id: number
  error: {
    code?: number
    message?: string
    data?: unknown
  }
}

type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure

export class JsonRpcClient {
  private nextId = 1

  constructor(private readonly transport: StdioTransport) {}

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<T> {
    const id = this.nextId++
    const request = params === undefined
      ? { jsonrpc: "2.0", id, method }
      : { jsonrpc: "2.0", id, method, params }

    await this.transport.send(JSON.stringify(request))

    const line = await this.transport.receive(timeoutMs)
    if (!line) {
      throw new Error(`MCP 调用超时：${method}`)
    }

    let response: JsonRpcResponse<T>
    try {
      response = JSON.parse(line) as JsonRpcResponse<T>
    } catch {
      throw new Error(`MCP 返回格式无法解析：${method}`)
    }

    if (response.id !== id) {
      throw new Error(`MCP 返回 ID 不匹配：${method}`)
    }

    if ("error" in response) {
      throw new Error(response.error.message || `MCP 调用失败：${method}`)
    }

    return response.result
  }

  async close(): Promise<void> {
    await this.transport.close()
  }
}
