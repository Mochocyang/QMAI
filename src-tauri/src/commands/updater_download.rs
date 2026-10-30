//! 安装包下载：多源候选 → 版本守门 → 分段并发 → 落地临时文件。
//!
//! 为什么不用插件自带的 `update.download()`：
//!   1. 它只会去下 `latest.json` 里写死的那个地址（GitHub 直连，实测 58 KB/s）；
//!   2. 它是单连接，而实测单连接被限速、多连接能叠加（8 段 0.6～2.7 MB/s）；
//!   3. 它没法在「官网文件版本过期」时自动换源。
//!
//! 安全边界不变：下载回来的字节最终仍交给 `tauri-plugin-updater` 的 `install(bytes)`
//! 做签名校验，镜像或站点改过的包装不上。

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::updater::channels::{ChannelTable, Rewrite};
use crate::updater::segmented::SegmentFetcher;

/// 下载进度事件名。前端据此更新进度条。
pub const DOWNLOAD_PROGRESS_EVENT: &str = "updater://download-progress";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    /// 正在用哪条源（"官网直链" / "加速通道 A" …），用于界面提示。
    pub source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadSource {
    pub channel_id: String,
    pub label: String,
    pub url: String,
}

/// 从文件名里抽出 `4.3.10` 这种版本号。
///
/// 站点直链的文件名形如 `QMaiWrite_4.3.10_windows_X64.exe`。
pub fn version_in_file_name(name: &str) -> Option<String> {
    let lower = name.to_ascii_lowercase();
    if !lower.contains("qmaiwrite_") {
        return None;
    }
    let rest = &name[name.find("QMaiWrite_").unwrap_or(0) + "QMaiWrite_".len()..];
    let version: String = rest
        .chars()
        .take_while(|ch| ch.is_ascii_digit() || *ch == '.')
        .collect();
    let trimmed = version.trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

/// 站点文件是否就是我们要的那个版本。
///
/// 官网 `/download/windows` 是**固定文件**（没有 `?v=` 参数）：发新版后它
/// 未必立刻更新。直接用它会让用户下到旧包，所以必须先比对文件名里的版本。
pub fn site_asset_matches_version(file_name: &str, wanted_version: &str) -> bool {
    match version_in_file_name(file_name) {
        Some(version) => version == wanted_version.trim(),
        None => false,
    }
}

/// 组出本次下载的候选源列表（已按优先级排序）。
///
/// 顺序：官网直链 → 各镜像 → 直连。官网只在「文件名版本与目标一致」时入选。
pub fn build_sources(
    table: &ChannelTable,
    release_url: &str,
    wanted_version: &str,
    site_file_name: Option<&str>,
) -> Vec<DownloadSource> {
    let mut sources: Vec<DownloadSource> = Vec::new();

    // 1) 官网直链（版本一致才用）
    if let Some(channel) = table.channels.iter().find(|channel| channel.rewrite == Rewrite::Site) {
        let usable = site_file_name
            .map(|name| site_asset_matches_version(name, wanted_version))
            .unwrap_or(false);
        if usable {
            if let Some(url) = channel.site_asset_url() {
                sources.push(DownloadSource {
                    channel_id: channel.id.clone(),
                    label: channel.label.clone(),
                    url,
                });
            }
        }
    }

    // 2) 镜像与直连：按通道表顺序（镜像在前、直连垫底）
    for channel in &table.channels {
        if channel.rewrite == Rewrite::Site {
            continue;
        }
        if let Some(url) = channel.map_release_url(release_url) {
            sources.push(DownloadSource {
                channel_id: channel.id.clone(),
                label: channel.label.clone(),
                url,
            });
        }
    }

    // 3) 万一一个都没有，至少保留原始地址，别让更新直接不可用。
    if sources.is_empty() {
        sources.push(DownloadSource {
            channel_id: "direct".to_string(),
            label: "直连".to_string(),
            url: release_url.to_string(),
        });
    }
    sources
}

/// 探测站点文件名（从 `Content-Disposition` 或 URL 里取）。
pub fn probe_site_file_name(url: &str, proxy_url: Option<&str>) -> Option<String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .connect_timeout(std::time::Duration::from_secs(5))
        .user_agent("QMaiWrite-Updater");
    if let Some(proxy) = proxy_url {
        if !proxy.trim().is_empty() {
            builder = builder.proxy(reqwest::Proxy::all(proxy).ok()?);
        }
    }
    let client = builder.build().ok()?;
    let response = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .ok()?;
    let header = response
        .headers()
        .get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|value| value.to_str().ok())?;
    // Content-Disposition: attachment; filename="QMaiWrite_4.3.10_windows_X64.exe"
    let marker = "filename=";
    let start = header.find(marker)? + marker.len();
    let rest = &header[start..];
    let name = rest.trim_matches('"').split(';').next()?.trim_matches('"');
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn temp_target_path() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("qmai-update");
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建临时目录失败：{error}"))?;
    Ok(dir.join(format!("QMaiWrite-update-{}.exe", uuid::Uuid::new_v4())))
}

/// 依次尝试各源把安装包下到临时文件，返回 `(路径, 实际使用的源标签)`。
pub fn download_from_sources<F>(
    sources: &[DownloadSource],
    proxy_url: Option<&str>,
    on_progress: F,
) -> Result<(PathBuf, String), String>
where
    F: Fn(u64, u64, &str) + Send + Sync + 'static,
{
    let target = temp_target_path()?;
    let mut reasons: Vec<String> = Vec::new();
    // 分段下载是多线程的，进度回调必须能跨线程共享；这里用 Mutex 包一层。
    let on_progress = std::sync::Arc::new(std::sync::Mutex::new(on_progress));

    for source in sources {
        let fetcher = match SegmentFetcher::new(&source.url, proxy_url) {
            Ok(fetcher) => fetcher,
            Err(error) => {
                reasons.push(format!("{}: {error}", source.label));
                continue;
            }
        };

        // 能分段就分段；服务端不支持就退回单连接（慢，但能下）。
        let segmented_ok = fetcher
            .probe()
            .map(|(_, supports_range)| supports_range)
            .unwrap_or(false);

        if segmented_ok {
            let label = source.label.clone();
            let progress = on_progress.clone();
            let result = fetcher.download_to_file(&target, move |done, total| {
                if let Ok(callback) = progress.lock() {
                    callback(done, total, &label);
                }
            });
            match result {
                Ok(_) => return Ok((target, source.label.clone())),
                Err(error) => reasons.push(format!("{}（分段）: {error}", source.label)),
            }
        } else {
            match crate::updater::segmented::plain_download(&source.url, proxy_url, &target) {
                Ok(_) => return Ok((target, source.label.clone())),
                Err(error) => reasons.push(format!("{}（单连接）: {error}", source.label)),
            }
        }
    }

    let _ = std::fs::remove_file(&target);
    Err(format!("所有下载源都失败了（{}）", reasons.join("；")))
}

/// 下载安装包到本地临时文件。前端拿返回的路径去调插件的 `install`。
#[tauri::command]
pub async fn updater_download_package<R: Runtime>(
    app: AppHandle<R>,
    release_url: String,
    version: String,
) -> Result<String, String> {
    let app_for_task = app.clone();
    let proxy = crate::commands::updater_channels::proxy_url_from_store_public();

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(PathBuf, String), String> {
        let table = ChannelTable::effective();
        let site_url = table
            .channels
            .iter()
            .find(|channel| channel.rewrite == Rewrite::Site)
            .and_then(|channel| channel.site_asset_url());
        // 只有官网通道存在时才去探文件名，避免无谓请求。
        let site_file_name = site_url
            .as_deref()
            .and_then(|url| probe_site_file_name(url, proxy.as_deref()));

        let sources = build_sources(&table, &release_url, &version, site_file_name.as_deref());
        log::warn!(
            "[updater] 下载候选源（{} 个）：{:?}",
            sources.len(),
            sources.iter().map(|item| item.label.clone()).collect::<Vec<_>>()
        );

        let emitter = app_for_task.clone();
        download_from_sources(&sources, proxy.as_deref(), move |downloaded, total, source| {
            let _ = emitter.emit(
                DOWNLOAD_PROGRESS_EVENT,
                DownloadProgress {
                    downloaded,
                    total,
                    source: source.to_string(),
                },
            );
        })
        .map(|(path, label)| {
            log::warn!("[updater] 下载完成：{label}");
            (path, label)
        })
    })
    .await
    .map_err(|error| format!("下载任务失败：{error}"))??;

    Ok(result.0.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_the_site_file_name() {
        assert_eq!(
            version_in_file_name("QMaiWrite_4.3.10_windows_X64.exe").as_deref(),
            Some("4.3.10")
        );
        assert_eq!(version_in_file_name("unrelated.exe"), None);
    }

    #[test]
    fn site_asset_only_matches_the_exact_version() {
        assert!(site_asset_matches_version(
            "QMaiWrite_4.3.10_windows_X64.exe",
            "4.3.10"
        ));
        // 官网还停在旧版：绝不能用它，否则用户装回旧版本。
        assert!(!site_asset_matches_version(
            "QMaiWrite_4.3.9_windows_X64.exe",
            "4.3.10"
        ));
        assert!(!site_asset_matches_version("garbage.exe", "4.3.10"));
    }

    #[test]
    fn site_source_first_when_version_matches() {
        let table = ChannelTable::builtin();
        let release = "https://github.com/O/R/releases/download/v1/app.exe";
        let sources = build_sources(&table, release, "4.3.10", Some("QMaiWrite_4.3.10_windows_X64.exe"));
        assert_eq!(sources[0].channel_id, "official-site");
        assert!(sources[0].url.starts_with("https://qmai.pro/"));
        // 直连必须在最后
        assert_eq!(sources.last().unwrap().channel_id, "direct");
    }

    #[test]
    fn site_source_is_skipped_when_version_is_stale() {
        let table = ChannelTable::builtin();
        let release = "https://github.com/O/R/releases/download/v1/app.exe";
        let sources = build_sources(&table, release, "4.3.10", Some("QMaiWrite_4.3.9_windows_X64.exe"));
        assert!(
            sources.iter().all(|item| item.channel_id != "official-site"),
            "官网版本过期时必须跳过"
        );
        assert!(!sources.is_empty(), "跳过官网后仍要有镜像可用");
    }

    #[test]
    fn sources_never_go_empty_even_without_site_name() {
        let table = ChannelTable::builtin();
        let release = "https://github.com/O/R/releases/download/v1/app.exe";
        let sources = build_sources(&table, release, "9.9.9", None);
        assert!(!sources.is_empty());
        assert!(sources.iter().any(|item| item.channel_id == "direct"));
    }
}
