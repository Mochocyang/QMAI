-- 百度网盘 OAuth 授权中转会话。
--
-- 为什么要有这张表：授权码模式要求用 client_secret 换 token，而 client_secret
-- 绝不能出现在客户端（安装包能被解包）。所以流程是：
--   客户端 --begin--> 拿到 authorizeUrl 与 sessionId
--   浏览器授权 --> 百度回调本 Worker 的 /oauth/baidu/callback
--   本 Worker 用 secret 换 token，加密后暂存这里（TTL 10 分钟）
--   客户端 --poll--> 取走 token，记录立即删除
--
-- 安全约定：
--   1. token 用 AES-GCM 加密后落库（密钥由 AUTH_CODE_PEPPER 派生）；
--   2. 一次性：poll 成功即删除该行；
--   3. 10 分钟 TTL，过期由 cron 清理；
--   4. 任何日志都不打印 token 明文。

CREATE TABLE IF NOT EXISTS baidu_oauth_sessions (
  -- 客户端生成的配对号（随机 32 字节 base64url），也是 poll 的查询键。
  session_id TEXT PRIMARY KEY,
  -- 发起授权时生成的随机 state，回调时校验，防 CSRF。
  state TEXT NOT NULL,
  -- pending（等用户授权）| authorized（已拿到 token）| failed（用户拒绝或出错）
  status TEXT NOT NULL,
  -- AES-GCM 密文（base64url）。 iv 单独存，避免密文自描述格式。
  token_cipher TEXT,
  token_iv TEXT,
  -- 授权下来的 scope 原文，用于审计。
  scope TEXT,
  -- JSON 数组：用户授权的目录列表，客户端每次读写前要按它校验路径。
  authorized_paths TEXT,
  -- 失败原因（百度返回的 error / errno / errmsg），只存错误码不存原文长文。
  error_code TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_baidu_oauth_expires
  ON baidu_oauth_sessions (expires_at);
