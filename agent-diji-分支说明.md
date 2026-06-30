# agent-diji 分支说明

## 分支用途

本分支用于开发 Agent 工具调用框架的核心基础设施，包括：

- Agent 核心类型定义
- ToolRegistry 工具注册中心
- OpenAI tools schema 转换
- LLM 层 tool_calls 扩展
- AgentRunner 多轮调用循环
- 17 个内置工具（读/写/行动）
- Agent UI 组件（AgentToolCallMessage）
- 聊天消息 DisplayMessage 字段扩展

## 使用要求

- 本分支仅实现 Agent 框架本身，不直接改动 chat-panel / outline-chat-panel 的业务逻辑。
- chat-panel 和 outline-chat-panel 的接入放在后续 `agent-duihua`、`agent-dagang` 分支处理。
- 所有改动必须可测试、可 typecheck、可打包。
- 不删除、不修改已有 `ChatInput` 组件。

## 更新记录

### 2026-06-30

- 创建分支 agent-diji
- 待开始实现 Task 1.1 ~ Task 1.14

## 提交状态

- 当前未提交
