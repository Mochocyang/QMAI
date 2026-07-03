import { describe, expect, it, vi } from "vitest"
import { JsonRpcClient, type StdioTransport } from "./json-rpc"

function createTransport(lines: Array<string | null>) {
  const sent: string[] = []
  const transport: StdioTransport = {
    send: vi.fn(async (data: string) => {
      sent.push(data)
    }),
    receive: vi.fn(async () => lines.shift() ?? null),
    close: vi.fn(async () => {}),
  }
  return { transport, sent }
}

describe("JsonRpcClient", () => {
  it("call 方法发送正确格式的 request", async () => {
    const { transport, sent } = createTransport([
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    ])
    const client = new JsonRpcClient(transport)

    await client.call("initialize", { client: "qmai" })

    expect(JSON.parse(sent[0])).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { client: "qmai" },
    })
  })

  it("收到 response 时解析 result", async () => {
    const { transport } = createTransport([
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
    ])
    const client = new JsonRpcClient(transport)

    await expect(client.call("tools/list")).resolves.toEqual({ tools: [] })
  })

  it("收到 error 时抛出中文错误", async () => {
    const { transport } = createTransport([
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "工具失败" } }),
    ])
    const client = new JsonRpcClient(transport)

    await expect(client.call("tools/call")).rejects.toThrow("工具失败")
  })
})
