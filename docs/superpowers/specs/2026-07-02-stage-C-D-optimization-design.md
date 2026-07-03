# AI 会话 Stage C-G 优化设计文档

> **状态**：已通过 brainstorming 三部分逐节认可，待 spec 自审与用户审查
> **分支**：`gongjudiaoyongyouhua`
> **日期**：2026-07-02

## 1. 背景与目标

Stage C-D 已接入完成（章节计划确认交互流程 + 写后剧情自检），但在接入过程中暴露出若干隐性 bug 和未完成阶段：

- **隐性 bug**：`aiWorkflowMode` 在 chat-panel 中用局部 `useState` 持有且永远写入 `"standard"`，导致"快速模式跳过 Stage C"分支运行时不可达；Promise resolver 在组件卸载时无清理，存在 stale callback 与内存泄漏风险。
- **Stage D 检查过弱**：当前 `runPostWriteCheck` 是纯规则检查（字数、转折词、占位符），无法真正判断剧情质量。
- **Stage E 未完成**：classification-section 只有"创建/升级/检查"按钮，缺编辑入口。
- **Stage F 未完成**：task-breakpoint.ts 已实现但 runner 未调用，chat-panel 无恢复入口。
- **Stage G 未完成**：MCP 只有降级 caller，未接入真实 stdio 连接。
- **测试缺口**：chat-panel 无 mount 级测试，PrePlugin 链与 Stage C 对话框的端到端交互无验证。

本设计目标：在 `gongjudiaoyongyouhua` 分支上，以最小改动完成上述 bug 修复与 Stage D-G 收口，并补齐 mount 级测试基础设施。

## 2. 全局约束

- **语言**：所有面向用户的提示语、弹窗、确认信息、错误提示必须使用中文。
- **不破坏旧功能**：现有 PrePlugin 链、Stage C 对话框、ContextTrace 追踪、MCP 降级路径必须保持兼容。
- **分支隔离**：所有改动在 `gongjudiaoyongyouhua` 分支完成，不合并 main。
- **YAGNI**：不引入用户未要求的功能，不为假想场景做错误处理。
- **复用现有**：优先复用 `streamChat`、`resolveNovelModel`、`hasUsableLlm`、`writeFileAtomic`、`normalizePath` 等现有工具。
- **测试约束**：vite.config.ts 默认 `test.environment = "node"`，mount 级测试需用 docblock `// @vitest-environment jsdom` 单独切换。
- **打包要求**：每完成一个 Stage 需打包便携版供用户测试，版本号保持 2.2.31 不变（未提交 GitHub）。

---

## 3. Part 1：Bug 修复 + Stage D AI 推理

### 3.1 Bug 修复

#### 3.1.1 aiWorkflowMode 从 store 读取

**问题**：`src/components/chat/chat-panel.tsx` 第 478-479 行用局部 `useState` 持有 `aiWorkflowMode`，并通过 `void setAiWorkflowMode` 丢弃 setter，导致值永远为 `"standard"`，"快速模式跳过 Stage C"分支不可达。

**修复**：
- 移除 chat-panel 中的局部 `useState`，改为从 `wiki-store` 读取 `aiWorkflowMode` 和 `setAiWorkflowMode`。
- store 侧已有完整实现（`wiki-store.ts` 第 573 行类型声明、第 857 行初值、第 894-897 行 setter 联动 `deepChapterEnabled`），无需修改 store。
- chat-panel 中所有引用局部 `aiWorkflowMode` 的位置改为引用 store 的值。

**改动文件**：
- 修改：`src/components/chat/chat-panel.tsx`
- 修改：`src/components/chat/chat-panel.spec.tsx`（补充 store 读取断言）

#### 3.1.2 Promise resolver 卸载清理

**问题**：`soulDialogResolverRef` 和 `chapterPlanResolverRef` 在组件卸载时未清理，若用户在 pending 状态关闭会话或卸载组件，resolver 会泄漏并在后续触发 stale callback。

**修复**：
- 在 chat-panel 的 `useEffect` 卸载钩子中，调用所有 pending resolver 并以"已取消"语义 resolve（避免 promise 永远 pending），然后清空 ref。
- 不抽取新函数，仅在现有卸载 effect 中追加清理逻辑。

**改动文件**：
- 修改：`src/components/chat/chat-panel.tsx`

#### 3.1.3 SoulDialog 输入框一致性

**问题**：Stage C 对话框打开时已禁用 ReferenceInput，但 SoulDialog 的输入框未同步禁用，用户可能在 SoulDialog pending 期间发送消息。

**修复**：
- SoulDialog 输入框的 `disabled` 条件追加 `pendingChapterPlan.open`。
- 与 ReferenceInput 的禁用条件保持一致：`disabled={isStreaming || pendingChapterPlan.open}`。

**改动文件**：
- 修改：`src/components/chat/chat-panel.tsx`

### 3.2 Stage D 升级 AI 推理

#### 3.2.1 设计目标

将 Stage D 从纯规则检查升级为"AI 推理 + 规则降级兜底"：
- 优先调用 LLM 对章节正文做 7 维度并行评估，输出结构化 JSON。
- AI 调用失败（无模型、网络错误、解析失败、超时）时，降级到现有 `runPostWriteCheck` 规则检查。
- 不破坏现有 `runPostWriteCheck` 函数签名和返回结构。

#### 3.2.2 PostWriteCheckItem 字段扩展

在 `src/lib/agent/context-trace.ts` 中扩展 `PostWriteCheckItem`：

```typescript
export interface PostWriteCheckItem {
  name: string
  passed: boolean
  detail: string
  /** AI 模式下新增字段，规则模式下为 undefined */
  severity?: "info" | "warning" | "error"
  evidence?: string   // 原文证据片段
  suggestion?: string // 改进建议
}
```

`PostWriteCheck` 顶层结构不变（items/passedCount/totalCount/allPassed）。规则模式下新字段为 `undefined`，UI 侧需优雅降级显示。

#### 3.2.3 runPostWriteCheckAI 函数

新增 `src/lib/agent/plugins/post-write-check-ai.ts`：

```typescript
import type { PostWriteCheck, PostWriteCheckItem } from "../context-trace"
import type { ContextPack } from "@/lib/novel/context-engine"
import type { LlmConfig } from "@/lib/types"
import { streamChat } from "@/lib/llm-client"
import { resolveNovelModel } from "@/lib/novel/lint"
import { hasUsableLlm } from "@/lib/llm-utils"
import { runPostWriteCheck } from "./post-write-check-plugin"

export interface PostWriteCheckAIResult {
  check: PostWriteCheck
  source: "ai" | "rule"  // 实际使用的检查来源
  fallbackReason?: string // 降级原因（source=rule 时填）
}

export async function runPostWriteCheckAI(params: {
  chapterContent: string
  contextPack?: ContextPack
  llmConfig?: LlmConfig
  signal?: AbortSignal
}): Promise<PostWriteCheckAIResult>
```

**行为**：
1. 若 `!hasUsableLlm(llmConfig)` → 降级，`source: "rule"`，`fallbackReason: "未配置可用模型"`
2. 若 `chapterContent` 为空 → 降级，`source: "rule"`，`fallbackReason: "章节内容为空"`
3. 构造单次 prompt，让 LLM 输出 7 维度 JSON（剧情承接、主线推进、人物动机、冲突强度、伏笔处理、节奏、风格一致性）
4. 调用 `streamChat`，超时 30s（`AbortSignal.timeout(30_000)`，与现有 signal 合并）
5. 解析 JSON 失败、网络错误、超时 → 降级到 `runPostWriteCheck`
6. 成功 → 返回 AI 结果，每项含 `severity/evidence/suggestion`

**Prompt 设计**（单次调用，并行输出）：
- System：你是小说剧情自检助手，只输出 JSON，不要额外解释。
- User：包含章节正文（截断到 8000 字）、ContextPack 关键字段（chapterGoal、previousChapterEnding 摘要）
- 输出格式：
```json
{
  "items": [
    {"name": "剧情承接", "passed": true, "severity": "info", "evidence": "...", "suggestion": "..."},
    ...
  ]
}
```

#### 3.2.4 chat-panel 集成

修改 `src/components/chat/chat-panel.tsx` 的 `finishAgentSession` 中 Stage D 自检逻辑：
- 当前：同步调用 `runPostWriteCheck(content)`
- 改为：异步调用 `runPostWriteCheckAI({chapterContent, contextPack, llmConfig})`
- 用 IIFE 包裹（因 `setContextInfo` 是整体替换，需在 AI 结果返回后再 setContextInfo）
- AI 结果的 `source` 和 `fallbackReason` 一并写入 `contextInfo.postWriteCheckMeta`（新增字段）

**ContextTrace 扩展**：
```typescript
// src/lib/agent/context-trace.ts
export interface TraceContextInfo {
  // ... 现有字段
  postWriteCheck?: PostWriteCheck
  postWriteCheckMeta?: { source: "ai" | "rule"; fallbackReason?: string }
}
```

#### 3.2.5 UI 展示

修改 `src/components/chat/context-trace-panel.tsx`：
- PostWriteCheck 区块新增"检查来源"标签（AI 推理 / 规则检查）
- 降级时显示降级原因
- 每项检查展开后显示 `evidence` 和 `suggestion`（若有）

### 3.3 Part 1 测试策略

- `post-write-check-ai.spec.ts`：新增，覆盖 AI 成功、降级（无模型/空内容/超时/解析失败）、字段扩展
- `post-write-check-plugin.spec.ts`：补充 `runPostWriteCheck` 规则模式返回 `severity=undefined` 断言
- `chat-panel.spec.tsx`：补充 aiWorkflowMode 从 store 读取断言、卸载清理断言
- `context-trace-panel.spec.tsx`：补充 AI/规则双模式展示断言

---

## 4. Part 2：Stage E 编辑入口 + Stage F 断点恢复

### 4.1 Stage E：classification.md 编辑入口

#### 4.1.1 设计目标

在 `src/components/settings/sections/classification-section.tsx` 现有 UI 基础上，新增：
1. textarea 编辑区（显示 classification.md 原始 markdown 内容）
2. "保存"按钮（带格式校验）
3. "恢复默认"按钮（写入 DEFAULT_CLASSIFICATION_CONFIG）

#### 4.1.2 UI 结构

在现有状态卡片下方新增编辑卡片：

```
┌─ 编辑 classification.md ─────────────────┐
│ [textarea: markdown 内容]                 │
│                                           │
│ [保存]  [恢复默认]  [格式校验提示]         │
└───────────────────────────────────────────┘
```

- textarea 仅在 `classificationStatus === "valid"` 时显示
- 保存前调用 `parseClassificationMarkdown(content)` 校验，失败时显示中文错误提示，不写入
- "恢复默认"需二次确认，复用现有 `ModifyConfirmDialog` 组件（已存在于 chat-panel），不新增组件

#### 4.1.3 实现细节

**新增函数**（在 `src/lib/novel/classification/markdown-serializer.ts`）：
- `serializeClassificationToMarkdown(config): string`：把 ClassificationConfig 序列化为 markdown（已存在反序列化 `parseClassificationMarkdown`，补正向）
- 若已存在正向序列化则复用

**classification-section.tsx 改动**：
- 新增 state：`editingContent: string`、`saveStatus: "idle" | "saving" | "saved" | "error"`
- 加载时若 status=valid，调用 `readProjectClassificationRaw(projectPath)` 读取原始 markdown 填充 textarea
- 保存：`parseClassificationMarkdown(editingContent)` → 成功则 `writeProjectClassification(projectPath, parsed)` → 提示"已保存"
- 恢复默认：`writeProjectClassification(projectPath, DEFAULT_CLASSIFICATION_CONFIG)` → 提示"已恢复默认配置"

**新增读取原始内容函数**（在 `classification-loader.ts`）：
- `readProjectClassificationRaw(projectPath: string): Promise<string>`：直接读取 markdown 文件原始内容

**改动文件**：
- 修改：`src/components/settings/sections/classification-section.tsx`
- 修改：`src/lib/novel/classification/markdown-serializer.ts`（补正向序列化，若缺）
- 修改：`src/lib/novel/classification/classification-loader.ts`（补 raw 读取）
- 新增：`src/components/settings/sections/classification-section.spec.tsx`

### 4.2 Stage F：任务断点恢复

#### 4.2.1 设计目标

实现 Agent 任务断点持久化与恢复：
1. AgentConfig 扩展 `projectPath?` 和 `taskGoal?`
2. runner.ts 每轮工具执行后调用 `saveTaskBreakpoint`
3. chat-panel 启动时检测上次未完成任务，弹确认对话框
4. chat-store 新增 `lastBreakpoint` 字段缓存

#### 4.2.2 AgentConfig 扩展

修改 `src/lib/agent/types.ts`：

```typescript
export interface AgentConfig {
  maxRounds: number
  tools: Tool[]
  systemPrompt: string
  llmConfig: LlmConfig
  toolResultContextLimit?: number
  requestOverrides?: RequestOverrides
  modelId?: string
  /** Stage F: 项目路径，用于断点持久化 */
  projectPath?: string
  /** Stage F: 本次任务目标，用于断点恢复 */
  taskGoal?: string
}
```

#### 4.2.3 runner.ts 集成

修改 `src/lib/agent/runner.ts` 的 `AgentRunner.run`：
- 在每轮工具执行后（`callbacks.onToolResult` 之后），若 `config.projectPath` 存在：
  - 调用 `createTaskBreakpoint` 或 `updateBreakpointStage` 更新断点
  - 调用 `saveTaskBreakpoint(config.projectPath, breakpoint)`
  - 记录 `usedTools`、`usedSkills`、`searches`、`mcpCalls`（从 trace 累积）
- 在 `run` 完成（成功或失败）后，若 `config.projectPath` 存在：
  - 成功：`clearTaskBreakpoint(config.projectPath)`
  - 失败：保留断点（不清理），供下次恢复

**断点更新策略**：
- 首次创建：`createTaskBreakpoint({taskGoal: config.taskGoal, currentStage: "agent_round_1"})`
- 后续更新：`updateBreakpointStage(bp, "agent_round_N", "agent_round_N-1")`
- 不引入新的 stage 概念，直接用 `agent_round_${roundNumber}`

#### 4.2.4 chat-panel 恢复入口

修改 `src/components/chat/chat-panel.tsx`：
- 组件挂载时（`useEffect`），若 `projectPath` 存在：
  - 调用 `loadTaskBreakpoint(projectPath)`
  - 若存在断点，弹出确认对话框："检测到上次有未完成的任务（{taskGoal}），是否恢复？"
  - 用户确认 → 调用 `buildBreakpointResumePrompt(bp)` 拼接恢复提示词，自动发送
  - 用户取消 → 调用 `clearTaskBreakpoint(projectPath)` 清理

**对话框**：复用现有 `ModifyConfirmDialog` 组件（已存在），不新增组件。

#### 4.2.5 chat-store 缓存

修改 `src/stores/chat-store.ts`：
- 新增字段：`lastBreakpoint: TaskBreakpoint | null`
- 新增 setter：`setLastBreakpoint(bp: TaskBreakpoint | null)`
- 用于 UI 显示"上次任务"状态条（可选，非必须）

#### 4.2.6 PrePlugin 链集成

`buildBreakpointResumePrompt` 输出的恢复提示词作为 user message 注入：
- 不通过 PrePlugin 链（断点恢复是消息级注入，不是上下文构建）
- 直接在 chat-panel 的 handleSend 中，若处于恢复模式，把 resume prompt 追加到用户原始输入后

### 4.3 Part 2 测试策略

- `classification-section.spec.tsx`：新增，覆盖 textarea 加载、保存（成功/格式错误）、恢复默认
- `markdown-serializer.spec.ts`：补充正向序列化往返一致性测试
- `runner.spec.ts`：补充每轮 saveTaskBreakpoint 调用断言、成功清理断言、失败保留断言
- `chat-panel.spec.tsx`：补充断点恢复对话框（确认/取消）断言
- `task-breakpoint.spec.ts`：已存在，无需新增

---

## 5. Part 3：Stage G MCP stdio + Mount 级测试

### 5.1 Stage G：MCP stdio 真实连接

#### 5.1.1 设计目标

实现真实 MCP stdio 连接，替换 `defaultUnavailableMcpCaller` 降级路径：
1. Tauri Rust 侧实现子进程管理（spawn/write/read/kill）
2. 前端实现 JSON-RPC 2.0 over stdio transport
3. 实现 `McpToolCaller` 真实连接器
4. runtime 按需注入真实 caller（配置启用时）

#### 5.1.2 Rust 侧实现

新增 `src-tauri/src/commands/mcp_stdio.rs`，四个 Tauri 命令：

```rust
#[tauri::command]
pub async fn mcp_stdio_spawn(
    server_id: String,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
) -> Result<SpawnResult, String>
// 启动子进程，返回 pid 和初始 stdout 缓冲

#[tauri::command]
pub async fn mcp_stdio_write(
    pid: u32,
    data: String,
) -> Result<(), String>
// 向子进程 stdin 写入数据（自动追加 \n）

#[tauri::command]
pub async fn mcp_stdio_read(
    pid: u32,
    timeout_ms: u64,
) -> Result<String, String>
// 阻塞读取一行 stdout（带超时），返回 JSON-RPC 响应

#[tauri::command]
pub async fn mcp_stdio_kill(
    pid: u32,
) -> Result<(), String>
// 终止子进程
```

**进程管理**：
- 用 `tokio::process::Command` 启动子进程
- 全局 `Mutex<HashMap<u32, ChildHandle>>` 管理活跃进程
- stdout 用 `BufReader::read_until` 按行读取（JSON-RPC 每行一个消息）
- kill 时先 `child.kill()` 再 `child.wait()`

**改动文件**：
- 新增：`src-tauri/src/commands/mcp_stdio.rs`
- 修改：`src-tauri/src/commands/mod.rs`（声明模块）
- 修改：`src-tauri/src/lib.rs`（注册命令到 invoke_handler）

#### 5.1.3 前端 transport 层

新增 `src/lib/mcp/transport/stdio.ts`：

```typescript
export interface StdioTransport {
  send(message: string): Promise<void>
  receive(timeoutMs?: number): Promise<string>
  close(): Promise<void>
}

export class TauriStdioTransport implements StdioTransport {
  constructor(private pid: number) {}
  async send(message: string): Promise<void> {
    await invoke("mcp_stdio_write", { pid: this.pid, data: message })
  }
  async receive(timeoutMs = 5000): Promise<string> {
    return await invoke("mcp_stdio_read", { pid: this.pid, timeoutMs })
  }
  async close(): Promise<void> {
    await invoke("mcp_stdio_kill", { pid: this.pid })
  }
}
```

#### 5.1.4 JSON-RPC 2.0 实现

新增 `src/lib/mcp/transport/json-rpc.ts`：

```typescript
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class JsonRpcClient {
  private nextId = 1
  constructor(private transport: StdioTransport) {}

  async call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
    await this.transport.send(JSON.stringify(request))
    const raw = await this.transport.receive()
    const response: JsonRpcResponse = JSON.parse(raw)
    if (response.error) throw new Error(response.error.message)
    return response.result
  }
}
```

**MCP 协议调用**：
- `initialize`：握手
- `tools/list`：获取工具列表
- `tools/call`：调用具体工具

#### 5.1.5 real-connector 实现

新增 `src/lib/mcp/real-connector.ts`：

```typescript
import type { McpToolCaller, McpToolCallRequest, McpToolCallResult } from "./types"

export class RealMcpConnector implements McpToolCaller {
  private transports = new Map<string, JsonRpcClient>()

  async ensureConnected(server: { id: string; command: string; args: string[]; env?: Record<string, string> }): Promise<JsonRpcClient> {
    // 已连接则复用
    // 否则 spawn + initialize 握手
  }

  async call(request: McpToolCallRequest): Promise<McpToolCallResult> {
    const client = await this.ensureConnected(/* 从配置查找 server */)
    try {
      const result = await client.call("tools/call", {
        name: request.toolName,
        arguments: request.arguments,
      })
      return { status: "ok", content: stringifyResult(result), summary: ... }
    } catch (e) {
      return { status: "error", content: "", summary: "", message: `MCP 调用失败：${e.message}` }
    }
  }

  async closeAll(): Promise<void> {
    // 关闭所有 transport
  }
}
```

#### 5.1.6 runtime 集成

修改 `src/lib/mcp/runtime.ts`：
- `buildMcpRuntime` 新增可选参数 `realConnector?: RealMcpConnector`
- 若 server 配置 `command` 存在且 `realConnector` 提供时，使用真实 caller
- 否则保持现有 `defaultUnavailableMcpCaller` 降级
- 不破坏现有降级路径

**chat-panel 集成**：
- 修改 `src/hooks/use-agent-config.ts`：根据 MCP 配置中是否有 `command` 字段，决定是否创建 `RealMcpConnector` 并传入 `buildMcpRuntime`
- 真实连接失败时自动降级到 `defaultUnavailableMcpCaller`，不中断 AI 会话

### 5.2 Mount 级测试基础设施

#### 5.2.1 设计目标

为 chat-panel 补充 mount 级测试，验证 PrePlugin 链、Stage C 对话框、Stage D 自检的端到端交互。现有 `chat-panel.spec.tsx` 全部是 `readFileSync + toContain` 字符串断言，无法验证运行时行为。

#### 5.2.2 测试基础设施

新增 `src/test/chat-panel-mount.ts`：
- 集中管理 mount 测试所需的 mock 体系
- mock `streamChat`、`useWikiStore`、`useAgentConfig`、`invoke`、`writeFileAtomic` 等
- 提供 `renderChatPanel(overrides?)` 工厂函数
- 处理 React 18 `createRoot` + `act` 包装

#### 5.2.3 jsdoc 环境切换

mount 测试文件头部使用 docblock：
```typescript
// @vitest-environment jsdom
```

不修改 `vite.config.ts` 的全局 `test.environment = "node"` 设置，保持其他测试不受影响。

#### 5.2.4 测试用例

新增 `src/components/chat/chat-panel.mount.spec.tsx`：

1. **基础渲染**：chat-panel 能 mount 成功，输入框可交互
2. **PrePlugin 链触发**：发送消息后，pipeline 执行，工具事件正确 emit
3. **Stage C 对话框**：standard 模式下生成章节时，chapter_plan 标记触发对话框，用户确认后续写
4. **Stage C 跳过**：fast 模式下跳过计划确认，直接生成正文
5. **Stage D 自检**：章节写完后，PostWriteCheck 写入 ContextTrace
6. **Stage D 降级**：无模型时降级到规则检查
7. **断点恢复**（依赖 Part 2）：检测到断点时弹对话框，确认后发送恢复提示词

#### 5.2.5 测试约束

- mount 测试不依赖真实文件系统，所有 fs 操作走 mock
- 不依赖真实 LLM，`streamChat` mock 返回预设响应
- 测试用例独立，无共享状态
- 单个测试用例执行时间 < 2s

### 5.3 Part 3 测试策略

- `mcp_stdio.rs`：Rust 侧单元测试（mock 子进程）或集成测试
- `stdio.spec.ts`：transport 层测试（mock invoke）
- `json-rpc.spec.ts`：JSON-RPC 协议测试
- `real-connector.spec.ts`：连接器测试（mock transport）
- `runtime.spec.ts`：补充真实 caller 注入断言
- `chat-panel.mount.spec.tsx`：mount 级端到端测试

---

## 6. 文件结构总览

### 6.1 新增文件

| 文件 | 职责 | 所属 Part |
|------|------|-----------|
| `src/lib/agent/plugins/post-write-check-ai.ts` | Stage D AI 推理 + 降级兜底 | Part 1 |
| `src/lib/agent/plugins/post-write-check-ai.spec.ts` | Stage D AI 测试 | Part 1 |
| `src/components/settings/sections/classification-section.spec.tsx` | Stage E 测试 | Part 2 |
| `src-tauri/src/commands/mcp_stdio.rs` | MCP stdio Rust 命令 | Part 3 |
| `src/lib/mcp/transport/stdio.ts` | stdio transport | Part 3 |
| `src/lib/mcp/transport/json-rpc.ts` | JSON-RPC 2.0 客户端 | Part 3 |
| `src/lib/mcp/real-connector.ts` | 真实 MCP 连接器 | Part 3 |
| `src/lib/mcp/transport/stdio.spec.ts` | transport 测试 | Part 3 |
| `src/lib/mcp/transport/json-rpc.spec.ts` | JSON-RPC 测试 | Part 3 |
| `src/lib/mcp/real-connector.spec.ts` | 连接器测试 | Part 3 |
| `src/test/chat-panel-mount.ts` | mount 测试基础设施 | Part 3 |
| `src/components/chat/chat-panel.mount.spec.tsx` | mount 级测试 | Part 3 |

### 6.2 修改文件

| 文件 | 改动 | 所属 Part |
|------|------|-----------|
| `src/components/chat/chat-panel.tsx` | aiWorkflowMode 从 store 读取、resolver 卸载清理、SoulDialog 禁用、Stage D 异步化、断点恢复 | Part 1+2 |
| `src/components/chat/chat-panel.spec.tsx` | 补充 store 读取、卸载清理断言 | Part 1 |
| `src/lib/agent/context-trace.ts` | PostWriteCheckItem 扩展 severity/evidence/suggestion、postWriteCheckMeta | Part 1 |
| `src/components/chat/context-trace-panel.tsx` | AI/规则双模式展示 | Part 1 |
| `src/components/chat/context-trace-panel.spec.tsx` | 双模式展示测试 | Part 1 |
| `src/lib/agent/plugins/post-write-check-plugin.spec.ts` | 补充规则模式 severity=undefined | Part 1 |
| `src/components/settings/sections/classification-section.tsx` | textarea + 保存 + 恢复默认 | Part 2 |
| `src/lib/novel/classification/markdown-serializer.ts` | 补正向序列化（若缺） | Part 2 |
| `src/lib/novel/classification/classification-loader.ts` | 补 readProjectClassificationRaw | Part 2 |
| `src/lib/agent/types.ts` | AgentConfig 扩展 projectPath/taskGoal | Part 2 |
| `src/lib/agent/runner.ts` | 每轮 saveTaskBreakpoint、完成清理 | Part 2 |
| `src/lib/agent/runner.spec.ts` | 断点调用断言 | Part 2 |
| `src/stores/chat-store.ts` | lastBreakpoint 字段 | Part 2 |
| `src/lib/mcp/runtime.ts` | realConnector 注入 | Part 3 |
| `src/hooks/use-agent-config.ts` | 创建 RealMcpConnector | Part 3 |
| `src-tauri/src/commands/mod.rs` | 声明 mcp_stdio 模块 | Part 3 |
| `src-tauri/src/lib.rs` | 注册 mcp_stdio 命令 | Part 3 |

---

## 7. 数据流

### 7.1 Stage D AI 推理数据流

```
章节写完 (finishAgentSession)
  → runPostWriteCheckAI({chapterContent, contextPack, llmConfig})
    → hasUsableLlm? 
      → 是: streamChat(单次 prompt) → 解析 JSON → 返回 AI 结果
      → 否: 降级 → runPostWriteCheck(content) → 返回规则结果
  → setContextInfo({postWriteCheck, postWriteCheckMeta})
  → UI 渲染（context-trace-panel）
```

### 7.2 Stage F 断点恢复数据流

```
chat-panel 挂载
  → loadTaskBreakpoint(projectPath)
    → 存在断点?
      → 是: 弹确认对话框
        → 用户确认: buildBreakpointResumePrompt → 自动发送
        → 用户取消: clearTaskBreakpoint
      → 否: 正常启动

Agent 运行每轮
  → saveTaskBreakpoint(projectPath, bp)
  
Agent 完成
  → clearTaskBreakpoint(projectPath)
```

### 7.3 Stage G MCP stdio 数据流

```
use-agent-config 初始化
  → 检查 MCP 配置中是否有 command 字段
    → 有: 创建 RealMcpConnector
    → 无: 使用 defaultUnavailableMcpCaller

Agent 调用 MCP 工具
  → RealMcpConnector.call(request)
    → ensureConnected: mcp_stdio_spawn → initialize 握手
    → client.call("tools/call", {name, arguments})
      → transport.send(JSON-RPC request)
      → transport.receive() → JSON-RPC response
    → 返回结果
  → 失败时返回中文降级信息，不中断会话
```

---

## 8. 错误处理

### 8.1 Stage D AI 推理

- 无可用模型 → 降级到规则检查，`fallbackReason: "未配置可用模型"`
- 章节内容为空 → 降级，`fallbackReason: "章节内容为空"`
- streamChat 抛错 → 降级，`fallbackReason: "AI 调用失败：${error.message}"`
- JSON 解析失败 → 降级，`fallbackReason: "AI 返回格式无法解析"`
- 超时（30s）→ 降级，`fallbackReason: "AI 推理超时"`

### 8.2 Stage E 编辑

- textarea 内容为空 → 保存时提示"内容不能为空"
- 解析失败 → 提示"格式错误：${错误位置}"，不写入文件
- 写入失败 → 提示"保存失败：${error.message}"

### 8.3 Stage F 断点恢复

- loadTaskBreakpoint 失败 → 静默忽略，正常启动
- saveTaskBreakpoint 失败 → console.error，不中断 Agent 运行
- clearTaskBreakpoint 失败 → 静默忽略

### 8.4 Stage G MCP stdio

- spawn 失败 → 返回"无法启动 MCP 服务：${error}"，降级
- initialize 握手失败 → 返回"MCP 服务握手失败"，降级
- tools/call 超时 → 返回"MCP 调用超时"，本次失败但不中断会话
- 子进程意外退出 → 清理 transport，下次调用时重新 spawn

---

## 9. 风险与限制

1. **Stage G 跨进程复杂度**：Rust 子进程管理 + JSON-RPC 协议 + 前端 transport 三层，调试难度高。建议先实现单个 MCP 服务的端到端连通，再扩展多服务。
2. **Mount 测试 mock 成本**：chat-panel 依赖众多 store 和 hook，mount 测试 mock 体系较重。建议先跑通基础渲染，再逐步补充交互用例。
3. **Stage D AI 推理延迟**：单次 streamChat 30s 超时可能影响用户体验。需在 UI 显示"正在执行 AI 自检..."提示。
4. **断点恢复语义**：`buildBreakpointResumePrompt` 拼接的提示词质量依赖 LLM 理解能力，复杂任务可能恢复失败。这是可接受的限制，不阻塞实现。
5. **MCP 配置兼容性**：现有 MCP 配置可能没有 `command` 字段，需确保无 command 时优雅降级。

---

## 10. 实施顺序建议

1. **Part 1 先行**：Bug 修复（aiWorkflowMode、resolver 清理、SoulDialog）→ Stage D AI 推理
2. **Part 2 紧随**：Stage E 编辑入口 → Stage F 断点恢复
3. **Part 3 最后**：Stage G Rust 侧 → transport → real-connector → runtime 集成 → mount 测试

每个 Part 完成后打包便携版供用户测试，确认无回退再进入下一 Part。

---

## 11. 成功标准

- [ ] aiWorkflowMode 从 store 读取，快速模式能跳过 Stage C
- [ ] Promise resolver 卸载时清理，无 stale callback
- [ ] Stage D AI 推理成功时返回 7 维度结构化结果，失败时降级到规则检查
- [ ] classification-section 可编辑、保存、恢复默认
- [ ] AgentConfig 包含 projectPath 和 taskGoal
- [ ] runner 每轮保存断点，完成时清理
- [ ] chat-panel 检测到断点时弹恢复对话框
- [ ] MCP stdio 真实连接可用（至少一个 MCP 服务端到端连通）
- [ ] mount 级测试覆盖基础渲染、Stage C、Stage D、断点恢复
- [ ] 所有面向用户的提示语使用中文
- [ ] 旧功能无回退（PrePlugin 链、Stage C 对话框、ContextTrace、MCP 降级路径）
- [ ] typecheck、test:mocks、build、build:portable 全部通过
