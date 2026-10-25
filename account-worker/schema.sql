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
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
