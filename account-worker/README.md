# QMAI 账号服务（account-worker）

青幕AI写作的独立账号后端：Cloudflare Worker + D1，提供邮箱验证码注册、邮箱密码登录、长期登录态与找回密码。与 `qmai-builtin` 模型网关、`analytics-worker` 完全独立。

接口契约与安全设计见 `../docs/superpowers/specs/2026-10-25-account-auth-design.html`。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/auth/send-code` | 发送注册 / 重置验证码；`purpose=register\|reset` |
| POST | `/v1/auth/register` | 邮箱 + 验证码 + 密码，成功后直接返回登录态 |
| POST | `/v1/auth/login` | 邮箱 + 密码 |
| POST | `/v1/auth/refresh` | 轮换 refresh token，返回新 access |
| POST | `/v1/auth/logout` | 撤销当前设备会话（幂等） |
| POST | `/v1/auth/me` | 用 Bearer access token 取当前账号 |
| POST | `/v1/auth/password/reset` | 验证码 + 新密码，撤销该用户全部会话 |
| POST | `/v1/auth/password/change` | 已登录改密：当前密码 + 新密码，撤销**其它**设备会话 |
| POST | `/v1/account/avatar` | 上传头像（请求体为图片原始字节，≤200 KB） |
| DELETE | `/v1/account/avatar` | 删除头像（幂等） |
| GET | `/v1/account/avatar/{id}` | 公开读取头像，长缓存 |

统一响应：成功 `{ "success": true, "data": ... }`；失败 `{ "success": false, "code": "...", "message": "..." }`。

## 一次性部署

```bash
cd account-worker
npm install

# 1. 创建 D1，把返回的 database_id 填进 wrangler.toml
npx wrangler d1 create qmai-account-db

# 2. 建表
npx wrangler d1 execute qmai-account-db --remote --file=./schema.sql

# 已有库升级（补头像列；新建库不需要）
npx wrangler d1 execute qmai-account-db --remote --file=./migrations/0002_avatar.sql

# 3. 写入 secrets（不要写进仓库）
npx wrangler secret put AUTH_JWT_SECRET       # >= 32 字节随机值
npx wrangler secret put AUTH_CODE_PEPPER      # >= 16 字节随机值
npx wrangler secret put RESEND_API_KEY        # Resend 控制台生成

# 4. 部署
npm run deploy
```

`wrangler.toml` 里的 `database_id` 必须替换成第 1 步的返回值；`AUTH_EMAIL_FROM` 改成已验证发信域名下的发信人。

> 修改 `wrangler.toml` 后请确认部署输出里仍列出 `env.DB (qmai-account-db)  D1 Database`。若它变成 `Environment Variable`，说明文件编码或 TOML 结构被破坏，Worker 会拿不到数据库并让所有接口 500。

## 发信通道

`EMAIL_PROVIDER` 选择发信后端，两条通道都已实现：

| 值 | 通道 | 要求 |
|---|---|---|
| `resend` | Resend HTTP API | Resend 已验证发信域名；免费档每天 100 封 |
| `cloudflare` | Workers `send_email` 绑定 | 需 Workers Paid 才能发给任意收件人 |

留空时按可用凭据推断：有 `EMAIL` 绑定走 cloudflare，有 `RESEND_API_KEY` 走 resend。`AUTH_EMAIL_FROM` 支持 `"显示名 <a@b.com>"` 与纯地址两种写法。

## 头像与改密

- **头像存储**：`users.avatar_mime` / `avatar_data`(BLOB) / `avatar_updated_at`。客户端上传前在本地把图片裁成 256×256 并压成 WebP（不支持时回退 JPEG），服务端再按文件头魔数校验真实类型，只接受 PNG/JPEG/WebP，上限 200 KB。SVG 会被拒绝（含脚本，不能当图片直接对外提供）。
- **头像读取**：`GET /v1/account/avatar/{id}` 公开可读，带 `?v=<avatar_updated_at>` 换版本；响应带 `nosniff` 与 CSP sandbox。
- **客户端 CSP 要求**：`src-tauri/tauri.conf.json` 的 `img-src` 必须包含 `https:`（头像走账号服务域名）与 `data: blob:`（本地预览）。少了前者头像会被静默拦截、界面一直显示首字母。
- **本地裁剪不能用 `<img>` 读 blob:**：CSP 只放行 `img-src`，`URL.createObjectURL` 生成的 `blob:` 同样受它约束。客户端改用 `createImageBitmap(File)` 直接解码，不受 `img-src` 限制。
- **D1 二进制坑**：实测线上 D1 返回 BLOB 时是普通 `number[]`（不是 ArrayBuffer/TypedArray）。`findUserAvatar` 三种形态都兼容，否则会出现「数据库有数据、接口返回 0 字节」。
- **改密**：必须提供当前密码；改密后撤销该用户其它会话，当前设备通过请求体里的 `refreshToken` 识别并保留。当前密码错误有独立限流（每 IP 15 分钟 10 次），防止拿 access token 爆破原密码。


`EMAIL_PROVIDER` 选择发信后端，两条通道都已实现：

| 值 | 通道 | 要求 |
|---|---|---|
| `resend` | Resend HTTP API | Resend 已验证发信域名；免费档每天 100 封 |
| `cloudflare` | Workers `send_email` 绑定 | 需 Workers Paid 才能发给任意收件人 |

留空时按可用凭据推断：有 `EMAIL` 绑定走 cloudflare，有 `RESEND_API_KEY` 走 resend。`AUTH_EMAIL_FROM` 支持 `"显示名 <a@b.com>"` 与纯地址两种写法。

生产 CORS 只保留 `tauri://localhost,https://tauri.localhost`；浏览器本地开发来源通过 `.dev.vars` 覆盖，不要写进生产配置。生产必须保持 `ENVIRONMENT=production`、`ALLOW_DEV_CODE=false`：误设为 development 会返回验证码、并允许伪造 `X-Forwarded-For` 绕过 IP 限流。

## 本地联调

在 `account-worker/.dev.vars`（不要提交）写入：

```dotenv
AUTH_JWT_SECRET=local-dev-jwt-secret-at-least-32-bytes
AUTH_CODE_PEPPER=local-dev-pepper-16
ENVIRONMENT=development
ALLOW_DEV_CODE=true
APP_ALLOWED_ORIGINS=tauri://localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420
# 可选：没有 Resend key 时开发模式会把验证码打到终端
RESEND_API_KEY=
AUTH_EMAIL_FROM="青幕AI写作 <no-reply@example.com>"
```

```bash
npm run db:migrate:local
npx wrangler dev --local --port 8787
```

开发模式且 `ALLOW_DEV_CODE=true` 时，`send-code` 响应会附 `devCode`，Worker 日志也会打印验证码；生产环境（`ENVIRONMENT=production`）绝不返回或打印验证码。

## 冒烟测试（可选）

先按上一节启动本地 Worker，再另开终端：

```bash
cd account-worker
npm run smoke
```

`test/smoke.mjs` 只访问 `http://127.0.0.1:8787`（可用 `ACCOUNT_BASE_URL` 覆盖），覆盖发码、注册、me、refresh 轮换、旧 token 重放、登录、退出、重置密码与 CORS。脚本会等待 61 秒验证发码冷却，总耗时约 1 分钟。

## 客户端地址

客户端默认请求 `https://qmai-account.qmai.workers.dev`。构建/启动时用 `VITE_QMAI_ACCOUNT_URL` 覆盖（不再支持 localStorage 改地址，避免被 XSS 重定向登录）。在仓库根目录 `.env.local` 写一行：

```bash
VITE_QMAI_ACCOUNT_URL=http://127.0.0.1:8787
```

正式发布建议绑定自定义域名：`workers.dev` 在部分国内网络下不稳定。

## Resend 发信域名配置（当前生产方案）

`qmai.pro` 已在 Resend 验证通过，发件人是 `青幕AI写作 <no-reply@qmai.pro>`。需要的 DNS 记录：

| 类型 | 名称 | 内容 | 代理 |
|---|---|---|---|
| CNAME | `send` | `send.forge.rmta.net` | 仅 DNS（灰云） |
| CNAME | `rsend` | `rsend-apne1.forge.rmta.net` | 仅 DNS（灰云） |
| TXT | `resend._domainkey` | DKIM 公钥 `p=MIGf...` | — |

三条记录都必须是**灰云（DNS only）**；CNAME 被橙云代理会导致验证失败。`qmai.pro` 根域的 MX/SPF 由 Cloudflare Email Routing 占用，Resend 用独立子域，不冲突。

注意：
1. 第二条 CNAME 的主机名是 `rsend`，不是 `resend`；名字写错会一直 `pending`。
2. `resend._domainkey` 只能有一条 TXT，且内容不要带外层引号，重复或带引号都会导致 DKIM 校验失败。
3. 上线前用 QQ 邮箱、163 邮箱、Gmail 各测一次送达与垃圾箱位置；Resend 免费档每天 100 封。
4. 若国内送达差，只需替换 `src/email.ts` 的发送实现（例如阿里云 DirectMail），业务层不动。

## 限流与安全权衡

- **固定窗口，不是精确滑动窗口**：`rate_limits` 只有 `bucket/window_start/count` 三列。发送验证码的邮箱 5 次/小时、IP 20 次/小时，冷却 60 秒；登录失败 15 分钟窗口（邮箱 10 次、IP 30 次）；验证码校验按 IP 隔离的邮箱桶 20 次/小时、IP 30 次/小时，另有全局 per-email 猜测桶 20 次/10 分钟。计数写入用单条 `UPSERT ... RETURNING` 原子完成。
- **验证码全局桶的边界**：全局 per-email 桶可能被第三方打满，但发码人本人 IP 验证不受影响（本人 IP 跳过全局桶）。前提是受害者自己发码；攻击者代发码、或受害者换了 IP 时仍受该桶约束，最长 10 分钟。同 IP 视为同一人，因此同 IP 连续错误码仍会累计并烧码，这是已知假设。
- **登录失败锁不永久锁死账号**：邮箱失败桶是错误响应节流，不是猜测硬闸；真正的 CPU/猜测硬闸是 IP 桶（30 次 / 15 分钟）。邮箱桶满后仍会验密，密码正确就清空邮箱桶并放行，密码错误才返回 429。生产建议在 Cloudflare WAF 对 `/v1/auth/login` 再加一层限流。
- **refresh 盗用检测范围有限**：每个设备只保留当前与紧邻的上一个 token 哈希。只有紧邻的上一个 refresh token 重放会撤销整个 `family_id`；更早的 token 重放会失效，但不会触发撤族。
- **密码重置**：撤销该用户全部 refresh 会话；已签发的 access JWT 在剩余 ≤15 分钟内仍有效（JWT + refresh 方案的固有窗口）。
- **Workers 免费版 CPU**：PBKDF2 默认 210,000 次迭代，免费版 10ms CPU 会超限。当前生产用免费版，`PASSWORD_ITERATIONS` 已设为 `100000`；升级到 Workers Paid 后可改回 210,000。
- `AUTH_JWT_SECRET` / `AUTH_CODE_PEPPER` 缺失或过短时 Worker 会失败关闭，返回 `SERVER_ERROR`。
- 密码、access/refresh token 不会写入日志；验证码只在开发模式且 `ALLOW_DEV_CODE=true` 时打印到本地终端，生产环境绝不打印。
- **每日清理**：`wrangler.toml` 配置了每日 cron，删除 24 小时前的限流桶、7 天前的验证码、过期或撤销 30 天前的会话。

## 测试

```bash
npm run typecheck
npx vitest run
```

vitest 只覆盖纯函数与 HTTP 层（校验、哈希、JWT、限流决策、响应信封、CORS 预检），不依赖 D1/网络。路由级联调在本地 `wrangler dev` 或 `npm run smoke` 完成。
