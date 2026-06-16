#!/usr/bin/env python3
"""
retention_curve_checker.py - 基于MrBeast方法论的视频脚本retention检查器

检查维度（基于MrBeast公开分享的retention理论）：
  1. 前30秒hook：是否有明确的hook抓住观众？
  2. Re-engagement moments：每3-5分钟是否有升级/转折？
  3. 结尾CTA/悬念：结尾是否有行动号召或悬念？
  4. Boring parts：是否有长段落无动作的「死区」？
  5. 递进结构：内容是否持续升级（MrBeast的核心理念）

用法:
  python retention_curve_checker.py script.txt
  python retention_curve_checker.py script.txt -o report.md
  python retention_curve_checker.py script.txt --duration 15

输入格式: 纯文本脚本文件
"""

import argparse
import re
import sys
from pathlib import Path


# ---------- 常量 ----------

# 平均语速（中文约250字/分钟，英文约150词/分钟）
WORDS_PER_MINUTE_EN = 150
CHARS_PER_MINUTE_ZH = 250

# Hook检查的关键词/模式
HOOK_PATTERNS = [
    r"\b(today|right now|in this video|let me show|watch what happens)\b",
    r"\b(challenge|bet|dare|surprise|secret|reveal|biggest|craziest)\b",
    r"\$[\d,]+",
    r"\b\d+\s*(hours?|days?|people|dollars)\b",
    r"[!?]{1,}",
    # 中文hook
    r"(今天|现在|接下来|你绝对|不敢相信|挑战|赌|秘密|最大的|最疯狂的)",
]

# Re-engagement信号词
REENGAGEMENT_PATTERNS = [
    r"\b(but wait|it gets (better|worse|crazier)|plot twist|here'?s where)\b",
    r"\b(next|now|then|suddenly|finally|the (biggest|craziest|best) part)\b",
    r"\b(level \d|round \d|phase \d|stage \d|part \d)\b",
    r"\b(upgrade|double|triple|10x|100x|even more|even bigger)\b",
    # 中文
    r"(但是等等|更疯狂的是|转折来了|接下来|突然|最关键的|升级|加倍|翻倍)",
    r"(第[一二三四五六七八九十\d]+[轮关回])",
]

# CTA和悬念模式
CTA_PATTERNS = [
    r"\b(subscribe|like|comment|share|click|next video|see you)\b",
    r"\b(what do you think|let me know|tell me)\b",
    r"\b(next time|coming soon|stay tuned|part \d|to be continued)\b",
    # 中文
    r"(关注|点赞|评论|分享|下期|下次|下一个视频|你觉得呢|告诉我|敬请期待)",
]

# Boring part检测：连续长段落无动作词
ACTION_WORDS = [
    r"\b(explode|run|jump|scream|crash|build|destroy|open|reveal|surprise)\b",
    r"\b(win|lose|fail|succeed|break|smash|launch|drop|fly|race)\b",
    r"[!?]",
    r"\$[\d,]+",
    # 中文
    r"(爆炸|跑|跳|尖叫|建造|打开|揭晓|惊喜|赢|输|失败|打破|发射)",
]


def detect_language(text: str) -> str:
    """简单检测文本主要语言"""
    zh_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
    en_words = len(re.findall(r"[a-zA-Z]+", text))
    return "zh" if zh_chars > en_words else "en"


def estimate_duration(text: str, lang: str) -> float:
    """估算脚本时长（分钟）"""
    if lang == "zh":
        char_count = len(re.findall(r"[\u4e00-\u9fff]", text))
        return char_count / CHARS_PER_MINUTE_ZH
    else:
        word_count = len(text.split())
        return word_count / WORDS_PER_MINUTE_EN


def split_into_segments(text: str, segment_minutes: float, lang: str) -> list[str]:
    """将脚本按时长切成段落"""
    lines = text.splitlines()
    if lang == "zh":
        chars_per_seg = int(CHARS_PER_MINUTE_ZH * segment_minutes)
        segments = []
        current = []
        current_len = 0
        for line in lines:
            line_len = len(re.findall(r"[\u4e00-\u9fff]", line))
            if current_len + line_len > chars_per_seg and current:
                segments.append("\n".join(current))
                current = [line]
                current_len = line_len
            else:
                current.append(line)
                current_len += line_len
        if current:
            segments.append("\n".join(current))
        return segments
    else:
        words_per_seg = int(WORDS_PER_MINUTE_EN * segment_minutes)
        segments = []
        current = []
        current_len = 0
        for line in lines:
            line_len = len(line.split())
            if current_len + line_len > words_per_seg and current:
                segments.append("\n".join(current))
                current = [line]
                current_len = line_len
            else:
                current.append(line)
                current_len += line_len
        if current:
            segments.append("\n".join(current))
        return segments


def check_hook(text: str, first_n_chars: int = 500) -> dict:
    """检查前30秒是否有hook"""
    opening = text[:first_n_chars]
    matches = []
    for pattern in HOOK_PATTERNS:
        found = re.findall(pattern, opening, re.IGNORECASE)
        if found:
            matches.extend(found)
    score = min(len(matches), 5)  # 0-5分
    return {
        "score": score,
        "max": 5,
        "matches": matches[:5],
        "opening_preview": opening[:200].replace("\n", " "),
    }


def check_reengagement(segments: list[str]) -> dict:
    """检查每个段落是否有re-engagement moment"""
    results = []
    for i, seg in enumerate(segments):
        matches = []
        for pattern in REENGAGEMENT_PATTERNS:
            found = re.findall(pattern, seg, re.IGNORECASE)
            if found:
                matches.extend(found)
        results.append({
            "segment": i + 1,
            "has_reengagement": len(matches) > 0,
            "matches": matches[:3],
        })
    segments_with = sum(1 for r in results if r["has_reengagement"])
    total = len(results)
    score = round(segments_with / total * 5) if total > 0 else 0
    return {
        "score": score,
        "max": 5,
        "segments_with": segments_with,
        "total_segments": total,
        "details": results,
    }


def check_ending(text: str, last_n_chars: int = 500) -> dict:
    """检查结尾是否有CTA或悬念"""
    ending = text[-last_n_chars:]
    matches = []
    for pattern in CTA_PATTERNS:
        found = re.findall(pattern, ending, re.IGNORECASE)
        if found:
            matches.extend(found)
    score = min(len(matches), 5)
    return {
        "score": score,
        "max": 5,
        "matches": matches[:5],
        "ending_preview": ending[-200:].replace("\n", " "),
    }


def check_boring_parts(segments: list[str]) -> dict:
    """检查是否有无动作的「死区」"""
    boring_segments = []
    for i, seg in enumerate(segments):
        action_count = 0
        for pattern in ACTION_WORDS:
            action_count += len(re.findall(pattern, seg, re.IGNORECASE))
        # 一个段落如果动作词密度太低就标记
        word_count = max(len(seg.split()), 1)
        density = action_count / word_count * 100
        if density < 0.5:  # 低于0.5%动作词密度
            boring_segments.append({
                "segment": i + 1,
                "preview": seg[:100].replace("\n", " ") + "...",
                "action_density": round(density, 2),
            })
    # 没有boring段落得5分，每有一个扣1分
    score = max(0, 5 - len(boring_segments))
    return {
        "score": score,
        "max": 5,
        "boring_count": len(boring_segments),
        "details": boring_segments,
    }


def check_escalation(segments: list[str]) -> dict:
    """检查内容是否持续升级（MrBeast核心理念：每一分钟都要比上一分钟更精彩）"""
    escalation_words = [
        r"\b(more|bigger|better|crazier|harder|faster|extreme|ultimate|final)\b",
        r"\b(upgrade|level up|raise|increase|double|triple|max|peak)\b",
        r"(更大|更好|更疯狂|更难|升级|加码|翻倍|终极|最终)",
    ]
    scores_per_seg = []
    for seg in segments:
        count = 0
        for pattern in escalation_words:
            count += len(re.findall(pattern, seg, re.IGNORECASE))
        scores_per_seg.append(count)

    # 理想情况：后半部分的升级词应该多于前半部分
    if len(scores_per_seg) >= 2:
        mid = len(scores_per_seg) // 2
        first_half = sum(scores_per_seg[:mid])
        second_half = sum(scores_per_seg[mid:])
        is_escalating = second_half >= first_half
    else:
        is_escalating = True

    total_escalation = sum(scores_per_seg)
    score = min(total_escalation, 3) + (2 if is_escalating else 0)
    return {
        "score": min(score, 5),
        "max": 5,
        "is_escalating": is_escalating,
        "escalation_per_segment": scores_per_seg,
    }


def generate_report(filepath: str, text: str, duration_override: float = None) -> str:
    """生成完整检查报告"""
    lang = detect_language(text)
    duration = duration_override or estimate_duration(text, lang)
    segments = split_into_segments(text, 3.0, lang)  # 每3分钟一段

    hook = check_hook(text)
    reengagement = check_reengagement(segments)
    ending = check_ending(text)
    boring = check_boring_parts(segments)
    escalation = check_escalation(segments)

    total_score = hook["score"] + reengagement["score"] + ending["score"] + boring["score"] + escalation["score"]
    max_score = 25

    lines = []
    lines.append("# Retention检查报告\n")
    lines.append(f"**文件**: {filepath}")
    lines.append(f"**语言**: {'中文' if lang == 'zh' else '英文'}")
    lines.append(f"**预估时长**: {duration:.1f} 分钟")
    lines.append(f"**分段数**: {len(segments)} 段（每3分钟）")
    lines.append(f"**总分**: {total_score}/{max_score}\n")

    # 评级
    if total_score >= 20:
        grade = "A - 优秀，retention结构扎实"
    elif total_score >= 15:
        grade = "B - 良好，有改进空间"
    elif total_score >= 10:
        grade = "C - 及格，需要重点优化"
    else:
        grade = "D - 需要大幅改写"
    lines.append(f"**评级**: {grade}\n")

    # 1. Hook检查
    lines.append("## 1. 前30秒Hook ({}/{})\n".format(hook["score"], hook["max"]))
    if hook["score"] >= 3:
        lines.append("开头有明确的hook元素。")
    elif hook["score"] >= 1:
        lines.append("开头有部分hook，但力度不够。")
    else:
        lines.append("**警告**: 开头缺少hook，观众可能在前10秒流失。")
    if hook["matches"]:
        lines.append(f"\n检测到的hook元素: {', '.join(str(m) for m in hook['matches'][:5])}")
    lines.append(f"\n> 开头预览: {hook['opening_preview']}")
    lines.append("")
    lines.append("**MrBeast原则**: 前30秒必须让观众知道「这个视频值得看完」。要么展示最终成果的预告，要么直接抛出不可抗拒的悬念。\n")

    # 2. Re-engagement
    lines.append("## 2. Re-engagement Moments ({}/{})\n".format(reengagement["score"], reengagement["max"]))
    lines.append(f"在 {reengagement['total_segments']} 个段落中，{reengagement['segments_with']} 个有re-engagement信号。\n")
    for detail in reengagement["details"]:
        status = "有" if detail["has_reengagement"] else "**缺失**"
        lines.append(f"- 段落 {detail['segment']}: {status}")
        if detail["matches"]:
            lines.append(f"  信号词: {', '.join(str(m) for m in detail['matches'])}")
    lines.append("")
    lines.append("**MrBeast原则**: 每3-5分钟必须有一个「重新抓住观众」的时刻。可以是新的挑战升级、意外转折、或者stakes提高。\n")

    # 3. 结尾
    lines.append("## 3. 结尾CTA/悬念 ({}/{})\n".format(ending["score"], ending["max"]))
    if ending["score"] >= 3:
        lines.append("结尾有明确的CTA或悬念。")
    elif ending["score"] >= 1:
        lines.append("结尾有部分CTA元素，可以更强。")
    else:
        lines.append("**警告**: 结尾平淡，缺少行动号召或下期预告。")
    lines.append(f"\n> 结尾预览: ...{ending['ending_preview']}")
    lines.append("")

    # 4. Boring Parts
    lines.append("## 4. Boring Parts检测 ({}/{})\n".format(boring["score"], boring["max"]))
    if boring["boring_count"] == 0:
        lines.append("未检测到明显的「死区」段落。")
    else:
        lines.append(f"检测到 **{boring['boring_count']}** 个低动作密度段落:\n")
        for b in boring["details"]:
            lines.append(f"- 段落 {b['segment']} (动作密度: {b['action_density']}%): {b['preview']}")
    lines.append("")
    lines.append("**MrBeast原则**: 「If it's boring, cut it.」没有动作、没有张力的段落就是观众点走的时刻。\n")

    # 5. 递进结构
    lines.append("## 5. 递进结构 ({}/{})\n".format(escalation["score"], escalation["max"]))
    if escalation["is_escalating"]:
        lines.append("内容呈现递进趋势，后半段升级词多于前半段。")
    else:
        lines.append("**警告**: 后半段的升级感不如前半段，可能导致观众中途流失。")
    lines.append(f"\n各段落升级词数量: {escalation['escalation_per_segment']}")
    lines.append("")
    lines.append("**MrBeast原则**: 视频的每一分钟都应该比上一分钟更精彩。观众的期望在持续上升，内容必须跟上。\n")

    # 改进建议
    lines.append("## 改进建议\n")
    if hook["score"] < 3:
        lines.append("1. **强化开头**: 考虑用「结果前置」策略，在前5秒展示视频最震撼的画面，然后回到起点讲故事。")
    if reengagement["segments_with"] < reengagement["total_segments"] * 0.6:
        missing = [d["segment"] for d in reengagement["details"] if not d["has_reengagement"]]
        lines.append(f"2. **补充转折点**: 段落 {missing} 缺少re-engagement，考虑加入新挑战、意外事件或stakes升级。")
    if ending["score"] < 3:
        lines.append("3. **强化结尾**: 加入明确的CTA（关注/点赞）或下期预告，让观众有理由回来。")
    if boring["boring_count"] > 0:
        lines.append(f"4. **删减死区**: {boring['boring_count']}个段落动作密度过低，考虑压缩或加入视觉/动作元素。")
    if not escalation["is_escalating"]:
        lines.append("5. **重排结构**: 把最精彩的内容放在后半段，确保观众感受到持续升级。")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="基于MrBeast方法论的视频脚本retention检查器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  python retention_curve_checker.py script.txt\n  python retention_curve_checker.py script.txt --duration 15 -o report.md",
    )
    parser.add_argument("input", help="视频脚本文本文件")
    parser.add_argument("-o", "--output", help="输出报告文件路径")
    parser.add_argument("--duration", type=float, help="手动指定视频时长（分钟），覆盖自动估算")
    args = parser.parse_args()

    path = Path(args.input)
    if not path.exists():
        print(f"[ERROR] 文件不存在: {args.input}", file=sys.stderr)
        sys.exit(1)

    text = path.read_text(encoding="utf-8")
    if not text.strip():
        print(f"[ERROR] 文件为空: {args.input}", file=sys.stderr)
        sys.exit(1)

    report = generate_report(args.input, text, args.duration)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"[OK] 报告已保存到: {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
