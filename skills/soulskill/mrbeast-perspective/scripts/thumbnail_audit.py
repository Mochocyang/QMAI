#!/usr/bin/env python3
"""
thumbnail_audit.py - 基于MrBeast缩略图理论的检查清单脚本

检查维度（基于MrBeast公开分享的缩略图原则）：
  1. 标题与缩略图互补性：是否「互补而非重复」？
  2. 焦点数量：是否只有1-2个视觉焦点？
  3. 文字量：缩略图文字是否少于5个词？
  4. 情绪表达：是否有明确的面部表情/情绪？
  5. 颜色对比：颜色对比是否足够醒目？

如果提供了图片文件，会用PIL分析颜色分布和亮度对比。

用法:
  python thumbnail_audit.py --title "I Spent 50 Hours Buried Alive"
  python thumbnail_audit.py --title "..." --image thumbnail.jpg
  python thumbnail_audit.py --title "..." --image thumbnail.jpg -o report.md

依赖: Pillow（仅图片分析时需要，纯文本检查无依赖）
"""

import argparse
import sys
from pathlib import Path


# ---------- MrBeast缩略图原则 ----------

REDUNDANCY_WORDS = {
    # 如果标题中的关键词大量出现在缩略图文字中，说明重复而非互补
    "challenge", "survive", "hours", "days", "dollars", "money",
    "biggest", "world", "first", "last", "never", "impossible",
}

# 情绪相关词汇（用于标题分析）
EMOTION_WORDS = [
    "shocked", "scared", "amazed", "crying", "screaming", "laughing",
    "surprised", "angry", "terrified", "excited", "happy", "sad",
    "emotional", "insane", "crazy", "unbelievable", "incredible",
    # 中文
    "震惊", "害怕", "惊讶", "哭", "尖叫", "笑", "疯狂", "不敢相信",
]


def check_title_thumbnail_complementarity(title: str, thumb_text: str = "") -> dict:
    """检查标题与缩略图是否互补（而非重复）"""
    title_words = set(title.lower().split())
    thumb_words = set(thumb_text.lower().split()) if thumb_text else set()

    if not thumb_text:
        return {
            "score": 3,
            "max": 5,
            "note": "未提供缩略图文字，无法完整评估。建议：缩略图应补充标题没说的信息。",
        }

    overlap = title_words & thumb_words & REDUNDANCY_WORDS
    overlap_ratio = len(overlap) / max(len(thumb_words), 1)

    if overlap_ratio > 0.5:
        score = 1
        note = f"缩略图文字与标题高度重复（重复词: {', '.join(overlap)}）。MrBeast原则：缩略图应该补充标题，而不是重复标题。"
    elif overlap_ratio > 0.2:
        score = 3
        note = f"有部分重复（{', '.join(overlap)}），但还可以。考虑让缩略图传递标题没说的信息。"
    else:
        score = 5
        note = "标题与缩略图互补性好，各自传递不同信息。"

    return {"score": score, "max": 5, "note": note, "overlap": list(overlap)}


def check_text_amount(thumb_text: str = "") -> dict:
    """检查缩略图文字量"""
    if not thumb_text:
        return {
            "score": 4,
            "max": 5,
            "word_count": 0,
            "note": "未提供缩略图文字。MrBeast的缩略图通常文字极少（0-3词）或不用文字。",
        }

    word_count = len(thumb_text.split())
    if word_count == 0:
        score, note = 5, "无文字，干净利落。"
    elif word_count <= 3:
        score, note = 5, f"仅{word_count}词，符合MrBeast标准。"
    elif word_count <= 5:
        score, note = 3, f"{word_count}词，接近上限。考虑精简到3词以内。"
    else:
        score, note = 1, f"{word_count}词，太多了！MrBeast缩略图极少超过3-5个词。文字越少，点击率越高。"

    return {"score": score, "max": 5, "word_count": word_count, "note": note}


def check_emotion_in_title(title: str) -> dict:
    """检查标题是否暗示明确的情绪（间接评估缩略图情绪需求）"""
    title_lower = title.lower()
    found_emotions = [w for w in EMOTION_WORDS if w in title_lower]

    # 检查感叹号和问号
    has_exclamation = "!" in title or "？" in title or "!" in title
    has_question = "?" in title or "？" in title

    if found_emotions:
        score = 5
        note = f"标题有明确情绪暗示（{', '.join(found_emotions[:3])}）。缩略图应该用面部表情呼应这种情绪。"
    elif has_exclamation or has_question:
        score = 3
        note = "标题有情绪标点，但缺少明确情绪词。缩略图需要用面部表情补充情绪。"
    else:
        score = 2
        note = "标题情绪不明显。MrBeast原则：缩略图必须有一张表情夸张的人脸，或者明确的情绪视觉元素。"

    return {
        "score": score,
        "max": 5,
        "emotions_found": found_emotions,
        "note": note,
    }


def check_title_curiosity_gap(title: str) -> dict:
    """检查标题是否制造好奇心缺口"""
    curiosity_patterns = [
        ("数字对比", ["vs", "versus", "$", "比"]),
        ("悬念词", ["secret", "mystery", "hidden", "never", "impossible", "秘密", "不可能"]),
        ("挑战框架", ["challenge", "survive", "last", "endure", "挑战", "坚持"]),
        ("极端词", ["world", "biggest", "smallest", "most", "least", "最大", "最小", "最"]),
        ("时间压力", ["hours", "days", "minutes", "seconds", "小时", "天", "分钟"]),
    ]

    found = []
    title_lower = title.lower()
    for pattern_name, keywords in curiosity_patterns:
        if any(k in title_lower for k in keywords):
            found.append(pattern_name)

    if len(found) >= 3:
        score, note = 5, f"标题有{len(found)}个好奇心元素（{', '.join(found)}），非常强！"
    elif len(found) >= 2:
        score, note = 4, f"标题有{len(found)}个好奇心元素（{', '.join(found)}），不错。"
    elif len(found) == 1:
        score, note = 3, f"标题有1个好奇心元素（{found[0]}），可以更强。"
    else:
        score, note = 1, "标题缺少好奇心缺口。MrBeast标题通常至少包含2-3个好奇心元素。"

    return {"score": score, "max": 5, "patterns_found": found, "note": note}


def analyze_image(image_path: str) -> dict:
    """用PIL分析图片的颜色和对比度"""
    try:
        from PIL import Image, ImageStat
    except ImportError:
        return {
            "available": False,
            "note": "Pillow未安装，跳过图片分析。安装: pip install Pillow",
        }

    path = Path(image_path)
    if not path.exists():
        return {"available": False, "note": f"图片文件不存在: {image_path}"}

    try:
        img = Image.open(path)
    except Exception as e:
        return {"available": False, "note": f"无法打开图片: {e}"}

    # 转换为RGB
    if img.mode != "RGB":
        img = img.convert("RGB")

    stat = ImageStat.Stat(img)
    width, height = img.size

    # 平均亮度
    avg_brightness = sum(stat.mean) / 3

    # 亮度标准差（对比度指标）
    avg_stddev = sum(stat.stddev) / 3

    # 颜色饱和度分析
    hsv_img = img.convert("HSV")
    hsv_stat = ImageStat.Stat(hsv_img)
    avg_saturation = hsv_stat.mean[1]

    # 主色调分析（简化版：取中心区域和边缘区域对比）
    center_crop = img.crop((width // 4, height // 4, 3 * width // 4, 3 * height // 4))
    center_stat = ImageStat.Stat(center_crop)
    center_brightness = sum(center_stat.mean) / 3

    # 评估
    results = {
        "available": True,
        "size": f"{width}x{height}",
        "brightness": {
            "average": round(avg_brightness, 1),
            "score": 5 if 80 < avg_brightness < 200 else 3 if 50 < avg_brightness < 230 else 1,
            "note": "亮度适中" if 80 < avg_brightness < 200 else "偏暗或偏亮",
        },
        "contrast": {
            "stddev": round(avg_stddev, 1),
            "score": 5 if avg_stddev > 60 else 3 if avg_stddev > 40 else 1,
            "note": "对比度强" if avg_stddev > 60 else "对比度中等" if avg_stddev > 40 else "对比度不足，缩略图在小尺寸下可能不够醒目",
        },
        "saturation": {
            "average": round(avg_saturation, 1),
            "score": 5 if avg_saturation > 100 else 3 if avg_saturation > 60 else 2,
            "note": "色彩饱和度高" if avg_saturation > 100 else "色彩饱和度中等" if avg_saturation > 60 else "色彩偏淡，考虑增加饱和度",
        },
        "center_focus": {
            "center_brightness": round(center_brightness, 1),
            "edge_contrast": round(abs(center_brightness - avg_brightness), 1),
            "note": "中心区域与边缘有明显对比" if abs(center_brightness - avg_brightness) > 15 else "中心与边缘对比不明显，焦点可能不够突出",
        },
    }
    return results


def generate_report(title: str, thumb_text: str = "", image_path: str = None) -> str:
    """生成完整审核报告"""
    complementarity = check_title_thumbnail_complementarity(title, thumb_text)
    text_amount = check_text_amount(thumb_text)
    emotion = check_emotion_in_title(title)
    curiosity = check_title_curiosity_gap(title)

    image_analysis = analyze_image(image_path) if image_path else None

    # 计算总分
    scores = [complementarity["score"], text_amount["score"], emotion["score"], curiosity["score"]]
    if image_analysis and image_analysis.get("available"):
        scores.append(image_analysis["brightness"]["score"])
        scores.append(image_analysis["contrast"]["score"])
        scores.append(image_analysis["saturation"]["score"])

    total = sum(scores)
    max_total = len(scores) * 5

    lines = []
    lines.append("# 缩略图审核报告\n")
    lines.append(f"**标题**: {title}")
    if thumb_text:
        lines.append(f"**缩略图文字**: {thumb_text}")
    if image_path:
        lines.append(f"**图片**: {image_path}")
    lines.append(f"\n**总分**: {total}/{max_total} ({total/max_total*100:.0f}%)\n")

    # 评级
    pct = total / max_total * 100
    if pct >= 80:
        grade = "A - 优秀，点击率潜力高"
    elif pct >= 60:
        grade = "B - 良好，有优化空间"
    elif pct >= 40:
        grade = "C - 及格，需要重点改进"
    else:
        grade = "D - 需要重做"
    lines.append(f"**评级**: {grade}\n")

    # 各项检查
    lines.append("## 1. 标题-缩略图互补性 ({}/{})\n".format(complementarity["score"], complementarity["max"]))
    lines.append(complementarity["note"])
    lines.append("")

    lines.append("## 2. 缩略图文字量 ({}/{})\n".format(text_amount["score"], text_amount["max"]))
    lines.append(text_amount["note"])
    lines.append("")

    lines.append("## 3. 情绪表达 ({}/{})\n".format(emotion["score"], emotion["max"]))
    lines.append(emotion["note"])
    lines.append("")

    lines.append("## 4. 好奇心缺口 ({}/{})\n".format(curiosity["score"], curiosity["max"]))
    lines.append(curiosity["note"])
    lines.append("")

    # 图片分析
    if image_analysis:
        if image_analysis.get("available"):
            lines.append(f"## 5. 图片技术分析 (尺寸: {image_analysis['size']})\n")
            b = image_analysis["brightness"]
            c = image_analysis["contrast"]
            s = image_analysis["saturation"]
            cf = image_analysis["center_focus"]
            lines.append(f"- **亮度** ({b['score']}/5): 平均 {b['average']} - {b['note']}")
            lines.append(f"- **对比度** ({c['score']}/5): 标准差 {c['stddev']} - {c['note']}")
            lines.append(f"- **饱和度** ({s['score']}/5): 平均 {s['average']} - {s['note']}")
            lines.append(f"- **焦点**: 中心-边缘差 {cf['edge_contrast']} - {cf['note']}")
        else:
            lines.append(f"## 5. 图片分析\n")
            lines.append(f"跳过: {image_analysis['note']}")
        lines.append("")

    # MrBeast缩略图清单
    lines.append("## MrBeast缩略图黄金法则\n")
    lines.append("- [ ] 缩略图在手机小屏上是否清晰可辨？")
    lines.append("- [ ] 是否只有1-2个视觉焦点（不杂乱）？")
    lines.append("- [ ] 是否有一张情绪强烈的人脸？")
    lines.append("- [ ] 缩略图是否让人产生「我必须点进去看」的冲动？")
    lines.append("- [ ] 标题和缩略图组合是否创造了信息缺口？")
    lines.append("- [ ] 与同时段其他视频放在一起时是否够醒目？")
    lines.append("")

    # 改进建议
    lines.append("## 改进建议\n")
    suggestions = []
    if complementarity["score"] < 4:
        suggestions.append("让缩略图传递标题没说的信息（比如标题说挑战，缩略图展示结果或最戏剧性的瞬间）")
    if text_amount["score"] < 4:
        suggestions.append("减少缩略图文字，理想是0-3个词，用视觉而非文字讲故事")
    if emotion["score"] < 4:
        suggestions.append("缩略图加入表情夸张的人脸照片，情绪越强烈越好")
    if curiosity["score"] < 4:
        suggestions.append("标题加入数字/极端词/时间压力等好奇心元素")
    if image_analysis and image_analysis.get("available"):
        if image_analysis["contrast"]["score"] < 4:
            suggestions.append("提高图片对比度，确保缩略图在小尺寸下也清晰醒目")
        if image_analysis["saturation"]["score"] < 4:
            suggestions.append("增加色彩饱和度，让图片在YouTube首页中跳出来")

    if suggestions:
        for i, s in enumerate(suggestions, 1):
            lines.append(f"{i}. {s}")
    else:
        lines.append("整体表现优秀，继续保持！")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="基于MrBeast缩略图理论的审核工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='示例:\n  python thumbnail_audit.py --title "I Survived 50 Hours In Antarctica"\n  python thumbnail_audit.py --title "..." --thumb-text "50 HOURS" --image thumb.jpg',
    )
    parser.add_argument("--title", required=True, help="视频标题")
    parser.add_argument("--thumb-text", default="", help="缩略图上的文字（如果有）")
    parser.add_argument("--image", help="缩略图图片文件路径（可选）")
    parser.add_argument("-o", "--output", help="输出报告文件路径")
    args = parser.parse_args()

    report = generate_report(args.title, args.thumb_text, args.image)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"[OK] 报告已保存到: {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
