# WorkBuddy 账号登录（国内版）· 分支说明

> 分支：`feature/model-settings`
> 规格：`docs/superpowers/specs/2026-10-27-workbuddy-账号登录-design.md`
> 计划：`docs/superpowers/plans/2026-10-27-workbuddy-账号登录.html`

## 一、这个功能做了什么

在「模型设置 → 大语言/LLM 模型」页的入口区，从**两栏**扩成**三栏**：

```
＋ 添加账号   ＋ 添加提供方   ＋ 添加自定义模型
```

「添加账号」打开 WorkBuddy 登录对话框，用户有两条路取凭证：

1. **网页登录**（内嵌窗口或系统浏览器）—— 用自己的 WorkBuddy 账号登录一次。**这是主路径**；
2. **导入凭证文件** —— 任何含 `accessToken` + `uid` 的 JSON（嵌套形 `auth` + `account`，或扁平形）。

> **关于「导入桌面端登录态」（已删除）**
> 原本还有第三条：读本机 `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\workbuddy-desktop.info`。
> 2026-10 实测发现新版客户端已把 `accessToken` / `refreshToken` / `nickname` 全部改成
> `{"$wbEncrypted":1,"envelope":"…"}` 密文（它自己的 at-rest 密钥保护：`AES-256-GCM`，
> 密钥来自客户端原生模块 `electron.workbuddyStorage`，**不落盘、不可导出**，信封里的
> `keyId` 是 `sha256(sha256(atRestSecretKey))` 前 16 位）。
> 任何外部程序都读不出来，因此整条链路（含只读探测）**已随本次改动删除**，不在界面上
> 留一个永远点不通的入口。想用客户端里那个账号，就走「网页登录」—— 同一个账号登录一次即可。
> 旧版客户端的 `.info` 若是明文，仍可用「导入凭证文件」导入。

登录成功后自动出现一张「WorkBuddy 国内版」模型卡片，模型清单来自
`GET /v3/config`，之后**聊天链路一行没改**就能用。

## 二、为什么是「进程内网关」

QMAI 原来有两种接法：HTTP 供应方与 CLI 子进程。WorkBuddy 是标准 OpenAI 协议，
但鉴权与请求头是它私有的（一串 `X-IDE-*` / 会话头 / 链路头、首条必须是 system、
token 到期要自己换）。

如果做成「又一种子进程 transport」，写作链路里现成的这些能力会全部失效：
上下文超限自动裁剪重试、`max_tokens` 降级、网络重试阶梯、用量统计、工具调用增量解析。

所以后端在应用进程内起了一个极小的 axum 网关（`127.0.0.1:0` + 一次性令牌），
把 WorkBuddy **伪装成一个普通 OpenAI 供应方**。前端照抄 `cursor-cli` 的既有做法
（`ensureWorkbuddyGateway()` → `withWorkbuddyEndpoint()`），聊天、模型列表、
连通性测试、中断全部复用。

与 Agent2API 的区别：那套是独立进程 + 固定端口 3065 + 面板鉴权；我们只绑回环随机端口，
三条路由（`/health`、`/v1/models`、`/v1/chat/completions`），不做面板、不做 CORS。

## 三、代码落点

### Rust（新增 `src-tauri/src/workbuddy/`，约 2600 行含测试）

| 文件 | 职责 | 测试 |
|---|---|---|
| `mod.rs` | 模块出口 + 测试用临时目录 / HTTP 替身 | — |
| `endpoints.rs` | 两版端点 / UA / platform / prefix，URL 拼装（**纯函数**） | 6 |
| `crypto.rs` | AES-256-GCM + `enc1:` 信封 + 密钥文件（0600、`create_new` 防并发） | 6 |
| `accounts.rs` | 账号结构、加密落盘、**按 uid 幂等**、优先级、对外视图 | 8 |
| `login.rs` | `auth/state` → 轮询 `auth/token` → `login/account` → JWT 兜底 | 8 |
| `import.rs` | 凭证文件（嵌套/扁平/判版本）、加密形态识别 | 5 |
| `refresh.rs` | `token/refresh`，单飞 + 合并口径 | 5 |
| `models.rs` | `/v3/config` 解析、前缀黑名单、缓存、内置兜底、OpenAI 形状 | 9 |
| `chat.rs` | 私有头集合、首条 system 注入（`developer` 先归一）、错误分类 | 8 |
| `gateway.rs` | axum 三路由、令牌、SSE **原样透传**、`stream:false` 聚合 | 7 |
| `commands.rs` | 9 条 Tauri 命令（返回值一律不含 token） | — |
| `login_window.rs` | 内嵌窗口、**每次登录新数据目录**、域名白名单、关窗即取消 | 3 |

`cargo test workbuddy` → **68 passed**。

### 前端

| 文件 | 改动 |
|---|---|
| `src/lib/workbuddy-accounts.ts`（新） | IPC 封装 + `waitForLogin`（两秒节拍、可取消、超时分离） |
| `src/lib/workbuddy-gateway.ts`（新） | 网关句柄与配置注入 |
| `src/lib/workbuddy-card.ts`（新） | 卡片生成规则（默认勾选 ≤3、上下文取最小、删账号置灰） |
| `…/sections/add-workbuddy-account-dialog.tsx`（新） | 登录对话框（版本 / 添加方式两段 / 已有账号） |
| `…/sections/llm-provider-section.tsx` | 两栏→三栏并上移；挂载对话框；首次登录生成卡片 |
| `…/uitest/models/model-settings.css` | 对话框样式（跟随主题变量） |
| `llm-presets.ts` / `wiki-store.ts` / `settings-types.ts` | provider `workbuddy` + 预设 |
| `preset-resolver.ts` / `llm-providers.ts` / `llm-client.ts` | 走 chat_completions 线格式，聊天前注入网关地址 |
| `settings-model-list.ts` | 模型列表走网关 `/v1/models` |
| `has-usable-llm.ts` | 账号类：卡片启用 + 有模型即「可用」 |

## 四、关键设计决定（含理由）

| 决定 | 理由 |
|---|---|
| 账号与 `app-state.json` **分开存** | 后者是明文、会被备份工具打包；凭证不能混进去 |
| `id = user-<uid>`，重复登录**覆盖** | 否则全局队列里出现两个同源账号，请求随机落到新旧 token，症状「时好时坏」 |
| 导入时**以文件里的 domain 判版本** | 文件写着 `www.workbuddy.ai` 却归到国内版，症状是稳定 401，界面上看不出异常 |
| 内嵌窗口**每次新建数据目录** | 共用默认目录 = 共用登录态，添加第二个账号时官方页面会直接把上一个账号放行过去 |
| 不改 WebView2 的 UA | 原生 Edge UA 就是普通浏览器形态；自拼 UA 会与 `Sec-CH-UA` 不一，反而更显眼 |
| 上游 SSE **不解析**、原样透传 | 少一层改写就少一处会吃掉 `[DONE]`、保活空行或 usage 帧的地方 |
| `/v3/config` 必须带客户端 UA | 不带时上游把 `data.models` 返回成 null —— 「登录成功却一个模型都没有」最常见的原因 |
| 首条非 system 就注入兜底 | 上游硬要求；写作链路总是带 system，但标题生成 / 连通性测试可能只发一条 user |
| 删掉最后一个账号 → 卡片**置灰不删除** | 重新登录时用户的模型勾选不丢；置灰让选择器立刻认为「没有可用模型」 |
| 网关绑 `127.0.0.1:0` + 随机令牌 | 固定 3065 会和用户自己装的 Agent2API 抢；随机端口 + 随机令牌，本机其它进程要同时猜中两者 |

## 五、错误处理对照

| 现象 | 用户看到什么 | 代码位置 |
|---|---|---|
| 上游 429 / 业务码 `6004` | 「额度或并发已用尽，请稍后再试或换模型」 | `chat::classify` |
| 业务码 `11-128`（落进 JSON 是 `-117`） | 「提示词可能命中上游敏感词」 | `chat::classify` |
| 401 / 403 | 先自动续期重试一次，仍失败 → 「登录态可能已失效」 | `gateway::chat_completions` |
| 模型不在清单里 | 400 `model_not_found`（与其它 provider 同口径） | `gateway::chat_completions` |
| 没登录账号 | 409 + 「请先在模型设置里添加账号」 | `gateway::chat_completions` |
| 密钥文件被换过 | 「凭证解密失败…请重新登录」 | `crypto::DECRYPT_FAILED` |
| 导入的是加密 `.info` | 明说「被客户端加密保护、请改用网页登录」 | `import::ENCRYPTED_CREDENTIAL` |
| 网关起不来 | 设置页照常可用，只有对话报错并说明原因 | `commands::workbuddy_gateway_ensure` |

## 六、验收清单（手工）

| # | 步骤 | 期望 |
|---|---|---|
| 1 | 打开 设置 → 模型设置 → 大语言 | 看到三栏，顺序是 添加账号 / 添加提供方 / 添加自定义模型，且在列表**上方** |
| 2 | 点「添加账号」→ WorkBuddy | 出现「登录 / 添加 WorkBuddy 账号」对话框；国际版分段**禁用**并标「二期」 |
| 3 | 选「网页登录 / 内嵌窗口」→ 打开网页登录 | 弹出腾讯登录页；登录成功后 5 秒内账号出现在「已有账号」，并自动生成模型卡片 |
| 4 | 关掉内嵌窗口（不登录） | 对话框回到可再次发起状态，无残留账号 |
| 5 | 再登录同一账号 | 覆盖更新，不产生第二条记录 |
| 6 | 导入凭证文件（含 accessToken + uid 的 JSON） | 账号出现；非法 JSON / 缺 uid / 加密 `.info` → 明确报错 |
| 7 | AI 对话里选 WorkBuddy 模型 | 正常流式出字；点停止立即中断 |
| 8 | 手动把 token 改成过期值 | 下一次请求自动续期并成功（日志有一条 refresh） |
| 9 | 删掉唯一账号 | 卡片置灰、模型从选择器消失；重新登录后恢复 |
| 10 | 断网后发起对话 | 可读的中文错误，不出现英文堆栈 |

> 状态：**第 1–2、5–6、8–10 条已由自动化测试覆盖到逻辑层**（Rust 68 条 + 前端 4 个 spec）；
> 第 3、4、7 条需要真实 WorkBuddy 账号与网络，**待手工验收**。

## 七、许可与合规

- Agent2API 是 **MIT + 附加声明**（禁止商业用途 / 二次分发牟利），与本仓库 GPL-3.0 冲突。
  本实现**只使用其协议事实**（端点、头名、字段、握手顺序），代码全部自己写，未复制其源码。
- 以非官方客户端形态复用登录态，可能触发上游限流或风控。产品上：不默认开启、
  首次使用提示风险、错误文案如实说明。
- 新版官方客户端把 token 以 `$wbEncrypted` 密文落在 `CodeBuddyExtension\…\auth\`（不可导出）；
  QMAI 自己的账号库同样加密落库，密钥文件与数据分离。

## 八、二期（国际版）预留

国际版的常量、UA、`platform` 已在 `endpoints.rs` 备好（`Edition::INTL`），
`provider_id = workbuddy-intl`。二期只需：

1. 放开对话框里被禁用的「国际版」分段；
2. 加「恢复 Google / GitHub 入口」开关（注入脚本持续移除 `oneid-only-login-style`
   样式 + 导航白名单扩到 `accounts.google.com` / `github.com`，**两者必须同时生效**）。
