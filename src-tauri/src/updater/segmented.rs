//! 分段并发下载：把一个安装包拆成 8 段同时拉取，再按序拼回。
//!
//! 为什么需要它：实测国内单连接下载 GitHub 资产只有 58 KB/s（142.9 MB 要 42 分钟）。
//! 同一个地址换 8 条连接并发，总吞吐能到 0.6～2.7 MB/s（约 1～4 分钟）——
//! 服务器限的是**单连接**速度，不是总带宽，所以多连接可以叠加。
//!
//! 前提：服务端必须支持 `Range`（不支持时 `segmented_download` 会让调用方退回单连接）。
//! 实测 GitHub via Cloudflare 与 gh-proxy 都返回 `Accept-Ranges: bytes`。

use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// 并发段数。实测 8 段的总吞吐比 4 段好，再往上收益递减且更容易触发服务端限流。
pub const DEFAULT_SEGMENTS: usize = 8;
/// 每段最小字节数：太小会让段数爆炸、请求开销占比过高。
const MIN_SEGMENT_BYTES: u64 = 512 * 1024;
/// 单段读超时。整包下载是分段的，单段卡住就判这一段失败，不拖累整体。
const SEGMENT_TIMEOUT: Duration = Duration::from_secs(60);
/// 单段最多重试次数（网络抖动在国内是常态，一次就放弃太脆）。
const SEGMENT_RETRIES: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub index: usize,
    pub start: u64,
    /// 这一段要读多少字节（含首不含尾的区间长度）。
    pub len: u64,
}

/// 把 `total` 字节切成 `segments` 段。
///
/// 段数会被压到「每段至少 MIN_SEGMENT_BYTES」——小文件强行拆 8 段只会
/// 让请求开销盖过收益（例如 2 MB 的文件拆 8 段，每段才 256 KB）。
pub fn plan_segments(total: u64, wanted: usize) -> Vec<Segment> {
    if total == 0 {
        return Vec::new();
    }
    let max_useful = (total / MIN_SEGMENT_BYTES).max(1) as usize;
    let count = wanted.clamp(1, max_useful);
    let base = total / count as u64;
    let remainder = total % count as u64;

    let mut out = Vec::with_capacity(count);
    let mut start = 0u64;
    for index in 0..count {
        // 余数平摊到前几段，保证所有段加起来正好等于 total。
        let len = base + if (index as u64) < remainder { 1 } else { 0 };
        out.push(Segment { index, start, len });
        start += len;
    }
    out
}

pub struct SegmentFetcher {
    client: reqwest::blocking::Client,
    url: String,
    proxy_url: Option<String>,
}

impl SegmentFetcher {
    pub fn new(url: &str, proxy_url: Option<&str>) -> Result<Self, String> {
        let mut builder = reqwest::blocking::Client::builder()
            .timeout(SEGMENT_TIMEOUT)
            .connect_timeout(Duration::from_secs(8))
            .user_agent("QMaiWrite-Updater");
        if let Some(proxy) = proxy_url {
            if !proxy.trim().is_empty() {
                builder = builder.proxy(
                    reqwest::Proxy::all(proxy).map_err(|error| format!("代理地址无效：{error}"))?,
                );
            }
        }
        let client = builder
            .build()
            .map_err(|error| format!("创建下载客户端失败：{error}"))?;
        Ok(Self {
            client,
            url: url.to_string(),
            proxy_url: proxy_url.map(|value| value.to_string()),
        })
    }

    pub fn proxy_url(&self) -> Option<&str> {
        self.proxy_url.as_deref()
    }

    /// 探测远端：返回 `(总大小, 是否支持 Range)`。
    ///
    /// 用 GET + `Range: bytes=0-0` 而不是 HEAD：某些反代对 HEAD 直接 405，
    /// 但对 Range GET 是支持的；一次只读 1 字节，代价可以忽略。
    pub fn probe(&self) -> Result<(u64, bool), String> {
        let response = self
            .client
            .get(&self.url)
            .header(reqwest::header::RANGE, "bytes=0-0")
            .send()
            .map_err(|error| format!("探测下载地址失败：{error}"))?;

        let status = response.status().as_u16();
        if status == 206 {
            let total = response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                // Content-Range: bytes 0-0/149794348
                .and_then(|value| value.rsplit('/').next())
                .and_then(|total| total.trim().parse::<u64>().ok())
                .ok_or_else(|| "服务器没给出文件总大小".to_string())?;
            return Ok((total, true));
        }
        if (200..300).contains(&status) {
            let total = response
                .headers()
                .get(reqwest::header::CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.trim().parse::<u64>().ok())
                .unwrap_or(0);
            return Ok((total, false));
        }
        Err(format!("下载地址返回 HTTP {status}"))
    }

    /// 拉一段。失败按 SEGMENT_RETRIES 重试，仍失败才放弃这一段。
    fn fetch_segment(&self, segment: &Segment) -> Result<Vec<u8>, String> {
        let range = format!(
            "bytes={}-{}",
            segment.start,
            segment.start + segment.len - 1
        );
        let mut last_error = String::new();
        for attempt in 0..=SEGMENT_RETRIES {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(400 * attempt as u64));
            }
            match self
                .client
                .get(&self.url)
                .header(reqwest::header::RANGE, &range)
                .send()
            {
                Ok(response) => {
                    if response.status().as_u16() != 206 {
                        last_error = format!("第 {} 段：服务器不支持分段（HTTP {}）", segment.index, response.status().as_u16());
                        continue;
                    }
                    let mut buffer = Vec::with_capacity(segment.len as usize);
                    let mut handle = response;
                    match handle.read_to_end(&mut buffer) {
                        Ok(_) => {
                            if buffer.len() as u64 == segment.len {
                                return Ok(buffer);
                            }
                            last_error = format!(
                                "第 {} 段长度不符（期望 {}，实得 {}）",
                                segment.index,
                                segment.len,
                                buffer.len()
                            );
                        }
                        Err(error) => last_error = format!("第 {} 段读取失败：{error}", segment.index),
                    }
                }
                Err(error) => last_error = format!("第 {} 段请求失败：{error}", segment.index),
            }
        }
        Err(last_error)
    }

    /// 分段并发下载整个文件，按段序写入 `target`。
    ///
    /// `on_progress` 收到 `(已下载字节, 总字节)`；调用方据此更新界面。
    pub fn download_to_file<F>(&self, target: &Path, on_progress: F) -> Result<u64, String>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
    {
        let (total, ranges_ok) = self.probe()?;
        if !ranges_ok || total == 0 {
            return Err("服务器不支持分段下载".to_string());
        }

        let segments = plan_segments(total, DEFAULT_SEGMENTS);
        let progress = Arc::new(AtomicU64::new(0));
        let on_progress = Arc::new(on_progress);

        let mut handles = Vec::with_capacity(segments.len());
        for segment in segments {
            let range = format!(
                "bytes={}-{}",
                segment.start,
                segment.start + segment.len - 1
            );
            let mut builder = reqwest::blocking::Client::builder()
                .timeout(SEGMENT_TIMEOUT)
                .connect_timeout(Duration::from_secs(8))
                .user_agent("QMaiWrite-Updater");
            if let Some(proxy) = self.proxy_url() {
                if !proxy.trim().is_empty() {
                    builder = builder.proxy(
                        reqwest::Proxy::all(proxy).map_err(|error| format!("代理地址无效：{error}"))?,
                    );
                }
            }
            let client = builder
                .build()
                .map_err(|error| format!("创建下载客户端失败：{error}"))?;
            let url = self.url.clone();
            let progress = progress.clone();
            let on_progress = on_progress.clone();
            handles.push((segment.index, std::thread::spawn(move || -> Result<Vec<u8>, String> {
                let mut last_error = String::new();
                for attempt in 0..=SEGMENT_RETRIES {
                    if attempt > 0 {
                        std::thread::sleep(Duration::from_millis(400 * attempt as u64));
                    }
                    let response = match client
                        .get(&url)
                        .header(reqwest::header::RANGE, &range)
                        .send()
                    {
                        Ok(response) => response,
                        Err(error) => {
                            last_error = format!("第 {index} 段请求失败：{error}", index = segment.index);
                            continue;
                        }
                    };
                    if response.status().as_u16() != 206 {
                        last_error = format!(
                            "第 {index} 段服务器未返回分段内容（HTTP {status}）",
                            index = segment.index,
                            status = response.status().as_u16()
                        );
                        continue;
                    }
                    let mut buffer = Vec::with_capacity(segment.len as usize);
                    let mut handle = response;
                    let mut read_error = None;
                    let mut chunk = [0u8; 64 * 1024];
                    loop {
                        match handle.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(count) => {
                                buffer.extend_from_slice(&chunk[..count]);
                                let done = progress.fetch_add(count as u64, Ordering::SeqCst)
                                    + count as u64;
                                on_progress(done, total);
                            }
                            Err(error) => {
                                read_error = Some(format!(
                                    "第 {index} 段读取中断：{error}",
                                    index = segment.index
                                ));
                                break;
                            }
                        }
                    }
                    if let Some(error) = read_error {
                        last_error = error;
                        continue;
                    }
                    if buffer.len() as u64 != segment.len {
                        last_error = format!(
                            "第 {index} 段长度不符（期望 {want}，实得 {got}）",
                            index = segment.index,
                            want = segment.len,
                            got = buffer.len()
                        );
                        continue;
                    }
                    return Ok(buffer);
                }
                Err(last_error)
            })));
        }

        // 收段：任一失败就整体失败——装一个残缺的包比下载失败更糟。
        let mut collected: Vec<(usize, Vec<u8>)> = Vec::with_capacity(handles.len());
        for (index, handle) in handles {
            let joined = handle
                .join()
                .map_err(|_| format!("第 {index} 段线程异常退出"))?;
            match joined {
                Ok(bytes) => collected.push((index, bytes)),
                Err(error) => return Err(error),
            }
        }
        collected.sort_by_key(|(index, _)| *index);

        let mut file = std::fs::File::create(target)
            .map_err(|error| format!("创建临时文件失败：{error}"))?;
        for (_, bytes) in collected {
            file.write_all(&bytes)
                .map_err(|error| format!("写入临时文件失败：{error}"))?;
        }
        file.flush().map_err(|error| format!("落盘失败：{error}"))?;
        Ok(total)
    }
}

/// 单连接下载（分段不支持时的兜底）。
pub fn plain_download(url: &str, proxy_url: Option<&str>, target: &Path) -> Result<u64, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("QMaiWrite-Updater");
    if let Some(proxy) = proxy_url {
        if !proxy.trim().is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(proxy).map_err(|error| format!("代理地址无效：{error}"))?);
        }
    }
    let client = builder
        .build()
        .map_err(|error| format!("创建下载客户端失败：{error}"))?;
    let started = Instant::now();
    let mut response = client
        .get(url)
        .send()
        .map_err(|error| format!("下载失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("下载返回 HTTP {}", response.status().as_u16()));
    }
    let mut file = std::fs::File::create(target)
        .map_err(|error| format!("创建临时文件失败：{error}"))?;
    let mut total = 0u64;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        match response.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                file.write_all(&chunk[..count])
                    .map_err(|error| format!("写入失败：{error}"))?;
                total += count as u64;
            }
            Err(error) => {
                return Err(format!(
                    "下载中断（已收 {total} 字节，用时 {:?}）：{error}",
                    started.elapsed()
                ))
            }
        }
    }
    file.flush().map_err(|error| format!("落盘失败：{error}"))?;
    Ok(total)
}

/// 供测试与调用方使用：把文件按段重排（校验用）。
pub fn read_all_at(path: &Path, offset: u64, len: u64) -> std::io::Result<Vec<u8>> {
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0u8; len as usize];
    file.read_exact(&mut buffer)?;
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn segments_cover_the_whole_file_without_gaps() {
        let total = 149_794_348u64;
        let segments = plan_segments(total, 8);
        assert_eq!(segments.len(), 8);
        let mut expected_start = 0;
        for segment in &segments {
            assert_eq!(segment.start, expected_start, "段必须首尾相接");
            expected_start += segment.len;
        }
        assert_eq!(expected_start, total, "所有段加起来必须等于文件大小");
    }

    #[test]
    fn small_files_are_not_split_into_tiny_segments() {
        // 2 MB 拆 8 段每段才 256 KB，请求开销盖过收益 —— 应被压到 4 段（每段 >= 512KB）。
        let segments = plan_segments(2 * 1024 * 1024, 8);
        assert_eq!(segments.len(), 4);
        for segment in &segments {
            assert!(segment.len >= MIN_SEGMENT_BYTES);
        }
    }

    #[test]
    fn tiny_file_becomes_a_single_segment() {
        let segments = plan_segments(1024 * 1024, 8);
        assert_eq!(segments.len(), 2);
        let single = plan_segments(100, 8);
        assert_eq!(single.len(), 1);
        assert_eq!(single[0].len, 100);
    }

    #[test]
    fn zero_size_has_no_segments() {
        assert!(plan_segments(0, 8).is_empty());
    }

    #[test]
    fn remainder_is_spread_over_the_first_segments() {
        // 必须用足够大的文件才拆得开：每段下限 512KB，所以取 3MB 拆 3 段。
        // 3_000_000 / 3 = 1_000_000 整除；换成 3_000_001 就会有 1 字节余数，
        // 余数要摊到第一段，且总和必须精确等于原大小。
        let segments = plan_segments(3_000_001, 3);
        let total: u64 = segments.iter().map(|segment| segment.len).sum();
        assert_eq!(total, 3_000_001, "不能丢字节");
        assert_eq!(segments.len(), 3);
        assert_eq!(segments[0].len, 1_000_001, "余数摊在第一段");
    }

    #[test]
    fn a_hundred_bytes_is_a_single_segment_no_matter_how_many_we_want() {
        // 下限保护的直接体现：小文件拆段只会增加开销。
        assert_eq!(plan_segments(100, 8).len(), 1);
    }
}
