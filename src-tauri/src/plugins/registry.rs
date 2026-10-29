use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths;

/// 当前注册表格式版本（盘上 `version` 字段的值）。
const CURRENT_VERSION: u32 = 1;

/// 安装来源：责任归属的凭据（设计文档 8.6）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceRecord {
    pub repo: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub commit: String,
    pub zip_sha256: String,
    pub installed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub version: String,
    pub enabled: bool,
    pub granted_permissions: Vec<String>,
    pub source: SourceRecord,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct RegistryFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    plugins: BTreeMap<String, RegistryEntry>,
}

/// 插件注册表：`.registry.json` 是唯一权威（对应 DSH「开关只能有一个写入点」的教训）
#[derive(Debug)]
pub struct PluginRegistry {
    file: RegistryFile,
}

impl PluginRegistry {
    /// 文件不存在 → 空表；文件损坏 → 报错（绝不当作空表覆盖）
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = paths::registry_file(root);
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            // 首次安装：文件本就不存在，这是正常状态，不是错误
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self {
                    file: RegistryFile { version: CURRENT_VERSION, plugins: BTreeMap::new() },
                });
            }
            // 读不动和读坏了都必须报错：当成空表返回，下一次 save 就会把
            // 用户的插件列表整体清空（静默丢数据，比报错难查得多）
            Err(e) => return Err(format!("读取插件注册表失败 {}: {e}", path.display())),
        };

        let mut file: RegistryFile = serde_json::from_str(&text)
            .map_err(|e| format!("插件注册表损坏 {}: {e}", path.display()))?;
        // 手写或极旧的文件可能没有 version 字段（serde 默认给 0），统一视为当前版本
        if file.version == 0 {
            file.version = CURRENT_VERSION;
        }
        // 版本比本程序新：降级运行会把读不懂的字段丢掉、再回写成旧版本，等于静默丢数据。
        // 宁可明确拒绝，让用户看到"请升级软件"。
        if file.version > CURRENT_VERSION {
            return Err(format!(
                "插件注册表版本 {} 高于本程序支持的 {}，请升级软件后再试（{}）",
                file.version,
                CURRENT_VERSION,
                path.display()
            ));
        }

        // 加载时重新校验：本文件是用户可手工编辑的本地文件，id 会被拼成磁盘路径
        // （paths::plugin_dir），`../../x` 或 `C:\x` 能让后续安装/卸载跑到插件根目录之外。
        // 写入时校验过 ≠ 读回来是干净的。
        for (key, entry) in &file.plugins {
            if !super::manifest::is_valid_id(key) {
                return Err(format!("插件注册表含非法 id：{key}（{}）", path.display()));
            }
            // key 与 entry.id 必须一致：注册表的 key 才是查表/删除的依据，
            // 两者不一致时「按 id 查到的东西」和「实际写盘的位置」会指向两个不同插件。
            // （key 合法且 key == entry.id ⇒ entry.id 必然合法，故不必单独再校验 id。）
            if *key != entry.id {
                return Err(format!(
                    "插件注册表条目 id 与键不一致：{key} → {}（{}）",
                    entry.id,
                    path.display()
                ));
            }
        }

        Ok(Self { file })
    }

    pub fn get(&self, id: &str) -> Option<&RegistryEntry> { self.file.plugins.get(id) }
    pub fn list(&self) -> Vec<RegistryEntry> { self.file.plugins.values().cloned().collect() }
    pub fn upsert(&mut self, entry: RegistryEntry) { self.file.plugins.insert(entry.id.clone(), entry); }
    pub fn remove(&mut self, id: &str) -> Option<RegistryEntry> { self.file.plugins.remove(id) }
    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), String> {
        match self.file.plugins.get_mut(id) {
            Some(entry) => {
                entry.enabled = enabled;
                Ok(())
            }
            // 明确报「未安装」而不是默默当成功：界面在插件目录被手工删掉后
            // 仍可能点开关，静默成功会让界面显示的状态与磁盘现实长期不一致
            None => Err(format!("插件 {id} 未安装")),
        }
    }
    pub fn save(&self, root: &Path) -> Result<(), String> {
        let path = paths::registry_file(root);
        // 读侧会拒绝非法 id；写侧若放行，一次 save 就能产出一份永远 load 不回来的文件
        // （用户只能手改盘才恢复）。所以闸门放在写盘之前，Err 时保证不落盘。
        for entry in self.file.plugins.values() {
            if !super::manifest::is_valid_id(&entry.id) {
                return Err(format!(
                    "插件注册表含非法 id：{}（拒绝写入 {}）",
                    entry.id,
                    path.display()
                ));
            }
        }
        let text = serde_json::to_string_pretty(&self.file)
            .map_err(|e| format!("序列化插件注册表失败: {e}"))?;
        // 不再手搓「写临时文件 + rename」：那会漏掉 fsync（断电后可能得到名字对、
        // 内容半截的文件）、失败不清理临时文件、临时名固定会被并发写者互相覆盖。
        // 现成 helper 已做唯一临时名 + create_new + sync_all + 失败删临时文件 + 建目录。
        crate::atomic_file::write_bytes_atomically(&path, text.as_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试用临时根目录：Drop 时自动清理，避免每次测试运行在 %TEMP% 下留一堆目录。
    struct TempRoot(std::path::PathBuf);

    impl std::ops::Deref for TempRoot {
        type Target = std::path::Path;

        fn deref(&self) -> &Self::Target { &self.0 }
    }

    // `fs::read_dir` 之类的泛型参数不做 deref 强制转换，故显式提供 AsRef
    impl AsRef<std::path::Path> for TempRoot {
        fn as_ref(&self) -> &std::path::Path { &self.0 }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn temp_root() -> TempRoot {
        let p = std::env::temp_dir().join(format!("qmai-registry-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        TempRoot(p)
    }

    fn sample(id: &str) -> RegistryEntry {
        RegistryEntry {
            id: id.into(),
            version: "1.0.0".into(),
            enabled: false,
            granted_permissions: vec![],
            source: SourceRecord {
                repo: "o/r".into(),
                git_ref: "main".into(),
                commit: "c".into(),
                zip_sha256: "0".repeat(64),
                installed_at: "t".into(),
            },
        }
    }

    fn entry_json(id: &str) -> String {
        format!(r#"{{"version":1,"plugins":{{"{id}":{{"id":"{id}","version":"1.0.0","enabled":false,"granted_permissions":[],"source":{{"repo":"o/r","ref":"main","commit":"c","zip_sha256":"00","installed_at":"t"}}}}}}}}"#)
    }

    #[test]
    fn empty_registry_when_file_absent() {
        let root = temp_root();
        let reg = PluginRegistry::load(&root).unwrap();
        assert!(reg.list().is_empty());
        assert_eq!(reg.file.version, 1);
    }

    #[test]
    fn add_then_reload_roundtrips() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        let mut entry = sample("alpha");
        entry.enabled = true;
        entry.granted_permissions = vec!["net:https".into()];
        reg.upsert(entry);
        reg.save(&root).unwrap();

        let reloaded = PluginRegistry::load(&root).unwrap();
        assert_eq!(reloaded.file.version, 1);
        let got = reloaded.get("alpha").expect("条目必须被保存下来");
        assert_eq!(got.version, "1.0.0");
        assert!(got.enabled);
        assert_eq!(got.granted_permissions, vec!["net:https".to_string()]);
        assert_eq!(got.source.git_ref, "main");

        // 盘上契约是 `ref`（设计文档 8.6）：serde 写读对称，删掉 rename 后 roundtrip
        // 依然绿；但旧版本写过的文件会因缺 `ref` 字段整表打不开。故直接盯字节。
        let raw = std::fs::read_to_string(paths::registry_file(&root)).unwrap();
        assert!(raw.contains("\"ref\":"), "盘上契约必须是 ref，不是 git_ref：{raw}");
    }

    #[test]
    fn remove_drops_the_entry() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        reg.upsert(sample("alpha"));
        assert!(reg.remove("alpha").is_some());
        assert!(reg.get("alpha").is_none());
    }

    #[test]
    fn corrupt_registry_is_an_error_not_empty() {
        let root = temp_root();
        std::fs::write(paths::registry_file(&root), "{not json").unwrap();
        // 损坏必须报错：若当成空表，下一次 save 就会把用户的插件列表整体清空
        assert!(PluginRegistry::load(&root).is_err());
    }

    #[test]
    fn set_enabled_errors_for_unknown_plugin() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        assert!(reg.set_enabled("nope", true).is_err());
    }

    #[test]
    fn set_enabled_persists_across_reload() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        reg.upsert(sample("alpha"));
        reg.set_enabled("alpha", true).unwrap();
        reg.save(&root).unwrap();

        // 开关状态必须落到盘上：只在内存里改，重启后界面会显示"关着"而后台在跑
        let reloaded = PluginRegistry::load(&root).unwrap();
        assert!(reloaded.get("alpha").unwrap().enabled);
    }

    #[test]
    fn rejects_registry_entry_with_unsafe_id() {
        let root = temp_root();
        std::fs::write(paths::registry_file(&root), entry_json("../../evil")).unwrap();
        let err = PluginRegistry::load(&root).expect_err("非法 id 必须拒绝加载");
        assert!(err.contains("非法 id"), "错误消息应说明非法 id，实际：{err}");
    }

    #[test]
    fn missing_version_is_normalised_to_current() {
        let root = temp_root();
        // 手写或极旧的文件没有 version 字段；归一而不是当成非法，否则用户升级后打不开
        std::fs::write(paths::registry_file(&root), r#"{"plugins":{}}"#).unwrap();
        let reg = PluginRegistry::load(&root).unwrap();
        assert_eq!(reg.file.version, CURRENT_VERSION);
    }

    #[test]
    fn future_version_is_rejected_instead_of_silently_downgraded() {
        let root = temp_root();
        // 降级运行：读新版本文件会把未知字段丢掉再回写成 v1，等于静默丢数据
        std::fs::write(
            paths::registry_file(&root),
            r#"{"version":99,"plugins":{},"unknown_field":1}"#,
        )
        .unwrap();
        let err = PluginRegistry::load(&root).expect_err("高版本注册表必须拒绝加载");
        assert!(err.contains("版本"), "错误消息应说明版本不兼容，实际：{err}");
    }

    #[test]
    fn save_writes_the_registry_file() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        reg.upsert(sample("alpha"));
        reg.save(&root).unwrap();

        assert!(paths::registry_file(&root).exists());
        let leftovers: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "不应残留临时文件：{leftovers:?}");
    }

    #[test]
    fn save_refuses_unsafe_id_and_keeps_previous_file_intact() {
        let root = temp_root();
        let mut reg = PluginRegistry::load(&root).unwrap();
        reg.upsert(sample("good-one"));
        reg.save(&root).expect("首次保存应成功");

        // 写侧必须挡住非法 id，否则一次 save 就能产出 load 不回来的文件
        reg.upsert(sample("../../evil"));
        let err = reg.save(&root).expect_err("非法 id 必须拒绝写入");
        assert!(err.contains("非法 id"), "err: {err}");

        // 原文件必须仍然是可读的、且仍只有那一个合法条目
        let reloaded = PluginRegistry::load(&root).expect("原注册表不能被破坏");
        assert!(reloaded.get("good-one").is_some());
        assert_eq!(reloaded.list().len(), 1);
    }
}
