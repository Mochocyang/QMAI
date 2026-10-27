-- 青幕AI写作 - 用户统计 D1 表结构

-- 用户表：记录每个独立设备（下载用户数统计）
--
-- ip_hash 存 IP 的 SHA-256 哈希（带固定 salt），不落明文，用于
-- 「独立 IP 数」去重：同一 IP 下载/使用多次只算 1 个。
-- last_version / last_platform 由客户端 /open 上报，用于版本与平台分布。
CREATE TABLE IF NOT EXISTS users (
  uuid TEXT PRIMARY KEY,
  ip_hash TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  last_version TEXT,
  last_platform TEXT
);

-- 会话表：记录 open/heartbeat/close 事件（在线人数、DAU/WAU 统计）
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL,
  open_time TEXT NOT NULL DEFAULT (datetime('now')),
  close_time TEXT,
  last_active TEXT NOT NULL DEFAULT (datetime('now')),
  is_online INTEGER NOT NULL DEFAULT 1
);

-- 每日统计快照（cron 每 5 分钟更新一次）
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY,
  new_users INTEGER NOT NULL DEFAULT 0,
  total_users INTEGER NOT NULL DEFAULT 0,
  peak_online INTEGER NOT NULL DEFAULT 0
);

-- 后台登录凭据：只保留一行（id = 1），存站长的自定义密码
--
-- 密码用 PBKDF2-SHA256（随机 salt + 10 万次迭代）哈希后保存，不存明文。
-- 表里没有记录时，后台用 Worker Secret「DASHBOARD_PASSWORD」作为初始密码，
-- 该初始密码在设置过自定义密码后仍可用于找回（忘记密码时仍能登录重设）。
CREATE TABLE IF NOT EXISTS admin_credentials (
  id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 索引：加速在线人数、DAU/WAU 与版本分布查询
CREATE INDEX IF NOT EXISTS idx_sessions_online ON sessions(is_online) WHERE is_online = 1;
CREATE INDEX IF NOT EXISTS idx_sessions_uuid ON sessions(uuid);
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions(last_active DESC);
CREATE INDEX IF NOT EXISTS idx_users_first_seen ON users(first_seen);
CREATE INDEX IF NOT EXISTS idx_users_last_version ON users(last_version);
