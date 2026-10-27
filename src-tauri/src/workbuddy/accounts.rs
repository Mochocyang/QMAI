//! WorkBuddy 账号存储：加密落盘、按 uid 幂等、优先级与可用性。
//!
//! ── 数据落点 ───────────────────────────────────────────────
//! `<app_config_dir>/workbuddy-accounts.json` + 同目录 `workbuddy-accounts.key`。
//! 与 `app-state.json` **分开存**是刻意的：那个文件是明文（用户能直接打开看、
//! 备份工具会打包），凭证不能混进去。
//!
//! ── 磁盘形状 ───────────────────────────────────────────────
//! 落盘时 `auth`（accessToken / refreshToken / 到期时间 / domain）整体加密成一个
//! `enc1:…` 字符串；其余字段（uid / 昵称 / 版本 / 端点 / 优先级）明文 —— 它们是
//! 界面要显示的东西，加密只会让排障变难，且不构成秘密。
//!
//! ── 幂等口径 ───────────────────────────────────────────────
//! `id = "user-<uid>"`，`upsert` 按 id 覆盖。于是「同一个账号重新登录一次」
//! 不会变成两条记录（那会让全局队列里出现两个同源账号，请求随机落到新旧 token
//! 上，症状是「时好时坏」）。`added_at` 保留第一次添加的时间，`priority` 也保留。
//!
//! ── 对外视图 ───────────────────────────────────────────────
//! [`AccountStore::public_view`] 是**唯一**允许跨 IPC 出去的形状：不含 auth，
//! uid 只给尾 6 位。任何命令都不许直接把 [`Account`] 序列化给前端。
//!
//! ── 并发 ──────────────────────────────────────────────────
//! 单进程内的账号操作都很快（一次读改写一个小 json），用一把 `Mutex` 串行化；
//! 网络请求（登录、刷新、拉目录）**不在锁内**做，见各调用方的写法。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::crypto;
use super::endpoints::Edition;

/// 账号文件名与密钥文件名（同目录，分离存放）。
pub const ACCOUNTS_FILE: &str = "workbuddy-accounts.json";
pub const ACCOUNTS_KEY_FILE: &str = "workbuddy-accounts.key";

/// 账号文件格式版本。加字段不必升版本（`#[serde(default)]` 兜住），
/// 但**改 auth 的语义**或搬文件位置时必须升。
const FILE_VERSION: u32 = 1;

/// 一个账号的凭证。整体加密落盘。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Auth {
    #[serde(rename = "accessToken")]
    pub access_token: String,
    #[serde(rename = "refreshToken", default)]
    pub refresh_token: String,
    /// 毫秒时间戳；0 表示上游没给（按「未知」处理，不提前刷新）。
    #[serde(rename = "expiresAt", default)]
    pub expires_at: i64,
    #[serde(rename = "refreshExpiresAt", default)]
    pub refresh_expires_at: i64,
    /// 上游下发的租户域名，回填 `X-Domain` 用。
    #[serde(default)]
    pub domain: String,
}

impl Auth {
    /// 距到期不足 `margin_ms` 即视为「该刷新了」。
    pub fn is_expiring(&self, now_ms: i64, margin_ms: i64) -> bool {
        if self.expires_at <= 0 {
            return false;
        }
        self.expires_at - now_ms < margin_ms
    }
}

/// 一个已登录账号。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub provider: String,
    pub uid: String,
    pub nickname: String,
    pub edition: String,
    pub endpoint: String,
    pub prefix_path: String,
    pub platform: String,
    pub auth: Auth,
    pub added_at: i64,
    pub priority: i64,
    pub enabled: bool,
}

impl Account {
    /// 从一次成功登录的结果构造账号。
    ///
    /// `nickname` 允许为空（上游资料接口偶尔挂），界面会退化成 uid 尾号。
    pub fn from_login(edition: Edition, uid: &str, nickname: &str, auth: Auth) -> Account {
        Account {
            id: format!("user-{uid}"),
            provider: edition.provider_id().to_string(),
            uid: uid.to_string(),
            nickname: nickname.to_string(),
            edition: edition.id.to_string(),
            endpoint: edition.endpoint.to_string(),
            prefix_path: edition.prefix_path.to_string(),
            platform: edition.platform.to_string(),
            auth,
            added_at: now_ms(),
            priority: DEFAULT_PRIORITY,
            enabled: true,
        }
    }

    /// 该账号对应的版本（端点/UA 的事实来源）。
    ///
    /// 落盘过的 `endpoint` 优先（staging / 自建反代的账号会与常量不同），
    /// 但版本本身按 `edition` 解析。
    pub fn edition(&self) -> Edition {
        Edition::from_id(Some(self.edition.as_str()))
    }

    /// 展示名：昵称，没有就退回 uid 尾号。
    pub fn display_name(&self) -> String {
        let nickname = self.nickname.trim();
        if !nickname.is_empty() {
            return nickname.to_string();
        }
        tail(&self.uid, 6)
    }
}

/// 缺省优先级（与其它 provider 的约定一致：越小越先）。
pub const DEFAULT_PRIORITY: i64 = 100;

/// 刷新提前量：到期前 5 分钟就换新，避免「验证通过、请求时刚好过期」。
///
/// 刷新决策的唯一实现点是 `refresh::should_refresh`（网关与命令层都走它）；
/// 这里保留同名常量是为了让「到期前多久算临期」只有**一个数值**，两处不会分叉。
/// 二期把「设置里可调提前量」做出来时，改这一处即可。
#[allow(dead_code)]
pub const REFRESH_MARGIN_MS: i64 = 5 * 60 * 1000;

/// 落盘的账号记录（`auth` 是密文信封）。
#[derive(Serialize, Deserialize)]
struct StoredAccount {
    id: String,
    provider: String,
    uid: String,
    #[serde(default)]
    nickname: String,
    edition: String,
    endpoint: String,
    #[serde(default)]
    prefix_path: String,
    #[serde(default)]
    platform: String,
    auth: String,
    #[serde(default)]
    added_at: i64,
    #[serde(default = "default_priority")]
    priority: i64,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn default_priority() -> i64 {
    DEFAULT_PRIORITY
}

fn default_enabled() -> bool {
    true
}

#[derive(Serialize, Deserialize)]
struct AccountsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    accounts: Vec<StoredAccount>,
}

fn default_version() -> u32 {
    FILE_VERSION
}

/// 账号仓库。`load` 之后所有读写都走内存，`upsert` / `remove` 会立刻落盘。
pub struct AccountStore {
    path: PathBuf,
    key_path: PathBuf,
    accounts: Vec<Account>,
}

impl AccountStore {
    /// 从目录加载；文件不存在等于空仓库（不是错误）。
    ///
    /// 单条记录解不开（密钥换过）时**跳过该条并继续**，而不是让整个仓库加载失败：
    /// 一条坏记录不该把用户其它能用的账号一起锁死。调用方拿到的是「能用的那些」。
    pub fn load(dir: &Path) -> Result<AccountStore, String> {
        let path = dir.join(ACCOUNTS_FILE);
        let key_path = dir.join(ACCOUNTS_KEY_FILE);
        let mut accounts = Vec::new();

        if path.exists() {
            let text = std::fs::read_to_string(&path)
                .map_err(|error| format!("读取账号文件失败：{error}"))?;
            let parsed: AccountsFile = serde_json::from_str(&text)
                .map_err(|error| format!("账号文件格式损坏：{error}"))?;
            for stored in parsed.accounts {
                match decode(stored, &key_path) {
                    Ok(account) => accounts.push(account),
                    Err(error) => {
                        crate::workbuddy::logging::warn(&format!(
                            "跳过一条无法解密的 WorkBuddy 账号记录：{error}"
                        ));
                    }
                }
            }
        }

        Ok(AccountStore {
            path,
            key_path,
            accounts,
        })
    }

    /// 一个空的仓库（**不读盘**）。
    ///
    /// 只用于「账号文件损坏、但应用必须能起来」的降级路径：设置页仍然打得开，
    /// 用户看到的是「还没有登录账号」，而不是一个起不来的应用。
    pub fn empty(dir: &Path) -> AccountStore {
        AccountStore {
            path: dir.join(ACCOUNTS_FILE),
            key_path: dir.join(ACCOUNTS_KEY_FILE),
            accounts: Vec::new(),
        }
    }

    /// 全部账号（按优先级升序、同级按添加时间升序 —— 稳定，便于界面与候选链）。
    pub fn list(&self) -> Vec<Account> {
        let mut all = self.accounts.clone();
        all.sort_by(|a, b| a.priority.cmp(&b.priority).then(a.added_at.cmp(&b.added_at)));
        all
    }

    /// 第一个可用的账号（本期只取这一个；多账号轮转留到二期）。
    pub fn current(&self) -> Option<Account> {
        self.list().into_iter().find(|account| account.enabled)
    }

    /// 按 id 取。
    pub fn get(&self, id: &str) -> Option<Account> {
        self.accounts.iter().find(|account| account.id == id).cloned()
    }

    /// 有没有任何账号（含已停用的）。
    ///
    /// 与 [`Self::has_enabled`] 的区别正是「删号 vs 停用」：设置页要用前者判断
    /// 「要不要把卡片置灰」，用后者判断「现在能不能发请求」。本期 UI 只有删除，
    /// 二期加停用开关时会用到 `has_enabled`。
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.accounts.is_empty()
    }

    /// 有没有可用（已启用）的账号。
    #[allow(dead_code)]
    pub fn has_enabled(&self) -> bool {
        self.accounts.iter().any(|account| account.enabled)
    }

    /// 新增或按 id 覆盖（同一账号重新登录走这条）。
    ///
    /// 覆盖时保留 `added_at` 与 `priority`：它们描述的是「这个账号在你列表里
    /// 的位置」，不随一次重新登录变化。
    pub fn upsert(&mut self, mut account: Account) -> Result<Account, String> {
        if let Some(existing) = self
            .accounts
            .iter_mut()
            .find(|item| item.id == account.id)
        {
            account.added_at = existing.added_at;
            account.priority = existing.priority;
            account.enabled = existing.enabled;
            *existing = account.clone();
        } else {
            self.accounts.push(account.clone());
        }
        self.persist()?;
        Ok(account)
    }

    /// 换凭证（刷新后回写）。
    pub fn update_auth(&mut self, id: &str, auth: Auth) -> Result<(), String> {
        let Some(target) = self.accounts.iter_mut().find(|item| item.id == id) else {
            return Err(format!("账号不存在：{id}"));
        };
        target.auth = auth;
        self.persist()
    }

    /// 删除。删掉最后一个账号**不**自动删卡片，由前端把卡片置灰（见规格 2.1）。
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let before = self.accounts.len();
        self.accounts.retain(|account| account.id != id);
        if self.accounts.len() == before {
            return Err(format!("账号不存在：{id}"));
        }
        self.persist()
    }

    /// 启停（界面上的「停用这个账号」）。
    ///
    /// 本期 UI 只提供「删除」；但「保留账号、先不用它」是二期多账号的必然需求，
    /// 且存储层已经按 `enabled` 过滤（见 [`Self::current`]），所以实现与用例都在，
    /// 只差一个开关按钮。
    #[allow(dead_code)]
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        let Some(target) = self.accounts.iter_mut().find(|item| item.id == id) else {
            return Err(format!("账号不存在：{id}"));
        };
        target.enabled = enabled;
        self.persist()
    }

    /// 给前端看的形状：**不含任何凭证**，uid 只给尾 6 位。
    pub fn public_view(&self) -> Value {
        let items: Vec<Value> = self
            .list()
            .into_iter()
            .map(|account| {
                json!({
                    "id": account.id,
                    "provider": account.provider,
                    "nickname": account.display_name(),
                    "uidTail": tail(&account.uid, 6),
                    "edition": account.edition,
                    "editionLabel": account.edition().label,
                    "expiresAt": account.auth.expires_at,
                    "enabled": account.enabled,
                    "addedAt": account.added_at,
                })
            })
            .collect();
        json!({ "accounts": items, "count": items.len() })
    }

    /// 落盘：按当前内存状态重写整个文件（原子替换）。
    fn persist(&self) -> Result<(), String> {
        let mut stored = Vec::with_capacity(self.accounts.len());
        for account in &self.accounts {
            let auth_json = serde_json::to_vec(&account.auth)
                .map_err(|error| format!("序列化凭证失败：{error}"))?;
            let envelope = crypto::seal(&self.key_path, &auth_json)?;
            stored.push(StoredAccount {
                id: account.id.clone(),
                provider: account.provider.clone(),
                uid: account.uid.clone(),
                nickname: account.nickname.clone(),
                edition: account.edition.clone(),
                endpoint: account.endpoint.clone(),
                prefix_path: account.prefix_path.clone(),
                platform: account.platform.clone(),
                auth: envelope,
                added_at: account.added_at,
                priority: account.priority,
                enabled: account.enabled,
            });
        }
        let file = AccountsFile {
            version: FILE_VERSION,
            accounts: stored,
        };
        let text = serde_json::to_string_pretty(&file)
            .map_err(|error| format!("序列化账号文件失败：{error}"))?;
        crate::atomic_file::write_bytes_atomically(&self.path, text.as_bytes())
    }
}

fn decode(stored: StoredAccount, key_path: &Path) -> Result<Account, String> {
    let plaintext = crypto::open(key_path, &stored.auth)?;
    let auth: Auth = serde_json::from_slice(&plaintext)
        .map_err(|error| format!("凭证内容损坏：{error}"))?;
    Ok(Account {
        id: stored.id,
        provider: stored.provider,
        uid: stored.uid,
        nickname: stored.nickname,
        edition: stored.edition,
        endpoint: stored.endpoint,
        prefix_path: stored.prefix_path,
        platform: stored.platform,
        auth,
        added_at: stored.added_at,
        priority: stored.priority,
        enabled: stored.enabled,
    })
}

/// 取字符串末尾 `n` 个**字符**（不是字节：昵称/uid 可能含中文或多字节字符）。
pub fn tail(value: &str, n: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= n {
        return value.to_string();
    }
    chars[chars.len() - n..].iter().collect()
}

/// 当前毫秒时间戳（统一走 chrono，避免各处各写一遍 SystemTime 换算）。
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbuddy::test_support::temp_dir;

    fn sample(uid: &str, nickname: &str) -> Account {
        let auth = Auth {
            access_token: "ACCESS-TOKEN-X".to_string(),
            refresh_token: "REFRESH-TOKEN-Y".to_string(),
            expires_at: now_ms() + 3_600_000,
            refresh_expires_at: now_ms() + 86_400_000,
            domain: "www.workbuddy.cn".to_string(),
        };
        Account::from_login(Edition::CN, uid, nickname, auth)
    }

    #[test]
    fn upsert_same_uid_updates_instead_of_appending() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        store.upsert(sample("uid-1", "旧名")).unwrap();
        store.upsert(sample("uid-1", "新名")).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].nickname, "新名");
        assert_eq!(store.list()[0].id, "user-uid-1");
    }

    #[test]
    fn uuid_nickname_and_priority_survive_relogin() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        let mut first = sample("uid-1", "名");
        first.added_at = 111;
        first.priority = 7;
        store.upsert(first).unwrap();
        store.upsert(sample("uid-1", "名")).unwrap();
        let stored = &store.list()[0];
        assert_eq!(stored.added_at, 111);
        assert_eq!(stored.priority, 7);
    }

    #[test]
    fn file_never_contains_plaintext_tokens() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        store.upsert(sample("uid-1", "名")).unwrap();
        let raw = std::fs::read_to_string(dir.join(ACCOUNTS_FILE)).unwrap();
        assert!(!raw.contains("ACCESS-TOKEN-X"), "accessToken 明文落盘了");
        assert!(!raw.contains("REFRESH-TOKEN-Y"), "refreshToken 明文落盘了");
        assert!(raw.contains(crypto::ENVELOPE_PREFIX));
        assert!(raw.contains("user-uid-1"), "身份字段应当可读，便于排障");
    }

    #[test]
    fn public_view_hides_secrets_and_shortens_uid() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        store
            .upsert(sample("0123456789abcdef", "小明"))
            .unwrap();
        let view = store.public_view();
        let item = &view["accounts"][0];
        assert!(item.get("auth").is_none());
        assert_eq!(item["nickname"], "小明");
        assert_eq!(item["uidTail"], "abcdef");
        let text = serde_json::to_string(&view).unwrap();
        assert!(!text.contains("ACCESS-TOKEN-X"));
    }

    #[test]
    fn reload_round_trips() {
        let dir = temp_dir();
        {
            let mut store = AccountStore::load(&dir).unwrap();
            store.upsert(sample("uid-9", "老张")).unwrap();
        }
        let store = AccountStore::load(&dir).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].nickname, "老张");
        assert_eq!(store.list()[0].auth.access_token, "ACCESS-TOKEN-X");
    }

    #[test]
    fn remove_and_current() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        store.upsert(sample("uid-a", "A")).unwrap();
        store.upsert(sample("uid-b", "B")).unwrap();
        assert!(store.current().is_some());
        store.remove("user-uid-a").unwrap();
        assert_eq!(store.list().len(), 1);
        store.remove("user-uid-b").unwrap();
        assert!(store.current().is_none());
        assert!(store.is_empty());
        assert!(store.remove("nope").is_err());
    }

    #[test]
    fn disabled_account_is_not_current() {
        let dir = temp_dir();
        let mut store = AccountStore::load(&dir).unwrap();
        store.upsert(sample("uid-a", "A")).unwrap();
        store.set_enabled("user-uid-a", false).unwrap();
        assert!(store.current().is_none());
        assert!(!store.has_enabled());
    }

    #[test]
    fn tail_counts_chars_not_bytes() {
        assert_eq!(tail("0123456789", 4), "6789");
        assert_eq!(tail("中文字符串", 2), "符串");
        assert_eq!(tail("ab", 6), "ab");
    }
}
