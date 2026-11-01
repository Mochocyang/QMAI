# 部署账号 Worker（qmai-account / account.qmai.pro）

## 为什么不能直接 
px wrangler

本机 DSH 的 node 是 **Electron-as-Node**（`process.versions.electron` 存在），
wrangler 依赖的 yargs 会把它判定为 bundled electron，导致 argv 整体错位一格，
于是它把自己的 `cli.js` 当成参数：

`
X [ERROR] Unknown arguments: ...\wrangler-dist\cli.js, whoami
`

用 **系统 Node** 执行即可绕开（本机在 `C:\Program Files\nodejs\node.exe`）：

``powershell
cd account-worker
& "C:\Program Files\nodejs\node.exe" node_modules\wrangler\wrangler-dist\cli.js whoami
& "C:\Program Files\nodejs\node.exe" node_modules\wrangler\wrangler-dist\cli.js deploy
``

或使用随仓库的启动器（内部就是干这件事）：

``powershell
 = "deploy"; node scripts/wr.cjs
``

## 标准步骤

``powershell
 = "C:\Program Files\nodejs\node.exe"
  = "node_modules\wrangler\wrangler-dist\cli.js"

# 1. 确认登录的账号（应为 mochocyang@gmail.com / Account 5bd795a1...）
&   whoami

# 2. 看线上库表是否齐（model_configs / device_accounts / revoke_audit）
&   d1 execute qmai-account-db --remote --command "select name from sqlite_master where type='table'"

# 3. 先干跑，确认产物里带着路由
&   deploy --dry-run --outdir $env:TEMP\wr-dry

# 4. 正式部署
&   deploy
``

## 部署后自检

``powershell
# 401 = 路由存在（需要登录）；404 code=NOT_FOUND = 路由不存在
Invoke-WebRequest https://account.qmai.pro/v1/model-config   # 期望 401
Invoke-WebRequest https://account.qmai.pro/v1/auth/me        # 期望 401
``

> 注意：`/v1/netcard` 只注册了 **POST**，用 GET 探测会得到 404，这是正常的。

## 关于 D1 迁移

线上 `d1_migrations` 表里没有记账，但**表结构实际已齐全**（`model_configs`、
`device_accounts`、`revoke_audit` 均存在）。因此 `d1 migrations list --remote`
会把全部迁移都列为「待应用」。

**不要**直接 `d1 migrations apply --remote`：`0002_avatar.sql` /
`0004_display_name_updated_at.sql` 是 `ALTER TABLE ADD COLUMN`，列已存在会整批
报错中断。新增表用 `d1 execute --remote --command` 单独执行即可（它们都是
`CREATE TABLE IF NOT EXISTS`，幂等）。