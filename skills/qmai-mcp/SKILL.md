---
name: qmai-mcp
description: 调用本机青幕写作 MCP。列出并打开书架、获取当前打开的书、写作对话、停止生成、保存文档、修改标题、提取记忆、章节排版。写作对话最长等 30 分钟；进度和问题读当前书项目里的 .qmai/chats/conv_*.json。
metadata:
  version: 1.4.0
---

# qmai-mcp

版本：1.4.0

青幕写作需要保持打开，并且设置里的 MCP 开关已打开。工具通过本机 MCP 服务 `qmai` 调用。

未传 `workflowMode`、`model`、`reasoningDepth` 时，使用青幕当前界面的写作模式、写作模型和思考深度，不改写界面上的选择。

`extract_memory` 只提取记忆，不排版正文。需要排版时单独调用 `format_chapter`。草稿不会进入记忆库，除非对章节显式传入 `allowDraft: true`。

## 工具

- `list_bookshelf`：列出书架上的书，含书名、id 和路径。
- `open_bookshelf`：打开书架上的一本书。`name`、`id`、`path` 至少提供一个。同名书有多本时改用 id 或路径。
- `get_current`：获取当前打开的书和正在打开的文件。
- `writing_conversation`：`message` 必填。可选 `projectPath`、`conversationId`、`workflowMode`（fast、standard、strict、discuss）、`model`、`reasoningDepth`（auto、off、low、medium、high、max）。单次最长等 30 分钟，超过就按超时处理，不要继续等。写某一章时，`message` 只写「编写第 N 章」，例如「编写第 200 章」。不要追加章纲路径，不要指定读哪些文件，不要要求调用 `run_chapter_workflow`，不要写「不要列目录」或「不要读其他章节」。读什么、怎么写，由青幕自己的写作流程决定。
- `stop_writing`：停止当前项目正在进行的写作生成，与界面「停止生成」相同。可选 `projectPath`。没有进行中的生成时会说明。停下后，对话记录里的助手消息是「已停止生成。」
- `save_document`：保存章节或大纲的完整 Markdown。不排版，不提取记忆。编辑器有未保存修改时拒绝，除非 `overwrite` 为 true。
- `update_document_title`：修改标题，同时更新 frontmatter、一级标题和文件名。
- `extract_memory`：章节或大纲摄取。非正式章节默认拒绝。
- `format_chapter`：只排版章节正文，与编辑器「一键排版」相同。

## 写作进度

写作对话可能很久。定期汇报进度和问题时，读当前打开的书的项目目录下 `.qmai/chats/conv_*.json`。`get_current` 返回的「路径」就是项目目录。文件名形如 `conv_1792466481541_iftgmy.json`，对应代码里的 `conv_<时间戳>_<随机串>`，落盘为 `.qmai/chats/<conversationId>.json`。

可以监听这些 `conv_*.json` 的变动，有变动再读、再用中文汇报。不要空转轮询。汇报只说进度和问题，不要贴 `content`、`reasoning_content`、`agentToolCalls[].result`、`agentStages[].events[].content` 里的正文。

文件是消息数组。看最后一条 `role` 为 `assistant` 的消息：

- 进行中：`isAgentRunning` 为 true；或 `agentStages`、`agentToolCalls` 里还有 `status` 为 `running` 或 `pending`；或 `generationTiming` 只有 `startedAt`、没有 `finishedAt`。
- 已完成：`isAgentRunning` 为 false，`generationTiming.finishedAt` 已有，阶段和工具没有 `status` 为 `error`，并且 `content` 不是以 `出错：` 开头。
- 失败：`isAgentRunning` 为 false。尚未结束的阶段收成 `agentStages[].status` = `error`，尚未结束的工具收成 `agentToolCalls[].status` = `error`。`content` 以 `出错：` 开头，后面是错误说明。`agentStages[].events[].kind` 为 `error` 也表示出错。只引用 `出错：` 后面的那句错误，不要带正文。
- 轮次用尽：没有单独字段。失败文本里包含 `已达到最大调用轮次` 就是轮次用尽。
- 已停止或已取消：`agentStages[].status` 或 `agentToolCalls[].status` 为 `cancelled`。`content` 可能是 `已停止生成。` 或 `已取消计划，未进入正文生成。`，汇报这句即可。
- 进度：按 `agentStages` 的顺序看 `title` 和 `status`。`status` 为 `pending`、`running`、`done`、`error`、`approval_required`、`cancelled`。工具看 `agentToolCalls` 的 `name` 和 `status`（`running`、`done`、`error`、`approval_required`、`cancelled`）。

`.qm/breakpoint.json` 只作辅助。文件可以不存在；任务结束时内容是 JSON `null`。有对象时看 `currentStage`、`completedStages`、`usedTools`、`updatedAt`。`currentStage` 形如 `agent_round_1`，`completedStages` 里已跑过的工具形如 `tool:<工具名>`。它不能代替 `conv_*.json`。

流式输出过程中，对话记录会等这轮状态落定后再写入。这段时间若断点文件有变动，可以用断点补充当前轮次，仍然不要空转轮询。

## 自检

这个目录由青幕在启动、打开 MCP 开关和保存 Agent skills 目录时按 `metadata.version` 自检。随包版本更高时，只覆盖 `qmai-mcp` 目录。已安装版本更高时不降级。
