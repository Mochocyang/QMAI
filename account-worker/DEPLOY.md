# 部署账号 Worker（qmai-account / account.qmai.pro）

## 账号归属（先确认这一条，否则白忙）

部署目标账号是 **`mochocyang@gmail.com`**，Account ID **`5bd795a121b2fb9730a6ce3cb3ddacf8`**。

本机可能已登录成别的账号（例如 `cousarbartula@gmail.com`），那个账号里
**没有** `qmai-account` 这个 Worker，也没有 `qmai-account-db`，部署会找不到目标。
先 `whoami` 核对，不对就重新登录。

## 为什么不能直接 `npx wrangler`

本机 DSH 的 node 是 **Electron-as-Node**（`process.versions.electron` 存在），
wrangler 依赖的 yargs 会把它判定为 bundled electron，导致 argv 整体错位一格，
于是它把自己的 `cli.js` 当成参数：

```
X [ERROR] Unknown arguments: ...\wrangler-dist\cli.js, whoami
```

用**系统 Node** 执行即可绕开（本机在 `C:\Program Files\nodejs\node.exe`）：

```powershell
cd account-worker
& "C:\Program Files\nodejs\node.exe" node_modules\wrangler\wrangler-dist\cli.js whoami
& "C:\Program Files\nodejs\node.exe" node_modules\wrangler\wrangler-dist\cli.js deploy
```

下面用变量简化：

```powershell
$Node = "C:\Program Files\nodejs\node.exe"
$Cli  = "node_modules\wrangler\wrangler-dist\cli.js"
```

## 无浏览器的登录（设备码流程）

`wrangler login` 默认起 `localhost:8976` 回调服务；浏览器不在本机时用设备码：

```powershell
& $Node $Cli login --device --browser false
```

它打印 `https://dash.cloudflare.com/oauth2/device/verify` 与 8 位验证码，
**5 分钟内**在任意设备的浏览器输入。授权页可以选账号，务必选 `mochocyang@gmail.com`。

## 标准步骤

```powershell
# 1. 确认账号
& $Node $Cli whoami

# 2. 看线上表结构（确认待应用的列/索引是否存在）
& $Node $Cli d1 execute qmai-account-db --remote --command "SELECT name FROM pragma_table_info('users')"

# 3. 干跑，确认产物带着新路由
& $Node $Cli deploy --dry-run --outdir $env:TEMP\wr-dry

# 4. 正式部署
& $Node $Cli deploy
```

## 关于 D1 迁移

线上 `d1_migrations` 表里没有记账，但表结构实际已齐全。因此
`d1 migrations list --remote` 会把全部迁移都列为「待应用」。

**不要**直接 `d1 migrations apply --remote`：`0002_avatar.sql` /
`0004_display_name_updated_at.sql` 是 `ALTER TABLE ADD COLUMN`，列已存在会整批
报错中断。新增表用 `d1 execute --remote --command` 单独执行即可（都是
`CREATE TABLE IF NOT EXISTS`，幂等）。

### 迁移 0008（avatar_token）：必须拆成两条

```powershell
& $Node $Cli d1 execute qmai-account-db --remote --command "ALTER TABLE users ADD COLUMN avatar_token TEXT"
& $Node $Cli d1 execute qmai-account-db --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_avatar_token ON users(avatar_token)"
```

验证：

```powershell
& $Node $Cli d1 execute qmai-account-db --remote --command "SELECT name FROM pragma_table_info('users') WHERE name='avatar_token'"
```

## 部署后自检

```
POST /admin/users/status      期望 401 UNAUTHORIZED   ← 404 说明新代码没上线
GET  /admin/sessions          期望 401 UNAUTHORIZED
POST /v1/netcard/verify       期望 200 { valid:false, reason:"session_not_found" }
GET  /v1/account/avatar/9     期望 404 NOT_FOUND       ← 旧的自增 id 形式已废
GET  https://qmai.pro/legal   期望 200
```

> 注意：`/v1/netcard` 只注册了 **POST**，用 GET 探测会得到 404，这是正常的。

## 两个真实踩过的坑

**1. 头像路由的 404 有歧义。**
头像改成随机 token 后，拿**随便编的 token** 去探测会得到
`404 NOT_FOUND「接口不存在」`，与「路由没注册」的响应**一模一样**——
因为 `handleGetAvatar` 查不到头像时返回的就是 `failure("NOT_FOUND")`。
**不要凭这个 404 判断部署失败。** 要验证路由是否真的生效，先给某个真实用户
写一个 token，再请求它（期望 `200` + `image/webp`），验完记得清掉。

**2. 用 API 取线上脚本时返回的是字节数组。**
`GET /accounts/<id>/workers/scripts/<name>` 返回二进制，直接当字符串
`includes()` 会全部判定为「没有」，从而误以为线上代码没更新。
正确做法：

```js
const buf = Buffer.from(await res.arrayBuffer())
const text = buf.toString("utf8")
```

## 会话与设备私钥的存储（2026-11-03 起）

账号会话与设备签名私钥不再写 localStorage，改走 `secret_store`（Windows DPAPI）。
启动时 `hydrateAccountSession()` 负责读入内存并完成旧明文迁移。这是纯客户端
行为，无需部署；但**不允许**让 `loadAccountSession()` 在 Tauri 下退回读明文
（那会形成旁路，加密存储就白做了）。
