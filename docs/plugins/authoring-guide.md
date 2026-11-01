# QMAI 插件作者指南

> 面向要写 QMAI 插件的人（也包括三个月后的自己）。
> 这份文档只讲**怎么写才算一个合格的插件**，以及**怎么在发布前自己验**。
>
> 协议细节的权威来源是 `docs/superpowers/specs/2026-10-27-开放插件系统-design.md`（v1）
> 与 `2026-10-28-插件provider扩展点-design.md`（v2）；本文是它们的实践版。

---

## 0. 先想清楚：你要做哪种插件

QMAI 现在有两种插件，**能力与信任等级完全不同**，写之前先选：

| | **工具插件**（v1） | **Provider 插件**（v2.0） |
|---|---|---|
| 它做什么 | 给 AI 加一个能调用的工具 | 给软件加一个**模型来源** |
| 数据接触面 | 模型调用它时传进来的那一段 | **用户与模型的全部对话** |
| 起步复杂度 | 低（一个 Node 脚本 ≈ 60 行） | 中（MCP + HTTP 两端） |
| 需要权限 | 通常**零权限** | 至少 `net:listen` |
| 例子 | 章节字数统计、格式检查、外部资料查询 | 把某家 Agent 的模型接进 QMAI |

**如果你是第一次写，先写工具插件。** 它不需要碰端口、不需要处理 SSE、不需要管凭证。

> 第三种（流程钩子 `contributes.stages`）目前**只解析不执行**，别基于它开发。

---

## 1. 最小可运行的工具插件（≈60 行）

一个插件 = **一个目录 + 一个 `plugin.json`**。目录放到哪由安装方式决定，但结构固定：

```
my-plugin/
├── plugin.json     ← 唯一必需的文件，宿主的安装契约
└── index.js        ← 你的程序
```

`plugin.json`：

```jsonc
{
  "schema": 1,
  "id": "my-plugin",                    // 全局唯一；只能小写字母/数字/连字符，不能含 /
  "name": "我的插件",                     // 界面上显示的名字
  "version": "1.0.0",                   // 必须完整 SemVer（1.2 会被拒）
  "description": "一句话说清它做什么",
  "author": { "name": "你的名字", "url": "https://github.com/you" },
  "license": "MIT",
  "requires": { "qmai": ">=4.4.0" },    // 解析但不校验，写它是为了将来
  "runtime": {
    "type": "node",                     // node | python | binary
    "entry": "index.js",
    "keepAlive": true,                  // 常驻（推荐）；false 则按需启动
    "startTimeoutMs": 10000             // 1000..60000
  },
  "contributes": {
    "tools": [{
      "name": "my_tool",                // 小写+下划线，3..64
      "description": "给模型看的说明：什么时候该用它",
      "parameters": {
        "text": { "type": "string", "description": "输入", "required": true }
      }
    }]
  },
  "permissions": []                     // 不需要权限就留空 —— 这是卖点，不是省略
}
```

`index.js`（零依赖，只用 Node 内置）：

```js
// stdout 是协议通道，只能写 JSON-RPC 帧；日志一律走 stderr。
// 这条是最常见的翻车点：一句 console.log 就会让宿主解析失败。
const send = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")

let buf = ""
process.stdin.on("data", (chunk) => {
  buf += chunk.toString("utf8")
  let nl
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    let req
    try { req = JSON.parse(line) } catch { continue }   // 非 JSON 行直接忽略，不要崩

    if (req.method === "initialize") {
      send({ jsonrpc: "2.0", id: req.id, result: {
        protocolVersion: "2024-11-05",
        serverInfo: { name: "my-plugin", version: "1.0.0" },
        capabilities: { tools: {} },
      } })
    } else if (req.method === "tools/list") {
      send({ jsonrpc: "2.0", id: req.id, result: { tools: [{
        name: "my_tool",
        description: "给模型看的说明",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string", description: "输入" } },
          required: ["text"],
        },
      }] } })
    } else if (req.method === "tools/call") {
      const text = req.params?.arguments?.text
      if (typeof text !== "string") {
        // 用 isError 而不是 JSON-RPC error：这样错误文案能到模型眼前，它能自己纠正重试
        send({ jsonrpc: "2.0", id: req.id, result: {
          content: [{ type: "text", text: "缺少 text 参数" }],
          isError: true,
        } })
        continue
      }
      send({ jsonrpc: "2.0", id: req.id, result: {
        content: [{ type: "text", text: "结果：" + text.length }],
      } })
    } else if (req.id !== undefined) {
      send({ jsonrpc: "2.0", id: req.id,
             error: { code: -32601, message: `未知方法：${req.method}` } })
    }
  }
})

// 宿主关管道 = 让你退出。不处理的话进程会变成孤儿。
process.stdin.on("end", () => process.exit(0))
```

装到 QMAI 里试（见第 4 节），然后在对话里让模型调 `my_tool`。

> 完整参照实现：`samples/plugins/chapter-metrics/`（一个真有用的工具插件）
> 与 `src-tauri/tests/fixtures/plugins/fake-provider/`（provider 端参照）。

---

## 2. 怎么写才"更好"：13 条硬经验

下面每一条都是**踩过才知道**的。前 5 条会直接让插件不可用，后 8 条决定它是不是一个好插件。

### 会让插件直接不可用的（务必看）

**① stdout 只准写协议帧。**
一句 `console.log("started")` 就足以让宿主这一行解析失败。所有调试输出用 `process.stderr.write`。
宿主会把 stderr 排空并保留尾部 64KB，排查时能看到。

**② 不要往 stderr 狂打日志。**
宿主会持续排空 stderr，但**如果你自己起子进程又不排空它的 stderr**，那条管道写满后你的插件会阻塞在写日志上——表现为"握手超时"或"调用无响应"，极难查。

**③ `tools/list` 报出来的工具，`inputSchema` 必须合法。**
宿主把它原样转给模型。写错了模型会拒绝调用，而你不会收到任何报错。

**④ 清单是封闭契约：拼错字段会被明确拒绝，不会静默忽略。**
宿主开了 `deny_unknown_fields`，错误信息会列出候选字段名。这是好事——但意味着**你不能塞自定义字段**，想存自己的配置请写进插件自己的数据目录。

**⑤ `version` 必须是三段 SemVer。**
`1.2`、`v1.0`、`1.0.0-beta` 都会被拒（错误码 `E_VERSION_INVALID`）。

### 决定它是不是"好插件"的

**⑥ 权限最小化，能不要就不要。**
`permissions: []` 的插件用户装起来毫无心理负担。如果你确实要读项目文件，只要 `fs:project-read`，**不要顺手把 `fs:project-write` 也写上**——用户会看到这一行，然后犹豫。
（含义详见设计文档 6.2；`data:write` 是自动授予的，不用声明。）

**⑦ 错误信息写给"人"看，而且要带原因。**
- ❌ `"error"`
- ✅ `"读取失败：文件不存在（路径 …）"`

模型的 tool 结果和用户看到的日志都用它。用 `isError: true` 让模型能看到并自行重试。

**⑧ 一个插件只做一件事。**
插件市场里"什么都能做"的插件没人敢装。章节体检就只做体检，资料查询就只做查询。

**⑨ 幂等 + 会清理。**
宿主会重启你、会同时开多个实例。不要在启动时假设"只有我一个"，也不要在退出时留下临时文件。

**⑩ 不要拖 `node_modules` 进仓库。**
安装包上限 **8MB 压缩 / 64MB 解压**。用 esbuild 打成单文件（`node_modules` 里一个 `@modelcontextprotocol/sdk` 就能到几十 MB）。
参照实现之所以零依赖手写协议，就是为了证明"这不需要依赖"。

**⑪ 安装期间**绝不**假设会有构建步骤。**
宿主**不跑** `npm install`、不跑 `postinstall`、不跑任何构建脚本（这是安全红线，见设计文档 13.1）。你推上去的必须是**能直接跑的东西**。

**⑫ 你是常驻进程，别假设"一辈子只活一次"。**
- 拿到的环境变量只在启动时有效（端口、令牌会变），**不要缓存到磁盘**
- 退出时把自己起的子进程/端口/临时文件收干净

**⑬ 小心 `"type": "module"` 的继承：`require` 可能突然不可用。**

Node 会**沿目录向上**找 `package.json` 来决定 `index.js` 是 CJS 还是 ESM。这意味着同一个插件文件：

- 放在你仓库里（仓库根 `package.json` 有 `"type": "module"`）→ 被当 **ESM** → 里面写 `require(...)` 直接 `ReferenceError: require is not defined`
- 装进 QMAI 后（插件目录里没有 `package.json`）→ 被当 **CJS** → `require` 可用

**所以本地跑得好、装上就炸（或反过来）是可能的。** 两条建议：

1. **要么全用 CJS**（`require`），并在插件根放一个 `package.json` 显式声明 `{ "type": "commonjs" }` —— 但注意宿主**不跑** `npm install`，这个 `package.json` 纯粹是给 Node 看 `type` 的；
2. **要么写成两边都能跑**：只用 `process` / `Buffer` / `JSON` 这类全局，不用 `require`/`import`。

参照实现 `samples/plugins/chapter-metrics/index.js` 走的是第 2 条（因此也不需要 `package.json`）——它专门验证过"仓库内"与"安装后"两种上下文输出一致。

> 顺带一个相关事实：宿主启动插件的命令就是 `node <entry>`（`supervisor::build_command`），**不读 `package.json`** 的 `main`、也不跑任何脚本。`plugin.json` 的 `runtime.entry` 指哪就跑哪。

---

## 3. 如果你要写 Provider 插件（v2.0）

Provider 插件 = MCP（给宿主管理）+ **一个 `127.0.0.1` 上的 OpenAI 兼容端点**（给宿主调模型）。

### 3.1 宿主给什么

启动时通过环境变量注入（**不是** `initialize` 里）：

| 变量 | 含义 |
|---|---|
| `QMAI_PROVIDER_PORT` | 宿主分配的端口，**只能在 `127.0.0.1` 上绑它** |
| `QMAI_PROVIDER_TOKEN` | 每个插件一份的随机令牌，**必须校验** |
| `QMAI_HOST_URL` / `QMAI_HOST_TOKEN` / `QMAI_PLUGIN_ID` | v1 就有的宿主能力面（v2.0 用得少） |

### 3.2 你至少要实现的

```
GET  /health                 → 200（不要鉴权，宿主探活不带令牌）
GET  /v1/models              → {"data":[{...}]}
POST /v1/chat/completions    → 支持 stream:true 的 SSE
全部 /v1/*                    → 必须校验 Authorization: Bearer <QMAI_PROVIDER_TOKEN>，否则 401
```

`/v1/models` 里每个模型**除了** OpenAI 标准字段，还要在 `_qmai` 里声明能力：

```jsonc
{
  "id": "glm-5.3",
  "object": "model",
  "_qmai": {
    "displayName": "GLM-5.3",
    "maxInputTokens": 200000,     // ★ 必需，缺了宿主会丢弃这个模型
    "maxOutputTokens": 8192,      // ★ 必需
    "supportsToolCall": true,
    "supportsVision": false,
    "creditMultiplier": 0.79      // 可选，只用于展示
  }
}
```

**`maxInputTokens` 是硬要求，别糊。** 宿主用它算上下文裁剪。两个方向都会出事：
- **缺了** → 该模型被丢弃（你会以为"我明明列出来了"）
- **虚高** → 宿主按虚高的窗口塞上下文，上游直接 400，而报错完全看不出是我们的字段不准

**声明真实的窗口。** 宿主已经把"用户输入下限"从插件 provider 上豁免了（v2.0 已修），所以你说 32768 就是 32768。

### 3.3 SSE 的三条硬要求

1. **`data: [DONE]` 必须在最后**——别自己加额外事件在它后面
2. **必须带 usage**（`stream_options.include_usage` 的语义），否则 QMAI 的用量统计会全是 0
3. **客户端断开就停上游**——用户点「停止」时，如果你的插件还在继续请求上游，用户的额度会继续被烧。这是最容易被忽略、也最让用户心疼的一条

还有一条：**不要重组 SSE**。上游怎么给就怎么转发，别解析成对象再拼回去——你会吃掉保活空行帧、`[DONE]` 或 usage 帧。（QMAI 自己的 gateway 就是纯字节流转发，注释里写了这个理由。）

### 3.4 凭证归你，不归 QMAI

- 用户的登录态/令牌**存在插件自己的数据目录**，不要塞给宿主
- 数据目录的绝对路径由宿主给出：`GET /host/status` 返回的 **`dataRoot`**（= `<插件根>/<id>.data/`，宿主在建立会话时创建）
  - **不要**用 `process.cwd()` 或 `../<id>.data` 去猜：`QMAI_PLUGIN_HOME` 可被改写，靠 cwd 反推会在某些启动方式下断裂
- 宿主唯一保存的凭证是**它自己发的 provider token**（内存里，不落盘）
- 宿主中转用户凭据时**不落盘、不写日志、不放进错误信息**，也**不会回填**到界面上

### 3.5 四种 `authKind`：两种要你写端点

| authKind | 用户看到什么 | 你要做什么 |
|---|---|---|
| `none` | 无登录入口 | 什么都不用做（例如转发到本机推理端点） |
| `browser-login` | 卡片上的「登录/设置」打开**受控窗口**加载 `settingsPagePath`；窗口**只能**去 `authDomains` 声明的域名 | 提供设置页 + 声明 `authDomains` |
| `paste-token` | 卡片上是**密码框 + 保存** | 实现 `POST /login/credential` |
| `import-file` | 卡片上是**「选择文件」**（按纯文本读，≤1MB） | 实现 `POST /login/credential`（同一个端点） |

**凭证端点（路径固定，清单里不用声明）**：

```
POST http://127.0.0.1:<providerPort>/login/credential
Authorization: Bearer <providerToken>
Content-Type: application/json

{ "kind": "paste-token" | "import-file", "value": "<内容>", "filename": "<原文件名，仅 import-file>" }
```

- 成功 → `200 {"ok":true,"message"?: "登录成功"}`。`message` 会原样显示在卡片上；**空 body 也接受**
- 失败 → 任意非 2xx。QMAI 把「**状态码 + 响应体前 200 字**」原样展示给用户，
  所以**请在响应体里写清原因**（`{"error":"令牌应为 sk- 开头"}`）。401/404/500 在用户眼里是三件不同的事
- 超时 **15 秒**
- `value` 全空白会在宿主侧被拒（返回「凭据内容为空」），不会送到你这里

**为什么是固定路径**：`paste-token` 与 `import-file` 语义完全一致（都是"把一段文本交给插件"）。
固定路径让宿主零配置支持两种，将来加文本型凭据（扫码结果等）也不用改清单。
可配置路径会把契约变成 N 套私有协议——和 `/health`、`/v1/models` 固定路径是同一个取舍。

**两条容易踩的**：

1. **宿主不回填**——它真没存这个值。所以"用户下次打开设置页还能看到已填的令牌"是做不到的；
   想要这个体验，请**同时**声明 `settingsPagePath`，在自己页面里展示"已登录"状态。
2. **QMAI 重启后不会自动带着令牌来找你**。要么用户重填，要么你自己持久化并在 `/health` 里如实报"未登录"。

---

## 4. 怎么测：四层，从便宜到贵

### 第 1 层：协议自测（不需要 QMAI，10 秒）

把请求用管道喂给你的插件，看回什么：

```powershell
$req = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"my_tool","arguments":{"text":"abc"}}}'
$req | node index.js
```

预期一行 JSON：`{"jsonrpc":"2.0","id":1,"result":{"content":[...]}}`。
**如果这一层就不对，后面都不用试了。**

多请求要一起测（协议是长连接、按行分发）：

```powershell
@(
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
) -join "`n" | node index.js
```

**要专门试这三件事**：
- 非法请求：`echo 'not json' | node index.js` → 应该**不崩**、安静跳过
- 缺参数：`tools/call` 少传 `text` → 应该回 `isError: true` 或 JSON-RPC error，不是崩
- EOF：管道关掉后进程要**退出**（不退出会变孤儿）

### 第 2 层：Provider 端点自测（仅 provider 插件）

```powershell
$env:QMAI_PROVIDER_PORT = "51999"
$env:QMAI_PROVIDER_TOKEN = "test-token"
node index.js &           # 后台起

# 1) 健康
curl.exe -s http://127.0.0.1:51999/health

# 2) 无令牌必须 401
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:51999/v1/models

# 3) 有令牌 200 且能列模型
curl.exe -s -H "Authorization: Bearer test-token" http://127.0.0.1:51999/v1/models

# 4) 流式：看是否分多块 + 有 usage + 以 [DONE] 收尾
curl.exe -s -N -H "Authorization: Bearer test-token" -H "Content-Type: application/json" `
  -d '{"model":"x","stream":true,"messages":[{"role":"user","content":"hi"}]}' `
  http://127.0.0.1:51999/v1/chat/completions
```

### 第 3 层：装进 QMAI 用（**本地目录安装**）

设置 → 插件 → **「从本地目录安装」**，选你的插件目录。然后：

| 你要看的 | 在哪 |
|---|---|
| 插件是否启动 | 插件列表的状态应显示「运行中」 |
| 工具有没有注册上 | 找个支持 function calling 的模型，问「你现在有哪些工具」 |
| provider 的模型有没有出现 | 设置 → 模型设置，应有你的卡片 + 模型 |
| 失败原因 | 卡片上的 `lastError`；日志里 `[plugins]` 那几行 |

> **provider 插件的「刷新模型」按钮**比重启快：改完 `/v1/models` 的逻辑重启插件后点一下就行。

### 第 4 层：跟着验收清单走一遍

`docs/superpowers/plans/2026-10-27-开放插件系统-验收清单.md`
- 第一部分（v1）：工具插件的完整验收
- 第二部分（v2.0）：provider 插件的完整验收，用仓库里的假 provider 当素材

---

## 5. 发布

### 5.1 仓库结构

```
<你的仓库>/
├── plugin.json          ← 必须在**根目录**
├── index.js             ← 你的入口
├── README.md            ← 说清做什么、怎么装、要什么权限
├── LICENSE
├── screenshots.json     ← 可选：1-8 张截图路径（市场卡片用）
└── assets/…
```

### 5.2 几条投稿要求（与 DSH 生态一致的做法）

- **公开仓库 + 有 LICENSE**
- 仓库要**真的能跑**（不是占位、不是只有 README）
- 描述**必须属实**——写「统计 12 项」就该真有 12 项
- 给仓库打 `qmai-plugin` topic，便于市场索引抓取
- **不要**把别人的插件重新打包到自己名下

### 5.3 版本与更新

宿主目前**不支持自动更新**（第二期才做）。所以：
- 改代码记得改 `version`，否则用户无法分辨新旧
- 用户更新 = 卸载再装（数据目录 `<id>.data/` 会保留）

---

## 6. 附录：作者自测清单（发布前逐条打勾）

**协议**
- [ ] 单个 `tools/call` 用管道能跑通
- [ ] `initialize` + `tools/list` 连发能正确分发（不是只回了第一条）
- [ ] 非 JSON 行不会让进程崩
- [ ] stdin 关闭后进程会退出
- [ ] stdout 里**没有**任何非协议输出（跑一遍 `grep -v '^{"jsonrpc"'` 应该是空）

**健壮性**
- [ ] 缺参数/参数类型错 → 回 `isError: true` 或 JSON-RPC error，不崩
- [ ] 超大输入（比如 200KB 文本）有明确错误，不卡死
- [ ] 连续调用 10 次都正常（没有状态泄漏）

**清单**
- [ ] `version` 是三段 SemVer
- [ ] `id` 只用小写字母/数字/连字符，且没和内置 provider 重名
- [ ] `permissions` 里没有你实际不用的项
- [ ] `contributes.tools[].name` 不与内置工具重名（宿主会加前缀，但仍建议避开 `read_chapter` 这类名字）

**provider（仅 provider 插件）**
- [ ] `/health` 不鉴权、返回 200
- [ ] 无令牌访问 `/v1/*` → 401
- [ ] `/v1/models` 每个模型都有 `maxInputTokens` 与 `maxOutputTokens`，且**是真实值**
- [ ] 流式：多个内容分片、带 usage、以 `data: [DONE]` 结尾
- [ ] 客户端断开 → 停止向上游请求（用日志确认）
- [ ] 凭证不写进插件目录以外的任何地方

**安装**
- [ ] 压缩后 < 8MB（解压 < 64MB），不依赖 `npm install`
- [ ] 从本地目录安装能一次成功
- [ ] 卸载后 `<id>.data/` 保留、其它目录清干净

---

## 7. 常见问题

**Q：我能用 TypeScript / 框架吗？**
A：能，但**推到仓库的必须是构建产物**（宿主不跑构建）。推荐 esbuild 打成单文件后提交。

**Q：能读用户的正文吗？**
A：只有申请了 `fs:project-read` 且用户勾选才行，而且只能在项目根目录内。
（注意：v2.0 里 `project_root` 还没接"当前打开的项目"，所以这个能力暂时会返回 `E_NO_PROJECT`——接上之后本文会更新。）

**Q：插件能互相调用吗？**
A：不能。`inject` 目前只认宿主服务（`host.qmai.tools` / `host.logger`）。

**Q：我的插件出问题会不会把用户的软件搞崩？**
A：不会。插件是独立进程，崩溃只影响它自己。但**provider 插件**崩了会让用户暂时无法用那个模型，宿主会显示"未就绪"并给出原因。

**Q：为什么我的插件装上了却没出现在模型列表里？**
A：按这个顺序查：
1. 插件列表里状态是不是「运行中」（不是的话看 `lastError`）
2. provider 卡片是不是灰显「未就绪」（是的话点「刷新模型」看新的 `lastError`）
3. `/v1/models` 返回的模型是不是都带了 `maxInputTokens`——缺的会被静默丢弃（这是设计行为）
