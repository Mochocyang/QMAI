-- 青幕AI写作 · 账号 Worker D1 表结构
-- 时间统一使用 Unix 秒（INTEGER）；邮箱统一 trim + 小写后存储。
-- 所有写入均通过 D1 prepared statement 参数绑定，禁止拼接用户输入。

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- 头像：BLOB 存 WebP/PNG/JPEG 原字节，mime 单独记；未设置时为 NULL。
  avatar_mime TEXT,
  avatar_data BLOB,
  avatar_updated_at INTEGER,
  -- 头像读取用的随机 token：公开 URL 不再用自增 id（否则可被批量枚举）。
  avatar_token TEXT,
  -- 昵称每月只能改一次：记录上次修改时间（Unix 秒），NULL 表示从未改过。
  display_name_updated_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_avatar_token ON users(avatar_token);

CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'reset')),
  code_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER,
  request_ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_codes_lookup
  ON email_codes(email, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  previous_token_hash TEXT,
  device_label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_family_id ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_previous_token_hash ON sessions(previous_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_revoked_at ON sessions(revoked_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

-- 模型配置云端保管：只存客户端加密后的密文（服务端零知识）。
-- 一个用户一行，只保留最新一份；version 用于乐观锁，防止旧设备覆盖新配置。
CREATE TABLE IF NOT EXISTS model_configs (
  user_id      INTEGER PRIMARY KEY,
  payload      TEXT    NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  device_label TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_configs_updated_at ON model_configs(updated_at DESC);

-- 吊销操作留痕：谁在什么时候踢了谁、影响多少会话。
CREATE TABLE IF NOT EXISTS revoke_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,          -- user | session | all
  target TEXT NOT NULL,         -- userId / sessionId / "ALL"
  reason TEXT,
  revoked INTEGER NOT NULL,     -- 影响多少行
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revoke_audit_at ON revoke_audit(at DESC);

-- 设备与账号的绑定：用于「一台设备最多注册 N 个账号」的硬限制。
-- 只存客户端算好的 SHA-256 摘要，服务端拿不到原始 MachineGuid。
CREATE TABLE IF NOT EXISTS device_accounts (
  device_hash TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (device_hash, user_id)
);

CREATE INDEX IF NOT EXISTS idx_device_accounts_device ON device_accounts(device_hash);
CREATE INDEX IF NOT EXISTS idx_device_accounts_user ON device_accounts(user_id);
