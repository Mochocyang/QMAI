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
| GET | `/v1/auth/me` | 用 Bearer access token 取当前账号 |
| POST | `/v1/auth/password/reset` | 验证码 + 新密码，撤销该用户全部会话 |

统一响应：成功 `{ "success": true, "data": ... }`；失败 `{ "success": false, "code": "...", "message": "..." }`。

## 一次性部署

```bash
cd account-worker
npm install

# 1. 创建 D1，把返回的 database_id 填进 wrangler.toml
npx wrangler d1 create qmai-account-db

# 2. 建表
npx wrangler d1 execute qmai-account-db --remote --file=./schema.sql

# 3. 写入 secrets（不要写进仓库）
npx wrangler secret put AUTH_JWT_SECRET       # >= 32 字节随机值
npx wrangler secret put AUTH_CODE_PEPPER      # >= 16 字节随机值
npx wrangler secret put RESEND_API_KEY        # Resend 控制台生成

# 4. 部署
npm run deploy
```

`wrangler.toml` 里的 `database_id` 默认是全零占位值，**必须**替换成第 1 步的返回值；`AUTH_EMAIL_FROM` 改成 Resend 已验证域名下的发信人。

生产 CORS 只保留 `tauri://localhost,https://tauri.localhost`；浏览器本地开发来源通过 `.dev.vars` 覆盖，不要写进生产配置。

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

客户端默认请求 `https://qmai-account.qmai.workers.dev`。构建时可用 `VITE_QMAI_ACCOUNT_URL` 覆盖；本地调试也可在浏览器 localStorage 写入：

```js
localStorage.setItem("qmai.account.baseUrl.v1", "http://127.0.0.1:8787")
```

正式发布建议绑定自定义域名：`workers.dev` 在部分国内网络下不稳定。

## Resend

1. 在 Resend 添加并验证发信域名（DNS 记录）。
2. 未验证域名前只能发到 Resend 账号本人邮箱，真实用户收不到码。
3. 上线前用 QQ 邮箱、163 邮箱、Gmail 各测一次送达与垃圾箱位置。
4. 若国内送达差，只需替换 `src/email.ts` 的发送实现（例如阿里云 DirectMail），业务层不动。

## 限流与安全权衡

- **固定窗口，不是精确滑动窗口**：`rate_limits` 只有 `bucket/window_start/count` 三列。发送验证码的邮箱 5 次/小时、IP 20 次/小时，冷却 60 秒；登录失败 15 分钟窗口（邮箱 10 次、IP 30 次）；验证码校验按 IP 隔离的邮箱桶 20 次/小时、IP 30 次/小时，另有全局 per-email 猜测桶 20 次/10 分钟。计数写入用单条 `UPSERT ... RETURNING` 原子完成。
- **验证码全局桶的边界**：全局 per-email 桶可能被第三方打满，但发码人本人 IP 验证不受影响（本人 IP 跳过全局桶）。同 IP 视为同一人，因此同 IP 连续错误码仍会累计并烧码，这是已知假设。
- **登录失败锁不永久锁死账号**：邮箱失败桶是错误响应节流，不是猜测硬闸；真正的 CPU/猜测硬闸是 IP 桶（30 次 / 15 分钟）。邮箱桶满后仍会验密，密码正确就清空邮箱桶并放行，密码错误才返回 429。生产建议在 Cloudflare WAF 对 `/v1/auth/login` 再加一层限流。
- **refresh 盗用检测范围有限**：每个设备只保留当前与紧邻的上一个 token 哈希。只有紧邻的上一个 refresh token 重放会撤销整个 `family_id`；更早的 token 重放会失效，但不会触发撤族。
- **密码重置**：撤销该用户全部 refresh 会话；已签发的 access JWT 在剩余 ≤15 分钟内仍有效（JWT + refresh 方案的固有窗口）。
- **Workers 免费版 CPU**：PBKDF2 默认 210,000 次迭代，免费版 10ms CPU 可能超限。必须用免费版时把 `PASSWORD_ITERATIONS` 降到 `100000`，并接受安全强度下降。
- `AUTH_JWT_SECRET` / `AUTH_CODE_PEPPER` 缺失或过短时 Worker 会失败关闭，返回 `SERVER_ERROR`。
- 密码、access/refresh token 不会写入日志；验证码只在开发模式且 `ALLOW_DEV_CODE=true` 时打印到本地终端，生产环境绝不打印。
- **每日清理**：`wrangler.toml` 配置了每日 cron，删除 24 小时前的限流桶、7 天前的验证码、过期或撤销 30 天前的会话。

## 测试

```bash
npm run typecheck
npx vitest run
```

vitest 只覆盖纯函数与 HTTP 层（校验、哈希、JWT、限流决策、响应信封、CORS 预检），不依赖 D1/网络。路由级联调在本地 `wrangler dev` 或 `npm run smoke` 完成。
