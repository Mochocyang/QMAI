---
name: qmai-mcp
description: 调用本机青幕写作 MCP，后台发起写作并查询实际阶段、工具状态和问题，也支持书架、文档保存、标题、记忆提取和章节排版。写作进度最多跟踪 30 分钟。
metadata:
  version: 1.5.0
---

# qmai-mcp

版本：1.5.0

青幕写作需要保持打开，并且设置里的 MCP 开关已打开。工具通过本机 MCP 服务 `qmai` 调用。

未传 `workflowMode`、`model`、`reasoningDepth` 时，使用青幕当前界面的写作模式、写作模型和思考深度，不改写界面上的选择。

`extract_memory` 只提取记忆，不排版正文。需要排版时单独调用 `format_chapter`。草稿不会进入记忆库，除非对章节显式传入 `allowDraft: true`。

## 工具

- `list_bookshelf`：列出书架上的书，含书名、id 和路径。
- `open_bookshelf`：打开书架上的一本书。`name`、`id`、`path` 至少提供一个。同名书有多本时改用 id 或路径。
- `get_current`：获取当前打开的书和正在打开的文件。
- `writing_conversation`：`message` 必填。使用 `background: true`，任务完成准备后立即返回包含 `runId`、`conversationId`、`projectPath`、`progressPath` 和 `conversationPath` 的 JSON。其余可选参数为 `projectPath`、`conversationId`、`workflowMode`（fast、standard、strict、discuss）、`model`、`reasoningDepth`（auto、off、low、medium、high、max）。`background` 默认 false，保留等待完整回复的旧用法，但同一 stdio 连接会在等待期间阻塞后续查询。写某一章时，`message` 只写「编写第 N 章」，例如「编写第 200 章」。不要追加章纲路径，不要指定读哪些文件，不要要求调用 `run_chapter_workflow`，不要写「不要列目录」或「不要读其他章节」。读什么、怎么写，由青幕自己的写作流程决定。
- `get_writing_progress`：必填 `runId`，同时传启动时返回的 `projectPath`，避免切书后查错项目。可选 `afterRevision` 为上次进度版本、`waitMs` 为等待变化的时长（0–30000 毫秒，默认 0）。返回 JSON 进度，`changed: false` 表示这次等待期间没有变化。
- `stop_writing`：停止当前项目正在进行的写作生成，与界面「停止生成」相同。可选 `projectPath`。没有进行中的生成时会说明。停下后，对话记录里的助手消息是「已停止生成。」
- `save_document`：保存章节或大纲的完整 Markdown。不排版，不提取记忆。编辑器有未保存修改时拒绝，除非 `overwrite` 为 true。
- `update_document_title`：修改标题，同时更新 frontmatter、一级标题和文件名。
- `extract_memory`：章节或大纲摄取。非正式章节默认拒绝。
- `format_chapter`：只排版章节正文，与编辑器「一键排版」相同。

## 写作进度

保存后台启动返回的任务标识及路径，然后调用 `get_writing_progress`。后续传入上次的 `revision` 作为 `afterRevision`，并用 `waitMs: 30000` 等待变化。首次启动与后续查询使用同一份进度模型。

只在阶段变化、出现需要用户处理的问题或任务结束时用中文汇报；`changed: false` 或仅工具细节变化不需要重复播报。进度中没有百分比或预计耗时，不自行推测。长时间没有事件不等于失败。

- `running`：查看 `currentStage`、`stages` 和 `tools` 的实际状态。`issues` 中单次工具错误不等于整轮失败，后续可能恢复。
- `needs_input`：本轮已经结束，查看 `issues`，转述需要补充或确认的事项；用户答复后沿用 `conversationId` 发起下一轮。不要替用户确认操作。
- `completed`：本轮完整回复已经保存，按 `conversationPath` 定位结果。完成写作对话不代表章节已经另存为正式稿、排版或提取记忆。
- `failed`：汇报 `issues` 中的错误，包含轮次耗尽或对话保存失败；不要把部分输出当作完成。
- `cancelled`：已停止生成。
- `interrupted`：软件关闭前任务未完成，不自动重发任务。
- `persistenceError`：磁盘进度快照保存失败，查询返回的是内存进度，明确说明磁盘记录可能滞后。

最多从启动起跟踪 30 分钟。超过时报告「等待超时，尚未确认完成」，停止等待；这不代表后台任务已取消，不自动重发。用户要求停止时，调用 `stop_writing`，再查询原任务确认终态。断开 MCP 客户端不会取消后台任务。

`progressPath` 指向 `.qmai/writing-runs/<runId>.json`，可按需读取该任务的精简快照；软件重启后优先查询工具，由工具判断遗留运行记录是否已中断。聊天文件用于完整结果，不扫描 `conv_*.json` 猜当前任务，也不用 `.qm/breakpoint.json` 判断成功或失败。

如服务未提供 `background` 或 `get_writing_progress`，明确说明当前青幕版本无法提供实时进度，需要更新应用。不要套用新参数反复重试，也不要将旧断点推测当作确定进度。汇报进度只使用进度字段，不贴聊天正文、思考内容或完整工具结果。

## 自检

这个目录由青幕在启动、打开 MCP 开关和保存 Agent skills 目录时按 `metadata.version` 自检。随包版本更高时，只覆盖 `qmai-mcp` 目录。已安装版本更高时不降级。
