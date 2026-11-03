-- 头像改为不可枚举的随机 token 寻址。
--
-- 背景：`GET /v1/account/avatar/{userId}` 是公开路径，userId 是自增整数 ——
-- 任何人可以从 1 开始批量拉取全站头像，配合管理端用户列表就能把人脸和邮箱对上。
-- 头像本身不是高敏数据，但「无需任何凭据即可枚举」是不必要的暴露。
--
-- 改用随机 token 后：只有拿到 token 的人（= 用户自己，来自 /v1/auth/me 与登录响应）
-- 能取到头像；批量遍历要猜 32 字节随机值，不可行。
ALTER TABLE users ADD COLUMN avatar_token TEXT;

-- 便于按 token 反查（唯一索引同时兜住碰撞）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_avatar_token ON users(avatar_token);
