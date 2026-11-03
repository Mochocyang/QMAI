/**
 * 系统加密仓库（Windows DPAPI / macOS Keychain 等）里使用的键名。
 *
 * 单独一个零依赖模块的原因：这些名字被两边同时需要 ——
 * model-sync-store 用它存取同步密码，account-hook 的注销清理用它删除密码。
 * 若把常量定义在 account-hook 里，store 就得**静态**依赖 hook；hook 又依赖
 * project-store / wiki-store，等于给一个纯键名把整条重依赖链拉进 store 的
 * 模块图（测试里的 mock 边界也会被波及）。共享一个叶子模块是最小的正确解。
 */

/** 模型同步密码。 */
export const SYNC_PASSWORD_SECRET_NAME = "model-sync-password"

/** 本机模型备份的数据密钥（随机生成，不经用户密码派生）。 */
export const BACKUP_KEY_SECRET_NAME = "model-backup-key"
