# 插件 Provider 扩展点 —— v2 设计增量

> **定位**：v1（开放插件系统）只支持"插件给 AI 加工具"。本文定义 v2：**插件给软件加模型**，
> 让用户在 GitHub 上找到的、或官方发布的 provider 插件，能直接出现在模型选择器里。
>
> **与 v1 的关系**：纯增量。v1 的 8 个 Rust 模块与工具链路一行不改；本文只新增协议字段、
> 一条新权限、以及 QMAI 核心的 provider 注册机制。
>
> **为什么单独成文**：provider 扩展点会碰 QMAI 的模型主干（provider 类型、模型列表、
> 上下文裁剪、用量统计），风险比 v1 高一个量级，必须先有设计再动代码。

---

## 0. 一句话结论

**统一契约 = 插件在 `127.0.0.1` 上提供 OpenAI 兼容端点（`/v1/models` + `/v1/chat/completions`），
QMAI 把它当成一个普通供应商来消费。** 插件内部怎么登录、怎么换号、怎么反代，QMAI 一律不管。

这个契约不是新发明——**QMAI 自己就是这么接 WorkBuddy 的**（`src-tauri/src/workbuddy/gateway.rs`）。
v2 要做的是把主客颠倒：现在 QMAI 起网关去代理上游，v2 里**插件**起网关，QMAI 去消费。

---

## 1. 为什么要 v2：v1 的扩展点覆盖不到

v1 的 `plugin.json` 只暴露三种贡献：

| 字段 | 状态 | 能做什么 |
|---|---|---|
| `contributes.tools` | ✅ 可用 | 插件给 Agent 加工具 |
| `contributes.stages` | ⚠️ 只解析 | 阶段钩子（未执行） |
| `contributes.panels` | ⚠️ 只解析 | 界面插件（未渲染） |

**没有 `providers`。** 一个插件能给 AI 加"工具"，不能给软件加"模型"。

这两件事不能用同一套机制，因为调用方向和数据流向是相反的：

| 维度 | 工具插件（v1） | Provider 插件（v2） |
|---|---|---|
| 谁发起调用 | QMAI → 插件（模型决定调工具） | 插件 → 上游（QMAI 请插件代调模型） |
| 数据流向 | 项目内片段（一章正文、一条记忆） | **用户全部对话内容** |
| 返回形态 | 一段文本 | **流式 token 流**（要支持中断、裁剪、用量统计） |
| 失败影响 | 一个工具报错 | 整个写作会话不可用 |
| 生命周期 | 随用随停 | 常驻、需探活、需列模型 |

v1 的权限集（`fs:project-read` / `fs:project-write` / `net:https` / `llm:use`）里，
**没有任何一条适合"我要充当模型供应商"**。

---

## 2. 现状证据：QMAI 已有的三种接入形态

当前内置 11 个 provider（`src/components/settings/llm-presets.ts:16-26`），
按"怎么拿到模型"分三族：

| 族 | provider | 鉴权方式 | QMAI 现在怎么做 |
|---|---|---|---|
| **A. API Key 直连** | `openai` `anthropic` `google` `azure` `ollama` `custom` `minimax` | 用户粘贴 key | 前端直连上游 |
| **B. 本地 CLI 包装** | `claude-code` `codex-cli` `cursor-cli` `antigravity-cli` | 复用本机已登录的官方 CLI | Rust spawn 子进程，`src-tauri/src/commands/{claude,codex,cursor,antigravity}_cli.rs` |
| **C. 账号登录 + 私有头部反代** | `workbuddy` | 内嵌窗口登录 / 导入凭证 | Rust 侧带 token + 私有头打上游，`gateway.rs` 起 OpenAI 兼容网关 |

**你要退场的是 C 族**——因为 C 族意味着 QMAI 自己在持有第三方账号凭证、
并以自己的名义反代对方的模型。A 族（用户自己的 key）与 B 族（跑用户本机已装的官方 CLI）
不构成同一个问题。

v2 的目标：**C 族以及对未来的 Qoder / Trae / 小浣熊，一律做成插件；核心不再内置任何 C 族实现。**

---

## 3. 核心契约：Provider 端点

### 3.1 端点要求

插件必须在 `127.0.0.1:<port>` 上提供**最小 OpenAI 兼容面**：

| 方法 | 路径 | 必需 | 说明 |
|---|---|---|---|
| GET | `/health` | 是 | 探活，返回 2xx 即可；宿主用它在启用/自动启动后确认插件真的能服务 |
| GET | `/v1/models` | 是 | 返回 `{"data":[{"id":"...","object":"model", ...}]}`；可含 `_qmai` 扩展字段（见 3.3） |
| POST | `/v1/chat/completions` | 是 | 支持 `stream: true` 的 SSE |
| POST | `/v1/embeddings` | 否 | 若插件提供向量能力（v2 不接，占位） |
| GET | `/login`(或清单声明) | 否 | 登录页，见第 5 章 |

**为什么不做 `/v1/responses` 与 `/v1/messages`**：QMAI 只走 chat 一条线
（`gateway.rs` 模块头已写明同一取舍）。多实现两条协议等于多两套要跟着上游变的东西。

### 3.2 SSE 硬要求（最容易搞坏的地方）

`gateway.rs` 的注释专门警告过：上游响应本身是 OpenAI chat SSE，**不解析、不重组、直接字节流转发**，
因为"少一层改写就少一处会吃掉 `[DONE]`、吃掉空行保活帧、或把 usage 帧弄丢的地方"。

对插件的要求：

1. `[DONE]` 帧必须原样出现在最后。
2. 空行保活帧可以透传（QMAI 的流式超时按"数据块间隔"计，保活帧能续命）。
3. **最后必须带 usage**：要么在 SSE 里有一个含 `usage` 的 chunk（`stream_options.include_usage` 语义），
   要么在响应头/最后事件里给。没有 usage → QMAI 的用量统计会全是 0。
4. 客户端断开（`AbortSignal`）时，插件必须停止向上游请求——否则用户的额度会继续被消耗。

### 3.3 端口与令牌注入

复用 v1 已有的 `_qmai` 扩展字段，宿主在 `initialize` 里注入：

```jsonc
{
  "jsonrpc": "2.0", "id": 1, "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "clientInfo": { "name": "qmai", "version": "4.5.0" },
    "capabilities": { "tools": {}, "providers": {} },   // ← v2 新增能力位
    "_qmai": {
      "pluginId": "wb-connect",
      "hostUrl": "http://127.0.0.1:51234",
      "hostToken": "…",
      "grantedPermissions": ["net:listen", "net:https"],
      "provider": {                                     // ← v2 新增
        "port": 51235,
        "token": "…",                                   // 插件必须校验此令牌
        "baseUrl": "http://127.0.0.1:51235"
      }
    }
  }
}
```

**端口由宿主分配**（bind 0 拿号后关掉，把号给插件），避免两个插件抢端口。
插件启动端点后应回报可用性，宿主用 `/health` 确认。

**令牌**：与 v1 的 `hostToken` 同构——每插件一份、随机、只存内存。插件收到的每个请求
必须校验 `Authorization: Bearer <providerToken>`，否则本机任何进程都能白嫖该插件
（进而白嫖用户的账号额度）。

### 3.4 模型目录与能力字段（**裁剪的前提**）

`/v1/models` 的每个模型除 OpenAI 标准字段外，用 `_qmai` 子对象声明能力：

```jsonc
{
  "id": "glm-5.3",
  "object": "model",
  "owned_by": "workbuddy",
  "_qmai": {
    "displayName": "GLM-5.3",
    "maxInputTokens": 200000,        // ★ 必需
    "maxOutputTokens": 8192,         // ★ 必需
    "supportsToolCall": true,
    "supportsVision": false,
    "supportsReasoning": true,
    "creditMultiplier": 0.79,        // 上游给的倍率，只用于显示
    "contextWindowSource": "declared" // declared | measured | unknown
  }
}
```

**`maxInputTokens` 为什么是必需而不是可选**：QMAI 的上下文裁剪（
`src/lib/context-budget.ts`、`resolveContextPackTokenBudget`）依赖模型的上下文窗口。
声明缺失或填错 → 长篇写作会**静默截断**或**请求超限 400**。这是长篇场景下最贵的一类 bug，
所以列为契约硬要求，缺失即拒绝该模型（不是拒绝整个插件）。

`creditMultiplier` 只做展示（卡片/选择器上的 `x0.79`），QMAI **不参与计费**。

---

## 4. `plugin.json` 增量（schema 2）

> **重要**：v1 的清单是**封闭契约**（`deny_unknown_fields`），并规定"新增字段必须 bump schema"。
> 所以本增量把 `schema` 从 `1` 提到 `2`。**v1 宿主会拒绝 schema 2 的清单**——这是有意的：
> 老版本遇到带 providers 的插件应当明说"需要更新版本"，而不是装上一个永远不会出现在模型列表里的插件。

### 4.1 新增字段

```jsonc
{
  "schema": 2,

  "contributes": {
    "providers": [
      {
        "id": "workbuddy",                 // 全局唯一；不得与内置 provider 或其它插件冲突
        "name": "WorkBuddy（国内版）",
        "description": "本机已登录的 WorkBuddy 账号",
        "authKind": "browser-login",       // browser-login | paste-token | import-file | none
        "settingsPagePath": "/login",      // 可选：插件自托管的登录/设置页（见第 5 章）
        "authDomains": ["workbuddy.cn", "accounts.google.com"],  // 登录窗口导航白名单
        "modelsEndpoint": "/v1/models",    // 可选，默认 /v1/models
        "chatEndpoint": "/v1/chat/completions",
        "healthEndpoint": "/health",
        "capabilities": ["models.refresh", "balance.query", "checkin"]  // 可选，见 4.3
      }
    ]
  },

  "permissions": ["net:listen", "net:https"]
}
```

### 4.2 字段约束

| 字段 | 必需 | 约束 | 错误码 |
|---|---|---|---|
| `providers[].id` | 是 | `^[a-z][a-z0-9-]{1,31}$`；不得与内置 provider（`openai`/`anthropic`/`google`/`azure`/`ollama`/`custom`/`minimax`/`claude-code`/`codex-cli`/`cursor-cli`/`antigravity-cli`）冲突，也不得与已安装插件的 provider 冲突 | `E_PROVIDER_ID_CONFLICT` |
| `providers[].name` | 是 | 1–64 字符 | `E_PROVIDER_NAME_INVALID` |
| `providers[].authKind` | 是 | 四选一 | `E_AUTH_KIND_INVALID` |
| `providers[].settingsPagePath` | 否 | 必须以 `/` 开头、不得含 `..`、不得是绝对 URL | `E_SETTINGS_PAGE_INVALID` |
| `providers[].authDomains` | `authKind=browser-login` 时必需 | 每项为主机后缀（如 `qoder.com`），**不允许通配 `*`**、不允许 IP | `E_AUTH_DOMAIN_INVALID` |
| `providers[].capabilities` | 否 | 白名单：`models.refresh` / `balance.query` / `checkin` | `E_PROVIDER_CAPABILITY_UNKNOWN` |
| 声明了 `providers` 但无 `net:listen` 权限 | — | 拒绝，避免"声明了却绑不了端口"的诡异状态 | `E_PROVIDER_REQUIRES_NET_LISTEN` |

### 4.3 `capabilities` 的用途

只影响**界面按钮是否显示**，不改变协议：

| capability | 界面表现 |
|---|---|
| `models.refresh` | 该 provider 卡片上显示「刷新模型列表」按钮 |
| `balance.query` | 卡片上显示余额/积分区（QMAI 调插件的 `/v1/_qmai/balance`，见 4.4） |
| `checkin` | 卡片上显示「每日签到」按钮（QMAI 调 `/v1/_qmai/checkin`） |

**为什么把这几个做成能力位而不是必需**：它们不是所有 provider 都有（API Key 类没有签到），
硬塞会让插件被迫实现空壳端点。

### 4.4 可选扩展端点

只有在声明了对应 capability 时才需要实现：

| 方法 | 路径 | 返回 |
|---|---|---|
| POST | `/v1/_qmai/balance` | `{"items":[{"label":"积分","value":"1,234"}]}` |
| POST | `/v1/_qmai/checkin` | `{"ok":true,"message":"已签到"}` |

QMAI 只负责渲染，不理解语义。

---

## 5. 登录与设置界面：插件自托管 + 受控窗口

这是 v2 里**第二个必须解决的问题**——provider 插件多半要登录，而 v1 的 `panels` 不渲染。

### 5.1 方案：插件提供页面，QMAI 用受控窗口打开

`authKind = browser-login` 的插件在 `settingsPagePath` 提供一个自托管页面（可以是极简表单，
也可以是"打开官方登录页"的按钮）。QMAI 在用户点「登录 / 设置」时，用**受控 WebView 窗口**
打开 `http://127.0.0.1:<providerPort><settingsPagePath>`。

**直接复用 `src-tauri/src/workbuddy/login_window.rs` 已验证的三条做法**（该文件模块头写明了理由）：

| 做法 | 理由（原文要点） |
|---|---|
| 每次登录**新建临时数据目录**，关窗即删 | WebView2 的 Cookie 按数据目录存放；共用目录会让"加第二个账号"时上一个账号自动放行，用户没机会换人 |
| **不开** `incognito(true)` | 隐私模式会让 Google/GitHub 等身份方判定为"不支持登录的浏览器"而拒绝 |
| **不改 UA** | 主动拼 UA 反而与 `Sec-CH-UA` 头不一致；"UA 与客户端提示头打架"在风控里比"多一个 Electron 段"更显眼 |

### 5.2 导航白名单必须来自清单，且由 QMAI 强制

v1（WorkBuddy）的白名单是代码里写死的域名后缀。v2 必须改成**从 `authDomains` 读取**，
因为插件是第三方写的。

规则：

1. 只放行 `http`/`https` + 清单声明的主机后缀（含其子域）。
2. 始终放行 `about:` / `data:` / `blob:`（页面自身需要）。
3. **其余一律拦截**，并在窗口内给出可读提示（不是白屏）。
4. `authDomains` 里出现 IP、`*`、`localhost`、或以 `.` 开头的裸后缀 → 拒绝安装。

> 这条是整个 v2 里**最需要认真实现的限制**：登录窗口本质是一个浏览器。白名单一旦松，
> 插件就能把 QMAI 变成一个"任意网页浏览器"，用户在里面输入的任何凭据都会被插件看到。

### 5.3 其它 `authKind`

| authKind | QMAI 侧表现 |
|---|---|
| `paste-token` | 卡片上给一个输入框，用户粘贴 → 经 HostApi 转交插件（`POST /host/provider/credential`），**QMAI 不落盘** |
| `import-file` | 走现有文件选择器，把文件**内容**转交插件，同样不落盘 |
| `none` | 无登录 UI（例如纯本地推理端点） |

**凭证归属铁律**：QMAI 只在内存里中转一次，**绝不写入任何 QMAI 自己的存储**。
插件自己决定存哪（活该在 `<插件根>/<id>.data/`）。

---

## 6. QMAI 核心改造清单

### 6.0 先纠正一个估算：**存储层已经是开放的，不需要改**

初稿把这里估成"6–8 文件 + 一个大 switch 的重构"。核实代码后要修正：**运行时配置存储本来就是开放的**。

```ts
// src/stores/wiki-store.ts:613
export type ProviderConfigs = Record<string, ProviderOverride>
```

而 `ProviderOverride`（`wiki-store.ts` 内）已经正好具备插件 provider 需要的全部字段：
`baseUrl`（端点）、`apiKey`（用来放 provider token）、`model` / `savedModels`（模型清单）、
`maxContextSize` / `maxOutputTokens`（裁剪依据）、`label`（显示名）。

**含义**：插件 provider 只要往 `providerConfigs[providerId]` 写一条记录，
下游所有既有逻辑（模型选择、裁剪、测试、统计）就都能沿用它 —— 不需要新的存储形态。

同样地，**跨 provider 的模型复合键也已经存在**（见 `src/lib/llm-model-keys.ts` 的
`getStableAvailableModelKey` 与 `src/lib/novel/model-resolver.ts` 的 `isModelKeyRegistered`）：

```
providerId/modelId        // 例：openai/gpt-4、wb-connect/glm-5.3
```

它已经被历史数据使用（`dedup-scan-cache.spec.ts` 的 `"openai/gpt-4"`），
解析与校验都是现成的。**所以第 11 章问题 1 的答案是"沿用既有约定"，不是新设计。**

真正要改的只剩下面这些（**封闭的是"类型声明"与"请求构造分支"，不是存储**）：

### 6.1 封闭 provider 联合 → 开放字符串

| 文件:行 | 内容 | 改法 |
|---|---|---|
| `src/stores/wiki-store.ts:236` | `provider: "openai" \| … \| "workbuddy"` | 改成 `LlmProviderId` 类型别名 = 内置字面量 `\| (string & {})`，保留字面量的自动补全 |
| `src/components/settings/settings-types.ts:15` | 同上 | 同上 |
| `src/components/settings/settings-types.ts:42` | `multimodalProvider` 同款联合 | 同上 |
| `src/components/settings/llm-presets.ts:16-26` | `LlmProviderId` 联合 | 同上；`LLM_PRESETS` 保持内置不变 |
| `src/lib/llm-providers.ts:1332-1513` | `switch (provider)` 十个 case | 改为 `resolveProviderAdapter(id)`：内置走原 case，插件 provider 走统一适配器 |
| `src/lib/has-usable-llm.ts:15,62` | `PRESET_ID_BY_PROVIDER` 映射 | 插件 provider 在此查不到 → 走"运行期已注册且有模型"分支 |
| `src/components/settings/preset-resolver.ts:116` | `else if (preset.provider === "workbuddy")` | 改为"若 preset 有 runtime endpoint 就套用"，与 provider 名解耦 |
| `src/lib/settings-model-list.ts:241` | workbuddy 特判 | 同上 |
| `src/lib/llm-client.ts:441` | workbuddy gateway 注入 | 改为 `ensureProviderEndpoint(providerId)` |

### 6.2 新增运行期注册表

Rust 侧（`src-tauri/src/plugins/provider.rs`，新文件）：

```rust
pub struct PluginProvider {
    pub plugin_id: String,
    pub provider_id: String,
    pub name: String,
    pub base_url: String,          // http://127.0.0.1:<port>
    pub token: String,             // providerToken，注入到前端用于 Bearer
    pub capabilities: Vec<String>,
    pub settings_page: Option<String>,
}

/// 已就绪的 provider（进程在跑且 /health 通过）
pub fn list_ready() -> Vec<PluginProvider>;
```

新命令：

| 命令 | 用途 |
|---|---|
| `plugins_providers()` | 列出已就绪的插件 provider |
| `plugins_provider_health(id)` | 手动探活 |
| `plugins_provider_open_settings(id)` | 打开受控登录窗口（第 5 章） |
| `plugins_provider_submit_credential(id, text)` | `paste-token` / `import-file` 的中转 |
| `plugins_provider_call(id, endpoint, body)` | 转发 `/v1/_qmai/balance`、`/v1/_qmai/checkin` |

### 6.3 模型列表合并

`/v1/models` 的插件模型要与内置模型合并进同一个选择器：

- 排序：内置在前，插件按 `provider name` 分组在后。
- 冲突：插件模型 id 若与内置同名（如都叫 `glm-5.3`），**必须带 provider 前缀显示**（`WorkBuddy · GLM-5.3`），
  id 层面用 `providerId/modelId` 区分，避免选错上游。
- 探活失败：该 provider 整组**灰显 + 说明原因**，不隐藏（隐藏会让用户以为是 BUG）。

### 6.4 用量统计与裁剪怎么接

| 机制 | 现状 | v2 要求 |
|---|---|---|
| 上下文裁剪 | 依赖 `maxInputTokens` | 插件必须在 `/v1/models` 声明；缺失则该模型不可选（见 3.4） |
| 用量统计 | 读响应的 `usage` | 插件必须回传 usage（见 3.2） |
| 中断 | 前端 `AbortSignal` | 插件必须真的停上游（见 3.2） |
| 重试/降级 | 内置 provider 有 `max_tokens` 降级逻辑 | v2 **不做**：插件 provider 只按原样转发，降级由插件自己决定 |

---

## 7. 信任与权限：provider 插件要单列高危档

v1 的插件已经有权限体系，但 **provider 插件拿到的数据等级完全不同**：

| | 工具插件 | Provider 插件 |
|---|---|---|
| 能看到什么 | 它被调用时的那一段上下文 | **用户与模型的完整对话**（全书设定、剧情、人物、全部正文） |
| 能做什么 | 返回一段文本 | 决定模型回什么，且能把内容发到任意上游 |
| 失败影响 | 一个工具不可用 | 整个写作会话不可用 |

因此：

1. **单独的高危确认层**，文案要具体，不用"该插件可能访问网络"这种空话。建议文案：
   > 该插件会成为你的模型供应商：你对 AI 说的每一句话、以及软件送给 AI 的全部上下文
   > （包括你这本书的设定、剧情和已写正文）都会经过它。它还可能把这些内容发往它自己的上游服务。
   > 请只安装你信任来源的 provider 插件。

2. **权限位**：`providers` 类插件必须同时申请 `net:listen` + `net:https`；
   未申请则拒绝启用（`E_PROVIDER_REQUIRES_NET_LISTEN`）。

3. **展示来源**：模型选择器里，插件模型必须带 provider 名与插件 id，
   不能与内置模型混成一片让用户分不清谁在收他的数据。

4. **卸载即失效**：停用/卸载插件必须同时让该 provider 从模型列表消失、并清理前端缓存的 baseUrl/token。

---

## 8. 迁移与退场：WorkBuddy 内置功能怎么下车

这是**风险最高的一步**，必须按顺序。

### 阶段 0（当前）：核心内置 WorkBuddy，无 provider 插件

不动。

### 阶段 1：v2 落地，两者并存

- 核心的 `workbuddy` provider 保留。
- 同时发布一个**官方 provider 插件**（`qmai-plugin-workbuddy`），它能实现同样的能力。
- 用户二选一；两条路都可用。
- **此时不删任何东西**。目的是验证插件路线真的能承载真实 provider（含登录、换号、倍率、签到）。

### 阶段 2：切换默认

- 新用户默认走插件；老用户保持原有内置 provider（按 `providerConfigs` 里已有数据判定）。
- 内置 provider 卡片上加一行提示：「该能力即将迁移到插件，可在插件中心安装同名插件」。

### 阶段 3：摘除

- 核心删除 `workbuddy` 内置 provider 与 `src-tauri/src/workbuddy/` 的账号/网关部分。
- **必须提供数据迁移**：把核心 `providerConfigs.workbuddy` 里的账号导出给插件
  （或至少提示用户"在插件里重新登录一次"）。**不能静默丢账号**。
- 保留的只有：`workbuddy-gateway.ts` 里那套"端点注入"逻辑（改为通用 provider 端点）。

### 阶段 4：后续 provider 一律插件

Qoder / Trae / 小浣熊 / 以及未来任何"账号登录 + 私有头部"的 Agent，
**从一开始就只做插件，不进核心**。

> **为什么必须先并存再摘除**：如果先删内置、插件还没稳，用户会经历一段"能用 → 不能用"的空窗。
> 这个窗口里丢的是付费用户的信任，比多维护一个 provider 几个月贵得多。

---

## 9. 端到端验收清单（v2）

前置：v1 的验收（`2026-10-27-开放插件系统-验收清单.md`）全过。

### 9.1 契约层

- [ ] 装一个 schema 2 的 provider 插件，`plugins_providers()` 能列出它，`baseUrl` 是 `127.0.0.1:<port>`
- [ ] 不带 `Authorization: Bearer <providerToken>` 直接访问该端点 → **401**（本机其它进程白嫖不了）
- [ ] `/health` 探活失败时：provider 在界面上灰显并给出原因，而不是消失
- [ ] 缺 `maxInputTokens` 的模型：该模型不可选，且提示"未声明上下文窗口"；同一插件的其它模型仍可用

### 9.2 使用层

- [ ] 在模型选择器里能看到插件模型，且带 provider 名（不与内置混同）
- [ ] 选它写一章，**流式输出正常**（不是一次性蹦出）
- [ ] 生成中点「停止」→ 输出立即停止，**且上游真的停了**（用插件日志确认没有继续请求）
- [ ] 生成后看用量统计：**token 数不为 0**
- [ ] 长篇（超过该模型 `maxInputTokens` 的一半）生成时，上下文裁剪生效且不报 400
- [ ] 工具调用：该 provider 支持 tool call 时，Agent 的工具能正常往返

### 9.3 登录与凭证

- [ ] `browser-login`：点登录 → 打开受控窗口 → 能完成登录 → 关窗后插件拿到凭证
- [ ] 登录窗口里手动导航到**清单未声明**的域名 → 被拦截，有可读提示
- [ ] `paste-token`：粘贴后 QMAI 的存储里**搜不到**该凭证（确认只走内存中转）
- [ ] 卸载插件后：模型列表里该 provider 消失，`providerConfigs` 里没有残留 baseUrl/token

### 9.4 安全与责任

- [ ] provider 插件的启用确认层显示的是第 7 章那段**具体文案**（不是泛泛的"可能联网"）
- [ ] 只申请 `net:https` 却声明了 `providers` → 安装被拒，错误码 `E_PROVIDER_REQUIRES_NET_LISTEN`
- [ ] provider id 与内置（如 `openai`）或另一个插件冲突 → 安装被拒，`E_PROVIDER_ID_CONFLICT`
- [ ] 停用插件后，模型选择器里不再出现它的模型

### 9.5 迁移（阶段 2/3 时）

- [ ] 老用户（核心内置 workbuddy 有账号）升级后：原有账号仍可用，且界面提示可迁移
- [ ] 迁移到插件后：模型列表、倍率、签到等行为一致
- [ ] 核心摘除后：`providerConfigs` 里的历史 workbuddy 数据不被静默丢弃（有迁移或明确提示）

---

## 10. 分期

| 版本 | 内容 |
|---|---|
| **v2.0（最小可用）** | `contributes.providers` + `net:listen` + OpenAI 兼容端点的 `/health`/`/v1/models`/`/v1/chat/completions` + 动态 provider 注册表 + 模型列表合并 + 高危确认。**不做登录窗口。** 用一个"无登录"的 provider 插件（例如转发到用户已有 key 的本地端点）验证全链路。 |

**v2.0 的实际工作量（按 6.0 核实后重估）**：

三件事，其中前两件是机械性的：

1. **打开类型**：`LlmConfig.provider` / `settings-types` / `LlmProviderId` 从封闭联合改为
   `内置字面量 | (string & {})`（保留内置的自动补全）。约 4 处。
2. **一个通用适配器**：`llm-providers.ts` 的 `switch` 加一个 `default` 分支——
   "OpenAI 兼容 + `providerConfigs[id].baseUrl` + `bearer providerToken`"。
   **不是把 10 个 case 重构成查表**（我初稿估错了），内置分支原样保留。
3. **设置页运行期注入**：`LLM_PRESETS` 是静态数组，设置页按它渲染卡片。
   插件 provider 需要在运行时追加为一张卡片（含「登录/设置」「刷新模型」两个入口）。
   **这是 v2.0 唯一有产品设计含量的部分。**

**存储层、复合键、裁剪、统计、测试全部零改动** —— 见 6.0。
| **v2.1** | 受控登录窗口（`browser-login` + `authDomains` 白名单）+ `paste-token` / `import-file` 中转 + `capabilities` 三个扩展端点（倍率/余额/签到展示） |
| **v2.2** | 官方 WorkBuddy provider 插件（阶段 1 并存）+ 迁移工具 |
| **v2.3** | 阶段 2 切换默认；阶段 3 摘除核心内置（需另写迁移方案） |

**v2.0 就能验证最关键的两个假设**：插件能否真的当供应商、QMAI 的裁剪/流式/统计能否无改动复用。

---

## 11. 已知风险与已定决策

### 风险

1. **上下文裁剪与插件的模型声明不一致**：插件可能把 `maxInputTokens` 报大（让用户能塞更多），
   实际上游会 400。QMAI 无法验证 → 只能给出"若频繁超限请检查插件声明的上下文窗口"的诊断提示。
2. **流式断开的泄漏**：插件不实现"客户端断开即停上游"，用户点停止后额度继续被烧。
   契约里写了要求，但**无法强制**。缓解：在 provider 插件的详情里标注"已声明支持中断"，并记录实测。
3. **白名单被绕过**：登录窗口是浏览器，白名单逻辑一旦有洞（比如重定向、`about:blank` 后续导航），
   插件就能看到用户在窗口里输入的任何东西。**这是 v2.1 最需要 review 的一段代码。**
4. **provider 插件成为单点**：一个插件挂了，用户所有会话不可用。需要"切回内置 provider"的清晰退路。
5. **责任归属更难划**：v1 里插件做错事影响一个工具；v2 里它决定模型回什么。
   即使做成插件，若由官方发布，责任仍在发布方（与 v1 的 内置/外部 讨论同构）。

### 已定决策（v2.0 实现前必须服从）

#### D1. 模型标识：沿用既有的 `providerId/modelId`

**决定**：插件模型的规范键就是 `providerId/modelId`（例：`wb-connect/glm-5.3`）。

**依据（不是偏好，是既有事实）**：
- `src/lib/llm-model-keys.ts` 的 `getStableAvailableModelKey()` 返回的正是这个形状，且已做"先按前缀精确匹配、匹配不上再按裸名扫描所有 provider"的两级回退；
- `src/lib/novel/model-resolver.ts` 的 `isModelKeyRegistered()` 用 `indexOf("/")` 解析它；
- 历史数据里已经在用：`src/lib/dedup-scan-cache.spec.ts` 的 `"openai/gpt-4"`、
  `src/lib/novel/book-analysis/analysis-pipeline-types.ts:111` 明确写着"任务使用的模型 key（`providerId/modelId` 或裸模型名）"。

**所以"影响历史会话兼容性"这个担心不成立**——这个形状已经是既成事实，插件 provider 是**加入**它，不是改变它。
界面展示用 provider 名做分组前缀（`WorkBuddy · GLM-5.3`），但那只是展示，键仍是复合键。

**约束**：`providerId` 必须满足 `^[a-z][a-z0-9-]{1,31}$` 且不含 `/`，否则复合键会产生歧义（解析用 `indexOf("/")`，第一个斜杠前是 provider）。

#### D2. 模型的真源：`/v1/models`，清单只作安装前预览

**决定**：以插件端点的 `/v1/models` 为唯一真源；`plugin.json` 里的 `models` 仅用于
"安装前让用户知道这个插件大概能提供什么"，**永远不进入可选列表**。

**依据**：与 v1 已确立的原则一致（"工具真源是运行期 `tools/list`，清单那份只用于预览"），
避免两份真源漂移——这正是设计文档 §6.3 引用的 DSH 教训。

**落地方式**：插件 `/v1/models` 的结果写入 `providerConfigs[providerId].savedModels`，
之后模型选择器、裁剪、测试、统计**全部走既有逻辑**（见 6.0）。

#### D3. 凭证：插件绝不能复用 QMAI 已存的第三方 key

**决定**：插件 provider 的 `providerConfigs[providerId].apiKey` 只能放**该插件自己发放的
provider token**（宿主为它生成的随机令牌）。**禁止**从任何内置 provider 的 `apiKey` 取值或拷贝。

**依据**：内置 `providerConfigs["openai"].apiKey` 是用户自己的付费凭证。
把它交给第三方插件代码，等于让插件可以脱离 QMAI 直接消耗用户额度、且 QMAI 无法审计——
这与"把 provider 移出核心以降低风险"的目标完全相反。

**实现约束**：宿主在生成 `providerConfigs[providerId]` 时，`apiKey` 字段**只接受**
`provider.token`（宿主自己生成的），不接受任何外部传入值。代码评审时这一处要单独看。

#### D4. 端口：只允许宿主分配，插件不得自选

**决定**：`net:listen` 语义严格限定为"在宿主分配的端口上绑定 `127.0.0.1`"。
插件自选端口、绑 `0.0.0.0`、绑非回环地址，一律拒绝启用。

**依据**：`src-tauri/src/workbuddy/gateway.rs` 模块头已经踩过并写明：
「只绑 `127.0.0.1`，端口取 `0`（内核分配），**不固定 3065** ——
用户可能自己装着一个 Agent2API，抢端口会让两边都莫名其妙」。

**附带要求**：宿主分配的端口在插件停用/卸载后必须回收；同一端口不得同时分配给两个插件；
绑定失败（被占用）时宿主**重新分配一次**，仍失败则报 `E_PROVIDER_PORT_UNAVAILABLE` 并让插件停在未就绪态。

---

## 12. 修正后的一致性检查

上述四条决策与正文其余部分的一致性：

| 决策 | 影响的正文位置 | 是否需要改正文 |
|---|---|---|
| D1 复合键 | 3.4 模型目录、6.3 冲突处理 | 6.3 原文说"用 `providerId/modelId` 区分"——已一致 ✓ |
| D2 端点真源 | 4.1 清单 `models` 字段 | 已在 4.1 标注为"可选，仅预览" ✓ |
| D3 凭证隔离 | 5.3 凭证归属铁律 | 已一致 ✓ |
| D4 端口分配 | 3.3 端口与令牌注入 | 已写"端口由宿主分配" ✓ |

---

## 附：与 v1 的关系一览

| 项 | v1 | v2 |
|---|---|---|
| `plugin.json` schema | 1 | **2**（新增 `contributes.providers`、`authDomains`、`capabilities`） |
| 权限 | `fs:project-read` / `fs:project-write` / `net:https` / `llm:use` | 新增 **`net:listen`** |
| 传输 | MCP stdio（工具） | 不变；**新增** loopback HTTP（provider） |
| 扩展点 | `tools` / `stages`(仅解析) / `panels`(仅解析) | 新增 **`providers`** |
| 信任档 | 一档（按权限勾选） | **新增 provider 高危档**（第 7 章） |
| 核心改动 | 新增 8 个 Rust 模块 | **改 provider 主干**（第 6 章） |
| 是否可独立回滚 | — | 可以：v2 失败时保留内置 provider 即可，不影响 v1 |
