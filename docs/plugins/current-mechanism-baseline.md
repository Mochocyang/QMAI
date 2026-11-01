# QMAI 插件机制现状基线

> 用途：在决定「三种插件形态（纯工作流 / 带界面 / 改造界面）」与「模型侧渠道体系」怎么走之前，
> 先把**现在到底是什么**钉成事实。
>
> 证据格式：`文件:行号`（相对仓库根）。基线提交：`18f08fa7`。
> 结论只写代码能证明的；推断会标注【推断】。

---

## 0. 一句话结论

**当前不是「应用扩展平台」，而是「两个具体能力的进程外挂载点」。**

- 能挂的只有两件事：**给 AI 加工具**、**给软件加模型来源**。
- 两者都靠「起一个子进程 + MCP over stdio (+ 可选 loopback HTTP)」实现。
- **没有 SDK、没有 UI 契约、没有工作流钩子**，权限系统基本是声明式的。

---

## 1. 一个插件在物理上是什么

```
<插件根>/<id>/
├── plugin.json          ← 唯一必需文件（封闭契约）
└── index.js / *.py / *.exe   ← 运行时入口（runtime.entry）
```

宿主启动它 = `spawn(node|python|<binary> <entry>)`，然后：

| 通道 | 方向 | 用途 |
|---|---|---|
| **stdin/stdout（NDJSON JSON-RPC）** | 双向 | MCP 协议：`initialize` / `tools/list` / `tools/call` |
| **stderr** | 插件 → 宿主 | 日志（宿主持续排空，保留尾部 64KB） |
| **环境变量** | 宿主 → 插件 | `QMAI_PLUGIN_ID`、`QMAI_HOST_URL`、`QMAI_HOST_TOKEN`、`QMAI_PROVIDER_PORT`、`QMAI_PROVIDER_TOKEN` |
| **loopback HTTP（可选）** | 宿主 → 插件 | provider 端点：`/health`、`/v1/models`、`/v1/chat/completions` |

存储：`<插件根>/<id>.data/`（宿主创建并保证存在）。

---

## 2. 四个贡献面，两个真通、两个空壳

`Contributes`（`src-tauri/src/plugins/manifest.rs`）：

| 字段 | 状态 | 证据 |
|---|---|---|
| `tools: Vec<ToolDecl>` | ✅ **真通**（清单声明 + 运行期 `tools/list` 为真源，已注入 agent） | `manifest.rs`；`src/lib/agent/config.ts:85` |
| `providers: Vec<ProviderDecl>` | ✅ **真通**（v2.0：起 loopback 端点，模型并入 `providerConfigs`） | `manifest.rs`；`src/lib/plugins/provider-sync.ts` |
| `stages: Vec<String>` | ⚠️ **只解析不执行**（且只有名字，没有输入/输出契约） | 全仓无任何 `.stages` 消费点 |
| `panels: Vec<serde_json::Value>` | ⚠️ **只解析不渲染**（前端 grep `contributes.panels` 零命中） | `src/` 无 slot/扩展点机制 |

> 结论：**当前插件不能参与 QMAI 的任何既有工作流，也不能在界面上出现任何一个像素。**

---

## 3. HostApi：3 个端点，1 个是死的

`src-tauri/src/plugins/host_api.rs:468-470`：

| 端点 | 状态 | 说明 |
|---|---|---|
| `GET /host/status` | ✅ 可用 | 返回 pluginId、已授予权限、项目根（恒 null） |
| `POST /host/log` | ✅ 可用 | 插件写日志到宿主日志 |
| `POST /host/project/read` | ❌ **恒返回 `E_NO_PROJECT`** | 见下 |
| `llm` 相关 | ❌ **不存在** | `llm:use` 权限无对应端点 |

**项目根永远是 `None`**（`src-tauri/src/plugins/mod.rs:310-312`）：

```rust
// 项目根暂不注入：宿主还不知道「当前打开项目」。
project_root: None,
```

所以：**`fs:project-read` / `fs:project-write` 在实际运行中不可用**。插件拿不到用户的正文。

> 这解释了为什么「章节体检」插件必须由用户/模型把正文**作为参数传进去**，而不是自己去读当前章节。

---

## 4. 权限系统：声明式的，不是强制式的（**最重要的一节**）

`KNOWN_PERMISSIONS`（`manifest.rs:196-202`）共有 5 条：

| 权限 | 谁检查 | 实际效果 |
|---|---|---|
| `fs:project-read` | `host_api.rs:425`（唯一一处） | 但项目根恒 None → **实际不可用** |
| `fs:project-write` | **无任何端点使用**（只在测试里出现） | **纯装饰** |
| `net:https` | **无** | 插件是独立进程，**不经宿主也能出网** → 纯声明 |
| `net:listen` | **无** | 宿主只负责**分配**端口，不阻止插件绑别的端口 → 纯声明 |
| `llm:use` | **无端点** | **纯装饰** |

**根本原因**：插件是子进程，以用户身份运行，能直接读文件、直接联网。宿主的权限检查只覆盖"**如果你愿意走 HostApi，我会查一下**"。

这不是实现偷懒，而是架构选择的必然结果（设计文档 §13.2 已写"这不是沙箱"）。但**权限列表的措辞让用户以为它是沙箱**，这是当前最大的认知风险。

**要么**把措辞改成"声明/告知"语义，**要么**做真正的强制（Windows Job Object / AppContainer / 独立用户），后者是另一个量级的工程。

---

## 5. 没有 SDK

全仓无插件 SDK 目录。插件作者面对的是：

- 手写 MCP stdio 协议（按行读写 JSON-RPC）
- 手写 HTTP 端点（provider 时）
- 自己拼 `Authorization` 校验
- 没有任何类型定义、没有 helper、没有脚手架

对照 OpenClaw 的 `src/plugin-sdk/`（typed 工具、去重、重放守卫、超时助手等），**我们这一层是空白**。

---

## 6. 模型侧：当前是「4 族渠道」，没有渠道抽象层

模型接入目前按「怎么拿到模型」分 4 族，**provider id 本身就是渠道**，没有独立的 channel 概念：

| 族 | provider | 鉴权 | 实现位置 | 状态 |
|---|---|---|---|---|
| A. API Key 直连 | `openai` `anthropic` `google` `azure` `ollama` `custom` `minimax` | 用户粘贴 key | 前端直连上游 | ✅ 内置 |
| B. 本地 CLI 包装 | `claude-code` `codex-cli` `cursor-cli` `antigravity-cli` | 复用本机已登录 CLI | Rust spawn 子进程 | ✅ 内置 |
| C. 账号登录 + 私有头反代 | `workbuddy` | 内嵌窗口登录 | `workbuddy/gateway.rs` 进程内 OpenAI 网关 | ✅ 内置（**计划退场**） |
| D. 插件 provider | 插件自定义 id | 插件自己管 | 插件起 loopback OpenAI 端点 | ✅ v2.0 新增 |

### D 族的真实边界（v2.0 做了什么、没做什么）

**做到**：
- 宿主分配端口 + 每插件随机 token（**不落盘**，请求前现取）
- `/health` 探活 → `/v1/models` 抓取 → 并入 `providerConfigs`（模型选择/裁剪/统计**零改动复用**）
- 缺失 `maxInputTokens` 的模型被丢弃；小窗口不被用户下限抬高
- 高危确认文案 + provider id 冲突检查（与内置 12 个、与其它插件）

**没做到**：
- **配置**：插件无法向用户索取任何配置（API base、key、地区、模型偏好）→ 见 §7
- **登录**：`authKind: browser-login / paste-token / import-file` 被接受但不实现（v2.1）
- **余额/签到**：`capabilities` 预留但端点未接
- **崩溃自愈**：插件崩溃后 `ready` 仍为 true，直到停用/重启
- **模型能力字段薄**：我们只有 `maxInputTokens/maxOutputTokens/supportsToolCall/supportsVision/creditMultiplier`；
  OpenClaw 的 `modelCatalog` 还有 `cost`（输入/输出/缓存读写）、`input:["text","image"]`、`compat`（`maxTokensField`、`thinkingFormat`、`reasoningEffortMap`、`supportsUsageInStreaming`…）

> 关于 `compat`：我们的契约是「插件自己翻译上游」，所以 quirks 由插件消化，**宿主不需要知道**。
> 这是设计上的简化，代价是**作者门槛更高**。

---

## 7. 三种工作形态 × 当前能力

| 形态 | 需要什么 | 我们有什么 | 结论 |
|---|---|---|---|
| **① 纯工作流**（在章节生成/大纲/导入/润色里插入处理） | 阶段钩子 + 输入输出契约 + 超时/失败策略 | `stages: Vec<String>`（只有名字，不执行） | ❌ **完全不支持**。缺：事件枚举、请求/响应 schema、超时预算、fail-open/closed 策略、串行/并行语义 |
| **② 带界面的**（贡献独立页面/面板） | 面板声明 + iframe/webview 沙箱 + 与宿主通信 + 布局占位 | `panels: Vec<Value>`（不渲染） | ❌ **完全不支持**。前端零 slot 机制 |
| **③ 改造界面的**（在既有 UI 插按钮/替换组件） | 稳定 slot 契约 + 宿主 UI 版本兼容 + 冲突仲裁 | 无 | ❌ **完全不支持**，且比 ② 难一个量级（② 是新增区域，③ 要侵入既有布局） |
| （现有）**工具** | MCP tools | ✅ 真通 | ✅ 可用 |
| （现有）**模型供应** | loopback OpenAI 端点 | ✅ 真通（v2.0） | ✅ 可用，但无配置/无登录 |

**并且三种形态都卡在同一个前置条件上**：**插件没有配置机制**。

任何真实插件都要配置：工作流插件要"在哪一步、用什么阈值"，界面插件要"放哪、显示什么"，provider 插件要"base URL、key、地区"。现在这些**只能硬编码**，或作者自己做 UI——而我们又不支持插件 UI。**这是一个闭环死结。**

---

## 8. 与 OpenClaw 的定位差异（不是优劣，是物种）

| | OpenClaw | QMAI 当前 |
|---|---|---|
| 执行 | 进程内，无沙箱 | 子进程 + 端口 + token |
| 接口 | 私有 API，30+ 注册方法 | MCP over stdio（标准） |
| 清单 | **声明式**，不执行代码即可回答"提供什么/怎么配/怎么显示" | 只描述"怎么启动"，**必须执行才知道提供什么** |
| 扩展点 | 30+（channel/provider/memory/context-engine/hook/service/command/cli…） | **2**（tools / providers） |
| 配置 | `configSchema` 必填 + `uiHints` → 宿主自动渲染设置界面 | **无** |
| SDK | `src/plugin-sdk/`（多组 typed helper） | **无** |
| 插件数量 | 180 | 2（样例） |

我们做对的地方（OpenClaw 自己说"不要抄"的两条，我们做到了）：**子进程隔离**、**安装期不执行任何代码**。

---

## 9. 缺的三块地基（按依赖顺序）

做任何新形态之前，这三块必须按序补：

### 地基 1：**插件配置机制**（所有形态的前置）
- `plugin.json` 增加 `configSchema` + 可选的 `uiHints`（label/placeholder/secret/enum 选项）
- 宿主按 schema **自动渲染设置表单**（通用表单，不需要插件做 UI）
- 配置值经环境变量或 `initialize` 注入插件
- 敏感字段（key）**不落明文**，与 provider token 同一套内存策略
- 校验：值与 schema 不符 → 拒绝启用并给出可读原因

### 地基 2：**静态声明面**（免执行发现）
- 清单里可选声明：提供哪些工具（名字+简述）、哪些 provider、哪些模型
- 用途**仅限展示与安装前预览**；**调用真源仍是运行期**
- 两者不一致 → 警告 + 以运行期为准（保住 v2.0 的 D2 决策）

### 地基 3：**SDK + 脚手架**
- Node SDK：stdin 循环、`initialize`/`tools/list`/`tools/call` 分发、`isError` helper、日志走 stderr、优雅退出
- provider helper：健康端点、认证中间件、SSE 分片与 usage、断开即停上游
- `create-qmai-plugin` 脚手架：一条命令生成可跑的骨架 + 本地安装说明

**三块都完成后**，才谈得上：
- 形态 ①：需要再定「事件枚举 + 输入输出契约 + 超时/失败策略」
- 形态 ②：需要再定「面板沙箱（iframe vs webview）+ 通信协议 + 布局占位」
- 形态 ③：需要再定「slot 契约 + UI 版本兼容」，风险最高，建议最后一个做

---

## 10. 附：当前实现的已知缺陷（与本次分析同时发现）

| # | 缺陷 | 证据 | 影响 |
|---|---|---|---|
| 1 | **工具调用持有全表锁 30 秒** | `mod.rs` `plugins_invoke_tool` 里 `state.running.lock()` 跨 `timeout(30s)` | 一个慢调用卡住所有插件操作 |
| 2 | 超时不取消 | 同上，只 drop future，不发 MCP `notifications/cancelled` | 插件继续空转 |
| 3 | 崩溃不自愈 | `providers.ready` 只在启动探活时设置 | 崩溃后仍显示"就绪" |
| 4 | `requires.qmai` 不校验 | `manifest.rs` 只解析 | 版本不兼容时装上才炸 |
| 5 | 更新时无「能力面变更重同意」 | 无更新功能，无 surface hash | 未来安全缺口 |
| 6 | 插件无存储配额 | 直接写 `<id>.data/` | 失控插件可占满磁盘 |
