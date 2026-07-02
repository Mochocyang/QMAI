# gongjudiaoyongyouhua 分支说明

## 分支目标

本分支用于优化 AI 工具调用流程，把当前工具调用从单纯执行器增强为更可控、可追踪、可验证的 Agent 流程。

## 使用要求

1. 不合并到 main，等待用户完成全面软件测试后再决定合并。
2. 本分支只处理工具调用流程增强，不顺手改动无关 UI、主题或模型配置。
3. 读取类工具默认自动执行，写入类工具必须进入确认/预览路径。
4. 工具返回给模型的长内容可以压缩，但界面和记录中保留完整工具结果。
5. 修改完成后必须完成源码启动、旧功能测试、构建和便携版打包验证。

## 本次更新

### 20260702-172000 AI 会话优化 Stage A-B

本轮目标：补充设计文档中规划但未落地的搜索辅助工具和内置写作 Skill 种子模板。

成功标准：
1. `summarize_search_results` 工具已注册并可用，可压缩搜索结果为摘要结构。
2. 软件启动后自动补全 10 个内置写作 Skill 种子模板（章节承接、下一章计划、主线检查、人物动机、冲突升级、伏笔管理、节奏检查、结尾钩子、剧情自检、正文输出协议）。
3. 内置 Skill 不可被用户删除（`deleteWritingSkill` 返回原 config）。
4. 已安装的 writing-skills.json 保持兼容。

修改文件：
- `docs/superpowers/plans/2026-07-02-ai-chat-optimization-stage-A-to-D-plan.md`
- `src/lib/agent/tools/summarize-search-results.ts`
- `src/lib/agent/tools/summarize-search-results.spec.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/novel/skill-seed.ts`
- `src/lib/novel/user-skill-store.ts`
- `src/lib/novel/user-skill-store.spec.ts`
- `src/components/skill-library/writing-skill-library-view.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

验证记录：
1. `npm.cmd exec -- vitest run src/lib/agent/tools/summarize-search-results.spec.ts src/lib/novel/user-skill-store.spec.ts --reporter=verbose`：11 个用例通过。
2. `npm.cmd run typecheck`：通过。
3. `npm.cmd exec -- vitest run --exclude='**/*.real-llm.test.ts' --testTimeout=30000 --hookTimeout=30000`：330 个测试文件、2442 个用例通过。
4. `npm.cmd run build`：通过（保留既有 Vite 警告）。
5. 源码启动验证：`npm.cmd run dev -- --host 127.0.0.1 --port 5174` 成功显示 Vite ready。
6. `npm.cmd run typecheck`（修复后）：通过，修复 chat-panel.tsx 4 个类型错误（移除死代码、修复未使用参数、添加空值检查）。
7. `npm.cmd run test:mocks`（修复后）：333 个测试文件、2463 个用例通过。
8. `npm.cmd run build`（修复后）：通过。
9. `npm.cmd run build:portable`：通过，生成 release-portable\QMaiWrite.exe；版本 2.2.31，大小 149206016 字节。
6. 本轮未提交 git，未合并 main。

### 20260702-224700 Stage C-D 接入完成

本轮目标：将 Stage C（章节计划确认交互流程）和 Stage D（写后剧情自检）的已有组件接入 chat-panel 运行时，使其在标准/严格模式下真正生效。

完成内容：
1. Stage C：章节计划确认交互流程接入
   - 新增 `chapter-plan-confirm-dialog.spec.tsx` 测试（16 个用例，覆盖纯函数和组件交互）
   - 修复 `ChapterPlanConfirmDialog` 组件 `修改计划` 按钮在未提供 onModify 时仍渲染的 UX bug
   - chat-panel 新增 `pendingChapterPlan` 状态和 Promise resolver（复用 SoulDialog 模式）
   - onDone 回调用 async IIFE 检测 `<!-- chapter_plan -->` 标记，弹窗等待用户确认
   - 支持"确认按计划写正文"、"跳过计划直接写"、"修改计划"、"取消生成"四种交互
   - 续写消息通过 handleSendRef 复用 handleSend，不创建新 conversation
2. Stage D：写后剧情自检接入
   - 补充 `runPostWriteCheck` 独立函数测试（6 个用例）
   - chat-panel 在 finishAgentSession 的 contextInfo 构建处追加 Stage D 逻辑
   - 仅对 write_chapter/continue_chapter 任务触发，排除 chapter_plan 标记和空内容
   - 自检结果写入 `contextTrace.contextInfo.postWriteCheck`
   - context-trace-panel 已有的展示区生效（7 项检查：剧情承接、主线推进、人物动机、冲突强度、伏笔处理、节奏、风格一致性）

改动文件：
- `src/components/chat/chapter-plan-confirm-dialog.spec.tsx`（新增，190 行）
- `src/components/chat/chapter-plan-confirm-dialog.tsx`（首次提交，143 行，含 UX bug 修复）
- `src/components/chat/chat-panel.tsx`（修改，+272 行 Stage C +23 行 Stage D）
- `src/components/chat/chat-panel.spec.tsx`（修改，+189 行 Stage C +68 行 Stage D）
- `src/lib/agent/plugins/post-write-check-plugin.spec.ts`（修改，+103 行）

验证记录：
1. `npm run typecheck`：通过，0 errors。
2. `npx vitest run`：338 个测试文件通过、1 个 real-llm 测试超时失败（与本次改动无关）、5 个跳过；2512 个用例通过、47 个跳过。
3. `npm run build`：通过（保留既有 Vite 警告）。
4. `node scripts/build-portable.mjs`：通过，生成 `release-portable\QMaiWrite.exe`，版本 2.2.31。

技术决策说明：
- Stage C 状态放 chat-panel 本地（不修改 chat-store），复用 SoulDialog 的 Promise resolver 模式
- onDone 签名为 `() => void`，用 async IIFE 实现异步等待，不修改接口签名
- Stage D 逻辑放在 finishAgentSession 而非 onDone，因为 onDone 中的 contextInfo 会被 setContextInfo 整体覆盖
- Stage D 不走 pre-plugin 链，直接调用 runPostWriteCheck 独立函数
- 续写消息发送会重跑 pre-plugin 链，但原会话消息历史作为上下文复用

已知限制（Minor，不阻塞）：
1. chat-panel 测试为源码扫描风格，未覆盖 mount 级集成测试
2. 弹窗打开期间聊天输入框仍可用，存在 UX 竞态
3. aiWorkflowMode 在 onDone 闭包中捕获，模式切换时可能为旧值
4. Stage D 自检为简化字符串匹配，非 AI 推理（可作为占位，后续升级）

提交记录：
- Task 1: commit 1f044bd `test(stage-c): add chapter plan confirm dialog tests`
- Task 2: commit aae1539 `feat(stage-c): wire chapter plan confirm dialog into chat-panel`
- Task 3: commit 788e05a `feat(stage-d): wire post-write check into chat-panel onDone`
- 所有改动已提交到 gongjudiaoyongyouhua 分支，未合并 main。

### 后续阶段（未完成）

Stage E：classification.md 编辑入口
Stage F：任务断点恢复
Stage G：真实 MCP 连接（stdio 传输层）

### 20260702-160358 AI 会话 Stage 10 独立写作 Skill 管理页

本轮目标：在不混入原“去 AI 味”技能库的前提下，新增独立的项目级写作 Skill 管理页，并让 AI 会话能够读取已启用的用户写作技巧。

成功标准：
1. 用户可以从侧边栏进入独立“写作 Skill”页面。
2. 用户可以创建、编辑、保存、禁用、删除项目级写作 Skill。
3. 写作 Skill 持久化到项目 `writing-skills.json`，无效记录会被归一化过滤。
4. 已启用写作 Skill 会进入 AI 会话 Skill 路由，已禁用 Skill 不进入会话。
5. “三翻四抖”等用户自定义写作 Skill 可被 `select_skills` 识别并参与下一章生成等任务。
6. 原“技能库/去 AI 味”功能保持独立，不被替换或删除。

修改文件：
- `docs/superpowers/specs/2026-07-02-ai-chat-stage10-writing-skill-library-design.md`
- `docs/superpowers/plans/2026-07-02-ai-chat-stage10-writing-skill-library-plan.md`
- `src/lib/novel/user-skill-store.ts`
- `src/lib/novel/user-skill-store.spec.ts`
- `src/components/skill-library/writing-skill-library-view.tsx`
- `src/components/skill-library/writing-skill-library-view.spec.tsx`
- `src/stores/wiki-store.ts`
- `src/lib/sidebar-nav-preferences.ts`
- `src/lib/sidebar-nav-preferences.spec.ts`
- `src/components/layout/icon-sidebar.tsx`
- `src/components/layout/content-area.tsx`
- `src/components/layout/sidebar-panel.tsx`
- `src/components/settings/sections/interface-section.tsx`
- `src/i18n/zh.json`
- `src/i18n/en.json`
- `src/hooks/use-agent-config.ts`
- `src/hooks/use-agent-config.spec.ts`
- `src/lib/agent/tools/index.ts`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `src/lib/agent/plugins/select-skills-plugin.spec.ts`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. 新增 `UserSkillConfig` 与 `writing-skills.json` 存储闭环，提供创建空白写作 Skill、更新、删除、启用/禁用、保存/加载和解析已启用 Skill 的能力。
2. 新增独立 `writingSkillLibrary` 视图、侧栏、详情编辑器和脏草稿保护，类型、阶段、模式使用复选控件，所有用户可见文案为中文。
3. 侧边栏新增“写作 Skill”导航项，并补齐界面设置里的导航显示配置，避免用户自定义侧边栏时缺少标签。
4. `useAgentConfig` 会读取用户写作 Skill，并把已启用 Skill 暴露给 AI 会话；`chat-panel` 将其合并进可用 Skill 与 `@` 引用来源。
5. `select_skills` 增加用户上传“三翻四抖”写作 Skill 的回归测试，确认下一章生成时可以补充用户自定义结构技巧。

验证记录：
1. `npm.cmd exec -- vitest run src/lib/novel/user-skill-store.spec.ts src/components/skill-library/writing-skill-library-view.spec.tsx src/components/layout/icon-sidebar.test.tsx src/components/layout/content-area.search-performance.test.tsx src/components/layout/sidebar-panel.search-history.test.tsx src/hooks/use-agent-config.spec.ts src/components/chat/chat-panel.spec.tsx src/lib/agent/plugins/select-skills-plugin.spec.ts --reporter=verbose`：8 个测试文件、58 个用例通过。
2. `npm.cmd run typecheck`：通过。
3. `npm.cmd exec -- vitest run src/lib/sidebar-nav-preferences.spec.ts --reporter=verbose`：1 个测试文件、6 个用例通过，用于确认新增导航项期望已同步。
4. `npm.cmd run test:mocks`：330 个测试文件、2444 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动验证：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 成功显示 Vite ready 和本地地址；验证后 5173 端口已释放。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149206016` 字节。
8. 本轮未提交 git，未合并 main。

### 20260702-134755 AI Capability 能力层

本轮目标：按照 Stage 5 计划，在不实现真实 MCP 连接的前提下，为 AI 会话新增统一能力层，承接内置工具、已选 Skill、外部搜索和未来 MCP 占位能力。

成功标准：
1. 内置工具、Skill、外部搜索和未来 MCP 占位能力可以统一表示为 `AiCapability`。
2. `select_capabilities` 前置插件位于 `select_skills` 之后、`soul_dialog` 之前。
3. 能力选择受任务意图、快速/标准/严格模式、用户输入和 classification 禁载数据源影响。
4. 上下文追踪显示本次启用能力，但不记录完整 Skill 内容、网页正文、密钥或 MCP 敏感数据。
5. 工具注册支持 `enabledToolNames` 白名单，同时保持默认行为兼容，`disabledTools` 优先级不变。
6. 本阶段不执行 MCP、不新增 MCP 市场、不绕过写入确认。

修改文件：
- `src/lib/agent/capabilities/types.ts`
- `src/lib/agent/capabilities/registry.ts`
- `src/lib/agent/capabilities/selector.ts`
- `src/lib/agent/capabilities/selector.spec.ts`
- `src/lib/agent/plugins/select-capabilities-plugin.ts`
- `src/lib/agent/plugins/select-capabilities-plugin.spec.ts`
- `src/lib/agent/pipeline.ts`
- `src/lib/agent/novel-pre-plugin-chain.ts`
- `src/lib/agent/novel-pre-plugin-chain.spec.ts`
- `src/lib/agent/plugin-scenarios.spec.ts`
- `src/lib/agent/context-trace.ts`
- `src/lib/agent/context-trace-builders.ts`
- `src/lib/agent/context-trace-builders.spec.ts`
- `src/components/chat/context-trace-panel.tsx`
- `src/components/chat/context-trace-panel.spec.tsx`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/tools/index.spec.ts`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. 新增 capability 类型，包含 `built_in_tool`、`user_skill`、`web_search`、`mcp_tool` 四类。
2. 新增 capability registry，把工具名和已选 `UserSkill` 转成不含正文的能力记录。
3. 新增 capability selector：快速模式保持最小能力，标准模式按写作/搜索任务选择，严格模式允许未来 MCP 占位能力；当 classification 禁载 `graph` 时不选择图谱类 MCP 占位能力。
4. 新增 `select_capabilities` 插件，输出 `selectedCapabilities` 和可选 `enabledToolNames`。
5. `ContextTrace` 和追踪面板新增“启用能力”，展示能力名、类型、权限、来源和原因。
6. `registerAllBuiltInTools` 支持 `enabledToolNames`，并保留 `disabledTools` 覆盖能力。

验证记录：
1. 已先写失败测试并确认失败：capability 模块缺失、插件链仍为 8 个插件、trace 未带能力摘要、面板未显示启用能力、工具注册没有 enabled 白名单过滤。
2. `npm.cmd exec -- vitest run src/lib/agent/capabilities/selector.spec.ts src/lib/agent/plugins/select-capabilities-plugin.spec.ts src/lib/agent/novel-pre-plugin-chain.spec.ts src/lib/agent/plugin-scenarios.spec.ts src/lib/agent/context-trace-builders.spec.ts src/components/chat/context-trace-panel.spec.tsx src/lib/agent/tools/index.spec.ts --reporter=verbose`：7 个测试文件、36 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：319 个测试文件、2398 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动验证：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 成功监听 5173，验证后端口已释放。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149201920` 字节。
8. 本轮未提交 git，未合并 main。

### 20260702-132235 AI 会话外部搜索工具接入

本轮目标：按照 AI 会话剩余能力设计执行计划执行阶段 4，让 AI 会话具备真实外部搜索工具能力。用户明确要求“搜索、联网查询、查外部资料、最新信息”时，Agent 可以调用 `web_search`；未配置或失败时必须中文说明本次未使用联网资料，不能假装已经搜索。

成功标准：
1. 新增 `web_search` 只读工具，复用现有 Web Search 配置。
2. 新增 `read_web_page` 只读工具，可读取 http/https 网页正文并做基础清洗和截断。
3. `web_search` 未配置时返回中文降级提示，不调用网络搜索。
4. `web_search` 搜索失败时返回中文失败提示，并明确“本次未使用联网资料”。
5. AI 会话系统提示词明确：未调用 `web_search` 不得声称已经搜索。
6. `web_search` 调用结果进入 `ContextTrace.webSearches`，追踪面板显示关键词、提供商、结果数量和来源。
7. 搜索结果只进入本次会话上下文，不自动写入记忆、大纲、retrieval 或图谱。
8. 本阶段不实现 MCP、不实现能力层、不改 Web Search 设置页结构。

修改文件：
- `src/lib/agent/tools/web-search.ts`
- `src/lib/agent/tools/web-search.spec.ts`
- `src/lib/agent/tools/read-web-page.ts`
- `src/lib/agent/tools/read-web-page.spec.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/tools/index.spec.ts`
- `src/hooks/use-agent-config.ts`
- `src/hooks/use-agent-config.spec.ts`
- `src/lib/agent/context-trace.ts`
- `src/lib/agent/context-trace-builders.ts`
- `src/lib/agent/context-trace-builders.spec.ts`
- `src/components/chat/context-trace-panel.tsx`
- `src/components/chat/context-trace-panel.spec.tsx`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. 新增 `createWebSearchTool`，返回结构化 JSON：`status/query/provider/resultCount/results/message`。
2. `web_search` 支持未配置、成功、失败三种状态；未配置时不调用 `webSearch`。
3. 新增 `createReadWebPageTool`，只允许 http/https，支持 HTML 标题提取、脚本/样式/标签清理和 `maxChars` 截断。
4. `registerAllBuiltInTools` 默认注册 `web_search` 和 `read_web_page`，并继续支持 `disabledTools` 禁用。
5. `useAgentConfig` 将 `searchApiConfig` 通过 `getSearchApiConfig` 传入工具注册流程。
6. `ContextTrace` 新增 `TraceWebSearch` 与 `webSearches`，初始追踪默认空数组。
7. `ContextTracePanel` 新增“外部搜索”展示区，显示搜索关键词、provider、结果数量、来源和失败原因。
8. `chat-panel.tsx` 新增搜索硬规则提示词，并在工具事件中通过 `appendWebSearchTrace` 记录 `web_search` 结果。

验证记录：
1. 已先写失败测试并确认预期失败：缺少 `web-search/read-web-page` 模块、工具未注册、追踪字段未初始化、追踪面板未展示、系统提示词未约束搜索。
2. `npm.cmd exec -- vitest run src/lib/agent/tools/web-search.spec.ts src/lib/agent/tools/read-web-page.spec.ts src/lib/agent/tools/index.spec.ts src/lib/agent/context-trace-builders.spec.ts src/components/chat/context-trace-panel.spec.tsx src/components/chat/chat-panel.spec.tsx src/hooks/use-agent-config.spec.ts --reporter=verbose`：7 个测试文件、43 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：317 个测试文件、2386 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动验证：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 成功监听，验证后端口 5173 已释放。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149197312` 字节。
8. 本轮未提交 git，未合并 main。

### 20260702-130209 AI 会话剩余能力设计执行计划

本轮目标：在阶段 1 三档模式、阶段 2 通用 Skill 数据模型、阶段 3 Skill 路由已完成的基础上，重新整理后续阶段 4-7 的执行设计计划，明确外部搜索、AI Capability 能力层、MCP Adapter 和端到端收敛应该如何继续拆分执行。

成功标准：
1. 明确当前已经完成的阶段，避免后续 AI 重复实现三档模式和 Skill 路由。
2. 明确下一步只应从阶段 4 外部搜索工具开始。
3. 明确每个剩余阶段的目标、文件范围、测试要求、成功标准和禁止事项。
4. 明确外部搜索不得假装联网，搜索结果不得自动写入项目资料。
5. 明确 MCP 必须通过 Adapter 和权限映射接入，不直接暴露给 AI 会话。

修改文件：
- `docs/superpowers/plans/2026-07-02-ai-chat-remaining-capability-plan.md`
- `gongjudiaoyongyouhua-分支说明.md`
- `GenxinLOG/更新日志.md`

实现记录：
1. 新增剩余能力设计执行计划，标注阶段 1-3 已完成，后续从阶段 4 开始。
2. 阶段 4 规划 `web_search`、`read_web_page` 工具，复用现有 Web Search 配置，并要求未配置/失败时中文降级提示。
3. 阶段 5 规划 AI Capability 能力层，用于统一内置工具、Skill、外部搜索和未来 MCP。
4. 阶段 6 规划 MCP Adapter，明确 read/action/write 权限映射和写入确认边界。
5. 阶段 7 规划普通用户端到端测试场景，覆盖快速、标准、严格、搜索、Skill、MCP 和保存确认。

验证记录：
1. 本轮只新增设计计划文档，未修改业务代码。
2. 未运行源码、未运行测试、未执行 build、未打包。
3. 未提交 git，未合并 main。

### 20260702-125305 AI 会话 Skill 路由接入

本轮目标：按照 AI 会话能力扩展大阶段计划执行阶段 3，把通用 Skill 接入 AI 会话前置插件链，让 AI 会话可以按任务意图和快速/标准/严格模式选择本次 Skill，并把使用过程写入上下文追踪。

成功标准：
1. 标准模式写下一章时能选择章节承接、下一章计划、人物动机、冲突升级、剧情自检、正文输出协议等 Skill。
2. 快速模式只选择正文输出协议和可选去 AI 味/风格类 Skill，避免强制生成复杂计划。
3. 严格模式能选择主线检查、伏笔管理、节奏检查、结尾钩子等更完整 Skill。
4. Skill 进入提示词和追踪，但最终章节正文不得混入 Skill 分析过程。
5. 本阶段不实现外部搜索、MCP、Skill 市场或上传流程。

修改文件：
- `src/lib/agent/plugins/select-skills-plugin.ts`
- `src/lib/agent/plugins/select-skills-plugin.spec.ts`
- `src/lib/agent/plugins/build-system-prompt-plugin.ts`
- `src/lib/agent/plugins/build-system-prompt-plugin.spec.ts`
- `src/lib/agent/novel-pre-plugin-chain.ts`
- `src/lib/agent/novel-pre-plugin-chain.spec.ts`
- `src/lib/agent/plugin-scenarios.spec.ts`
- `src/lib/agent/pipeline.ts`
- `src/lib/agent/context-trace.ts`
- `src/lib/agent/context-trace-builders.ts`
- `src/lib/agent/context-trace-builders.spec.ts`
- `src/components/chat/context-trace-panel.tsx`
- `src/components/chat/context-trace-panel.spec.tsx`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `src/lib/agent/tools/apply-skill.ts`
- `src/lib/agent/tools/write-tools.spec.ts`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. 新增 `select_skills` 前置插件，优先级位于 `build_context_pack` 之后、`soul_dialog` 和 `trim_context` 之前。
2. `select_skills` 按 `taskRoute/effectiveTaskRoute + aiWorkflowMode + availableSkills` 选择 Skill，并返回 `selectedSkills`。
3. `buildSelectedSkillsPrompt` 将选中 Skill 注入系统提示词，并要求最终回复不要解释 Skill 或输出 Skill 分析过程。
4. AI 会话入口把当前模式和可用去 AI 味 Skill 转换后的 `UserSkill` 传入前置插件链，并把 `selectedSkills` 对应提示词加入最终 Agent system prompt。
5. `ContextTrace` 新增 `selectedSkills` 元数据；追踪面板显示 Skill 名称、类型、阶段和来源，不显示 Skill 正文。
6. `apply_skill` 保留旧去 AI 味配置读取，同时增加可选通用 `UserSkill` 读取入口，为后续用户上传 Skill 预留接口。

验证记录：
1. 已先写失败测试并确认预期失败：新插件缺失、链路缺少 `select_skills`、提示词未注入、追踪未展示、聊天入口未传入 Skill、`apply_skill` 不支持通用 Skill。
2. `npm.cmd exec -- vitest run src/lib/agent/plugins/select-skills-plugin.spec.ts src/lib/agent/plugins/build-system-prompt-plugin.spec.ts src/lib/agent/novel-pre-plugin-chain.spec.ts src/lib/agent/context-trace-builders.spec.ts src/components/chat/context-trace-panel.spec.tsx src/components/chat/chat-panel.spec.tsx src/lib/agent/tools/write-tools.spec.ts --reporter=verbose`：7 个测试文件、46 个用例通过。
3. `npm.cmd exec -- vitest run src/lib/agent/plugin-scenarios.spec.ts --reporter=verbose`：1 个测试文件、8 个用例通过。
4. `npm.cmd run typecheck`：通过。
5. `npm.cmd run test:mocks`：315 个测试文件、2373 个用例通过。
6. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
7. 源码启动验证：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 成功监听，验证后端口 5173 已释放。
8. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149197312` 字节。
9. 本轮未提交 git，未合并 main。

### 20260702-123204 通用 Skill 数据模型基础

本轮目标：按照 AI 会话能力扩展大阶段计划执行阶段 2，在不破坏现有去 AI 味 Skill 的前提下，补充通用 Skill 数据模型，让“三翻四抖”等结构类/计划类 Skill 后续可以被分类、被引用、被路由。

成功标准：

1. 通用 Skill 可以表达类型、阶段、模式和来源。
2. “三翻四抖”这类结构类 Skill 可以被规范化为 `structure + planning`。
3. 旧去 AI 味 Skill 可以转换为通用 `style` Skill。
4. 技能库 UI 能显示 Skill 类型、适用阶段和适用模式。
5. @ 引用技能时能携带通用 Skill 元信息。
6. 本阶段不接入 AI 会话自动选择，不接外部搜索，不接 MCP。

修改文件：

- `src/lib/novel/skill-library.ts`
- `src/lib/novel/skill-library.spec.ts`
- `src/lib/novel/de-ai-skill-library.ts`
- `src/components/skill-library/skill-library-view.tsx`
- `src/components/skill-library/skill-library-view.spec.tsx`
- `src/lib/reference/types.ts`
- `src/lib/reference/providers.ts`
- `src/lib/reference/providers.spec.ts`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. 新增 `UserSkill`、`SkillKind`、`SkillStage`、`SkillMode`、`normalizeUserSkill` 和 `filterUserSkills`。
2. 新增 Skill 类型、阶段、模式中文标签，供 UI 展示使用。
3. 新增 `deAiSkillToUserSkill`，将旧去 AI 味 Skill 映射为通用风格类 Skill，适用阶段为改写和输出，适用模式为快速、标准、严格。
4. 技能库详情页展示“类型：风格”“阶段：改写、输出”“模式：快速、标准、严格”。
5. `ReferenceToken` 增加 `skillKinds`、`skillStages`、`skillModes`，`createSkillProvider` 会透传这些元信息。

验证记录：

1. 已先写失败测试并确认失败：`skill-library` 模块缺失、技能库 UI 未显示类型/阶段/模式、技能引用 token 未携带通用 Skill 元信息。
2. 已运行 `npm.cmd exec -- vitest run src/lib/novel/skill-library.spec.ts --reporter=verbose`，1 个测试文件、3 个用例通过。
3. 已运行 `npm.cmd exec -- vitest run src/components/skill-library/skill-library-view.spec.tsx --reporter=verbose`，1 个测试文件、14 个用例通过。
4. 已运行 `npm.cmd exec -- vitest run src/lib/reference/providers.spec.ts --reporter=verbose`，1 个测试文件、7 个用例通过。
5. 已运行 `npm.cmd exec -- vitest run src/lib/novel/skill-library.spec.ts src/components/skill-library/skill-library-view.spec.tsx src/lib/reference/providers.spec.ts --reporter=verbose`，3 个测试文件、24 个用例通过。
6. `npm.cmd run typecheck`：通过。
7. `npm.cmd run test:mocks`：312 个测试文件、2362 个用例通过。
8. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
9. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后端口 5173 已释放。
10. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149193728` 字节。
11. 本轮未提交 git，未合并 main。

### 20260702-121521 AI会话三档模式基础

本轮目标：按照 AI 会话能力扩展大阶段计划，先执行阶段 1，将单一深度模式升级为快速、标准、严格三档 AI 会话执行模式，并为后续 Skill、外部搜索、MCP 路由打基础。

成功标准：

1. AI 会话 UI 可选择快速、标准、严格。
2. 旧深度模式逻辑不丢失，旧开关开启等价于严格模式，关闭等价于标准模式。
3. AI 会话系统提示词能根据当前模式改变执行深度。
4. 上下文追踪能记录本次使用的 `workflowMode`。
5. 本阶段不接入通用 Skill、外部搜索或 MCP。

修改文件：

- `src/lib/agent/workflow-mode.ts`
- `src/lib/agent/workflow-mode.spec.ts`
- `src/lib/agent/context-trace.ts`
- `src/lib/agent/context-trace-builders.ts`
- `src/lib/agent/context-trace-builders.spec.ts`
- `src/stores/wiki-store.ts`
- `src/stores/wiki-store.test.ts`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `src/components/chat/chat-message.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. 新增 `AiWorkflowMode = "fast" | "standard" | "strict"`、默认标准模式、旧深度模式映射和中文标签。
2. `wiki-store` 新增 `aiWorkflowMode` 与 `setAiWorkflowMode`，同时保留 `deepChapterEnabled` 兼容状态。
3. AI 会话系统提示词按快速、标准、严格三种模式注入不同执行要求。
4. AI 会话底部工具栏将旧深度模式入口替换为三段式模式控件。
5. `ContextTrace` 和 `buildInitialContextTraceInfo` 增加 `workflowMode` 记录。
6. 清理聊天面板中旧深度按钮样式测试，改为三档模式按钮样式测试。

验证记录：

1. 已先写失败测试并确认失败：`getWorkflowModeButtonClass` 缺失、旧底部文案仍查找“深度模式”。
2. 已运行 `npm.cmd exec -- vitest run src/components/chat/chat-message.spec.tsx --reporter=verbose`，1 个测试文件、10 个用例通过。
3. 已运行 `npm.cmd exec -- vitest run src/lib/agent/workflow-mode.spec.ts src/lib/agent/context-trace-builders.spec.ts src/stores/wiki-store.test.ts src/components/chat/chat-panel.spec.tsx --reporter=verbose`，4 个测试文件、38 个用例通过。
4. `npm.cmd run typecheck`：通过。
5. `npm.cmd run test:mocks`：311 个测试文件、2359 个用例通过。
6. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
7. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后端口 5173 已释放。
8. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149197312` 字节。
9. 本轮未提交 git，未合并 main。

### 20260702-1047 AI会话右侧宽度支持窗口50%

本轮目标：根据用户反馈，修复 AI 会话右侧面板占比太窄、无法拉到窗口 50% 的问题。

成功标准：

1. AI 会话右侧 dock 可以拖拽到当前窗口宽度的 50%。
2. AI 大纲右侧 dock 使用同一宽度规则，避免两个聊天入口体验不一致。
3. 默认打开的右侧聊天不再停留在旧的 `360px` 窄宽度。
4. 不影响底部聊天高度、消息气泡最大宽度和 Agent 生成流程。

修改文件：

- `src/lib/workspace-layout.ts`
- `src/lib/workspace-layout.test.ts`
- `src/components/layout/writing-workspace.tsx`
- `src/components/sources/sources-view.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. `clampChatWidth` 从固定最大 `520px` 改为按当前窗口宽度 50% 计算最大值。
2. 新增右侧聊天默认宽度和初始宽度解析逻辑，旧的 `360px` 默认保存值会自动提升到新默认宽度。
3. AI 会话和 AI 大纲右侧 dock 均使用新的初始宽度规则。
4. 已完成 `npm.cmd run test:mocks -- src/lib/workspace-layout.test.ts src/components/layout/chat-layout.spec.ts src/components/layout/chat-layout.test.ts`、`npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build` 和源码启动验证。
5. 已完成 `npm.cmd run build:portable`，生成 `release-portable\QMaiWrite.exe`，版本 `2.2.31`，大小 `149283328` 字节。
6. 未提交 git，未合并 main。

### 20260702-1019 思考过程读取对象与完成状态修复

本轮目标：根据用户截图反馈，修正思考过程只显示“读取章节/读取记忆”但看不出读了哪一个对象的问题，并修复结果已生成后仍显示“正在读取...”转圈的问题。

成功标准：

1. 默认思考过程显示读取对象名称，例如“读取章节《第1章-开篇》”“读取记忆「主角档案」”“读取大纲《总大纲》”。
2. 默认思考过程继续隐藏 `read_chapter`、`read_memory` 等内部工具名和序号。
3. 生成完成或失败后，残留 `running` 工具调用必须被收敛为完成或失败状态，不再继续转圈。
4. AI 会话和 AI 大纲两侧都应用同一状态收敛逻辑。

修改文件：

- `src/components/chat/agent-tool-call-message.tsx`
- `src/components/chat/agent-tool-call-message.spec.tsx`
- `src/lib/agent/tool-events.ts`
- `src/lib/agent/tool-events.spec.ts`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `src/components/sources/outline-chat-panel.tsx`
- `src/components/sources/outline-chat-panel.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. 思考过程摘要新增读取目标格式化，读取章节/大纲用书名号，读取记忆/推演/历史会话用引号，搜索章节显示关键词。
2. 新增 `settleRunningAgentToolCalls`，用于会话完成或失败时收敛残留的 `running` 工具状态。
3. AI 会话和 AI 大纲的 `onDone`、最终落盘和错误路径均接入状态收敛，避免结果完成后继续显示“正在...”。
4. 已完成 `npm.cmd run test:mocks -- src/components/chat/agent-tool-call-message.spec.tsx src/lib/agent/tool-events.spec.ts src/components/chat/chat-panel.spec.tsx src/components/sources/outline-chat-panel.spec.tsx`、`npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build` 和源码启动验证。
5. 已完成 `npm.cmd run build:portable`，生成 `release-portable\QMaiWrite.exe`，版本 `2.2.31`，大小 `149283328` 字节。
6. 未提交 git，未合并 main。

### 20260702-1003 章节生成只输出思考内容修复

本轮目标：修复 AI 会话生成下一章时，模型只返回少量 reasoning/思考内容，界面反复显示“模型只输出了思考内容，但没有输出正文”的问题。

成功标准：

1. 章节生成、续写、改写、润色类 Agent 请求必须为正文输出预留足够 `max_tokens`。
2. 这些正文生成请求默认关闭模型 reasoning，避免思考 token 把正文预算耗尽。
3. 保留工具调用能力，不能因为传入 `max_tokens/reasoning` 覆盖项导致工具参数丢失。
4. 不改变 AI 大纲、工具详情展示、写入确认和普通聊天逻辑。

修改文件：

- `src/lib/agent/types.ts`
- `src/lib/agent/runner.ts`
- `src/lib/agent/runner.spec.ts`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. `AgentConfig` 新增 `requestOverrides`，用于由上层为特定任务传入模型请求参数。
2. `AgentRunner` 调用 `streamChat` 时会把 `requestOverrides` 与工具调用参数合并，保留 `tools` 和 `toolChoice: "auto"`。
3. AI 会话识别到 `write_chapter`、`continue_chapter`、`rewrite_chapter`、`polish_chapter` 后，使用 `resolveChapterLengthSpec` 计算输出预算，并传入 `reasoning: { mode: "off" }` 与 `max_tokens`。
4. 已完成 `npm.cmd run test:mocks -- src/lib/agent/runner.spec.ts src/components/chat/chat-panel.spec.tsx`、`npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build` 和源码启动验证。
5. 已完成 `npm.cmd run build:portable`，生成 `release-portable\QMaiWrite.exe`，版本 `2.2.31`，大小 `149283328` 字节。
6. 未提交 git，未合并 main。

### 20260702-0952 AI会话思考过程简化展示

本轮目标：根据用户反馈，把 AI 会话和 AI 大纲中的“思考过程”从工具调用日志式展示改为简洁动作展示。

成功标准：

1. 默认只显示“正在读取章节”“读取大纲”“等待用户确认保存”等动作，不显示序号、工具名、具体章节名或目标文件名。
2. 原始工具调用信息仍保留在“工具详情”折叠区，用户需要排查或确认保存时可以展开查看。
3. 不改变工具执行、上下文加载、写入确认和 AI 大纲工具权限逻辑。

修改文件：

- `src/components/chat/agent-tool-call-message.tsx`
- `src/components/chat/agent-tool-call-message.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：

1. `AgentToolCallMessage` 默认展示层隐藏工具名、序号、耗时和具体目标，只保留图标与动作文本。
2. 运行中状态显示为“正在 + 动作”，失败状态显示为“动作失败”，待确认状态统一显示“等待用户确认保存”。
3. 原始 `ToolCallTimeline` 继续折叠在“工具详情”中，展开后可查看完整工具调用信息。
4. 已完成 `npm.cmd run test:mocks -- src/components/chat/agent-tool-call-message.spec.tsx`、`npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build`、源码启动验证和 `npm.cmd run build:portable`。
5. 便携版已生成：`release-portable\QMaiWrite.exe`，版本 `2.2.31`，大小 `149283328` 字节。
6. 未提交 git，未合并 main。

### 20260702-0812 AI大纲生成工作流与会话宽度修复

本轮目标：修复 AI 会话和 AI 大纲消息区域偏窄、AI 大纲生成按钮返回流程分析而非可用正文、工具调用时间线在窄面板排版拥挤的问题。

成功标准：

1. AI 会话和 AI 大纲消息气泡在桌面端可扩展到窗口约 50%，同时在窄窗口内不横向溢出。
2. 所有 AI 大纲生成分项统一遵循 PRD 3.1 主流程：识别意图、读取资料、提取关键内容、结合 skill 与 soul.md 生成、按结果协议收敛。
3. 章节细纲、人物小传、组织势力、金手指能力、伏笔计划、地点设定等分项都输出可直接保存的大纲正文，不用工具调用报告或泛泛分析代替正文。
4. 工具调用时间线在窄面板内分行展示工具名、状态和说明，长内容只在展开区滚动查看。

准备修改文件：

- `src/components/chat/chat-message.tsx`
- `src/components/chat/chat-message.spec.tsx`
- `src/components/chat/tool-call-timeline.tsx`
- `src/components/chat/agent-tool-call-message.spec.tsx`
- `src/components/sources/outline-chat-panel.tsx`
- `src/components/sources/outline-chat-panel.spec.tsx`

计划：

1. 先写失败测试，覆盖宽度类、统一大纲生成工作流协议、工具调用时间线换行布局。
2. 最小实现通过测试，不改动无关 Agent 架构和数据源路由。
3. 跑定向测试，再跑 `npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build`。
4. 按 PRD 13.2，本阶段不默认执行便携版打包，除非用户明确要求。

实现记录：

1. AI 大纲系统提示新增“AI大纲生成工作流”，对齐 PRD 3.1：提取请求关键词、识别用户意图、读取资料、提取关键创作内容、结合 skill 与 soul.md 生成、按结果协议收敛。
2. AI 大纲生成菜单改为通过 `buildOutlineSectionGenerationPrompt` 构造请求，章节细纲、人物、组织势力、能力体系、伏笔、地点设定分别有正文输出结构约束。
3. 独立大纲细化/文件生成入口 `outline-generation.ts` 同步加入同类工作流和结果收敛约束，避免只在聊天菜单生效。
4. AI 会话与 AI 大纲消息气泡从固定 80%/85% 改为 `max-w-full lg:max-w-[50vw]`，窗口窄时不溢出，桌面端可扩展到约半屏。
5. 工具调用时间线主行改为两层布局：工具名和状态一行，说明独立换行；外层限制 `max-w-full overflow-hidden`，展开区支持滚动。

### 20260702-修复规划

本轮目标：把 AI-Agent PRD 与问答记录对照审查中发现的 7 个问题全部纳入修复闭环，先补测试，再改实现，最后跑旧功能验证。

成功标准：

1. 低置信度澄清后重新执行插件链时，新的 `contextPack`、`novelSystemPrompt` 和 `finalSystemPrompt` 会覆盖旧结果，后续生成不再使用澄清前上下文。
2. `classification.md` 路由能力默认进入小说模式聊天前置插件链，并在上下文追踪中记录 `routeSource`、`blockedSources`、`fallbackReason` 和版本信息。
3. 上下文加载从“全量加载后裁剪字段”推进为“按 classification 路由预过滤数据源后加载”，减少禁载数据源读取。
4. `handleContinueUnfinished` 的普通继续路径接入 `AgentRunner` 与前置插件链；若保留深度章节 checkpoint 路径，需在说明中限定其原因和边界。
5. 批量重建 `retrieval` 索引时使用章节正文实际 hash，不再用章节号充当 `sourceHash`。
6. 章节/大纲生成结果在保存或进入正史链路前接入 `result-parser` 校验，并把校验结果写入 `ContextTrace.resultProtocol`。
7. 模型不支持工具调用的处理口径统一：已知不支持工具的模型走普通对话模式并给出中文提示；运行中发现不支持工具时也使用同一提示与回退路径。

准备修改文件：

- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `src/hooks/use-agent-config.ts`
- `src/hooks/use-agent-config.spec.ts`
- `src/lib/agent/novel-pre-plugin-chain.ts`
- `src/lib/agent/novel-pre-plugin-chain.spec.ts`
- `src/lib/agent/plugins/build-context-pack-plugin.ts`
- `src/lib/agent/plugins/build-context-pack-plugin.spec.ts`
- `src/lib/agent/runner.ts`
- `src/lib/agent/runner.spec.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/types.ts`
- `src/lib/novel/context-data-sources.ts`
- `src/lib/novel/context-engine.ts`
- `src/lib/novel/context-engine.spec.ts`
- `src/lib/novel/chapter-ingest.ts`
- `src/lib/novel/retrieval/retrieval-store.spec.ts`
- `src/lib/novel/result-parser.ts`
- `src/lib/novel/result-parser.spec.ts`

计划：

1. 先写失败测试：覆盖澄清后上下文替换、classification 默认启用、数据源预过滤、retrieval 重建 hash、结果协议校验、工具不支持回退口径。
2. 最小实现通过测试：优先改插件链和数据流，不重构无关 UI。
3. 把继续未完成路径分两步处理：普通继续接入 AgentRunner；checkpoint 深度续写保留专用路径并补边界说明，避免破坏深度章节恢复能力。
4. 跑定向测试，再跑 `npm.cmd run typecheck`、`npm.cmd run test:mocks`、`npm.cmd run build`。
5. 不执行 git commit，不合并 main；是否打包等待用户明确要求。

实现记录：

1. 澄清确认或自定义澄清文本后，重新执行 `runNovelPrePluginChain`，并用重跑结果覆盖 `prePluginResult`、`effectiveTaskRoute` 和 `contextPack`。
2. `runNovelPrePluginChain` 默认启用 classification 路由能力，`build-context-pack-plugin` 在加载上下文前先解析分类规则，再把允许的数据源分类传给 `buildContextPack`。
3. `context-engine` 支持按数据源分类注册上下文数据源，`context-data-sources` 新增分类到数据源映射。
4. 普通继续未完成路径优先使用 `AgentRunner`，深度章节 checkpoint 路径继续保留专用恢复逻辑。
5. `buildRetrievalIndex` 通过章节正文或快照内容计算 `sourceHash`，不再使用章节号。
6. `result-parser` 新增结果协议追踪结构，章节/大纲生成结果会写入 `ContextTrace.resultProtocol`。
7. 已知不支持工具与运行中发现不支持工具两条路径统一降级到普通对话，并显示中文提示 `当前模型不支持工具调用，已切换为普通对话模式`。

### 20260702-073056 复审缺口修复

本轮目标：处理复审发现的 3 个残留问题，确保 7 个 AI-Agent 修复点在主路径和关键边界路径上闭环。

修复内容：

1. `ContextTrace.contextInfo` 初始化时不再把 `routeSource` 固定为 `default`，改为使用前置插件链返回的 `routeSource`、`blockedSources`、`classificationFallbackReason` 和 `classificationVersion`。
2. 普通“继续未完成”路径构建上下文时改走 `runNovelPrePluginChain`，限定启用 `build_context_pack` 和 `trim_context`，避免绕过 classification 预过滤；深度章节 checkpoint 恢复路径继续保持专用逻辑。
3. 章节草稿确认保存和章节修改确认保存前新增 `validateChapterBeforeSave` 校验，校验失败时阻断保存并返回中文错误，避免无效章节进入正式章节库。
4. 新增 `context-trace-builders` 和 `result-save-guard` 两个小型纯函数模块，用真实函数测试覆盖 trace 分类元信息和保存前结果校验。

### 20260701-132053

- 新增统一工具事件层 `applyAgentToolEvent`，聊天面板和 AI 大纲面板统一通过工具事件更新运行中、完成、错误和待确认状态。
- 新增工具结果压缩模块，长工具结果回灌给模型前保留首尾证据并标记“已压缩给模型使用”，完整结果仍保存在工具调用记录中。
- 写入类工具默认标记为需要确认，AgentRunner 在没有用户确认时不会执行写入，只返回可审核预览提示。
- `write_chapter`、`write_memory`、`write_outline_node` 写入后会读回验证，成功显示“读回验证通过”，不一致时返回中文警告。
- AI 大纲加入固定分析流程：先 list 确认可用资料，再 read 读取内容，分析冲突、缺口、伏笔、角色动机和章节承接，最后生成建议。

## 验证记录

- 20260702-0928：
  - 本轮目标：把 AI 会话和 AI 大纲中原本裸露的工具调用列表整理为用户可读的“思考过程”，并把原始工具调用折叠到“工具详情”。
  - 已先写失败测试并确认失败：默认渲染缺少“思考过程”，且原始 `AI 工具调用` 直接显示。
  - 修复内容：`AgentToolCallMessage` 根据工具调用生成任务识别、资料读取、上下文整理、写入草稿等待确认等过程步骤；原始 `ToolCallTimeline` 默认折叠在“工具详情”中。
  - `npm.cmd run test:mocks -- src/components/chat/agent-tool-call-message.spec.tsx`：1 个测试文件、10 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：309 个测试文件、2335 个用例通过。
  - `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；验证后确认端口 5173 未监听。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本信息显示 `2.2.31`，便携版体积约 142.37 MB。保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 本轮未提交 git，未合并 main。

- 20260702-0858：
  - 已先写失败测试并确认失败：低信息普通消息跳过小说上下文链、AI 大纲禁用章节/记忆写入工具、工具调用列表固定网格布局、工具注册过滤新增断言均在实现前失败。
  - 修复内容：普通聊天 `general_chat` 不再运行小说前置插件链；`clarification_needed` 内部降级普通聊天，不弹窗；AI 大纲注册工具时禁用 `write_chapter`、`write_memory`；工具调用时间线改为统一四列网格并禁止横向滚动。
  - `npm.cmd run test:mocks -- src/components/chat/chat-panel.spec.tsx src/components/sources/outline-chat-panel.spec.tsx src/components/chat/agent-tool-call-message.spec.tsx src/lib/agent/tools/index.spec.ts`：4 个测试文件、39 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：309 个测试文件、2334 个用例通过。
  - `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；验证后确认端口 5173 未监听。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本信息显示 `2.2.31`，便携版体积约 142.37 MB。保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 本轮未提交 git，未合并 main。

- 20260702-0832：
  - 已先写失败测试并确认失败：AI 大纲统一工作流、独立大纲生成工作流、消息宽度和工具调用换行布局新增断言均在实现前失败。
  - `npx.cmd vitest run src/components/sources/outline-chat-panel.spec.tsx src/components/chat/chat-message.spec.tsx src/components/chat/agent-tool-call-message.spec.tsx src/lib/novel/outline-generation.spec.ts --reporter=verbose`：4 个测试文件、33 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：308 个测试文件、2331 个用例通过。
  - `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 成功监听 `http://127.0.0.1:5173/`，验证后已停止；复查端口 5173 未监听。
  - 按 PRD 13.2 当前分支节奏，本阶段未执行便携版打包，等待用户明确要求。

- 20260702-073056：
  - 先写失败测试并确认失败：`src/lib/agent/context-trace-builders.spec.ts`、`src/lib/novel/result-save-guard.spec.ts` 和 `src/components/chat/chat-panel.spec.tsx` 覆盖复审发现的 3 个缺口。
  - `npm.cmd exec -- vitest run src/lib/agent/novel-pre-plugin-chain.spec.ts src/lib/agent/plugins/build-context-pack-plugin.spec.ts src/lib/agent/context-trace-builders.spec.ts src/lib/novel/context-data-sources.spec.ts src/lib/novel/chapter-ingest.retrieval.spec.ts src/lib/novel/result-parser.spec.ts src/lib/novel/result-save-guard.spec.ts src/components/chat/chat-panel.spec.tsx`：8 个测试文件、53 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：308 个测试文件、2323 个用例通过。
  - `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后已停止。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；保留既有 Vite dynamic import、chunk size、plugin timings 警告。

- 20260702-003837：
  - `npm.cmd exec -- vitest run src/lib/agent/novel-pre-plugin-chain.spec.ts src/lib/agent/plugins/build-context-pack-plugin.spec.ts src/lib/novel/context-data-sources.spec.ts src/lib/novel/chapter-ingest.retrieval.spec.ts src/lib/novel/result-parser.spec.ts src/components/chat/chat-panel.spec.tsx`：6 个测试文件、48 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：306 个测试文件、2318 个用例通过。
  - `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后已停止。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；保留既有 Vite dynamic import、chunk size、plugin timings 警告。

- 20260701-132053：
  - `npm.cmd exec -- vitest run src/lib/agent/runner.spec.ts src/lib/agent/tool-events.spec.ts src/lib/agent/tool-result.spec.ts src/lib/agent/tools/read-tools.spec.ts src/lib/agent/tools/write-tools.spec.ts src/components/chat/agent-tool-call-message.spec.tsx src/components/chat/chat-panel.spec.tsx src/components/sources/outline-chat-panel.spec.tsx src/components/reference/ReferenceInput.spec.tsx src/components/reference/ReferencePickerDialog.spec.tsx src/lib/reference/providers.spec.ts`：11 个测试文件、75 个用例通过。
  - `npm.cmd run typecheck`：通过。
  - `npm.cmd run test:mocks`：287 个测试文件、2127 个用例通过。
  - `npm.cmd run build`：通过，存在既有 Vite chunk/dynamic import 警告。
  - 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 后已停止。
  - `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `version-info.json`；Rust 构建存在既有 `file_sync.rs` dead-code 警告。

## Git 状态

- 20260702-134755 AI Capability 能力层已完成验证并已完成便携版打包：新增统一能力层、`select_capabilities` 前置插件、`selectedCapabilities` 追踪与“启用能力”面板展示，工具注册新增 `enabledToolNames` 且 `disabledTools` 继续优先。本阶段未实现真实 MCP 连接、未新增 MCP 市场、未绕过写入确认。未提交 git，未合并 main。
- 20260702-132235 AI 会话外部搜索工具接入已完成验证并已完成便携版打包：新增 `web_search` 与 `read_web_page` 两个只读 Agent 工具，复用现有 Web Search 配置；未配置或失败时中文降级提示，未调用 `web_search` 不得声称已搜索；搜索过程进入 `ContextTrace.webSearches` 和追踪面板。本阶段未实现 MCP、未实现能力层、未改 Web Search 设置页结构。未提交 git，未合并 main。
- 20260702-130209 AI 会话剩余能力设计执行计划：新增 `docs/superpowers/plans/2026-07-02-ai-chat-remaining-capability-plan.md`，明确阶段 1-3 已完成，后续从阶段 4 外部搜索工具开始，并拆分 AI Capability 能力层、MCP Adapter、端到端收敛三个后续阶段。本轮只新增计划文档，未修改业务代码，未运行测试，未打包，未提交 git，未合并 main。
- 20260702-125305 AI 会话 Skill 路由接入已完成验证并已完成便携版打包：新增 `select_skills` 前置插件，按任务意图和三档模式选择 Skill，选中 Skill 进入提示词和上下文追踪；本阶段未接外部搜索、MCP、Skill 市场或上传流程。未提交 git，未合并 main。
- 20260702-123204 通用 Skill 数据模型基础已完成验证并已完成便携版打包：新增通用 Skill 类型/阶段/模式结构，旧去 AI 味 Skill 可适配为通用风格类 Skill，技能库 UI 和 @ 引用携带元信息；未接 AI 会话自动选择、外部搜索或 MCP。未提交 git，未合并 main。
- 20260702-121521 AI会话三档模式基础已完成验证并已完成便携版打包：新增快速、标准、严格三档执行模式，保留旧深度模式兼容，模式进入系统提示词与上下文追踪；未接入通用 Skill、外部搜索或 MCP。未提交 git，未合并 main。
- 20260702-120741 AI会话能力扩展设计计划：新增 `docs/superpowers/specs/2026-07-02-ai-chat-capability-design.md`，用于固定快速/标准/严格三档模式、通用 Skill、外部搜索、AI Capability 能力层、MCP Adapter、上下文追踪和分阶段落地边界。本轮只补设计计划文档，未继续实现业务代码，未提交 git，未合并 main。
- 20260702-115932 AI会话能力扩展大阶段执行启动：完成阶段 0 基线确认，当前分支为 `gongjudiaoyongyouhua`，现有 `deepChapterEnabled` 尚未升级为 `aiWorkflowMode`，未接通用 Skill、外部搜索或 MCP。本轮准备先执行阶段 1：三档模式基础。未提交 git，未合并 main。
- 20260702-1047 AI会话右侧宽度支持窗口50%已完成验证并已完成便携版打包，未提交 git，未合并 main。
- 20260702-1019 思考过程读取对象与完成状态修复已完成验证并已完成便携版打包，未提交 git，未合并 main。
- 20260702-0928 AI会话思考过程展示优化已完成验证并已完成便携版打包，未提交 git，未合并 main。
- 20260702-0858 意图分析、AI大纲工具权限与工具列表排版修复已完成验证并已完成便携版打包，未提交 git，未合并 main。
- 20260702-0832 AI大纲生成工作流与会话宽度修复已完成验证，未提交 git，未合并 main。
- 20260702-073056 复审缺口修复已完成验证，未提交 git，未合并 main。
- 20260702-003837 AI-Agent PRD 与问答记录对照修复已完成验证，未提交 git，未合并 main。
- 20260701-132053 工具调用流程优化纳入本次提交。
- 不合并 main。

### 20260702-0752 AI大纲引用与工具调用渲染修复

本轮目标：修复 AI 大纲在 @ 引用大纲/章节后，助手工具调用更新时出现 React #310 崩溃，以及用户发送消息中不显示已附带 @ 引用内容的问题。

修复内容：
1. `ToolCallTimeline` 不再在 `toolCalls` 为空时提前跳过后续 Hook，避免工具调用从空数组流式更新为非空数组时触发 Hook 顺序变化。
2. AI 大纲用户消息渲染 `attachedReferences`，在消息正文下方显示已发送的 @ 引用 chip，保持与普通聊天消息一致。
3. 新增回归测试：覆盖工具调用从空到非空的渲染过程，以及 AI 大纲用户消息必须渲染 @ 引用。

验证记录：
1. 已先写失败测试并确认失败：`AgentToolCallMessage` 空工具调用更新为非空时报 `Rendered more hooks than during the previous render`；AI 大纲引用显示测试缺少 `ReferenceChip`。
2. 已运行 `npx.cmd vitest run src/components/chat/agent-tool-call-message.spec.tsx src/components/sources/outline-chat-panel.spec.tsx --reporter=verbose`，17 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：308 个测试文件、2325 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后已停止。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；保留既有 Vite dynamic import、chunk size、plugin timings 警告。

Git 状态：本轮修复未提交 git，未合并 main。

### 20260702-140552 MCP Adapter 基础层

本轮目标：按 Stage 6 计划补齐 AI 会话的 MCP Adapter 基础层，让 graphRAG、knowledgeGraph 等只读或分析型 MCP 能力将来可以被 AI 会话承接，同时保持写入确认、安全降级和上下文追踪边界。

成功标准：
1. MCP 工具描述可以适配为 QMai Agent Tool。
2. 只读、分析、建议、写入、删除、覆盖类 MCP 操作有明确权限映射。
3. 删除和覆盖类 MCP 默认阻断；写入类 MCP 必须走确认路径。
4. MCP 调用失败时返回中文降级信息，不中断普通 AI 会话。
5. MCP 调用摘要进入 ContextTrace 和追踪面板，不记录密钥、完整外部结果或敏感配置。

修改文件：
- `src/lib/mcp/types.ts`
- `src/lib/mcp/config.ts`
- `src/lib/mcp/adapter.ts`
- `src/lib/mcp/adapter.spec.ts`
- `src/lib/agent/tools/mcp-tool.ts`
- `src/lib/agent/tools/mcp-tool.spec.ts`
- `src/lib/agent/tools/index.ts`
- `src/lib/agent/tools/index.spec.ts`
- `src/lib/agent/context-trace.ts`
- `src/lib/agent/context-trace-builders.ts`
- `src/lib/agent/context-trace-builders.spec.ts`
- `src/components/chat/context-trace-panel.tsx`
- `src/components/chat/context-trace-panel.spec.tsx`

实现记录：
1. 新增 MCP 类型与配置模型，限定当前阶段只做适配层，不做 MCP 市场、自动安装或真实连接管理 UI。
2. `adaptMcpTool` 将 MCP schema 转换为 Agent Tool 参数模型，不支持的参数类型会返回中文错误并拒绝注册。
3. `createMcpTool` 使用注入式 `McpToolCaller`，便于后续接入真实 MCP 客户端，也便于当前阶段用测试覆盖失败降级。
4. MCP 工具通过 `mcpTools` 注入到工具注册流程，并继续受 `enabledToolNames` 与 `disabledTools` 控制。
5. 追踪面板新增“MCP 调用”，只展示工具名、服务名、操作类型、状态和失败原因等摘要信息。

验证记录：
1. 定向测试：`npm.cmd exec -- vitest run src/lib/mcp/adapter.spec.ts src/lib/agent/tools/mcp-tool.spec.ts src/lib/agent/tools/index.spec.ts src/lib/agent/context-trace-builders.spec.ts src/components/chat/context-trace-panel.spec.tsx --reporter=verbose`，5 个测试文件、23 个用例通过。
2. `npm.cmd run typecheck`：通过。
3. `npm.cmd run test:mocks`：321 个测试文件、2408 个用例通过。
4. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
5. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；超时截断后复查端口 5173 未监听。
6. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149201920` 字节。

Git 状态：本阶段未提交 git，未合并 main。

### 20260702-152521 Stage 9 MCP 配置 UI 与持久化闭环

本轮目标：按 Stage 9 计划补齐 MCP 最小配置入口，让 AI 会话已有 MCP Adapter/Runtime 能从设置页读取用户配置，并在应用重启后恢复；本阶段不实现 MCP 市场、自动安装、真实进程生命周期或外部 MCP 客户端连接。

成功标准：
1. MCP 配置保存前和启动恢复时都经过归一化，畸形配置不会中断应用。
2. 设置页存在“MCP 工具”入口，普通用户可以添加示例、启用/禁用、编辑服务和工具 descriptor、删除服务。
3. 设置页能显示可执行 MCP 工具数量和中文 warning，删除/覆盖类 descriptor 不进入可执行工具。
4. 应用启动后能把本地保存的 MCP 配置恢复到 `wiki-store`，AI 会话可以继续通过 Stage 8 runtime 接收配置。
5. 未连接真实 MCP 服务时仍返回中文降级信息，不伪造外部结果，不中断普通 AI 会话。

修改文件：
- `src/lib/mcp/config.ts`
- `src/lib/mcp/config.spec.ts`
- `src/lib/project-store.ts`
- `src/lib/project-store.integration.test.ts`
- `src/App.tsx`
- `src/App.mcp-config.test.ts`
- `src/components/settings/sections/mcp-section.tsx`
- `src/components/settings/mcp-section.spec.tsx`
- `src/components/settings/settings-view.tsx`
- `src/i18n/zh.json`
- `src/i18n/en.json`
- `docs/superpowers/specs/2026-07-02-ai-chat-stage9-mcp-settings-design.md`
- `docs/superpowers/plans/2026-07-02-ai-chat-stage9-mcp-settings-plan.md`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. `normalizeMcpConfig`、`normalizeMcpServerConfig` 与 `createSampleGraphMcpServer` 已补齐，配置读取和 UI 示例共用同一归一化逻辑。
2. `project-store` 新增 `saveMcpConfig` 与 `loadMcpConfig`，应用启动阶段会读取保存配置并写入 `useWikiStore.getState().setMcpConfig`。
3. 设置页新增 `McpSection`，支持添加 Graph MCP 示例、即时保存、工具 JSON 草稿校验、启用/禁用、删除确认和 runtime warning 摘要。
4. 设置分类新增“MCP 工具”，中英文 i18n 均已补齐，所有面向用户的中文提示保留中文。

验证记录：
1. Stage 9 定向测试：`npm.cmd exec -- vitest run src/lib/mcp/config.spec.ts src/lib/mcp/runtime.spec.ts src/lib/project-store.integration.test.ts src/App.mcp-config.test.ts src/components/settings/mcp-section.spec.tsx src/components/settings/settings-model-categories.spec.ts src/hooks/use-agent-config.spec.ts --reporter=verbose`，7 个测试文件、44 个用例通过。
2. `npm.cmd run typecheck`：通过。
3. `npm.cmd run test:mocks`：328 个测试文件、2434 个用例通过。
4. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
5. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；超时截断后复查端口 5173 未监听。
6. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149201408` 字节。

Git 状态：本阶段未提交 git，未合并 main。

### 20260702-143025 Stage 7 普通用户工作流闭环

本轮目标：按 Stage 7 计划把模式、classification、Skill、外部搜索、MCP、追踪显示和写入确认收口到普通用户可测试的 AI 会话工作流中。

成功标准：
1. 快速润色只启用最小上下文工具，不启用写入工具。
2. 标准下一章启用写作上下文、写入确认工具和用户上传写作 Skill。
3. 用户明确要求搜索时启用 `web_search` 和 `read_web_page`，不把搜索能力默认塞进所有写作任务。
4. 严格知识图谱任务可以选择只读 MCP 能力；classification 禁载 `graph` 时不得选择 MCP 图谱能力。
5. 实际发送给模型的工具列表必须跟 `select_capabilities` 的 `enabledToolNames` 一致。
6. MCP 工具调用结果进入上下文追踪，但不记录完整外部内容或敏感信息。

修改文件：
- `src/lib/agent/ai-chat-workflow-convergence.spec.ts`
- `src/lib/agent/tool-scope.ts`
- `src/lib/agent/tool-scope.spec.ts`
- `src/lib/agent/mcp-trace.ts`
- `src/lib/agent/mcp-trace.spec.ts`
- `src/lib/agent/plugins/select-skills-plugin.ts`
- `src/lib/agent/plugins/build-context-pack-plugin.ts`
- `src/components/chat/chat-panel.tsx`

实现记录：
1. 新增普通用户工作流收口测试，覆盖快速润色、标准下一章、外部搜索、严格 MCP 和 classification 禁载 MCP。
2. `scopeAgentConfigTools` 在 AgentRunner 调用前按 `prePluginResult.enabledToolNames` 过滤工具列表，确保能力选择真正影响模型可见工具。
3. `appendMcpCallTrace` 将 `mcp_*` 工具结果转为 `ContextTrace.mcpCalls` 摘要，过滤 `content` 等完整外部结果。
4. 标准/严格写作 Skill 选择在保留原默认 Skill 精确列表的同时，只补充 `uploaded` 来源的相关写作 Skill，避免默认项目 Skill 列表变宽。
5. `build_context_pack` 保留输入中已有的 `blockedSources`，避免上游禁载信息在前置链中丢失。

验证记录：
1. 新增测试先失败再修复：`tool-scope`、`mcp-trace` 和 `ai-chat-workflow-convergence` 均完成红绿验证。
2. 定向测试：`npm.cmd exec -- vitest run src/lib/agent/ai-chat-workflow-convergence.spec.ts src/lib/agent/tool-scope.spec.ts src/lib/agent/mcp-trace.spec.ts src/lib/agent/plugins/select-skills-plugin.spec.ts src/lib/agent/plugins/build-context-pack-plugin.spec.ts src/lib/agent/plugins/select-capabilities-plugin.spec.ts src/lib/agent/capabilities/selector.spec.ts src/lib/agent/novel-pre-plugin-chain.spec.ts src/lib/agent/context-trace-builders.spec.ts src/components/chat/context-trace-panel.spec.tsx src/lib/agent/tools/index.spec.ts src/lib/mcp/adapter.spec.ts src/lib/agent/tools/mcp-tool.spec.ts --reporter=verbose`，13 个测试文件、65 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：324 个测试文件、2417 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；超时截断后复查端口 5173 未监听。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149201920` 字节。

Git 状态：本阶段未提交 git，未合并 main。

### 20260702-080431 @ 输入触发引用窗口修复

本轮目标：修复用户在引用输入框输入 `@` 时无法打开引用选择窗口的问题。

根因：`ReferenceInput` 只允许 `event.key === "@"` 且 `shiftKey` 为 false 时触发引用窗口；多数键盘输入 `@` 需要 `Shift+2`，导致正常输入路径被误拦截。

修复内容：
1. 放宽 `@` 键触发条件，允许 `Shift+@` 打开引用选择窗口。
2. 保留 Ctrl/Meta 组合键屏蔽，避免影响系统或浏览器快捷键。
3. 新增 `Shift+@` 回归测试，防止后续再次回退。

验证记录：
1. 已先写失败测试并确认失败：`Shift+@` 触发时 `onAtTrigger` 调用次数为 0。
2. 已运行 `npx.cmd vitest run src/components/reference/ReferenceInput.spec.tsx --reporter=verbose`，11 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：308 个测试文件、2326 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 通过 Job 验证，Vite ready 地址为 `http://127.0.0.1:5173/`，验证后已停止。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；保留既有 Vite dynamic import、chunk size、plugin timings 警告。

Git 状态：本轮修复未提交 git，未合并 main。
### 20260702 AI Chat Stage 5-7 设计计划补充

本轮目标：只补充后续执行设计计划，不修改业务代码。

新增文档：
1. `docs/superpowers/plans/2026-07-02-ai-chat-stage5-to-stage7-design-plan.md`

设计边界：
1. 当前从 Stage 5 AI Capability 能力层继续推进。
2. Stage 5 只做能力层、能力选择、追踪和工具注册兼容，不实现真实 MCP 连接。
3. Stage 6 再做 MCP Adapter。
4. Stage 7 再做端到端工作流收敛。
5. 不允许绕过写入确认。
6. 不允许把搜索结果或 MCP 结果自动写入记忆、大纲、retrieval 或图谱。

验证记录：
1. 本轮只新增设计计划文档，未运行测试。
2. 未打包。
3. 未提交 git。
4. 未合并 main。
# 20260702-145700 Stage 8 MCP 本地配置运行时接线

本轮目标：按 Stage 8 设计，把本地 MCP 配置接入 AI 会话运行时，使启用的只读/分析类 MCP descriptor 可以变成 Agent 工具、AI 能力层能力和预插件链可选择能力；本轮不实现 MCP 市场、自动安装、真实进程生命周期或完整设置 UI。

成功标准：
1. `McpConfig` 可以转换为 `mcpTools`、`mcpCapabilities` 和中文 warnings。
2. 删除、覆盖和不支持 schema 的 MCP descriptor 不进入可执行工具列表。
3. MCP 配置在 `wiki-store` 中有统一状态入口，后续设置页或外部导入可复用。
4. `useAgentConfig` 能把 MCP 工具注入 `buildAgentConfig`，同时暴露 MCP capabilities/warnings。
5. AI 会话预插件链能接收 MCP capabilities，并且不会因此丢失已选用户 skill 能力。
6. 未连接真实 MCP 服务时只返回中文降级信息，不伪造外部结果，不中断普通 AI 会话。

修改文件：
- `src/lib/mcp/runtime.ts`
- `src/lib/mcp/runtime.spec.ts`
- `src/stores/wiki-store.ts`
- `src/hooks/use-agent-config.ts`
- `src/hooks/use-agent-config.spec.ts`
- `src/lib/agent/pipeline.ts`
- `src/lib/agent/plugins/select-capabilities-plugin.ts`
- `src/lib/agent/plugins/select-capabilities-plugin.spec.ts`
- `src/components/chat/chat-panel.tsx`
- `src/components/chat/chat-panel.spec.tsx`
- `GenxinLOG/更新日志.md`
- `gongjudiaoyongyouhua-分支说明.md`

实现记录：
1. 新增 `buildMcpRuntime`，把启用的 MCP server/tool descriptor 转成 QMai Agent Tool 与 `mcp_tool` 能力。
2. 新增 `defaultUnavailableMcpCaller`，真实 MCP 尚未连接时返回中文降级结果，避免 AI 会话假装已经查到外部 MCP 内容。
3. `wiki-store` 增加 `mcpConfig` 和 `setMcpConfig`，默认值为 `DEFAULT_MCP_CONFIG`。
4. `useAgentConfig` 构建 MCP runtime，并把 `mcpTools` 注入 `buildAgentConfig`；hook 返回值增加 `mcpCapabilities` 和 `mcpWarnings`。
5. `PrePluginInput` 增加 `mcpCapabilities`，`select_capabilities` 在运行时合并内置工具、已选 skill 和 MCP 能力。
6. `chat-panel` 在普通发送和继续未完成上下文构建两条路径中传入 `agentMcpCapabilities`。

验证记录：
1. TDD RED/GREEN 已完成：`runtime`、`use-agent-config`、`select-capabilities-plugin`、`chat-panel` 均先确认失败再实现。
2. Stage 8 定向测试：`npm.cmd exec -- vitest run src/lib/mcp/runtime.spec.ts src/hooks/use-agent-config.spec.ts src/components/chat/chat-panel.spec.tsx src/lib/agent/plugins/select-capabilities-plugin.spec.ts src/lib/agent/ai-chat-workflow-convergence.spec.ts --reporter=verbose`，5 个测试文件、42 个用例通过。
3. `npm.cmd run typecheck`：通过。
4. `npm.cmd run test:mocks`：325 个测试文件、2424 个用例通过。
5. `npm.cmd run build`：通过；保留既有 Vite dynamic import、chunk size、plugin timings 警告。
6. 源码启动：`npm.cmd run dev -- --host 127.0.0.1 --port 5173` 显示 Vite ready，地址为 `http://127.0.0.1:5173/`；超时截断后复查端口 5173 未监听。
7. `npm.cmd run build:portable`：通过，生成 `release-portable\QMaiWrite.exe` 和 `release-portable\version-info.json`；版本 `2.2.31`，大小 `149201920` 字节。

Git 状态：本阶段未提交 git，未合并 main。
