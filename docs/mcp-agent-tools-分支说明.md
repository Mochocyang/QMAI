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

路径必须落在该项目的 `QM/` 或 `wiki/` 章节、大纲目录内。正文和大纲没有删除工具。写作对话里仍然不会自动调用写正文、写大纲或写记忆。

## 记忆维护

先 `get_maintenance_status` 查看当前项目、六类记忆的扫描摘要、四项数量及认知字数阈值、提醒设置和 `availableModels`。维护只针对当前打开的书，切书先用 `open_bookshelf`。可用 `update_maintenance_settings` 调整 `enabled`、`limits`（cognition、characters、foreshadowing、timeline）、`cognitionChars` 和默认检测 `model`。超量只提醒，由用户选择清理；同项目最多每七天提醒一次。

- `scan_memory_cleanup`：后台检测，返回 `runId`、`projectPath` 和进度路径。可传完整 `model` ID，不改变界面模型；可选 `fields` 为 knowledgeChanges、characterStateChanges、foreshadowingChanges、timelineEvents、newCanonFacts、conflicts，可用 `fromChapter`、`toChapter` 限定正文章节范围。省略范围时扫描全部有效快照。扫描不会删除来源。
- `get_maintenance_progress`：按启动返回的 `projectPath`、`runId` 查询，配合 `afterRevision`、`waitMs: 30000` 等待变化。终态为 completed、failed、cancelled、interrupted；重启不会自动重跑。`persistenceError` 表示磁盘进度可能滞后。不要将启动成功当成维护完成。
- `get_memory_cleanup_result`：扫描完成后分页查看 `issues`，包括删除条目、保留依据、理由和置信度。可指定 `scanId`；`offset` 默认 0，`limit` 默认 20、最大 100。
- `keep_memory_cleanup_issues`：传 `scanId` 和明确 `issueIds`，把误判候选加入项目保留白名单，之后不再建议同组候选。
- `apply_memory_cleanup`：传原 `scanId` 和审查后的明确 `issueIds`，后台先备份，再从快照来源删除并同步四类 JSON、正式记忆/追踪 Markdown、检索资料、人物 Skill、图谱和受影响向量。不会修改正文或大纲。来源修订变化、候选保留依据冲突或相关编辑器有未保存修改时拒绝执行。完成结果带 `cleanupId`。
- `undo_memory_cleanup`：撤销最近一次清理，可传原 `cleanupId` 防止撤销错任务。后台恢复实际改动的文件并同步索引；相关文件清理后已有新修改时拒绝覆盖，保留备份。
- `stop_maintenance_task`：只取消扫描，传 `projectPath`、`runId`。清理和撤销同步期间不能中断，清理完成后可以撤销。

模型建议只是候选。检查原文及保留依据，不能因历史久远、人物退场、当前未用、政治战争题材或架空设定而删掉有效事实。除非用户已授权相应清理或测试，不要仅凭高置信度就全选删除。进度文件为 `.qmai/maintenance-runs/<runId>.json`，备份为 `.qmai/memory-cleanup-history/`；不要把备份当作新记忆提取。

## 连接

设置 → 外部 Agent（MCP）→ 启用 MCP。复制 MCP 配置说明，把服务名 `qmai` 配进 Agent，命令是程序路径加 `--mcp-stdio`。

连接信息写在应用数据目录的 `mcp-endpoint.json`，只允许当前用户读取，只监听 `127.0.0.1`。应用没开或开关关闭时，stdio 返回「青幕写作未启动，或尚未打开 MCP 开关。」

## Skill 版本

随包目录是 `skills/qmai-mcp`，版本在 `SKILL.md` 的 `metadata.version`，当前 `1.6.0`。它不跟随应用版本号。新版 Skill 后台启动任务并查询进度，最多跟踪 30 分钟；等待超时不等于任务已经取消，不自动重发，也不扫描聊天文件或断点猜测进度。

设置里填写 Agent skills 目录后，应用启动、打开开关和保存目录时自检：

- 父目录不存在：跳过，不创建。
- 版本相同：不写文件。
- 已安装版本更高：不降级。
- 未安装、版本缺失或随包版本更高：整份覆盖该目录下的 `qmai-mcp`，不动其他 skill。

复制 Skill 安装说明会带上当前版本号和随包绝对路径。

## Red_Alert 实测（2026-10-26）

运行中的 QMAI 通过 MCP 调用，扫描模型为 `codex-cli/gpt-6-luna`：

- 第 225–230 章六类来源共 163 条，扫描完成，无清理候选。
- 第 1–50 章扫描在第 2 批通过 MCP 取消，原扫描缓存及来源保持不变。
- 第 43–66 章伏笔来源 121 条，发现第 43、66 章两条 `回收:无`，均为空记录；明确传入候选 ID 后完成来源删除，再用 `cleanupId` 撤销。
- 撤销后校验 8,640 个原有来源、派生资料、正文和大纲文件，哈希与测试前一致。保留测试任务、扫描及清理备份作为审计记录。
- 验证了未知模型、过期扫描 ID、非法 runId 和分页越界参数拒绝执行。

实测修正：实体只重建内容确实受影响的页面；撤销只检查及恢复本次实际改动的文件；开发热更新后的原生 MCP 监听器更新分派函数。

当前项目的向量服务对 `ali/qwen3-embedding-8b` 返回 HTTP 401，错误为 `model or provider not exist`。维护严格清除受影响的旧向量；如果重新嵌入失败，来源和文档操作仍然完成，MCP 的完成结果通过 `warnings`（及任务日志）明确提示重建索引，UI 显示持久提示。旧向量删除本身失败仍然回滚文件并报告失败。撤销同样返回重新索引警告；文件恢复成功不代表语义索引已恢复。

验证：生产构建及 TypeScript 源码检查通过；相关回归测试 257 项、Rust MCP 协议测试 5 项通过。全量 mock 测试为 9,130 项通过，另有 4 个无关测试文件失败：字体与 AI 输入布局测试引用的文档资产缺失、Web Search 配置断言失败、人物绑定对话框焦点断言失败（单独运行同样失败）。测试源码类型检查仍有原有类型错误，本次新增维护测试无类型错误。
