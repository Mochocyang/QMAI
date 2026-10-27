import type { ToolParameter } from "@/lib/agent/types"

/** 后端 plugins_list 返回的一项（任务 10 的命令层会填充真实数据） */
export interface PluginSummary {
  id: string
  name: string
  version: string
  description: string
  enabled: boolean
  processState: "stopped" | "starting" | "running" | "failed" | "crashed" | "disabled_by_crash"
  grantedPermissions: string[]
  toolCount: number
  sourceRepo: string
  sourceCommit: string
}

/** 一次工具注入要用到的描述符（来自插件运行期 tools/list） */
export interface PluginToolDescriptor {
  pluginId: string
  name: string
  description: string
  parameters: Record<string, ToolParameter>
}

/** 调用插件工具：返回文本结果 */
export type PluginToolInvoker = (
  pluginId: string,
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>
