-- 迁移：给已有库补头像列。
-- 新建库用 schema.sql 即可，不需要跑这个文件。
-- 用法：npx wrangler d1 execute qmai-account-db --remote --file=./migrations/0002_avatar.sql
--
-- D1 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，重复执行会报
-- "duplicate column name"，那是幂等成功的表现，可以忽略。

ALTER TABLE users ADD COLUMN avatar_mime TEXT;
ALTER TABLE users ADD COLUMN avatar_data BLOB;
ALTER TABLE users ADD COLUMN avatar_updated_at INTEGER;
