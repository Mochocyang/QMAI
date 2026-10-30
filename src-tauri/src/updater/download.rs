//! 按通道顺序下载。第一个成功的通道胜出，其余不再尝试。

use std::io::Read;
use std::time::Duration;

/// 单个通道的下载超时。超过就判定该通道不可用，继续下一条件。
///
/// 没有超时的话，一条"能连上但永远不返回"的通道会把整个更新流程挂死，
/// 而兜底设计的意义恰恰是"坏掉一条就换下一条"。
const CHANNEL_TIMEOUT: Duration = Duration::from_secs(20);

/// 一次下载最多接受的字节数（256 MiB）。
///
/// 更新包远小于这个量级；设上限是为了挡住"看起来在下载、实际永不结束"的
/// 响应，否则超时会在数据源源不断时被不断续期。
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// 一个通道对本次下载的"可用形态"。
///
/// `manifest_url` 为 `None` 表示这个通道**不支持当前文件类型**
/// （jsDelivr 之于 release 资产）。这种通道在下载阶段直接跳过 ——
/// 它不是"坏了"，而是"不具备该能力"，两者不该混在同一个错误里。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelAttempt {
    pub channel_id: String,
    pub label: String,
    pub manifest_url: Option<String>,
}

/// 依序尝试下载，返回 `(数据, 命中的通道 id)`。
///
/// 失败原因全部收集进最终错误里：用户报障时能直接看出"是哪几条通道坏了、为什么"。
pub fn download_with_fallback<F>(
    attempts: Vec<ChannelAttempt>,
    mut fetch: F,
) -> Result<(Vec<u8>, String), String>
where
    F: FnMut(&ChannelAttempt) -> Result<Vec<u8>, String>,
{
    let mut reasons: Vec<String> = Vec::new();
    for attempt in attempts {
        if attempt.manifest_url.is_none() {
            continue;
        }
        match fetch(&attempt) {
            Ok(bytes) => return Ok((bytes, attempt.channel_id)),
            Err(reason) => reasons.push(format!("{}: {reason}", attempt.label)),
        }
    }
    if reasons.is_empty() {
        return Err("没有可用的下载通道".to_string());
    }
    Err(format!("全部通道都失败了（{}）", reasons.join("；")))
}

/// 用真实 HTTP 拉一个文件，供 `download_with_fallback` 的 `fetch` 闭包使用。
///
/// 为什么要显式构造客户端：`tauri-plugin-updater` 只把代理写进环境变量，
/// 而 app 内的代理也可能是在启动后才切换的，所以这里每条件都自己建客户端、
/// 由调用方把 `proxy_url`（`proxy::current_proxy_url` 的结果）传进来，
/// 保证"用户开了代理，更新就真的走代理"。
pub fn fetch_url(
    url: &str,
    proxy_url: Option<&str>,
    expected_len: Option<usize>,
) -> Result<Vec<u8>, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(CHANNEL_TIMEOUT)
        .connect_timeout(Duration::from_secs(8));
    if let Some(proxy) = proxy_url {
        let proxy = reqwest::Proxy::all(proxy).map_err(|e| format!("代理地址无效: {e}"))?;
        builder = builder.proxy(proxy);
    }
    let client = builder.build().map_err(|e| format!("创建请求失败: {e}"))?;

    // 响应体本身不需要可变绑定：`Read::take` 会按值接管它，
    // 再在 `read_to_end` 里消费。多余的 `mut` 会报 unused_mut。
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }

    // 先按 Content-Length 预分配，避免大文件反复扩容；但只当作提示值，
    // 真正的长度上限由 take() 兜底。
    let hint = expected_len
        .or_else(|| response.content_length().map(|n| n as usize))
        .unwrap_or(0);
    let mut data = Vec::with_capacity(hint.min(MAX_DOWNLOAD_BYTES as usize));
    response
        .take(MAX_DOWNLOAD_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|e| format!("读取数据失败: {e}"))?;
    if data.len() as u64 > MAX_DOWNLOAD_BYTES {
        return Err(format!("文件超过上限（{} MiB）", MAX_DOWNLOAD_BYTES / 1024 / 1024));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attempt(id: &str) -> ChannelAttempt {
        ChannelAttempt {
            channel_id: id.to_string(),
            label: id.to_string(),
            manifest_url: Some(format!("https://{id}/latest.json")),
        }
    }

    #[test]
    fn first_channel_wins_when_it_works() {
        let mut tried: Vec<String> = Vec::new();
        let result = download_with_fallback(vec![attempt("a"), attempt("b")], |channel| {
            tried.push(channel.channel_id.clone());
            if channel.channel_id == "a" {
                Ok(vec![1, 2, 3])
            } else {
                Err("should not reach".to_string())
            }
        });
        assert_eq!(result, Ok((vec![1, 2, 3], "a".to_string())));
        assert_eq!(tried, vec!["a".to_string()], "成功后不该再试下一条");
    }

    #[test]
    fn falls_back_to_the_next_channel() {
        let result = download_with_fallback(vec![attempt("a"), attempt("b")], |channel| {
            if channel.channel_id == "a" {
                Err("connect reset".to_string())
            } else {
                Ok(vec![9])
            }
        });
        assert_eq!(result, Ok((vec![9], "b".to_string())));
    }

    #[test]
    fn all_channels_failing_reports_every_reason() {
        let result = download_with_fallback(vec![attempt("a"), attempt("b")], |channel| {
            Err(format!("{} down", channel.channel_id))
        });
        let error = result.unwrap_err();
        assert!(error.contains("a down"), "要保留第一条的原因");
        assert!(error.contains("b down"), "也要保留第二条的原因");
    }

    #[test]
    fn channels_without_a_url_for_this_file_are_skipped_not_failed() {
        // jsDelivr 代理不了 release 资产，manifest_url 为 None。
        // 它不算"失败"，只是"不具备该能力"，所以最终错误里不该出现它。
        let skipped = ChannelAttempt {
            channel_id: "jsdelivr".to_string(),
            label: "jsdelivr".to_string(),
            manifest_url: None,
        };
        let result = download_with_fallback(vec![skipped, attempt("b")], |_channel| Ok(vec![7]));
        assert_eq!(result, Ok((vec![7], "b".to_string())));
    }

    #[test]
    fn nothing_attemptable_reports_a_clear_error() {
        let skipped = ChannelAttempt {
            channel_id: "jsdelivr".to_string(),
            label: "jsdelivr".to_string(),
            manifest_url: None,
        };
        let error = download_with_fallback(vec![skipped], |_channel| Ok(vec![0])).unwrap_err();
        assert!(error.contains("没有可用的下载通道"));
    }
}
