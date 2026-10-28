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

/// 从本地目录安装插件（插件作者的开发闭环，也是验收时的测试入口）。
///
/// 与 GitHub 安装共用同一套校验与发布语义，只把「下载+解压」换成「复制目录」：
///   - 清单必须合法（同一个 PluginManifest::parse）
///   - 顶层必须有 plugin.json（不剥顶层目录 —— 本地目录本身就是插件根）
///   - 目标已存在则拒绝，不覆盖
///   - 失败绝不留半成品
pub fn install_local(root: &Path, source_dir: &Path) -> Result<InstallOutcome, String> {
    // 目录选择器给的路径理论上是存在的，但用户可能刚删掉/改名，或手输了一个不存在的路径。
    // 不先判这一下，后面只会报「缺少 plugin.json」，把「目录都不对」误导成「目录结构不对」。
    if !source_dir.is_dir() {
        return Err(format!("插件目录不存在：{}", source_dir.display()));
    }
    // 先读源清单再复制：清单错了立刻返回，不必把一个带 node_modules 的几百 MB 目录
    // 整个拷一遍才发现装不上。校验语义与 GitHub 安装完全一致（同一个 parse + 错误码）。
    let source_raw = std::fs::read_to_string(source_dir.join("plugin.json"))
        .map_err(|_| "插件目录根下缺少 plugin.json".to_string())?;
    let source_manifest = super::manifest::PluginManifest::parse(&source_raw)
        .map_err(|e| format!("清单校验失败 {}：{}", e.code(), e.detail))?;

    // 目标已存在就拒绝：与 GitHub 安装同一语义，不覆盖用户正在用的版本。
    // 这里先查一次是为了少拷一遍大目录；发布前还会再查一次（复制可能要好几秒）。
    let target = super::paths::plugin_dir(root, &source_manifest.id);
    ensure_target_free(&target, &source_manifest.id)?;

    std::fs::create_dir_all(super::paths::staging_dir(root)).map_err(|e| e.to_string())?;
    let staging = super::paths::staging_dir(root).join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let result = (|| -> Result<InstallOutcome, String> {
        // 源目录若是插件根（或它的父目录），staging 就落在源目录内部：复制会把自己
        // 正在写入的内容再复制一遍，无限递归到磁盘满。canonicalize 两侧取真实路径，
        // Windows 上的大小写差异、短路径（RUNNER~1）都能正确归一。
        let source_abs =
            std::fs::canonicalize(source_dir).map_err(|e| format!("读取插件目录失败：{e}"))?;
        let staging_abs =
            std::fs::canonicalize(&staging).map_err(|e| format!("读取插件暂存目录失败：{e}"))?;
        if staging_abs.starts_with(&source_abs) {
            return Err(format!(
                "插件目录不能是插件根目录或其父目录：{}",
                source_dir.display()
            ));
        }

        copy_local_dir(source_dir, &staging)?;

        // 校验复制结果：plugin.json 必须落在 staging 根上。发布出去的插件目录
        // 必须「plugin.json 直接在根」（supervisor/registry 都这么假设），而复制
        // 是逐条目展开的，这一步同时兜住「源目录里有同名但错位的 plugin.json」。
        // 重新读一遍 staging 里的清单：发布的必须是这份校验过的字节，id/version
        // 也以它为准（复制耗时期间作者可能改过源目录）。
        let staged_raw = std::fs::read_to_string(staging.join("plugin.json"))
            .map_err(|_| "插件目录结构异常：plugin.json 不在目录根下".to_string())?;
        let manifest = super::manifest::PluginManifest::parse(&staged_raw)
            .map_err(|e| format!("清单校验失败 {}：{}", e.code(), e.detail))?;
        // 前面那次检查只是省一次大目录复制；这里才是发布前的最终闸：复制期间
        // 目标目录可能被另一个安装占住，直接 rename 会把对方的内容半途换掉。
        let target = super::paths::plugin_dir(root, &manifest.id);
        ensure_target_free(&target, &manifest.id)?;

        std::fs::rename(&staging, &target).map_err(|e| format!("发布插件目录失败：{e}"))?;
        Ok(InstallOutcome {
            plugin_id: manifest.id.clone(),
            version: manifest.version.clone(),
            // 本地安装没有分支/tag，也没有下载包可算哈希：git_ref 固定 "local"、
            // zip_sha256 留空（不伪造一个看起来可信的值）。溯源靠注册表里的
            // `source.repo = "local:<绝对路径>"`，能回答「这个插件从哪来」。
            git_ref: "local".to_string(),
            zip_sha256: String::new(),
            target,
        })
    })();

    // 无论成败都清掉暂存目录，不留半成品。成功时 rename 已经把整个 staging 搬走，
    // 这里的 NotFound 是预期结果，不算清理失败；其余错误要留痕 —— Windows 上杀毒软件
    // 可能短暂占用刚写入的文件，静默失败会让 staging 越堆越多。
    match std::fs::remove_dir_all(&staging) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("清理插件暂存目录失败 {}：{e}", staging.display()),
    }
    result
}

/// 目标目录已存在就拒绝。抽出来是因为安装前与发布前各要查一次（见 install_local）。
fn ensure_target_free(target: &Path, plugin_id: &str) -> Result<(), String> {
    // Windows 上对已存在目录做 rename 会失败，而且覆盖会把用户正在用的版本半途换掉。
    // 更新走独立流程，本地安装也只做「装一个新的」。
    if target.exists() {
        return Err(format!("插件 {plugin_id} 已安装，请先卸载"));
    }
    Ok(())
}

/// 本地安装要跳过的目录。只跳「显然可重建/与运行无关」的，宁可多拷也不误删：
/// 插件运行时找不到依赖，比装慢几秒糟得多。
fn should_skip_copy_dir(name: &std::ffi::OsStr, parent: &Path) -> bool {
    // `.git` 是版本库元数据，插件运行用不到；带上它会让每次安装多拷一份历史，
    // 还可能把作者的远端地址等配置带进插件目录。
    if name == std::ffi::OsStr::new(".git") {
        return true;
    }
    // Python 解释器会按需重建 `__pycache__`，来源机器上的 .pyc 换台机器还可能失效。
    if name == std::ffi::OsStr::new("__pycache__") {
        return true;
    }
    // npm 的构建缓存可重建；但 `node_modules` 本身必须保留 —— 插件可能依赖它，
    // 少了它插件装上就跑不起来。所以只跳过它下面这一层 `.cache`。
    name == std::ffi::OsStr::new(".cache")
        && parent.file_name() == Some(std::ffi::OsStr::new("node_modules"))
}

/// 是否「链接类」条目：符号链接，或 Windows 上的目录联接（junction）。
///
/// 本地安装不跟随链接复制：跟着链接会把链接目标（可能是整个盘、也可能是作者本机
/// 另一份工作副本）搬进插件目录，既可能撑爆磁盘，也会让插件里的文件与作者正在改的
/// 那份脱钩 —— 作者改了代码却看不到效果，比直接报错更难查。
fn is_link_like(path: &Path, file_type: &std::fs::FileType) -> bool {
    if file_type.is_symlink() {
        return true;
    }
    // pnpm 的 `node_modules` 里大量用 junction；它不是 symlink，但同样是重解析点。
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if let Ok(meta) = std::fs::symlink_metadata(path) {
            if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return true;
            }
        }
    }
    #[cfg(not(windows))]
    let _ = path;
    false
}

/// 递归复制插件目录。目录结构原样展开（不保留源目录这一层），
/// 这样 staging 根就是插件根，与 GitHub 安装剥掉 zip 顶层目录后的形态一致。
fn copy_local_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| format!("创建目录 {} 失败：{e}", to.display()))?;
    let entries = std::fs::read_dir(from)
        .map_err(|e| format!("读取插件目录 {} 失败：{e}", from.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取插件目录 {} 条目失败：{e}", from.display()))?;
        let src = entry.path();
        // file_type() 是链接本身的信息（不跟随链接），以下判断都基于它
        let file_type = entry
            .file_type()
            .map_err(|e| format!("读取 {} 的类型失败：{e}", src.display()))?;
        if is_link_like(&src, &file_type) {
            eprintln!(
                "跳过插件目录中的符号链接/目录联接 {}：本地安装不跟随链接，避免把链接目标的内容复制进插件",
                src.display()
            );
            continue;
        }
        let dst = to.join(entry.file_name());
        if file_type.is_dir() {
            if should_skip_copy_dir(&entry.file_name(), from) {
                continue;
            }
            copy_local_dir(&src, &dst)?;
        } else if file_type.is_file() {
            // 用 copy 而不是「读出来再写」：大文件不会整块进内存，
            // 也能保留修改时间（部分插件按 mtime 判断缓存是否失效）。
            std::fs::copy(&src, &dst).map_err(|e| format!("复制 {} 失败：{e}", src.display()))?;
        } else {
            // 管道/设备等特殊文件：复制过去也没有意义，跳过并留痕
            eprintln!("跳过无法复制的特殊文件 {}", src.display());
        }
    }
    Ok(())
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

    // ------------------------------------------------------------------
    // 本地目录安装：插件作者的开发闭环
    // ------------------------------------------------------------------

    /// 造一个「源目录」形态的本地插件：根下 plugin.json + 一个入口文件。
    /// 源目录放在插件根之外 —— 插件根（或它的父目录）本身就是被拒绝的源形态。
    fn local_plugin_dir(tag: &str, manifest: &str) -> PathBuf {
        let dir = temp_dir(tag);
        std::fs::write(dir.join("plugin.json"), manifest).expect("写源 plugin.json");
        std::fs::write(dir.join("index.js"), "// local plugin\n").expect("写源入口");
        dir
    }

    /// 最小合法清单。version 留参数化，用来制造 E_VERSION_INVALID 之类的失败。
    fn local_manifest(id: &str, version: &str) -> String {
        format!(
            r#"{{"schema":2,"id":"{id}","name":"本地插件","version":"{version}","runtime":{{"type":"node","entry":"index.js"}}}}"#
        )
    }

    /// `<root>/.staging` 下的残留条目。目录不存在视作「没有残留」。
    fn staging_residue(root: &Path) -> Vec<PathBuf> {
        let dir = crate::plugins::paths::staging_dir(root);
        if !dir.exists() {
            return Vec::new();
        }
        std::fs::read_dir(&dir)
            .expect("读取 staging")
            .map(|entry| entry.expect("staging 条目").path())
            .collect()
    }

    #[test]
    fn install_local_copies_a_valid_plugin() {
        let root = temp_dir("local-ok-root");
        let manifest = local_manifest("local-demo", "1.2.0");
        let source = local_plugin_dir("local-ok-src", &manifest);

        let outcome = install_local(&root, &source).expect("本地安装应成功");

        let target = crate::plugins::paths::plugin_dir(&root, "local-demo");
        assert_eq!(outcome.plugin_id, "local-demo");
        assert_eq!(outcome.version, "1.2.0");
        assert_eq!(
            outcome.git_ref, "local",
            "本地安装没有分支/tag，固定标记 local"
        );
        assert_eq!(outcome.zip_sha256, "", "本地安装没有下载包，不应伪造哈希");
        assert_eq!(outcome.target, target);
        assert!(target.is_dir(), "插件目录应已发布");
        assert_eq!(
            std::fs::read_to_string(target.join("plugin.json")).expect("读已装清单"),
            manifest,
            "发布出去的清单必须与源目录逐字节一致"
        );
        assert!(target.join("index.js").is_file(), "入口文件应一并复制");
        // 复制不是移动：作者的源目录必须原样保留，否则本地开发闭环就断了
        assert!(source.join("plugin.json").is_file(), "源目录不能被搬走");

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&source);
    }

    #[test]
    fn install_local_rejects_missing_plugin_json() {
        let root = temp_dir("local-missing-root");
        let source = temp_dir("local-missing-src");

        let err = install_local(&root, &source).unwrap_err();

        assert!(
            err.contains("plugin.json"),
            "错误应指明缺 plugin.json，实际：{err}"
        );
        assert!(
            !crate::plugins::paths::plugin_dir(&root, "local-demo").exists(),
            "被拒的安装不能在插件根留下目录"
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&source);
    }

    #[test]
    fn install_local_rejects_invalid_manifest() {
        let root = temp_dir("local-bad-version-root");
        // 两段式版本号是插件作者最常犯的清单错误：必须复用 GitHub 安装那条
        // 校验链，错误里带稳定错误码，作者才知道是清单而不是目录结构的问题。
        let source = local_plugin_dir(
            "local-bad-version-src",
            &local_manifest("local-bad-version", "1.2"),
        );

        let err = install_local(&root, &source).unwrap_err();

        assert!(
            err.contains("E_VERSION_INVALID"),
            "错误信息应带清单错误码，实际：{err}"
        );
        assert!(
            !crate::plugins::paths::plugin_dir(&root, "local-bad-version").exists(),
            "校验失败不能发布目录"
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&source);
    }

    #[test]
    fn install_local_refuses_to_overwrite() {
        let root = temp_dir("local-twice-root");
        let source = local_plugin_dir("local-twice-src", &local_manifest("local-twice", "1.0.0"));
        install_local(&root, &source).expect("第一次安装应成功");

        let err = install_local(&root, &source).unwrap_err();

        assert!(err.contains("已安装"), "应拒绝重复安装，实际：{err}");
        assert!(
            crate::plugins::paths::plugin_dir(&root, "local-twice")
                .join("plugin.json")
                .is_file(),
            "被拒的第二次安装不能破坏已装好的目录"
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&source);
    }

    #[test]
    fn install_local_leaves_no_staging_residue() {
        let root = temp_dir("local-staging-root");
        let source = local_plugin_dir(
            "local-staging-src",
            &local_manifest("local-staging", "1.0.0"),
        );

        install_local(&root, &source).expect("成功路径应可安装");
        assert!(
            staging_residue(&root).is_empty(),
            "成功安装后 staging 不应残留：{:?}",
            staging_residue(&root)
        );

        // 失败路径挑一条「staging 已经建好之后才失败」的：把插件根本身当源目录。
        // 既验证了「源目录不能是插件根/其父目录」的护栏，也验证失败后 staging 被清掉。
        std::fs::write(
            root.join("plugin.json"),
            local_manifest("local-ancestor", "1.0.0"),
        )
        .expect("写插件根上的清单");
        let err = install_local(&root, &root).unwrap_err();
        assert!(
            err.contains("插件根目录"),
            "源目录是插件根时应被拒绝，实际：{err}"
        );
        assert!(
            staging_residue(&root).is_empty(),
            "失败安装后 staging 不应残留：{:?}",
            staging_residue(&root)
        );

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&source);
    }
}
