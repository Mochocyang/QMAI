-- 迁移：昵称支持每月修改一次。
-- 用法：npx wrangler d1 execute qmai-account-db --remote --file=./migrations/0004_display_name_updated_at.sql
--
-- 记录「上次改昵称的时间」（Unix 秒）。NULL 表示从未改过（首次改名不受限）。
-- 放在服务端而不是客户端：客户端限制只是提示，绕过太容易。

ALTER TABLE users ADD COLUMN display_name_updated_at INTEGER;
