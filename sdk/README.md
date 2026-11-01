# QMAI 插件 SDK（`sdk/`）

写一个 QMAI 插件需要做对的事情有两类：**协议**（MCP stdio 那一套、provider 端点的鉴权与 SSE）
与**清单**（`plugin.json` 是封闭契约，字段拼错会直接拒装）。这两类都与你的插件想做的事无关，
但任一处写错插件就不可用。

这个 SDK 把那两类收走：**你只写业务，协议和清单校验交给它。**
配套的实践文档是 [`docs/plugins/authoring-guide.md`](../docs/plugins/authoring-guide.md)，
设计依据是 [`docs/superpowers/specs/2026-10-28-插件平台v3-设计.md`](../docs/superpowers/specs/2026-10-28-插件平台v3-设计.md) 第 9 章。

---

## 0. 三条必须先知道的事实

1. **SDK 不会被 QMAI 运行时安装或加载。** 宿主既不 `npm install`、也不跑任何构建脚本
   （安全红线，指南第 ⑪ 条）。`sdk/` 只是**作者本地的开发期依赖**：你用它在自己机器上
   写和验插件，最终交给用户的仍然是"一个目录 + 能直接跑的文件"。
2. **零依赖。** 没有 `dependencies`、不需要 `pnpm i`、不需要联网。只用 Node 内置模块。
   这是它能离线用的前提，也是插件不被 `node_modules` 撑过 8MB/64MB 上限的前提。
3. **Tier 2 插件的运行时助手要跟着插件走。** `sdk/create.mjs` 会把
   `sdk/runtime/qmai-plugin.mjs` **拷进**生成的插件目录（`qmai-plugin.mjs`），
   因为宿主只装那一个目录。升级 SDK 后想同步，重新生成一次或手动覆盖这个文件。

---

## 1. 三个命令

```powershell
# 1) 生成一个可跑的骨架（目标目录必须为空）
node sdk/create.mjs <目标目录> --template content-only|with-tools [--id <id>] [--name <名称>]

# 2) 本地校验清单 / 内容包 / 提示词变量（装进 QMAI 之前先跑这个）
node sdk/validate.mjs <插件目录> [<插件目录> …]

# 3) SDK 自己的测试（不测你的插件）
node --test "sdk/test/*.test.mjs"
```

> `validate.mjs`：有 error → 退出码 **1**；只有 warning / 提示 → **0**；用法错误 → **2**。
> 可以直接接进你的 CI。它会**一次列出所有错误**（宿主是命中第一个就返回），
> 因为本地改清单是编辑循环，一轮改完比一轮改一个快得多。

`node --test` 的目录形式（`node --test sdk/test/`）在标准 Node ≥ 22 可用；
QMAI 开发环境里那个 `node` 是 Electron 内置的（`node -e "console.log(process.versions.electron)"`
有值），它不认目录参数，请用上面的 glob 形式。

---

## 2. 两种插件的最小示例

### 2.1 纯声明式（Tier 1，**不跑任何代码**）

```jsonc
// plugin.json —— 目录里只有这一个必需文件（外加你的 content/*.json）
{
  "schema": 3,
  "id": "hello-content",
  "name": "你好内容包",
  "version": "1.0.0",
  "description": "两条开局灵感 + 一个生成书名的按钮",
  "kind": ["declarative"],
  "slots": ["chapter-toolbar", "inspiration-browser"],
  "requiresSlot": { "chapter-toolbar": 1 },
  "contributes": {
    "contentPacks": [{
      "id": "starters", "title": "开局灵感", "file": "content/items.json",
      "actions": [{ "kind": "insert-at-cursor", "label": "插入正文" }]
    }],
    "actions": [{
      "id": "make-title", "title": "生成书名", "slot": "chapter-toolbar",
      "form": { "fields": [{ "key": "idea", "type": "textarea", "label": "灵感", "required": true }] },
      "prompt": { "system": "你是书名策划，只产出书名。", "user": "灵感：{{idea}}\n每行一个书名。" },
      "output": { "mode": "list", "targets": [{ "kind": "clipboard", "label": "复制" }] }
    }]
  },
  "permissions": []
}
```

`output.targets[].kind` 只有四个合法值：`project-field` / `insert-at-cursor` / `clipboard` /
`chapter-note`（内容包条目多一个 `run-action`）。写成 `"kind": "copy"` 这种笔误，宿主会
**静默丢弃**那个按钮 —— 所以 `validate.mjs` 把它判成 error，别指望在界面上看出问题。

内容包 `content/items.json`：

```json
{ "version": 1, "items": [{ "id": "s001", "title": "最后一班地铁", "body": "末班车只有七个人，其中六个没有影子。", "tags": ["都市", "悬疑"] }] }
```

纯 Tier 1 插件：**没有 `runtime`，宿主不会为它启动任何进程**（装 20 个也是 0 条进程）。

### 2.2 带工具（Tier 2，要跑代码）

```js
// index.js —— 只写工具实现，其余交给 SDK
import { definePlugin } from "./qmai-plugin.mjs"

definePlugin({
  info: { id: "my-plugin", name: "我的工具插件", version: "1.0.0" },
  tools: {
    char_count: {
      description: "统计一段文本的汉字数与英文词数。传整段文本进来，不要传文件路径。",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string", description: "要统计的文本" } },
        required: ["text"],
      },
      async handler(args, ctx) {
        if (typeof args.text !== "string") {
          return { text: "缺少 text 参数：请把文本作为字符串放进 text。", isError: true }
        }
        ctx.log(`收到 ${args.text.length} 字符`)          // → stderr，不污染 stdout
        const han = (args.text.match(/\p{Script=Han}/gu) || []).length
        return `汉字 ${han} 个`
      },
    },
  },
})
```

配 `plugin.json`（`schema: 1` + `runtime` + 一个 `tool` + 空权限），见
[`templates/with-tools/plugin.json`](templates/with-tools/plugin.json)。

**别忘了同目录的 `package.json` 写 `{"type": "module"}`** —— 见下面 ⑬。

---

## 3. 指南里的哪条坑，SDK 替你挡了

| 指南条目 | SDK 怎么挡 |
|---|---|
| ① stdout 只准写协议帧 | `qmai-plugin.mjs` 是唯一写 stdout 的地方；`ctx.log()` 一律走 stderr。你就算写 `console.log` 也是唯一会漏的那条（所以我们从不给你 stdout） |
| ② 不要往 stderr 狂打日志 | 单条日志超过 8KB 自动截断，避免把 stderr 管道写满后自己阻塞 |
| ③ `inputSchema` 必须合法 | 声明什么就原样报什么（SDK 不"顺手修正"，那只会让错误更难发现）；`validate.mjs` 会提示清单 `parameters` 与运行期 `inputSchema` 的形状差异 |
| ④ 清单是封闭契约，拼错被拒 | `validate.mjs` 复刻 `deny_unknown_fields`，**并把候选字段名列给你** |
| ⑤ `version` 必须三段 SemVer | `validate.mjs` 直接判 `^\d+\.\d+\.\d+$` |
| ⑥ 权限最小化 | 两个模板默认 `permissions: []`；声明 `fs:project-write` 时会额外提示你确认 |
| ⑦ 错误信息写给人看、带原因 | `handler` 抛错 → SDK 转成 `{ isError: true }`（模型能看到并自行重试）；**不要**用 JSON-RPC error |
| ⑨ 幂等 + 会清理 | SDK 不写临时文件、不缓存环境变量、stdin EOF 立刻 `exit(0)`（不留孤儿进程） |
| ⑩ 不要拖 `node_modules` | SDK 零依赖；`create.mjs` 生成的插件只有一个 6KB 的 `qmai-plugin.mjs` |
| ⑪ 安装期间不假设有构建步骤 | 生成的就是能直接跑的文件，`node index.js` 即可 |
| ⑫ 你是常驻进程 | 端口/令牌/配置只在启动时读进 `ctx`，不落盘；provider 的 `signal` 在客户端断开时立刻 abort |
| ⑬ `"type": "module"` 的继承 | `qmai-plugin.mjs` 用 `.mjs`（永远 ESM）；`with-tools` 模板额外生成 `package.json` 声明 `{"type":"module"}`，两边一致 |

---

## 4. provider 插件（给软件加一个模型来源）

`qmai-provider.mjs` 替你做掉 `/health` 免鉴权、`/v1/*` 常量时间 Bearer 校验、
`/v1/models` 的 `_qmai` 包装、SSE 的 usage 帧与 `data: [DONE]`、以及**客户端断开即停上游**，
登录入口（`/login/credential`）也一并收走。你只写 `models()`、`chat()`，
以及需要用户登录时的 `onCredential()`。

### 4.1 `models()` 与 `chat()`

```js
import { serveProvider } from "./qmai-provider.mjs"

serveProvider({
  id: "my-provider",
  async models() {
    // 窗口大小必须**如实**填：缺 maxInputTokens 宿主会丢弃这个模型；
    // 虚高会让宿主按假窗口塞上下文、上游直接 400。SDK 不会替你编默认值。
    return [{ id: "my-model", name: "我的模型", maxInputTokens: 131072, maxOutputTokens: 8192, supportsToolCall: true }]
  },
  async chat(request, { onDelta, signal }) {
    // ★ signal 是"不烧用户额度"的关键：用户点「停止」时它立刻 abort，
    //   请把它透传给你的上游请求（fetch 的 signal），否则额度会继续被烧。
    const response = await fetch("https://upstream.example/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request.raw, stream: false }),
      signal,
    })
    const data = await response.json()
    onDelta(data.choices[0].message.content)
    return { usage: { promptTokens: 10, completionTokens: 20 } }
  },
})
```

宿主用环境变量 `QMAI_PROVIDER_PORT` / `QMAI_PROVIDER_TOKEN` 注入端口与令牌（**必须**两者都有
才能启动，缺一个就 `exit(1)`）；只能绑 `127.0.0.1`。

### 4.2 登录入口：四种 `authKind`

`plugin.json` 里 `contributes.providers[].authKind` 决定**用户在模型卡片上看到什么**，
也决定你要不要写一个端点：

| `authKind` | 用户看到什么 | 你要做什么 |
|---|---|---|
| `none` | 没有登录入口 | 什么都不用做（例如转发到本机推理端点） |
| `browser-login` | 卡片上的「登录/设置」打开**受控窗口**加载 `settingsPagePath`；窗口**只能**去 `authDomains` 声明过的域名 | 提供设置页 + 声明 `authDomains`。缺 `settingsPagePath` 时按钮会一直禁用（`validate.mjs` 会 warn） |
| `paste-token` | 卡片上是**密码框 + 保存** | 实现 `POST /login/credential` |
| `import-file` | 卡片上是**「选择文件」**（按纯文本读，≤1MB） | 实现 `POST /login/credential`（同一个端点） |

四种现在**全部可用**（`authKind` 必填，不写会被校验器判 error）。

**凭证端点（路径固定，清单里不用声明）**：

```
POST http://127.0.0.1:<providerPort>/login/credential
Authorization: Bearer <providerToken>
Content-Type: application/json

{ "kind": "paste-token" | "import-file", "value": "<内容>", "filename": "<原文件名，仅 import-file>" }
```

- 成功 → `200 {"ok":true,"message"?: "登录成功"}`。`message` 原样显示在卡片上；**空 body 也接受**（按 `{ok:true}`）
- 失败 → **任意非 2xx**。QMAI 把「状态码 + 响应体前 200 字」原样展示给用户，
  所以请在响应体里写清原因（`{"error":"令牌应为 sk- 开头"}`）。401 / 404 / 500 在用户眼里是三件事
- 超时 **15 秒**
- `value` 全空白会在宿主侧被拒（「凭据内容为空」），不会送到你这里

**在 SDK 里实现它 = 给 `serveProvider` 加一个 `onCredential` 回调。** 端点路径、Bearer 校验
（与 `/v1/*` 同一条常量时间比较）、404 / 405 / 400 都由 SDK 处理，你只写业务：

```js
serveProvider({
  async models() { /* … */ },
  async chat(req, ctx) { /* … */ },

  /**
   * 用户在卡片上粘贴了令牌 / 选了文件。
   * 返回值会原样回给宿主：{ ok?: boolean, message?: string }；抛错则回 400 + 错误信息。
   */
  async onCredential({ kind, value, filename }) {
    // 校验、持久化到你自己的数据目录（<插件根>/<id>.data/），返回可读结果
    if (!value.startsWith("sk-")) {
      // 抛错 → SDK 回 400 {"error": <你的 message>}，宿主把这句话显示给用户
      throw new Error("令牌应以 sk- 开头")
    }
    await saveToOwnDataDir(value)
    return { ok: true, message: "登录成功" }
  },
})
```

SDK 已经固定好的那半边：

| 你的行为 | SDK 的响应 |
|---|---|
| 没写 `onCredential` | `404 {"error":"该插件未实现 /login/credential"}` —— 作者一看就知道少了什么，不会去日志里找"500 崩在哪" |
| 返回 `{ ok: true, message }` | `200` + 原样透传（`message` 显示在卡片上） |
| 返回 `undefined` | `200 {"ok":true}`（允许你只做副作用、不想多说一句话） |
| **抛错** | `400 {"error": <error.message>}` —— 这是表达"这次输入不合法"的**唯一**正确方式 |
| 返回 `{ ok: false }` | 仍是 `200`：宿主只看状态码，会当成成功并显示「已保存」。要表达失败请**抛错** |
| 令牌不对 / 非 POST | `401` / `405`（与 `/v1/*` 同一条 Bearer 校验） |

**SDK 绝不把你的 `value` 写进日志或错误信息**（连非法 JSON 的解析报错都换掉了 —— Node 原生的
`JSON.parse` 错误会带上输入片段，而这里的输入就是用户令牌）。同理，你自己的 `onCredential` 里
也不要把 `value` 拼进 `throw` 的文案或 `stderr`：用户一截图报错，令牌就跟着泄出去了。

**两条容易踩的**：

1. **宿主不回填** —— 它真没存这个值。所以"用户下次打开设置页还能看到已填的令牌"是做不到的；
   想要这个体验，请**同时**声明 `settingsPagePath`，在自己页面里展示"已登录"状态。
2. **QMAI 重启后不会自动带着令牌来找你**。要么用户重填，要么你自己持久化并在 `/health` 里
   如实报"未登录"（别假装已登录：模型列表会 401，看起来像是你坏了）。

> 与指南的关系：本节是 [`docs/plugins/authoring-guide.md`](../docs/plugins/authoring-guide.md)
> §3.5 的 SDK 视角版本，两处冲突时以指南为准（它跟着宿主代码走）。

---

## 5. `validate.mjs` 校验了什么

规则逐条对齐宿主代码，权威来源按优先级：

1. `src-tauri/src/plugins/manifest.rs` —— 清单字段、id/version 格式、插槽、钩子事件、runtime 规则
2. `src-tauri/src/plugins/content.rs` —— 内容包（`version` 必须是数字 1、条目字段、5MB / 5000 条）
3. `src/lib/plugins/declarative/*.ts` —— 前端白名单（输出目标 kind、表单字段类型、提示词变量命名空间）

它会检查：清单未知字段、schema 版本、id / version 格式、`schema < 3` 声明 v3 字段、
runtime 该不该有、`entry` 是否越界、权限 / inject / provider id 白名单、工具名与重名、
内容包路径与文件本身（存在 / 大小 / 条目）、action 的插槽与提示词变量可用性、输出目标 kind、
钩子事件与「同事件同 priority 重复」、插槽版本、`preview` 与实际声明是否一致。

**两处相对宿主刻意收紧 / 放松**（都在输出里写清理由）：

- 宿主对 `output.targets[].kind` 只 `console.warn` 然后**静默丢弃**那个按钮；校验器把它升级成
  **error**（这是已知缺口：作者会以为按钮声明生效了）。
- 宿主命中第一个错误就返回；校验器**一次列全**。

---

## 6. 目录

```
sdk/
├── README.md                        ← 本文件
├── create.mjs                       ← 脚手架 CLI
├── validate.mjs                     ← 校验器 CLI（也导出 validateDirectory 供测试调用）
├── runtime/
│   ├── qmai-plugin.mjs              ← Tier 2 运行时助手（MCP stdio 分发）
│   ├── qmai-plugin.d.ts
│   ├── qmai-provider.mjs            ← provider 端点助手（health / Bearer / SSE / 断开即停 / login-credential）
│   └── qmai-provider.d.ts
├── templates/
│   ├── content-only/                ← 纯声明式模板
│   └── with-tools/                  ← 带工具模板
└── test/                            ← node:test 测试（零依赖）
```
