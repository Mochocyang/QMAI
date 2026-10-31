-- 设备与账号的绑定关系：用于「一台设备最多注册 3 个账号」的硬限制。
--
-- 为什么需要这张表：IP 限流挡不住换代理，邮箱验证挡不住批量注册。
-- 设备指纹是更硬的身份锚点 —— 同一台电脑换多少 IP、清多少缓存，指纹都不变。
--
-- 隐私：只存客户端算好的 SHA-256 摘要（32 位十六进制），服务端拿不到原始
-- MachineGuid，也无法反推机器信息。
--
-- 清理：设备记录长期保留（重装系统才会换新指纹），由 cleanupExpiredData 按需清理
-- 90 天未活跃的行。
CREATE TABLE IF NOT EXISTS device_accounts (
  device_hash TEXT NOT NULL,      -- 客户端上报的设备指纹摘要
  user_id INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (device_hash, user_id)
);

CREATE INDEX IF NOT EXISTS idx_device_accounts_device ON device_accounts(device_hash);
CREATE INDEX IF NOT EXISTS idx_device_accounts_user ON device_accounts(user_id);
