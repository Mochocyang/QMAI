# agent-duihua 分支说明

## 分支目标

本分支用于将 AI 会话面板接入 Agent 工具调用流程，并接入 @ 引用输入、引用弹窗和章节右键发送到 AI 会话能力。

## 使用要求

1. 不合并到 main，等待用户完成全面软件测试后再决定合并。
2. 本分支优先处理 AI 会话面板；AI 大纲不在本轮强接入范围内。
3. 保留旧 `ChatInput` 组件源码，不删除不重构无关逻辑。
4. 面向用户的提示语保持中文。
5. 修改完成后必须完成源码启动验证、旧功能测试、构建和便携版打包验证。

## 本次更新

### 20260701-103906

- 修复 AI 会话模型选择器位置回归：模型选择器已回到输入区右下角，靠近发送按钮。
- 恢复 AI 会话引用输入框可拖拽高度，流式生成时在输入区右下角显示停止按钮。
- 优化 @ 引用弹窗样式，改为主题化弹窗，增大内容区域，显示清晰中文标签、搜索框、路径和已选计数。
- 修复 @ 引用数据源：章节库、记忆库、大纲支持递归读取嵌套 Markdown；推演室支持读取 `.qmai/simulations` 下的框架 Markdown 和结果 JSON。
- 修复 Agent 读取工具：`read_memory` 和 `read_deduction` 支持按完整 `path` 读取嵌套文件。
- 修复章节列表右键菜单在真实侧边栏未接入的问题：章节右键“发送到AI会话”会展开 AI 会话并插入引用 token，不会自动发送。
- 修正 @ 引用 Chip 关闭按钮乱码，改为图标按钮和中文无障碍标签。

### 20260701-095256

- 新增 `agent-message-metadata` 纯函数模块，将 Agent 成功读取类工具调用转换为 assistant 消息引用来源。
- AI 会话输入草稿恢复按会话隔离：文本继续使用 `conversation.inputDraft`，引用 token 按会话单独缓存。
- Agent 完成后会把成功读取的章节、大纲、记忆和推演来源写入 assistant `references`，旧引用来源面板可继续展示。
- 同步 `src/lib/changelog.spec.ts` 的 `2.2.31` 版本断言，使全量 mock 测试恢复通过。

### 20260701-092043

- 将 `chat-panel` 的发送流程接入 `AgentRunner`。
- 将 AI 会话输入区替换为 `ReferenceInput`，并接入 `ReferencePickerDialog`。
- 用户消息保存 `attachedReferences`，assistant 占位消息保存 `isAgentRunning` 与 `agentToolCalls`。
- 用户消息区域展示只读引用芯片。
- `useAgentConfig` 返回已加载技能配置，并修正内置工具注册使用的 wiki 目录路径。
- 保留章节生成相关的 QM-QUAI、目标章节解析和角色灵魂确认逻辑，避免旧功能回退。

## 验证记录

- 20260701-103906：
  - `npm.cmd exec -- vitest run src/components/reference/ReferenceChip.spec.tsx src/components/reference/ReferenceInput.spec.tsx src/components/reference/ReferencePickerDialog.spec.tsx src/lib/reference/providers.spec.ts src/stores/chat-store.test.ts src/components/layout/sidebar-panel.outline-tree.test.tsx src/components/chat/chat-panel.spec.tsx src/lib/agent/tools/read-tools.spec.ts`：8 个测试文件、45 个用例通过。
  - `npm.cmd exec -- vitest run src/components/chat/agent-message-metadata.spec.ts src/components/chat/chat-message.spec.tsx src/components/layout/knowledge-tree.long-press.test.tsx src/components/layout/chat-layout.test.ts src/components/sources/outline-chat-panel.spec.tsx src/lib/reference/resolve.spec.ts`：6 个测试文件、46 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：285 个测试文件、2105 个用例通过。
  - `npm.cmd run build`：通过，存在既有 Vite chunk/dynamic import 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 前台启动显示 Vite ready；当前环境无法可靠保留后台 dev server，未留下常驻 URL。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe`。
- 20260701-095256：
  - `npm.cmd exec -- vitest run src/components/chat/agent-message-metadata.spec.ts src/components/chat/chat-panel.spec.tsx src/components/chat/chat-message.spec.tsx src/hooks/use-agent-config.spec.ts src/lib/changelog.spec.ts`：5 个测试文件、28 个用例通过。
  - `npm.cmd exec -- vitest run src/components/layout/chat-layout.test.ts`：11 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：285 个测试文件、2094 个用例通过。
  - `npm.cmd run build`：通过，存在既有 Vite chunk/dynamic import 警告。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe`。
- 20260701-092043：
  - `npm.cmd exec -- vitest run src/components/chat/chat-panel.spec.tsx src/components/chat/chat-message.spec.tsx src/hooks/use-agent-config.spec.ts`：7 个用例通过。
  - `npm.cmd exec -- vitest run src/components/layout/chat-layout.test.ts`：1 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run build`：通过，存在既有 Vite chunk/dynamic import 警告。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe`。

## Git 状态

- 20260701-092043 更新已提交，提交号 `6b08275`。
- 20260701-095256 优化纳入本次提交。
- 20260701-103906 回归修复和 @ UI 优化纳入本次提交。
- 不合并 main。
