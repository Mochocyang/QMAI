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

/// 自定义下载代理前缀的环境变量名。
///
/// URL 约定与 `gh-proxy.com` 完全一致：`<proxy>/https://github.com/<owner>/<repo>/...`
/// —— 代理把「原始 GitHub 地址」当成自己的路径来收。所以配置值只需要一个前缀，
/// 例如 `https://gh.example.dev`，拼出来就是
/// `https://gh.example.dev/https://github.com/o/r/archive/refs/heads/main.zip`。
///
/// 同一个前缀既可以下 zip，也可以代理索引：把 `QMAI_PLUGIN_INDEX_URL` 写成
/// `<proxy>/https://raw.githubusercontent.com/<owner>/<repo>/main/plugins.json`
/// 就复用同一个 Worker / 对象存储 / 内网镜像，不用再配第二套（索引侧无需改代码）。
///
/// 为什么需要它：硬编码的两个公共代理在国内时好时坏（限流、被墙、换域名）。
/// 用户自建 Cloudflare Worker、国内对象存储或公司内网镜像时，不该要求改代码重编译 ——
/// 一个环境变量就能把自建通道插到所有通道的最前面。
pub const ZIP_PROXY_ENV: &str = "QMAI_PLUGIN_ZIP_PROXY";

#[derive(Debug, Clone, PartialEq)]
pub struct SourceSpec {
    pub owner: String,
    pub repo: String,
    pub git_ref: String,
    /// true = 用户没写 `@ref`，`git_ref` 只是占位；安装时应先查仓库的默认分支。
    ///
    /// 为什么不能猜 `main`：GitHub 上大量仓库（2020 年前创建的几乎都是，以及很多
    /// 中文开源项目）默认分支是 `master`，还有 `develop` / `trunk` 等。猜错的表现是
    /// 「所有下载通道均失败」——用户完全看不出真实原因。实测 `octocat/Hello-World`
    /// 默认是 `master`，猜 `main` 时六个候选通道全部 404。
    pub git_ref_defaulted: bool,
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
    let (repo_raw, git_ref, git_ref_defaulted) = match rest.split_once('@') {
        Some((repo, git_ref)) => (repo, git_ref, false),
        None => {
            // 剩余的段里还有 `/`：说明用户粘的是 `/tree/main` 之类的页面地址
            if rest.contains('/') {
                return Err(bad_shape());
            }
            // 占位值仍固定 `main`（保持既有语义、下游无需处理 Option），
            // 但标记它只是占位：install() 必须先查仓库的真实默认分支。
            (rest, "main", true)
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
        git_ref_defaulted,
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

/// GitHub API 根地址。抽成参数只为了测试能把它指向本机 TCP 桩。
const GITHUB_API_BASE: &str = "https://api.github.com";

/// 查仓库的默认分支。
///
/// 不能猜 `main`：GitHub 上大量仓库默认分支是 `master`（2020 年前创建的几乎都是），
/// 还有 `develop` / `trunk` 等。猜错的表现是「所有通道 404」，用户完全看不出原因。
/// 实测：octocat/Hello-World 默认是 master，猜 main 时六个通道全 404。
///
/// 任何失败（网络 / 404 / 限流 / 字段缺失 / 分支名非法）都返回 `None`，
/// 由调用方走 `main` + `master` 的兜底候选——「查不到」不等于「装不了」。
pub async fn resolve_default_branch(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
) -> Option<String> {
    resolve_default_branch_at(client, GITHUB_API_BASE, owner, repo).await
}

/// `resolve_default_branch` 的可注入版本：`api_base` 在测试里指向本机桩。
async fn resolve_default_branch_at(
    client: &reqwest::Client,
    api_base: &str,
    owner: &str,
    repo: &str,
) -> Option<String> {
    let url = format!("{api_base}/repos/{owner}/{repo}");
    let resp = client
        .get(&url)
        // GitHub API 对没有 User-Agent 的请求直接 403（archive 下载不需要 UA，但 API 需要）。
        // 用 `qmai/<版本>` 让 GitHub 能识别调用方，也方便出问题时对账。
        .header(
            reqwest::header::USER_AGENT,
            format!("qmai/{}", env!("CARGO_PKG_VERSION")),
        )
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        // 5 秒：查默认分支只是让下载更准的辅助步骤，不能把「安装」拖成几十秒。
        // 单请求超时而不是改 client 的总超时，避免影响真正下载 zip 的那条路径。
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body: serde_json::Value = resp.json().await.ok()?;
    let branch = body.get("default_branch")?.as_str()?.trim();
    // 分支名会直接拼进下载 URL。API 正常时不会是怪字符，但这里是外部输入，
    // 仍按 ref 的白名单过一遍；不合格就当作「没查到」，走兜底而不是拼出畸形 URL。
    if branch.is_empty() || !is_valid_ref(branch) {
        return None;
    }
    Some(branch.to_string())
}

/// 每个 ref 要试的两条 GitHub 路径，顺序按 ref 形态决定（分支先 heads、版本号先 tags），
/// 避免每次安装都白跑必然 404 的那条。
fn kinds_for_ref(git_ref: &str) -> [&'static str; 2] {
    if looks_like_tag(git_ref) {
        ["tags", "heads"]
    } else {
        ["heads", "tags"]
    }
}

/// 单个通道的下载候选：返回 `(url, 所属 ref)`。
///
/// GitHub 的分支在 `refs/heads` 下、tag 在 `refs/tags` 下，两者 URL 不通用，
/// 所以每个 ref 都要试两条路径。顺序按 ref 形态决定：分支先试 heads，版本号先试 tags，
/// 避免每次安装都白跑必然 404 的那条。
///
/// 多 ref 时按 ref 相邻展开：同一个通道里先试完 main 再试 master，
/// 使「默认分支猜错」的代价从「跑完所有通道再回头」降到「同一通道内多一次请求」。
fn candidates_for_base(
    base: &str,
    owner: &str,
    repo: &str,
    refs: &[&str],
) -> Vec<(String, String)> {
    let mut out = Vec::with_capacity(refs.len() * 2);
    for git_ref in refs {
        for kind in kinds_for_ref(git_ref) {
            // codeload 的路径形状与 github.com 不同，单独处理
            let url = if base.starts_with("codeload.") {
                format!("https://{base}{owner}/{repo}/zip/refs/{kind}/{git_ref}")
            } else {
                format!(
                    "https://{base}https://github.com/{owner}/{repo}/archive/refs/{kind}/{git_ref}.zip"
                )
            };
            out.push((url, (*git_ref).to_string()));
        }
    }
    out
}

/// 归一化 `QMAI_PLUGIN_ZIP_PROXY` 的取值，返回可直接拼接的前缀（无尾斜杠）。
///
/// 返回 `None` 表示「这个值不可用，按未配置处理」：
///   - 空白（含全部是空白）：用户清空了变量，等价于没配；
///   - 不以 `http://` / `https://` 开头：`x.dev` 会拼成 `x.dev/https://…`（没有 scheme，
///     请求直接失败），`proxy/` 这类相对值甚至会指到本机。与其静默拼出一个必然连不上的
///     通道，不如明确忽略并告警，让用户改配置。
fn normalize_zip_proxy(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !(trimmed.starts_with("http://") || trimmed.starts_with("https://")) {
        eprintln!(
            "忽略环境变量 {ZIP_PROXY_ENV}={trimmed:?}：代理前缀必须以 http:// 或 https:// 开头"
        );
        return None;
    }
    // `https://x.dev/` 与 `https://x.dev` 都要拼出一模一样的地址：
    // 多出来的 `/` 会变成 `https://x.dev//https://github.com/...`，部分代理会 404。
    let prefix = trimmed.trim_end_matches('/');
    // 只有 scheme 没有 host（`https://`）：trim 掉尾斜杠后连 `://` 都没了，视为不可用
    let host = prefix.split_once("://").map(|(_, rest)| rest).unwrap_or("");
    if host.is_empty() {
        eprintln!("忽略环境变量 {ZIP_PROXY_ENV}={trimmed:?}：缺少代理主机名");
        return None;
    }
    Some(prefix.to_string())
}

/// 自定义代理通道的候选：`<prefix>/https://github.com/<owner>/<repo>/archive/...`。
///
/// 与 `candidates_for_base` 的区别只在「前缀是完整 URL」而不是裸 host，所以单独拼；
/// 路径形状仍必须与 gh-proxy 一致，否则同一个 Worker 只能服务其中一半。
fn candidates_for_proxy(
    prefix: &str,
    owner: &str,
    repo: &str,
    refs: &[&str],
) -> Vec<(String, String)> {
    let mut out = Vec::with_capacity(refs.len() * 2);
    for git_ref in refs {
        for kind in kinds_for_ref(git_ref) {
            out.push((
                format!(
                    "{prefix}/https://github.com/{owner}/{repo}/archive/refs/{kind}/{git_ref}.zip"
                ),
                (*git_ref).to_string(),
            ));
        }
    }
    out
}

/// 全部下载候选（通道外层、ref 次层、heads/tags 内层）。
///
/// `proxy` 由调用方给：`None` 时顺序与历史行为完全一致（两个公共代理 → codeload 直连）。
/// 配了 `QMAI_PLUGIN_ZIP_PROXY` 则把自建代理插到最前面：用户自建通道的可达性
/// 一定优于公共代理，不该让公共代理先白等两次超时。
pub fn download_candidates_with(
    owner: &str,
    repo: &str,
    refs: &[&str],
    proxy: Option<&str>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Some(prefix) = normalize_zip_proxy(proxy) {
        out.extend(candidates_for_proxy(&prefix, owner, repo, refs));
    }
    out.extend(candidates_for_base("gh-proxy.com/", owner, repo, refs));
    out.extend(candidates_for_base("ghproxy.net/", owner, repo, refs));
    out.extend(candidates_for_base("codeload.github.com/", owner, repo, refs));
    out
}

/// 全部下载候选（读环境变量版）。`install()` 走这条，环境变量只在这里读一次。
pub fn download_candidates(owner: &str, repo: &str, refs: &[&str]) -> Vec<(String, String)> {
    let proxy = std::env::var(ZIP_PROXY_ENV).ok();
    download_candidates_with(owner, repo, refs, proxy.as_deref())
}

/// 单 ref 的候选 URL 列表（串行下载用；保留既有签名与顺序）。
pub fn download_urls(owner: &str, repo: &str, git_ref: &str) -> Vec<String> {
    let proxy = std::env::var(ZIP_PROXY_ENV).ok();
    download_urls_with(owner, repo, git_ref, proxy.as_deref())
}

/// `download_urls` 的纯函数版本：代理值由调用方直接给，不读环境变量。
///
/// 为什么拆出来：本仓库有过「测试里 set_var 并发污染」的历史（见 market.rs 的环境变量锁），
/// 所以代理相关的用例一律喂参数，不碰进程环境。
pub fn download_urls_with(
    owner: &str,
    repo: &str,
    git_ref: &str,
    proxy: Option<&str>,
) -> Vec<String> {
    download_candidates_with(owner, repo, &[git_ref], proxy)
        .into_iter()
        .map(|(url, _)| url)
        .collect()
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

/// 所有通道都失败时追加的排查提示。把「怎么自救」直接写在错误里：
/// 旧报错只说「都失败了」，用户看完仍然不知道下一步该做什么。
const DOWNLOAD_FAILURE_HINT: &str = "请检查：① 仓库地址是否正确 ② 仓库是否公开 ③ 分支/标签名是否写对（可用 `仓库地址@分支名` 指定）";

/// 失败列表最多列几个通道。错误信息要能直接贴进界面，列太多反而把真正有用的
/// 「你配的代理在哪、报了什么」淹掉；超出用 `…` 标注剩余条数。
const MAX_LISTED_CHANNELS: usize = 6;

/// 一条通道的失败：完整下载地址 + 原因。
///
/// 不直接存成 `"URL → 原因"` 字符串，是为了还能按通道聚合（见 `format_failures`）：
/// 拼成字符串后想判断「这条属于哪个通道」就只能反过来解析 URL 了。
#[derive(Debug, Clone)]
struct DownloadFailure {
    url: String,
    reason: String,
}

impl DownloadFailure {
    fn new(url: &str, reason: impl Into<String>) -> Self {
        Self {
            url: url.to_string(),
            reason: reason.into(),
        }
    }

    /// 通道标识：代理通道取「内嵌 GitHub 地址之前的前缀」，直连取 `scheme://host`。
    /// 只用于分组去重，不参与下载。
    fn channel(&self) -> &str {
        if let Some(idx) = self.url.find("https://github.com") {
            if idx > 0 {
                return &self.url[..idx];
            }
        }
        let scheme_end = self.url.find("://").map(|i| i + 3).unwrap_or(0);
        match self.url[scheme_end..].find('/') {
            Some(slash) => &self.url[..scheme_end + slash],
            None => &self.url,
        }
    }
}

impl std::fmt::Display for DownloadFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} → {}", self.url, self.reason)
    }
}

/// 串行版的失败信息：逐条列出每个失败通道的地址与原因。
///
/// 为什么不再只报「最后一次」：用户配了自定义代理却打不开时，必须一眼看到
/// 「我的代理地址在不在列表里、它报了什么」。只报最后一次尝试，会让排在前面
/// 的自定义通道失败完全不可见（它恰恰是用户最想确认的那条）。
fn all_channels_failed(failures: &[DownloadFailure]) -> String {
    format!(
        "所有下载通道均失败：{}\n{DOWNLOAD_FAILURE_HINT}",
        format_failures(failures)
    )
}

/// 直连与代理两条流都失败时的信息：合并成一张列表（直连在前），并标出两侧尝试条数。
fn all_channels_failed_parallel(direct: &[DownloadFailure], proxied: &[DownloadFailure]) -> String {
    let mut failures = Vec::with_capacity(direct.len() + proxied.len());
    failures.extend(direct.iter().cloned());
    failures.extend(proxied.iter().cloned());
    format!(
        "所有下载通道均失败（直连 {} 条、代理 {} 条）：{}\n{DOWNLOAD_FAILURE_HINT}",
        direct.len(),
        proxied.len(),
        format_failures(&failures)
    )
}

/// 按通道聚合失败原因后渲染成缩进条目，最多列 `MAX_LISTED_CHANNELS` 个通道。
///
/// 为什么按通道聚合：每个通道有 heads / tags 两条候选，自定义代理加上三个内置通道
/// 一共 8 条候选。若逐条列出再截断到 6 条，排在最后的内置通道（codeload 直连）
/// 会被整条挤掉，用户看到的仍是「不全」。同一通道的候选总是相邻出现，
/// 所以只保留每个通道的第一条原因即可。
fn format_failures(failures: &[DownloadFailure]) -> String {
    if failures.is_empty() {
        return "\n  - 未尝试任何通道".to_string();
    }
    let mut seen: Vec<&str> = Vec::new();
    let mut message = String::new();
    let mut channels = 0usize;
    for failure in failures {
        let channel = failure.channel();
        if seen.contains(&channel) {
            continue;
        }
        seen.push(channel);
        channels += 1;
        if channels > MAX_LISTED_CHANNELS {
            continue;
        }
        message.push_str("\n  - ");
        message.push_str(&failure.to_string());
    }
    if channels > MAX_LISTED_CHANNELS {
        message.push_str(&format!(
            "\n  … 另有 {} 个通道失败未列出（共 {channels} 个）",
            channels - MAX_LISTED_CHANNELS
        ));
    }
    message
}

/// 顺序试一组候选，返回 `(字节, 在候选里的下标)`。
/// 下标用来回溯「最后是哪个 ref 成功」，安装结果里的 git_ref 才是真的而不是占位。
/// 全部失败时返回每条通道的失败明细（顺序与尝试顺序一致），由调用方统一格式化。
async fn download_first_indexed(
    client: &reqwest::Client,
    candidates: &[(String, usize)],
) -> Result<(Vec<u8>, usize), Vec<DownloadFailure>> {
    let mut failures: Vec<DownloadFailure> = Vec::with_capacity(candidates.len());
    for (url, index) in candidates {
        let resp = match client.get(url).send().await {
            Ok(resp) => resp,
            Err(e) => {
                failures.push(DownloadFailure::new(url, e.to_string()));
                continue;
            }
        };
        if !resp.status().is_success() {
            failures.push(DownloadFailure::new(url, format!("HTTP {}", resp.status())));
            continue;
        }
        // 先看声明的长度：等 bytes() 全量读进来再判，内存已经被吃掉了
        if let Some(len) = resp.content_length() {
            if len as usize > MAX_ZIP_BYTES {
                return Err(vec![DownloadFailure::new(
                    url,
                    format!("插件包超过 {} MB 上限", MAX_ZIP_BYTES / 1024 / 1024),
                )]);
            }
        }
        let bytes = match resp.bytes().await {
            Ok(b) => b,
            Err(e) => {
                failures.push(DownloadFailure::new(url, format!("读取响应失败：{e}")));
                continue;
            }
        };
        // 超限不再试下一个通道：这是「这个包本身太大」，
        // 换通道只会把同一份大包再下一遍，白等用户
        if bytes.len() > MAX_ZIP_BYTES {
            return Err(vec![DownloadFailure::new(
                url,
                format!("插件包超过 {} MB 上限", MAX_ZIP_BYTES / 1024 / 1024),
            )]);
        }
        // 代理对私有库/限流/ref 不存在常返回 200 + HTML 错误页。
        // 只按状态码判成功会让剩下几个候选一次都不试，用户只看到「不是有效 zip」。
        if !bytes.starts_with(b"PK\x03\x04") {
            failures.push(DownloadFailure::new(
                url,
                "响应不是 zip（可能被代理替换成错误页）",
            ));
            continue;
        }
        return Ok((bytes.to_vec(), *index));
    }
    Err(failures)
}

/// 下载 zip 字节；按顺序试每个候选，全部失败才报错（错误里列出所有失败通道）。
pub async fn download(client: &reqwest::Client, urls: &[String]) -> Result<Vec<u8>, String> {
    let candidates: Vec<(String, usize)> = urls
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, url)| (url, index))
        .collect();
    download_first_indexed(client, &candidates)
        .await
        .map(|(bytes, _)| bytes)
        .map_err(|failures| all_channels_failed(&failures))
}

/// 直连与代理并行：两条流各自按顺序试自己的候选，谁先拿到真 zip 用谁。
///
/// 为什么不是纯串行「代理优先」：本环境实测两个代理都失败、直连成功，串行会先白等
/// 两次连接超时（每次 5 秒）。为什么也不改成直连优先：那会让国内用户每次安装都先
/// 撞一次被墙的 codeload。并行的代价是多一个在途请求，换来最坏情况「等 1 次」而不是
/// 「等 2 次」。两条流都失败时把两边每个通道的失败原因都列出来（见 format_failures）。
async fn download_racing(
    client: &reqwest::Client,
    direct_candidates: &[(String, String)],
    proxied_candidates: &[(String, String)],
) -> Result<(Vec<u8>, String), String> {
    // 下标是全局的：先直连后代理拼成一张表，成功时用它回溯真正命中的 ref。
    let indexed = |candidates: &[(String, String)], offset: usize| -> Vec<(String, usize)> {
        candidates
            .iter()
            .enumerate()
            .map(|(i, (url, _))| (url.clone(), offset + i))
            .collect()
    };
    let direct_items = indexed(direct_candidates, 0);
    let proxied_items = indexed(proxied_candidates, direct_candidates.len());
    let all: Vec<&(String, String)> = direct_candidates
        .iter()
        .chain(proxied_candidates.iter())
        .collect();

    // `select` 只等「先完成」的那一条；若它失败，另一条仍可继续等（future 被还回来）。
    // 两条流都必须存在：候选生成至少会给出一个通道。
    let direct_fut = Box::pin(download_first_indexed(client, &direct_items));
    let proxied_fut = Box::pin(download_first_indexed(client, &proxied_items));
    // 先绑到局部变量再返回：直接 `match ... .await { }` 作为块尾表达式时，
    // match 的临时值活到块尾，会把 `*_items` 的借用拉到 drop 之后（E0597）。
    let outcome = match futures::future::select(direct_fut, proxied_fut).await {
        futures::future::Either::Left((Ok((bytes, index)), _)) => {
            Ok((bytes, all[index].1.clone()))
        }
        futures::future::Either::Right((Ok((bytes, index)), _)) => {
            Ok((bytes, all[index].1.clone()))
        }
        // 先完成的一条失败了：继续等另一条，只有两条都失败才算真失败
        futures::future::Either::Left((Err(direct_err), remaining)) => match remaining.await {
            Ok((bytes, index)) => Ok((bytes, all[index].1.clone())),
            Err(proxied_err) => Err(all_channels_failed_parallel(&direct_err, &proxied_err)),
        },
        futures::future::Either::Right((Err(proxied_err), remaining)) => match remaining.await {
            Ok((bytes, index)) => Ok((bytes, all[index].1.clone())),
            Err(direct_err) => Err(all_channels_failed_parallel(&direct_err, &proxied_err)),
        },
    };
    outcome
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
    // 用户没写 @ref 时先查真实默认分支。GitHub 上大量仓库默认是 master，
    // 猜 main 会让六个候选通道全部 404（见 SourceSpec::git_ref_defaulted 的注释）。
    let resolved_default = if spec.git_ref_defaulted {
        resolve_default_branch(&client, &spec.owner, &spec.repo).await
    } else {
        None
    };
    // 查不到（离线 / 限流 / 私有库 / 空库）时用 main + master 双保险：
    // 这两个覆盖 99% 的仓库，其余分支名只能靠用户显式 `@ref` 指定。
    let refs: Vec<&str> = match (&resolved_default, spec.git_ref_defaulted) {
        (Some(branch), _) => vec![branch.as_str()],
        (None, true) => vec!["main", "master"],
        (None, false) => vec![spec.git_ref.as_str()],
    };
    // 直连与代理并行（谁先成功用谁），具体理由见 download_racing 的注释。
    // 通道顺序只在 download_candidates 里定义一次，这里按通道分成两条流。
    let all_candidates = download_candidates(&spec.owner, &spec.repo, &refs);
    let (proxied_candidates, direct_candidates): (Vec<_>, Vec<_>) = all_candidates
        .into_iter()
        .partition(|(url, _)| !url.contains("codeload.github.com/"));
    let (bytes, used_ref) =
        download_racing(&client, &direct_candidates, &proxied_candidates).await?;

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
            // 钉的是「实际命中的」ref，而不是 spec.git_ref：用户没写 @ref 时后者只是
            // 占位（main），真实分支可能是 API 查到的 master 或兜底命中的那个。
            // 说明：这里钉的是 ref 而不是 commit SHA。GitHub 的 archive zip 顶层目录名是
            // `repo-ref`，不含 commit。要拿到真 SHA 得再打一次 API，第一期不做；
            // 责任归属仍可追溯（repo + ref + zip 的 sha256）。
            git_ref: used_ref,
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
        // 占位值仍是 main，但标记为「默认」——安装时必须先查真实默认分支
        assert_eq!(s.git_ref, "main");
        assert!(s.git_ref_defaulted);
    }

    #[test]
    fn plain_url_marks_the_ref_as_defaulted() {
        let s = parse_source("https://github.com/a/b").unwrap();
        assert!(s.git_ref_defaulted, "没写 @ref 时必须标记为默认");
        assert_eq!(s.git_ref, "main", "占位值保持 main，避免下游大改");
    }

    #[test]
    fn explicit_ref_is_not_defaulted() {
        let s = parse_source("https://github.com/a/b@master").unwrap();
        assert!(!s.git_ref_defaulted, "用户显式写了 @master 就不是默认");
        assert_eq!(s.git_ref, "master");
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
        // 用 `_with(..., None)` 而不是读环境变量的版本：本机若设了
        // QMAI_PLUGIN_ZIP_PROXY，外层断言会被自定义通道带偏（不需要 set_var 也能隔离）
        let urls = download_urls_with("owner", "repo", "main", None);
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

        let tag_urls = download_urls_with("owner", "repo", "v1.2.0", None);
        // 版本号 → tags 先试，避免必然 404 的 heads 抢在最前
        assert!(tag_urls[0].contains("/refs/tags/v1.2.0"));
        assert!(tag_urls.iter().any(|u| u.contains("/refs/heads/v1.2.0")));
    }

    // ------------------------------------------------------------------
    // 可配置 zip 代理（QMAI_PLUGIN_ZIP_PROXY）
    // 全部走 `_with(..., proxy)` 纯函数：不在测试里 std::env::set_var，
    // 本仓库有过环境变量并发污染的历史（见 market.rs 的锁）。
    // ------------------------------------------------------------------

    const CUSTOM_PROXY: &str = "https://gh.example.dev";

    #[test]
    fn zip_proxy_env_adds_highest_priority_channel() {
        let urls = download_urls_with("o", "r", "main", Some(CUSTOM_PROXY));
        assert_eq!(urls.len(), 8, "自定义通道 2 条 + 原有 6 条");
        assert_eq!(
            urls[0], "https://gh.example.dev/https://github.com/o/r/archive/refs/heads/main.zip",
            "分支名 → heads 先试，且自定义通道排在最前"
        );
        assert_eq!(
            urls[1], "https://gh.example.dev/https://github.com/o/r/archive/refs/tags/main.zip",
            "同一通道的 tags 候选紧随其后，仍在内置通道之前"
        );
    }

    #[test]
    fn zip_proxy_trailing_slash_is_normalized() {
        let without = download_urls_with("o", "r", "main", Some("https://x.dev"));
        for with_slash in ["https://x.dev/", "https://x.dev///"] {
            assert_eq!(
                download_urls_with("o", "r", "main", Some(with_slash)),
                without,
                "{with_slash:?} 应与无尾斜杠等价"
            );
        }
        assert_eq!(
            without[0],
            "https://x.dev/https://github.com/o/r/archive/refs/heads/main.zip"
        );
        // 前缀与内嵌 GitHub 地址之间只能有一个斜杠：多出来的会被代理当空段，常见表现是 404
        assert!(
            !without[0].contains("dev//"),
            "不能拼出双斜杠：{}",
            without[0]
        );
    }

    #[test]
    fn empty_or_blank_proxy_is_ignored() {
        let baseline = download_urls_with("o", "r", "main", None);
        for blank in ["", "   ", "\t\n ", "/"] {
            assert_eq!(
                download_urls_with("o", "r", "main", Some(blank)),
                baseline,
                "空白代理 {blank:?} 应等价于未配置"
            );
        }
        assert_eq!(baseline.len(), 6, "未配置/空白时代理通道不能多出来");
    }

    #[test]
    fn proxy_without_scheme_is_ignored() {
        let baseline = download_urls_with("o", "r", "main", None);
        for bad in ["x.dev/proxy", "//x.dev", "ftp://x.dev", "https://"] {
            let urls = download_urls_with("o", "r", "main", Some(bad));
            assert_eq!(
                urls, baseline,
                "非法代理 {bad:?} 必须被忽略，其它通道一条都不能少"
            );
            assert!(
                !urls.iter().any(|u| u.contains("x.dev")),
                "非法代理 {bad:?} 不应进入通道列表：{urls:?}"
            );
        }
    }

    #[test]
    fn custom_proxy_comes_before_builtin_proxies_and_direct() {
        let urls = download_urls_with("o", "r", "main", Some(CUSTOM_PROXY));
        let pos = |needle: &str| {
            urls.iter()
                .position(|u| u.contains(needle))
                .unwrap_or_else(|| panic!("缺少通道 {needle}：{urls:?}"))
        };
        assert!(urls[0].starts_with(CUSTOM_PROXY), "自定义通道必须在第一位");
        assert!(pos("gh.example.dev") < pos("gh-proxy.com"));
        assert!(pos("gh-proxy.com") < pos("ghproxy.net"));
        assert!(pos("ghproxy.net") < pos("codeload.github.com"));
    }

    #[test]
    fn all_channels_failed_lists_every_channel() {
        // 用真实候选造失败：每个通道有 heads / tags 两条候选，错误里应聚合为「每通道一条」
        let failures: Vec<DownloadFailure> =
            download_urls_with("o", "r", "main", Some(CUSTOM_PROXY))
                .into_iter()
                .map(|url| DownloadFailure::new(&url, "连接超时"))
                .collect();
        assert_eq!(failures.len(), 8);
        let err = all_channels_failed(&failures);
        for channel in [
            CUSTOM_PROXY,
            "https://gh-proxy.com",
            "https://ghproxy.net",
            "https://codeload.github.com",
        ] {
            assert!(
                err.contains(channel),
                "错误信息应包含通道 {channel}，实际：{err}"
            );
        }
        assert!(err.contains("连接超时"), "每个通道的失败原因也要保留：{err}");
        assert_eq!(
            err.matches("\n  - ").count(),
            4,
            "四个通道各一条，不重复列 heads/tags：{err}"
        );
        assert!(!err.contains('…'), "只有 4 个通道，不该截断：{err}");

        // 超过 6 个通道时截断并留省略标记（错误信息要能直接贴进界面）
        let many: Vec<DownloadFailure> = (0..8)
            .map(|i| {
                DownloadFailure::new(
                    &format!("https://p{i}.dev/https://github.com/o/r/x.zip"),
                    "boom",
                )
            })
            .collect();
        let err = all_channels_failed(&many);
        assert_eq!(err.matches("\n  - ").count(), MAX_LISTED_CHANNELS);
        assert!(err.contains('…'), "超出上限要有省略标记：{err}");
        assert!(!err.contains("p7.dev"), "超出上限的通道不再列出：{err}");
        assert!(all_channels_failed(&[]).contains("未尝试任何通道"));
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

    // ------------------------------------------------------------------
    // 默认分支：不能猜 main（真实网络实测见 real_github_* 的 #[ignore] 用例）
    // ------------------------------------------------------------------

    use std::io::Write;
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    /// 极简本机 HTTP 桩：固定状态码 + 固定 body，并记录收到的完整请求头。
    ///
    /// 用真实 TCP 而不是 mock client：这里要验证的正是 reqwest 真实发出的请求
    /// （尤其 `User-Agent` —— GitHub API 对无 UA 的请求回 403）。
    struct StubHttp {
        base: String,
        requests: Arc<Mutex<Vec<String>>>,
    }

    impl StubHttp {
        fn spawn(status: u16, body: &[u8]) -> Self {
            Self::spawn_delayed(status, body, Duration::ZERO)
        }

        fn spawn_delayed(status: u16, body: &[u8], delay: Duration) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").expect("绑定桩端口失败");
            let port = listener.local_addr().expect("读取桩端口").port();
            let requests = Arc::new(Mutex::new(Vec::new()));
            let captured = Arc::clone(&requests);
            let body = body.to_vec();
            // 线程随测试进程退出，不 join：桩阻塞在 accept() 上，join 会把用例拖成超时
            std::thread::spawn(move || {
                for stream in listener.incoming() {
                    let Ok(mut stream) = stream else { return };
                    let request = read_http_request(&mut stream);
                    captured.lock().expect("请求记录锁").push(request);
                    if !delay.is_zero() {
                        std::thread::sleep(delay);
                    }
                    let response = format!(
                        "HTTP/1.1 {status} Stub\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.write_all(&body);
                    let _ = stream.flush();
                }
            });
            Self {
                base: format!("http://127.0.0.1:{port}"),
                requests,
            }
        }

        fn last_request(&self) -> String {
            self.requests
                .lock()
                .expect("请求记录锁")
                .last()
                .cloned()
                .unwrap_or_default()
        }
    }

    /// 读一个请求（GET 没有 body，读到 `\r\n\r\n` 即可）。
    fn read_http_request(stream: &mut TcpStream) -> String {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buffer = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buffer.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&buffer).to_string()
    }

    fn stub_client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            // 与 providers.rs 的桩同理：测试进程可能带代理环境变量，回环地址不能走代理
            .no_proxy()
            .build()
            .expect("构造 reqwest client")
    }

    #[tokio::test]
    async fn resolve_default_branch_parses_github_api_response() {
        let stub = StubHttp::spawn(200, br#"{"default_branch":"master"}"#);
        let got =
            resolve_default_branch_at(&stub_client(), &stub.base, "octocat", "Hello-World").await;
        assert_eq!(got.as_deref(), Some("master"));
    }

    #[tokio::test]
    async fn resolve_default_branch_returns_none_on_404() {
        // 私有库 / 不存在的库都是 404：这里必须返回 None，交给 main+master 兜底，
        // 而不是把「查不到」升级成「装不了」
        let stub = StubHttp::spawn(404, br#"{"message":"Not Found"}"#);
        let got = resolve_default_branch_at(&stub_client(), &stub.base, "a", "b").await;
        assert_eq!(got, None);
    }

    #[tokio::test]
    async fn resolve_default_branch_returns_none_on_malformed_json() {
        // 限流页 / 网关错误页会是 200 + HTML：解析失败只能是 None，不能 panic
        let stub = StubHttp::spawn(200, b"<html>rate limited</html>");
        let got = resolve_default_branch_at(&stub_client(), &stub.base, "a", "b").await;
        assert_eq!(got, None);
    }

    #[tokio::test]
    async fn resolve_default_branch_sends_a_user_agent() {
        let stub = StubHttp::spawn(200, br#"{"default_branch":"main"}"#);
        let _ = resolve_default_branch_at(&stub_client(), &stub.base, "a", "b").await;
        let request = stub.last_request().to_ascii_lowercase();
        // GitHub API 对无 UA 的请求直接 403，这条断言是「默认分支能被查到」的前提
        assert!(
            request.contains("user-agent:"),
            "查默认分支的请求必须带 User-Agent，实际请求头：{request}"
        );
        assert!(
            request.contains("qmai/"),
            "UA 应是 qmai/<version>，实际请求头：{request}"
        );
        // 路径也要钉死：`/repos/<owner>/<repo>`，错了 API 只会回 404
        assert!(
            request.starts_with("get /repos/a/b"),
            "请求路径不对：{request}"
        );
    }

    #[test]
    fn fallback_refs_are_tried_within_each_channel() {
        // API 查不到时 main + master 都要试，且同一通道内相邻（猜错的代价是同一通道
        // 多一次请求，而不是「跑完所有通道再回头」）
        let candidates = download_candidates_with("o", "r", &["main", "master"], None);
        assert_eq!(candidates.len(), 12, "2 ref × 2 kind × 3 通道");
        assert_eq!(candidates[0].1, "main");
        assert_eq!(candidates[2].1, "master", "同一通道内紧跟 master");
        assert_eq!(
            candidates[8].0,
            "https://codeload.github.com/o/r/zip/refs/heads/main"
        );
        assert_eq!(candidates[10].1, "master");
        // 单 ref 形状不变：既有串行行为不能被这次改动带偏
        assert_eq!(download_urls_with("o", "r", "main", None).len(), 6);
    }

    #[tokio::test]
    async fn install_failure_message_mentions_actionable_hints() {
        // install() 会把 download 的错误原样透出，所以这里直接压 download 的失败分支
        let stub = StubHttp::spawn(404, b"nope");
        let err = download(
            &stub_client(),
            &[format!("{}/archive/refs/heads/main.zip", stub.base)],
        )
        .await
        .unwrap_err();
        assert!(
            err.contains("分支") || err.contains('@'),
            "错误信息要给可操作提示（分支/tag 写法），实际：{err}"
        );
        // 原始失败原因仍要保留，否则排查时又变成「只说了都失败」
        assert!(
            err.contains("404"),
            "错误信息应保留最后一次失败原因，实际：{err}"
        );
    }

    #[tokio::test]
    async fn racing_uses_the_proxied_channel_when_direct_fails_first() {
        let zip = zip_with(&[("repo-master/plugin.json", b"{}")]);
        let dead = StubHttp::spawn(404, b"gone");
        // 代理慢一点但最终成功：直连先失败，不能因此提前判死
        let slow_ok = StubHttp::spawn_delayed(200, &zip, Duration::from_millis(150));
        let direct = vec![(format!("{}/direct.zip", dead.base), "main".to_string())];
        let proxied = vec![(format!("{}/proxy.zip", slow_ok.base), "master".to_string())];

        let (bytes, used_ref) = download_racing(&stub_client(), &direct, &proxied)
            .await
            .expect("一条通道成功即应成功");
        assert_eq!(bytes, zip);
        assert_eq!(used_ref, "master", "安装结果要记录真正命中的 ref");
    }

    #[tokio::test]
    async fn racing_uses_the_direct_channel_when_it_wins() {
        let zip = zip_with(&[("repo-main/plugin.json", b"{}")]);
        let slow_fail = StubHttp::spawn_delayed(500, b"server error", Duration::from_millis(150));
        let direct_stub = StubHttp::spawn(200, &zip);
        let direct = vec![(format!("{}/direct.zip", direct_stub.base), "main".to_string())];
        let proxied = vec![(format!("{}/proxy.zip", slow_fail.base), "master".to_string())];

        let (bytes, used_ref) = download_racing(&stub_client(), &direct, &proxied)
            .await
            .expect("直连成功即应成功");
        assert_eq!(bytes, zip);
        assert_eq!(used_ref, "main");
    }

    #[tokio::test]
    async fn racing_reports_both_channels_when_all_fail() {
        let direct_stub = StubHttp::spawn(404, b"direct");
        let proxy_stub = StubHttp::spawn(500, b"proxy");
        let direct = vec![(format!("{}/d.zip", direct_stub.base), "main".to_string())];
        let proxied = vec![(format!("{}/p.zip", proxy_stub.base), "main".to_string())];

        let err = download_racing(&stub_client(), &direct, &proxied)
            .await
            .unwrap_err();
        assert!(
            err.contains("直连") && err.contains("代理"),
            "两条流都失败时两边的原因都要报，实际：{err}"
        );
        assert!(
            err.contains("分支") || err.contains('@'),
            "错误信息要给可操作提示，实际：{err}"
        );
    }

    /// 真实网络验收：不带 @ref 安装 octocat/Hello-World（默认分支是 master）。
    ///
    /// 默认 `#[ignore]`：CI/离线环境打不了 GitHub。本地用
    /// `cargo test plugins::installer::tests::real_github -- --ignored --nocapture` 跑，
    /// 它同时验证「猜 main 会六个通道全 404」和「查默认分支后能下载成功」。
    #[tokio::test]
    #[ignore = "真实网络：需要能访问 api.github.com / codeload.github.com"]
    async fn real_github_resolves_master_and_downloads_without_explicit_ref() {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(120))
            .build()
            .expect("构造 reqwest client");
        let spec = parse_source("https://github.com/octocat/Hello-World").unwrap();
        assert!(spec.git_ref_defaulted, "没写 @ref 应标记为默认");

        // 旧行为复现：猜 main 的候选全部 404。只走 codeload（不走代理），
        // 免得这条演示为了两个必然连不上的代理白等 10 秒。
        let main_urls: Vec<String> =
            candidates_for_base("codeload.github.com/", &spec.owner, &spec.repo, &["main"])
                .into_iter()
                .map(|(url, _)| url)
                .collect();
        let main_err = download(&client, &main_urls).await.unwrap_err();
        println!("猜 main 的旧行为（应有明确失败提示）：\n{main_err}");

        let resolved = resolve_default_branch(&client, &spec.owner, &spec.repo).await;
        println!("API 解析出的默认分支：{resolved:?}");
        match resolved.as_deref() {
            // 有 API 额度时必须拿到 master：这证明「查」而不是「猜」
            Some(branch) => assert_eq!(
                branch, "master",
                "octocat/Hello-World 的默认分支实测是 master"
            ),
            // API 会限流（未认证 60 次/小时，按出口 IP 共用）、也可能被网络挡住。
            // 这时必须靠 main + master 兜底把安装走通 —— 这正是生产会遇到的形态。
            None => println!("API 不可用（限流/网络），走 main + master 兜底"),
        }

        let refs: Vec<&str> = match resolved.as_deref() {
            Some(branch) => vec![branch],
            None => vec!["main", "master"],
        };
        let direct = candidates_for_base("codeload.github.com/", &spec.owner, &spec.repo, &refs);
        let mut proxied = candidates_for_base("gh-proxy.com/", &spec.owner, &spec.repo, &refs);
        proxied.extend(candidates_for_base(
            "ghproxy.net/",
            &spec.owner,
            &spec.repo,
            &refs,
        ));
        let (bytes, used_ref) = download_racing(&client, &direct, &proxied)
            .await
            .expect("查默认分支后应能下载成功");
        println!(
            "实际使用 ref：{used_ref}，下载 {} 字节，zip 魔数：{:?}",
            bytes.len(),
            &bytes[..4]
        );
        assert_eq!(used_ref, "master");
        assert!(bytes.starts_with(b"PK\x03\x04"), "下载结果应是真 zip");
        assert!(bytes.len() > 100, "不应是空包或错误页");
    }
}
