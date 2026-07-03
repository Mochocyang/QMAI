import type { McpToolDescriptor } from "./types"
import type { McpJsonSchema, McpToolOperation } from "./types"

export interface McpServerConfig {
  id: string
  name: string
  enabled: boolean
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  tools: McpToolDescriptor[]
}

export interface McpConfig {
  servers: McpServerConfig[]
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
  servers: [],
}

const MCP_OPERATIONS: McpToolOperation[] = ["read", "analysis", "suggestion", "write", "delete", "overwrite"]

export function normalizeMcpConfig(input?: unknown): McpConfig {
  if (!isRecord(input) || !Array.isArray(input.servers)) return DEFAULT_MCP_CONFIG
  return {
    servers: input.servers
      .map((server) => normalizeMcpServerConfig(server))
      .filter((server): server is McpServerConfig => Boolean(server)),
  }
}

export function normalizeMcpServerConfig(input: unknown): McpServerConfig | null {
  if (!isRecord(input)) return null
  const id = readTrimmedString(input.id)
  const name = readTrimmedString(input.name)
  if (!id || !name) return null

  const tools = Array.isArray(input.tools)
    ? input.tools
      .map((tool) => normalizeMcpToolDescriptor(tool, id, name))
      .filter((tool): tool is McpToolDescriptor => Boolean(tool))
    : []

  return {
    id,
    name,
    enabled: input.enabled !== false,
    command: readOptionalTrimmedString(input.command),
    args: readStringArray(input.args),
    cwd: readOptionalTrimmedString(input.cwd),
    env: readStringRecord(input.env),
    tools,
  }
}

export function createSampleGraphMcpServer(): McpServerConfig {
  return {
    id: "graph",
    name: "Knowledge Graph",
    enabled: true,
    tools: [
      {
        serverId: "graph",
        serverName: "Knowledge Graph",
        name: "query_graph",
        description: "Query relationship and setting facts from a graph MCP service.",
        operation: "read",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        serverId: "graph",
        serverName: "Knowledge Graph",
        name: "analyze_relation",
        description: "Analyze character or plot relationships from graph context.",
        operation: "analysis",
        inputSchema: {
          type: "object",
          properties: {
            subject: { type: "string", description: "Subject to analyze" },
            target: { type: "string", description: "Optional target" },
          },
          required: ["subject"],
        },
      },
    ],
  }
}

function normalizeMcpToolDescriptor(input: unknown, serverId: string, serverName: string): McpToolDescriptor | null {
  if (!isRecord(input)) return null
  const name = readTrimmedString(input.name)
  const description = readTrimmedString(input.description)
  const operation = readOperation(input.operation)
  const inputSchema = normalizeMcpJsonSchema(input.inputSchema)
  if (!name || !description || !operation || !inputSchema) return null

  return {
    serverId: readTrimmedString(input.serverId) || serverId,
    serverName: readTrimmedString(input.serverName) || serverName,
    name,
    description,
    operation,
    inputSchema,
  }
}

function normalizeMcpJsonSchema(input: unknown): McpJsonSchema | null {
  if (!isRecord(input) || input.type !== "object") return null
  return {
    type: "object",
    properties: isRecord(input.properties) ? input.properties as McpJsonSchema["properties"] : undefined,
    required: Array.isArray(input.required)
      ? input.required.filter((item): item is string => typeof item === "string")
      : undefined,
  }
}

function readOperation(input: unknown): McpToolOperation | null {
  return MCP_OPERATIONS.includes(input as McpToolOperation) ? input as McpToolOperation : null
}

function readTrimmedString(input: unknown): string {
  return typeof input === "string" ? input.trim() : ""
}

function readOptionalTrimmedString(input: unknown): string | undefined {
  const value = readTrimmedString(input)
  return value || undefined
}

function readStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined
  const values = input.filter((item): item is string => typeof item === "string")
  return values.length > 0 ? values : undefined
}

function readStringRecord(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined
  const entries = Object.entries(input)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null
}
