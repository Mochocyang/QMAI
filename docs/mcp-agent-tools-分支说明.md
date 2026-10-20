# MCP Agent 工具

分支：`cursor/mcp-agent-tools-f62a`

青幕写作作为本机 MCP 服务。外部 Agent 通过当前程序的 `--mcp-stdio` 连接。应用必须保持打开，并且设置里的 MCP 开关已打开。开关默认关闭。

## 工具

- `list_bookshelf`：列出书架上的书，含书名、id 和路径。
- `open_bookshelf`：按书名、id 或路径打开一本书，并切换到这本书。同名书有多本时改用 id 或路径。
- `get_current`：获取当前打开的书，以及正在打开的文件。
- `writing_conversation`：写作对话。`message` 必填。可选 `projectPath`、`conversationId`、`workflowMode`（`fast`、`standard`、`strict`、`discuss`）、`model`、`reasoningDepth`（`auto`、`off`、`low`、`medium`、`high`、`max`）。未传的写作参数使用当前界面值，不改写界面选择。找不到传入的模型 id 时返回错误。
- `writing_conversation` 的 `background` 默认 `false`，保留同步返回；设为 `true` 后先返回任务 `runId`、`conversationId`、`projectPath`、`progressPath` 和 `conversationPath`，写作继续在青幕进程内执行。
- `get_writing_progress`：按 `projectPath` 和必填 `runId` 查询实际写作进度。可传 `afterRevision`、`waitMs`（0–30000）等待变化，无变化返回 `changed: false`。进度不包含正文、思考、工具参数或完整结果；快照原子保存到 `.qmai/writing-runs/<runId>.json`。状态为 `running`、`needs_input`、`completed`、`failed`、`cancelled`、`interrupted`；保存完整会话后才能报告完成，软件重启后的遗留运行任务在查询时标为中断。
- `stop_writing`：停止当前项目正在进行的写作生成，与界面「停止生成」相同。可选 `projectPath`。没有进行中的生成时会说明。
- `save_document`：原子保存章节或大纲 Markdown。不排版，不改正式稿状态，不提取记忆。编辑器有未保存修改时拒绝，除非 `overwrite` 为 true。
- `update_document_title`：修改 frontmatter 标题、一级标题和文件名。同名或章节号冲突时拒绝。
- `extract_memory`：章节走 `ingestChapter`，大纲走 `ingestOutline`。不排版正文。非正式章节默认拒绝，只有 `allowDraft: true` 才提取草稿。
- `format_chapter`：与编辑器「一键排版」相同，只接受章节路径。

路径必须落在该项目的 `QM/` 或 `wiki/` 章节、大纲目录内。没有删除工具。写作对话里仍然不会自动调用写正文、写大纲或写记忆。

## 连接

设置 → 外部 Agent（MCP）→ 启用 MCP。复制 MCP 配置说明，把服务名 `qmai` 配进 Agent，命令是程序路径加 `--mcp-stdio`。

连接信息写在应用数据目录的 `mcp-endpoint.json`，只允许当前用户读取，只监听 `127.0.0.1`。应用没开或开关关闭时，stdio 返回「青幕写作未启动，或尚未打开 MCP 开关。」

## Skill 版本

随包目录是 `skills/qmai-mcp`，版本在 `SKILL.md` 的 `metadata.version`，当前 `1.5.0`。它不跟随应用版本号。新版 Skill 后台启动任务并查询进度，最多跟踪 30 分钟；等待超时不等于任务已经取消，不自动重发，也不扫描聊天文件或断点猜测进度。

设置里填写 Agent skills 目录后，应用启动、打开开关和保存目录时自检：

- 父目录不存在：跳过，不创建。
- 版本相同：不写文件。
- 已安装版本更高：不降级。
- 未安装、版本缺失或随包版本更高：整份覆盖该目录下的 `qmai-mcp`，不动其他 skill。

复制 Skill 安装说明会带上当前版本号和随包绝对路径。
