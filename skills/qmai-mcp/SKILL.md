---
name: qmai-mcp
description: 调用本机青幕写作 MCP。列出并打开书架、获取当前打开的书、写作对话、保存文档、修改标题、提取记忆、章节排版。
metadata:
  version: 1.1.0
---

# qmai-mcp

版本：1.1.0

青幕写作需要保持打开，并且设置里的 MCP 开关已打开。工具通过本机 MCP 服务 `qmai` 调用。

未传 `workflowMode`、`model`、`reasoningDepth` 时，使用青幕当前界面的写作模式、写作模型和思考深度，不改写界面上的选择。

`extract_memory` 只提取记忆，不排版正文。需要排版时单独调用 `format_chapter`。草稿不会进入记忆库，除非对章节显式传入 `allowDraft: true`。

## 工具

- `list_bookshelf`：列出书架上的书，含书名、id 和路径。
- `open_bookshelf`：打开书架上的一本书。`name`、`id`、`path` 至少提供一个。同名书有多本时改用 id 或路径。
- `get_current`：获取当前打开的书和正在打开的文件。
- `writing_conversation`：`message` 必填。可选 `projectPath`、`conversationId`、`workflowMode`（fast、standard、strict、discuss）、`model`、`reasoningDepth`（auto、off、low、medium、high、max）。
- `save_document`：保存章节或大纲的完整 Markdown。不排版，不提取记忆。编辑器有未保存修改时拒绝，除非 `overwrite` 为 true。
- `update_document_title`：修改标题，同时更新 frontmatter、一级标题和文件名。
- `extract_memory`：章节或大纲摄取。非正式章节默认拒绝。
- `format_chapter`：只排版章节正文，与编辑器「一键排版」相同。

## 自检

这个目录由青幕在启动、打开 MCP 开关和保存 Agent skills 目录时按 `metadata.version` 自检。随包版本更高时，只覆盖 `qmai-mcp` 目录。已安装版本更高时不降级。
