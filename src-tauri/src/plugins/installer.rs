//! GitHub 安装器：下载 zip → 安全解压 → 校验清单 → 原子发布。
//!
//! 为什么不用 git clone：用户机器上不一定有 git，而且 clone 会拉全量历史，
//! GitHub 的 archive zip 只要一个快照，体积和失败面都小得多。

use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

/// 下载包体积上限（压缩后）。8 MB 足够容纳一个带依赖的插件源码 zip；
/// 超过说明用户粘错了仓库（比如把整个 monorepo 放进来了），早拒早省流量。
const MAX_ZIP_BYTES: usize = 8 * 1024 * 1024;
/// 解压后总大小上限（64 倍放大比）。防的是 zip 炸弹：
/// 几 KB 的包解开能塞满磁盘，进而把宿主所在盘的剩余空间吃光。
const MAX_UNPACKED_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct SourceSpec {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
}

/// 解析用户粘贴的 GitHub 地址。
/// 只接受 `https://github.com/<owner>/<repo>`，可用 `@<ref>` 指定分支/tag，允许 `.git` 后缀。
pub fn parse_source(raw: &str) -> Result<SourceSpec, String> {
    // URL 解析器会按 WHATWG 规范静默删掉制表符与换行：`@a<TAB>b` 会被解析成 `@ab`，
    // 用户以为钉的是 a<TAB>b，实际拿到 ab，安装出来的东西和预期不符。
    // 这类不可见字符直接拒，不做猜测。
    if raw.chars().any(|c| c.is_control()) {
        return Err("地址含不可见字符".to_string());
    }
    // 用户从浏览器地址栏复制时常带首尾空白，先裁掉再解析
    let url = url::Url::parse(raw.trim()).map_err(|e| format!("地址格式不正确：{e}"))?;
    // 只允许 https：http 会被中间人换成任意 zip，而安装器拿到的 zip 会直接落盘执行
    if url.scheme() != "https" {
        return Err("只支持 https 地址".to_string());
    }
    // 用 host 精确比对而不是 `contains("github.com")`：
    // `https://evil.com/github.com/o/r` 这种把域名当路径的地址必须拒掉
    if url.host_str() != Some("github.com") {
        return Err("只支持 github.com 的仓库".to_string());
    }

    let bad_shape = || "地址应为 https://github.com/<owner>/<repo>".to_string();
    let path = url.path().strip_prefix('/').unwrap_or(url.path());
    // 拆成「owner」+「其余全部」：ref 允许带 `/`（`feature/x` 是很常见的分支名），
    // 所以不能先把路径切成固定 2 段再去判断
    let (owner, rest) = path.split_once('/').ok_or_else(bad_shape)?;
    // 没有 @ref 时容忍尾斜杠（`…/repo/` 是浏览器里复制出来的样子）；
    // 有 @ref 时尾斜杠属于 ref 本身，不能归一 —— 否则 `@trail/` 会被悄悄改成 `@trail`
    let rest = if rest.contains('@') {
        rest
    } else {
        rest.trim_end_matches('/')
    };
    if rest.is_empty() {
        return Err(bad_shape());
    }
    let (repo_raw, git_ref) = match rest.split_once('@') {
        Some((repo, git_ref)) => (repo, git_ref),
        None => {
            // 剩余的段里还有 `/`：说明用户粘的是 `/tree/main` 之类的页面地址
            if rest.contains('/') {
                return Err(bad_shape());
            }
            (rest, "main")
        }
    };
    let repo = repo_raw.strip_suffix(".git").unwrap_or(repo_raw);

    for seg in [owner, repo] {
        if !is_valid_segment(seg) {
            return Err(format!("非法字符：{seg}"));
        }
    }
    if !is_valid_ref(git_ref) {
        return Err(format!("非法字符：{git_ref}"));
    }

    Ok(SourceSpec {
        owner: owner.to_string(),
        repo: repo.to_string(),
        git_ref: git_ref.to_string(),
    })
}

/// 路径段白名单：GitHub 的 owner/repo 字符集是 `[A-Za-z0-9-_.]`，ref 额外允许 `~`
/// （tag 里常见，如 `v1.2.0~rc1`）。白名单而非黑名单：URL 里能编出 `%2f`、`..`、
/// 空格、`?` 等会改变拼接结果的字符，黑名单永远漏。
fn is_valid_segment(seg: &str) -> bool {
    !seg.is_empty()
        && seg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~'))
}

/// ref 比 owner/repo 宽松：GitHub 的分支名本就允许 `/`（`feature/x`），这里也放行。
/// 但仍然要挡住会改变 URL 语义或路径含义的写法：
/// `..`（穿越）、首尾 `/`、连续 `//`（拼出空段），以及 `%`/空白等编码字符。
fn is_valid_ref(git_ref: &str) -> bool {
    !git_ref.is_empty()
        && !git_ref.contains("..")
        && !git_ref.contains("//")
        && !git_ref.starts_with('/')
        && !git_ref.ends_with('/')
        && git_ref
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~' | '/'))
}

/// ref 看起来像版本 tag 吗？`v1.2.0` / `V2.0` / `1.2.3` 是；`main` / `feature-x` 不是。
///
/// 只是决定「先试 tag 还是先试分支」的启发式，不影响正确性：
/// 两条路径最终都会试，判断错了只是多一次 404。
fn looks_like_tag(git_ref: &str) -> bool {
    let body = git_ref.trim_start_matches(['v', 'V']);
    !body.is_empty() && body.chars().all(|c| c.is_ascii_digit() || c == '.')
}

/// 下载候选：加速通道优先，codeload 直连兜底（与 update-channels.json 同策略）。
///
/// GitHub 的分支在 `refs/heads` 下、tag 在 `refs/tags` 下，两者 URL 不通用，
/// 所以每个通道都要试两条路径。顺序按 ref 形态决定：分支先试 heads，版本号先试 tags，
/// 避免每次安装都白跑三个必然 404。
pub fn download_urls(owner: &str, repo: &str, git_ref: &str) -> Vec<String> {
    const BASES: [&str; 3] = ["gh-proxy.com/", "ghproxy.net/", "codeload.github.com/"];
    let kinds: [&str; 2] = if looks_like_tag(git_ref) {
        ["tags", "heads"]
    } else {
        ["heads", "tags"]
    };
    let mut out = Vec::with_capacity(6);
    for base in BASES {
        for kind in kinds {
            // codeload 的路径形状与 github.com 不同，单独处理
            if base.starts_with("codeload.") {
                out.push(format!(
                    "https://{base}{owner}/{repo}/zip/refs/{kind}/{git_ref}"
                ));
            } else {
                out.push(format!(
                    "https://{base}https://github.com/{owner}/{repo}/archive/refs/{kind}/{git_ref}.zip"
                ));
            }
        }
    }
    out
}

/// zip 条目路径安全校验；不安全返回 None
pub fn is_safe_entry(name: &str) -> Option<PathBuf> {
    let path = std::path::Path::new(name);
    // 绝对路径一律拒：`C:\evil.js` 在 Windows 上会被 `dest.join()` 整个替换掉，
    // 结果就是往 dest 之外写文件
    if path.is_absolute() {
        return None;
    }
    // 先按两种分隔符粗查 `..`：在 Unix 语义下 `\` 只是普通字符，`..\..\x` 会被
    // `components()` 当成一个 Normal 段放过；而 Windows 解压路径两种分隔符都生效。
    // 所以这里不依赖 `Component` 的父目录判定，自己切一遍兜住跨平台差异。
    if name.split(['/', '\\']).any(|seg| seg == "..") {
        return None;
    }
    let mut normalized = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::Normal(part) => normalized.push(part),
            // `./a` 之类的写法无害，跳过即可
            Component::CurDir => {}
            // RootDir / Prefix / ParentDir：上面两道闸已挡掉绝大多数，
            // 这里是不依赖平台实现细节的最后一道，宁可错杀
            _ => return None,
        }
    }
    if normalized.as_os_str().is_empty() {
        None
    } else {
        Some(normalized)
    }
}

/// 解压到 dest：逐条目校验路径、拒绝符号链接、读取侧硬限大小
pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("插件包不是有效的 zip：{e}"))?;
    // 累加的是「真正读出来的字节数」，而不是中央目录声明的大小（后者可被少报）
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("读取插件包条目失败：{e}"))?;
        // 目录条目不用建：文件的父目录在下面按需 create_dir_all，
        // 空的目录条目对插件没有意义
        if file.is_dir() {
            continue;
        }
        // 先把名字克隆出来：下面要用可变借用去读内容，借用期间不能再调 file.name()
        let name = file.name().to_string();
        // 符号链接必须最先拒：它的内容是一段指向包外的路径，落盘后就被当成普通文件，
        // 后续任何「路径校验」都看不见它，等于允许往任意位置写
        if file.is_symlink() {
            return Err(format!("插件包含符号链接，已拒绝：{name}"));
        }
        let rel = is_safe_entry(&name).ok_or_else(|| format!("插件包包含不安全路径：{name}"))?;
        let out_path = dest.join(&rel);

        // 不能只信中央目录声明的 size：它可被少报，从而绕过上限把 8MB 的包膨胀到 GB 级
        // （deflate 极限约 1032:1，而 CRC 是读完才校验的）。用 take 在读取侧硬限。
        let remaining = MAX_UNPACKED_BYTES.saturating_sub(total);
        let mut buf = Vec::new();
        (&mut file)
            .take(remaining + 1)
            .read_to_end(&mut buf)
            .map_err(|e| format!("解压 {name} 失败：{e}"))?;
        let actual = buf.len() as u64;
        if actual > remaining {
            return Err(format!(
                "解压后超过 {} MB 上限",
                MAX_UNPACKED_BYTES / 1024 / 1024
            ));
        }
        if actual != file.size() {
            // 声明值与实际不一致 → 包被篡改或畸形的可能性很高，直接拒
            return Err(format!(
                "条目 {name} 声明大小 {} 与实际 {actual} 不一致",
                file.size()
            ));
        }
        total += actual;

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建目录 {} 失败：{e}", parent.display()))?;
        }
        std::fs::write(&out_path, &buf)
            .map_err(|e| format!("写入 {} 失败：{e}", out_path.display()))?;
    }
    Ok(())
}

/// 下载 zip 字节；按顺序试每个候选，全部失败才报错（错误里带最后一次尝试）
pub async fn download(client: &reqwest::Client, urls: &[String]) -> Result<Vec<u8>, String> {
    // 全失败时要说清「最后一次」怎么失败的，否则用户只看到「都失败了」无从下手
    let mut last = "未尝试任何通道".to_string();
    for url in urls {
        let resp = match client.get(url).send().await {
            Ok(resp) => resp,
            Err(e) => {
                last = format!("{url} → {e}");
                continue;
            }
        };
        if !resp.status().is_success() {
            last = format!("{url} → HTTP {}", resp.status());
            continue;
        }
        // 先看声明的长度：等 bytes() 全量读进来再判，内存已经被吃掉了
        if let Some(len) = resp.content_length() {
            if len as usize > MAX_ZIP_BYTES {
                return Err(format!(
                    "插件包超过 {} MB 上限",
                    MAX_ZIP_BYTES / 1024 / 1024
                ));
            }
        }
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                last = format!("{url} → 读取响应失败：{e}");
                continue;
            }
        };
        // 超限不再试下一个通道：这是「这个包本身太大」，
        // 换通道只会把同一份大包再下一遍，白等用户
        if bytes.len() > MAX_ZIP_BYTES {
            return Err(format!(
                "插件包超过 {} MB 上限",
                MAX_ZIP_BYTES / 1024 / 1024
            ));
        }
        // 代理对私有库/限流/ref 不存在常返回 200 + HTML 错误页。
        // 只按状态码判成功会让剩下几个候选一次都不试，用户只看到「不是有效 zip」。
        if !bytes.starts_with(b"PK\x03\x04") {
            last = format!("{url} → 响应不是 zip（可能被代理替换成错误页）");
            continue;
        }
        return Ok(bytes.to_vec());
    }
    Err(format!("所有下载通道均失败，最后一次：{last}"))
}

/// 安装结果。字段足够在日志/前端里追溯「这个插件是哪来的哪一版」。
#[derive(Debug, Clone)]
pub struct InstallOutcome {
    pub plugin_id: String,
    pub version: String,
    /// 安装时钉住的 ref（分支/tag）。注意：这不是 commit SHA —— 见 install() 的注释。
    pub git_ref: String,
    pub zip_sha256: String,
    /// 已发布到的最终目录。注册表写失败时调用方据此回滚（remove_dir_all）。
    pub target: PathBuf,
}

/// 完整安装：下载 → 解压到 staging → 剥掉 GitHub zip 的顶层目录 → 读清单 → 原子发布
pub async fn install(root: &Path, raw_source: &str) -> Result<InstallOutcome, String> {
    let spec = parse_source(raw_source)?;
    let client = reqwest::Client::builder()
        .user_agent("qmai-plugin-installer")
        // 不设总超时的话，一条卡住的代理通道会让「安装」永久挂着，用户既没进度也没法取消
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let urls = download_urls(&spec.owner, &spec.repo, &spec.git_ref);
    let bytes = download(&client, &urls).await?;

    let hash = {
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };

    std::fs::create_dir_all(super::paths::staging_dir(root)).map_err(|e| e.to_string())?;
    // 每次安装用独立子目录：并发安装/上一次失败的残留不会互相踩
    let staging = super::paths::staging_dir(root).join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let result = (|| -> Result<InstallOutcome, String> {
        extract_zip(&bytes, &staging)?;
        // GitHub 的 zip 里有一层 `repo-ref/` 顶层目录，剥掉它，
        // 发布出去的插件目录里才是 `plugin.json` 直接在根上（supervisor/registry 都这么假设）
        let payload = single_top_level_dir(&staging)?;
        let raw = std::fs::read_to_string(payload.join("plugin.json"))
            .map_err(|_| "插件包根目录缺少 plugin.json".to_string())?;
        let manifest = super::manifest::PluginManifest::parse(&raw)
            .map_err(|e| format!("清单校验失败 {}：{}", e.code(), e.detail))?;

        let target = super::paths::plugin_dir(root, &manifest.id);
        // 不覆盖已存在的插件目录：Windows 上对已存在目录做 rename 会失败，
        // 而且覆盖会把用户正在用的版本半途换掉。更新走独立流程（第二期）。
        if target.exists() {
            return Err(format!("插件 {} 已安装，请先卸载或走更新流程", manifest.id));
        }

        std::fs::rename(&payload, &target).map_err(|e| format!("发布插件目录失败：{e}"))?;
        Ok(InstallOutcome {
            plugin_id: manifest.id.clone(),
            version: manifest.version.clone(),
            // 说明：这里钉的是 ref 而不是 commit SHA。GitHub 的 archive zip 顶层目录名是
            // `repo-ref`，不含 commit。要拿到真 SHA 得再打一次 API，第一期不做；
            // 责任归属仍可追溯（repo + ref + zip 的 sha256）。
            git_ref: spec.git_ref.clone(),
            zip_sha256: hash,
            target: target.clone(),
        })
    })();

    // 无论成败都清掉暂存目录，不留半成品。清理失败要留痕：
    // Windows 上杀毒软件可能短暂占用刚写入的文件，静默失败会让 staging 越堆越多。
    if let Err(e) = std::fs::remove_dir_all(&staging) {
        eprintln!("清理插件暂存目录失败 {}：{e}", staging.display());
    }
    result
}

/// 恰好一个子目录才返回它。GitHub archive zip 的固定形状是 `repo-ref/…`；
/// 多于一个或零个说明不是 GitHub archive（或是被人为拼装的包），不猜，直接失败。
/// IO 错误如实上报，不与「形状不对」混为一谈。
fn single_top_level_dir(dir: &Path) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("读取插件暂存目录 {} 失败：{e}", dir.display()))?;
    let mut found: Option<PathBuf> = None;
    for entry in entries {
        let path = entry
            .map_err(|e| format!("读取插件暂存目录 {} 条目失败：{e}", dir.display()))?
            .path();
        // 顶层出现普通文件，或第二个目录：都不是 GitHub archive 的形状
        if !path.is_dir() || found.is_some() {
            return Err("插件包内应只有一个顶层目录".to_string());
        }
        found = Some(path);
    }
    found.ok_or_else(|| "插件包内应只有一个顶层目录".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_github_url() {
        let s = parse_source("https://github.com/owner/repo").unwrap();
        assert_eq!(s.owner, "owner");
        assert_eq!(s.repo, "repo");
        assert_eq!(s.git_ref, "main");
    }

    #[test]
    fn parses_url_with_ref() {
        let s = parse_source("https://github.com/owner/repo@v1.2.0").unwrap();
        assert_eq!(s.git_ref, "v1.2.0");
    }

    #[test]
    fn rejects_http() {
        assert!(parse_source("http://github.com/owner/repo").is_err());
    }

    #[test]
    fn rejects_non_github_host() {
        assert!(parse_source("https://gitlab.com/owner/repo").is_err());
        assert!(parse_source("https://evil.com/github.com/owner/repo").is_err());
    }

    #[test]
    fn rejects_missing_or_extra_segments() {
        assert!(parse_source("https://github.com/owner").is_err());
        assert!(parse_source("https://github.com").is_err());
        assert!(parse_source("https://github.com/owner/repo/tree/main").is_err());
    }

    #[test]
    fn accepts_git_suffix_and_strips_it() {
        let s = parse_source("https://github.com/owner/repo.git").unwrap();
        assert_eq!(s.repo, "repo");
    }

    #[test]
    fn accepts_trailing_slash_without_ref() {
        // 从浏览器地址栏复制常带尾斜杠，没有 @ref 时容忍它
        let s = parse_source("https://github.com/owner/repo/").unwrap();
        assert_eq!(s.repo, "repo");
    }

    #[test]
    fn ref_may_contain_slashes_but_not_traversal() {
        let s = parse_source("https://github.com/owner/repo@feature/x").unwrap();
        assert_eq!(s.git_ref, "feature/x");
        for bad in ["../evil", "a//b", "/lead", "trail/", "a b", "a\tb"] {
            let url = format!("https://github.com/owner/repo@{bad}");
            assert!(parse_source(&url).is_err(), "ref {bad:?} 应被拒");
        }
    }

    #[test]
    fn build_channel_urls_cover_both_heads_and_tags() {
        let urls = download_urls("owner", "repo", "main");
        assert_eq!(urls.len(), 6);
        // 分支名 → heads 先试
        assert!(urls[0].contains("/refs/heads/main"));
        assert!(urls[0].contains("gh-proxy.com"));
        assert!(urls.iter().any(|u| u.contains("/refs/tags/main")));
        assert!(urls.iter().any(|u| u.contains("codeload.github.com")));
        assert!(urls.iter().all(|u| u.contains("/owner/repo/")));
        // 钉死形状：codeload 是 /zip/refs/<kind>/<ref>，没有 /archive/、没有 .zip 后缀。
        // 只靠 contains 的话，把 codeload 改成 `/archive/...zip` 仍然会绿。
        assert_eq!(
            urls[4],
            "https://codeload.github.com/owner/repo/zip/refs/heads/main"
        );

        let tag_urls = download_urls("owner", "repo", "v1.2.0");
        // 版本号 → tags 先试，避免必然 404 的 heads 抢在最前
        assert!(tag_urls[0].contains("/refs/tags/v1.2.0"));
        assert!(tag_urls.iter().any(|u| u.contains("/refs/heads/v1.2.0")));
    }

    #[test]
    fn looks_like_tag_detects_version_refs() {
        for t in ["v1.2.0", "V2.0", "1.2.3"] {
            assert!(looks_like_tag(t), "{t} 应判为 tag");
        }
        for f in ["main", "dev", "feature-x", "v", "release/1.0"] {
            assert!(!looks_like_tag(f), "{f} 应判为分支");
        }
    }

    #[test]
    fn zip_entry_path_is_rejected_when_escaping() {
        assert!(is_safe_entry("../evil.js").is_none());
        assert!(is_safe_entry("/abs/evil.js").is_none());
        assert!(is_safe_entry("a/../../evil.js").is_none());
        // 依赖 Windows 路径语义（`C:` 会被解析成 Prefix 组件）。本项目只出 Windows 构建。
        assert!(is_safe_entry("C:\\evil.js").is_none());
        assert_eq!(
            is_safe_entry("repo-main/index.js").unwrap(),
            PathBuf::from("repo-main/index.js")
        );
    }

    // ------------------------------------------------------------------
    // 解压安全闸：路径穿越 / 解压炸弹 / 符号链接
    // ------------------------------------------------------------------

    /// 临时目录（不引入 tempfile 依赖）：进程号 + 纳秒时间戳保证唯一。
    fn temp_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "qmai-installer-{tag}-{}-{nanos}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    /// 在内存里造一个 zip。条目名 / 内容都原样写入，不做任何校验 ——
    /// 要测的就是「恶意包会怎样」，不能被写包工具顺手清洗掉。
    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(*name, zip::write::SimpleFileOptions::default())
                .expect("造包：start_file");
            w.write_all(data).expect("造包：写条目");
        }
        w.finish().expect("造包：finish").into_inner()
    }

    /// 把中央目录里「解压后大小」字段改成更小的值，模拟恶意包少报大小。
    /// 中央目录头布局固定：偏移 24..28 是 uncompressed size（小端）。
    fn underreport_central_size(bytes: &mut [u8], declared: u32) {
        // 中央目录在文件末尾（无注释），从后往前找第一条就是唯一的条目头
        let cd = bytes
            .windows(4)
            .rposition(|w| w == b"PK\x01\x02")
            .expect("造包：找不到中央目录头");
        bytes[cd + 24..cd + 28].copy_from_slice(&declared.to_le_bytes());
    }

    #[test]
    fn extract_rejects_path_traversal_entries() {
        let dest = temp_dir("traversal");
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // 唯一文件名：万一真被写出去，断言也不会被上一次残留的文件污染
        let escaped = format!("evil-{nanos}.js");
        let entry = format!("../{escaped}");
        let bytes = zip_with(&[(entry.as_str(), b"pwned")]);

        let err = extract_zip(&bytes, &dest).unwrap_err();
        assert!(
            err.contains("不安全路径"),
            "错误信息应指明不安全路径，实际：{err}"
        );
        // 关键断言：dest 内和 dest 之外都不能留下文件
        assert!(!dest.join(&escaped).exists(), "dest 内不该出现该文件");
        assert!(
            !dest.parent().unwrap().join(&escaped).exists(),
            "dest 之外更不该出现该文件（路径穿越发生了）"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn extract_enforces_unpacked_size_limit() {
        use std::io::Write;
        let dest = temp_dir("oversize");
        // 65 MB 全零：deflate 对全零压得极狠，造出来的包只有几十 KB，既不慢也不占盘。
        // extract_zip 在读取侧硬限大小（不信任声明值），所以磁盘上不会出现 65 MB。
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        w.start_file("repo-main/big.bin", opts).expect("造包：start_file");
        let chunk = vec![0u8; 1024 * 1024];
        for _ in 0..65 {
            w.write_all(&chunk).expect("造包：写大文件");
        }
        let bytes = w.finish().expect("造包：finish").into_inner();
        assert!(
            bytes.len() < 8 * 1024 * 1024,
            "测试包本身应远小于下载上限，实际 {} 字节",
            bytes.len()
        );

        let err = extract_zip(&bytes, &dest).unwrap_err();
        assert!(err.contains("64 MB"), "应报解压体积超限，实际：{err}");
        assert!(
            !dest.join("repo-main/big.bin").exists(),
            "超限条目不该落盘"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn extract_rejects_entry_whose_declared_size_is_underreported() {
        use std::io::Write;
        let dest = temp_dir("underreported");
        // 真内容 65 MB，中央目录只声明 100 字节：这正是「少报 size 绕过 64 MB 累加」的攻击形态。
        // 旧实现按声明值累加会直接放行，解开 65 MB 落盘；新实现必须在读取侧就拒绝。
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        w.start_file("repo-main/big.bin", opts)
            .expect("造包：start_file");
        let chunk = vec![0u8; 1024 * 1024];
        for _ in 0..65 {
            w.write_all(&chunk).expect("造包：写大文件");
        }
        let mut bytes = w.finish().expect("造包：finish").into_inner();
        underreport_central_size(&mut bytes, 100);

        // 自检：读取侧看到的声明值确实是 100，否则这条测试测的就不是「少报」
        {
            let mut a = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).expect("读包");
            assert_eq!(
                a.by_index(0).expect("条目 0").size(),
                100,
                "造包失败：声明大小没有被改小"
            );
        }

        let err = extract_zip(&bytes, &dest).unwrap_err();
        assert!(err.contains("64 MB"), "少报大小不应绕过上限，实际：{err}");
        assert!(
            !dest.join("repo-main/big.bin").exists(),
            "被拒的条目不该落盘"
        );
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn extract_rejects_entry_whose_declared_size_mismatches_actual() {
        let dest = temp_dir("size-mismatch");
        // 真实内容 11 字节、声明 3 字节：不走体积上限，走「声明与实际不一致」这条拒绝分支
        let mut bytes = zip_with(&[("repo-main/a.txt", b"hello world")]);
        underreport_central_size(&mut bytes, 3);
        {
            let mut a = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).expect("读包");
            assert_eq!(a.by_index(0).expect("条目 0").size(), 3);
        }

        let err = extract_zip(&bytes, &dest).unwrap_err();
        assert!(
            err.contains("不一致"),
            "声明大小与实际不符应被拒，实际：{err}"
        );
        assert!(!dest.join("repo-main/a.txt").exists(), "被拒的条目不该落盘");
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[test]
    fn extract_rejects_symlink_entries() {
        let dest = temp_dir("symlink");
        // 不能用 `SimpleFileOptions::unix_permissions(0o120777)` 手搓：zip 2.x 的
        // `unix_permissions()` 会 `mode & 0o777` 丢掉高位，条目会退化成普通文件、
        // 测试就假绿了。必须走 `add_symlink`，它内部把 S_IFLNK 直接或进权限位。
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.add_symlink(
            "repo-main/link",
            "../../../../etc/passwd",
            zip::write::SimpleFileOptions::default(),
        )
        .expect("造包：add_symlink");
        let bytes = w.finish().expect("造包：finish").into_inner();

        // 自检：包内条目在读取侧确实是符号链接，否则下面的断言等于没测
        {
            let mut a = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).expect("读包");
            assert!(
                a.by_index(0).expect("条目 0").is_symlink(),
                "造包失败：条目不是符号链接"
            );
        }

        let err = extract_zip(&bytes, &dest).unwrap_err();
        assert!(err.contains("符号链接"), "应报符号链接，实际：{err}");
        let _ = std::fs::remove_dir_all(&dest);
    }
}
