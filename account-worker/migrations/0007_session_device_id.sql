-- 007 会话记录设备指纹
--
-- ## 为什么加这个
--
-- 中转站的 usage_logs 里每条调用都带 device_id（设备指纹哈希），
-- 但账号服务的 sessions 只有 device_label（用户填的设备名）。
-- 两边没有共同字段，没法把「这台设备」和「这个人登录时用的名字」对上，
-- 导致控制台只能靠时间窗口「猜」设备名。
--
-- 存了 device_id 之后可以精确关联：
--   usage_logs.device_id = sessions.device_id
--
-- 老数据保持 NULL，不影响。

ALTER TABLE sessions ADD COLUMN device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_device ON sessions(user_id, device_id);
