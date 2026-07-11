# 大纲升级分支说明

## 分支目标
升级AI大纲系统，集成qmaiskill成熟方法论，实现动态追踪、标准化结构、质量校验。

## 更新记录
### 2026-07-08 AI大纲多Agent运行链路接入
- 本次目标：将 AI 大纲固定生成向导从“提示多 Agent”推进为实际调用多 Agent 编排器执行，支持子 Agent 并发、合并 Agent 汇总和单 Agent fallback。
- 已完成：向导提交时传入 `enableMultiAgent: true`；普通自由对话保持单 Agent；子 Agent 禁止写入文件；合并失败时自动回退单 Agent。
- 验证：新增失败测试并转绿，目标单测、typecheck、build、test:mocks、源码启动、build:portable 已执行。
- 是否提交：未提交

### 2026-07-08 AI大纲多Agent工作流升级
- 新增实施计划文档：docs/superpowers/plans/2026-07-08-ai-outline-multi-agent-workflow-implementation.html
- 本次目标：支持 AI 大纲按 SkillHub 中不同 Skill 规划多个子 Agent 并行生成，子 Agent 只生成结构化结果不直接写文件，由最终合并 Agent 统一质检、合并和写回；多 Agent 不可用时自动回退为单 Agent。
- 已新增工作流状态机、结构化输出协议、多 Agent 编排器，并将 AI 大纲向导发送内容升级为包含多 Agent 分工计划和回退说明。
- 验证：目标单测、typecheck、build、test:mocks、源码启动、build:portable 已执行。
- 是否提交：未提交

### 2026-07-08 AI大纲工作流标准升级
- 新增实施计划文档：docs/superpowers/plans/2026-07-08-ai-outline-workflow-upgrade.html
- 本次目标：先落地充分性闸门、先卷后章、卷节拍表、卷时间线、滚动章纲、结构节点和设定写回等标准。
- 是否提交：未提交

### 2026-07-07 初始化
- 分支创建
- 实施计划文档完成：docs/superpowers/plans/2026-07-07-ai-outline-upgrade.html

### 2026-07-11 动态多 Agent、响应式思考框与 next_step 容错
- 动态规划器读取用户任务、项目摘要、已有与缺失模块及全部可用 Skill 元数据，最多规划 12 个任务。
- 依赖调度器最多并发 3 个 Agent，支持自动补位、失败重试一次、失败维度传播和按规划顺序合并。
- 普通 AI 会话与 AI 大纲的思考流程框统一全宽响应式，长内容不会撑出横向宽度。
- next_step 支持标准解析、轻微结构恢复、残留清理和安全卡片降级；显示、复制、摘要与保存统一使用清理正文。
- 验证：本次相关最终聚焦测试 9 个文件、67 项通过；typecheck、build、源码启动检查和 2.2.33 build:portable 通过。
- 完整 mocks 回归：428 个测试文件、3291 项通过；43 项既有失败集中于当前工作区其他模块。
- 是否提交：已纳入本次本地提交，并将合并到本地 main；不推送远程。
