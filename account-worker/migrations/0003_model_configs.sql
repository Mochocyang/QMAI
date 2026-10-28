-- 迁移：模型配置云端保管（只存密文，服务端零知识）。
-- 新建库用 schema.sql 即可；已有库跑本文件：
--   npx wrangler d1 execute qmai-account-db --remote --file=./migrations/0003_model_configs.sql

CREATE TABLE IF NOT EXISTS model_configs (
  -- 一个用户只保留最新一份配置
  user_id      INTEGER PRIMARY KEY,
  -- 客户端用「同步密码」派生的密钥做 AES-GCM 加密后的信封 JSON
  payload      TEXT    NOT NULL,
  -- 每次写入自增，配合客户端 baseVersion 做乐观锁
  version      INTEGER NOT NULL DEFAULT 1,
  updated_at   INTEGER NOT NULL,
  device_label TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_model_configs_updated_at ON model_configs(updated_at DESC);
