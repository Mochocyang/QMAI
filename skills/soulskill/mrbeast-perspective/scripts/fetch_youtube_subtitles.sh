#!/bin/bash
#
# fetch_youtube_subtitles.sh - 下载YouTube视频字幕
#
# 使用yt-dlp下载YouTube视频或频道的字幕文件（手动字幕优先，自动生成字幕兜底）
#
# 用法:
#   ./fetch_youtube_subtitles.sh <URL> [语言代码] [输出目录]
#
# 参数:
#   URL        - YouTube视频URL或频道URL（必需）
#   语言代码   - 字幕语言，默认 en（可选）
#   输出目录   - 字幕保存位置，默认当前目录（可选）
#
# 示例:
#   ./fetch_youtube_subtitles.sh "https://youtube.com/watch?v=xxx"
#   ./fetch_youtube_subtitles.sh "https://youtube.com/watch?v=xxx" zh-Hans ./subs
#   ./fetch_youtube_subtitles.sh "https://youtube.com/@MrBeast" en ./mrbeast_subs
#

set -euo pipefail

# ---------- 参数解析 ----------
URL="${1:-}"
LANG="${2:-en}"
OUTDIR="${3:-.}"

if [ -z "$URL" ]; then
    echo "用法: $0 <YouTube URL> [语言代码] [输出目录]"
    echo ""
    echo "示例:"
    echo "  $0 'https://youtube.com/watch?v=xxx'"
    echo "  $0 'https://youtube.com/watch?v=xxx' zh-Hans ./subs"
    echo "  $0 'https://youtube.com/@MrBeast' en ./mrbeast_subs"
    exit 1
fi

# ---------- 检查/安装 yt-dlp ----------
if ! command -v yt-dlp &> /dev/null; then
    echo "[INFO] yt-dlp 未安装，正在通过 pip 安装..."
    pip install -q yt-dlp
    if ! command -v yt-dlp &> /dev/null; then
        echo "[ERROR] yt-dlp 安装失败，请手动安装: pip install yt-dlp 或 brew install yt-dlp"
        exit 1
    fi
    echo "[INFO] yt-dlp 安装完成"
fi

# ---------- 创建输出目录 ----------
mkdir -p "$OUTDIR"

echo "========================================="
echo "  YouTube字幕下载器"
echo "========================================="
echo "URL:    $URL"
echo "语言:   $LANG"
echo "输出:   $OUTDIR"
echo ""

# ---------- 先列出可用字幕 ----------
echo "[INFO] 正在查询可用字幕..."
yt-dlp --list-subs --skip-download "$URL" 2>/dev/null | head -50 || true
echo ""

# ---------- 下载字幕 ----------
# 策略：先尝试手动字幕，失败后回退到自动生成字幕
echo "[INFO] 尝试下载手动字幕 (${LANG})..."
if yt-dlp \
    --write-sub \
    --sub-lang "$LANG" \
    --sub-format "srt/vtt/best" \
    --skip-download \
    --no-overwrites \
    -o "${OUTDIR}/%(title)s.%(ext)s" \
    "$URL" 2>/dev/null; then
    echo "[OK] 手动字幕下载成功"
else
    echo "[INFO] 无手动字幕，尝试下载自动生成字幕..."
    if yt-dlp \
        --write-auto-sub \
        --sub-lang "$LANG" \
        --sub-format "srt/vtt/best" \
        --skip-download \
        --no-overwrites \
        -o "${OUTDIR}/%(title)s.%(ext)s" \
        "$URL" 2>/dev/null; then
        echo "[OK] 自动生成字幕下载成功"
    else
        echo "[ERROR] 未找到任何 ${LANG} 字幕"
        echo "[提示] 尝试其他语言代码，或用 --list-subs 查看可用字幕"
        exit 1
    fi
fi

echo ""
echo "[INFO] 下载的字幕文件:"
find "$OUTDIR" -maxdepth 1 \( -name "*.srt" -o -name "*.vtt" \) -newer "$0" 2>/dev/null | head -20 || \
    ls -la "$OUTDIR"/*.{srt,vtt} 2>/dev/null || echo "  (无新文件)"

echo ""
echo "完成!"
