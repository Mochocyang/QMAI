#!/usr/bin/env python3
"""
analyze_titles.py - 分析YouTube频道视频标题模式

分析维度：
  - 标题长度分布
  - 数字使用频率与类型
  - 高频词汇（去除停用词）
  - 标题公式分类（挑战型/数字型/悬念型/对比型/情感型）
  - 标点符号与大写模式

用法:
  python analyze_titles.py titles.txt
  python analyze_titles.py titles.txt -o report.md
  python analyze_titles.py titles.txt --top 30

输入格式: 纯文本文件，每行一个标题
输出格式: Markdown分析报告
"""

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

# 英文停用词（轻量级，不依赖nltk）
STOP_WORDS = {
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
    "her", "it", "its", "they", "them", "their", "a", "an", "the", "and",
    "but", "or", "for", "nor", "on", "at", "to", "from", "by", "in", "of",
    "with", "is", "am", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "do", "does", "did", "will", "would", "shall", "should",
    "may", "might", "must", "can", "could", "not", "no", "so", "if", "then",
    "than", "that", "this", "these", "those", "what", "which", "who", "whom",
    "how", "when", "where", "why", "all", "each", "every", "both", "few",
    "more", "most", "other", "some", "such", "only", "same", "too", "very",
    "just", "about", "above", "after", "again", "also", "any", "because",
    "before", "between", "during", "into", "through", "up", "down", "out",
    "over", "under", "here", "there", "now", "get", "got", "go", "going",
    "went", "make", "made", "like", "even", "still", "back", "us",
}

# 标题公式分类的关键词/模式
TITLE_PATTERNS = {
    "挑战型": [
        r"\b(challenge|survive|last|endure|spent|living|tried|attempt)\b",
        r"\b(\d+)\s*(hours?|days?|minutes?)\b",
        r"\bi\s+(survived|built|made|ate|bought|opened|spent)\b",
    ],
    "数字型": [
        r"^\$[\d,]+",
        r"\$[\d,]+\s+vs\.?\s+\$[\d,]+",
        r"\b\d{2,}\b",
        r"\b(100|1000|10000|million|billion)\b",
    ],
    "悬念型": [
        r"\.\.\.",
        r"\?$",
        r"\b(mystery|secret|hidden|never|impossible|insane|unbelievable)\b",
        r"\b(what happens|you won't believe|no one|nobody)\b",
    ],
    "对比型": [
        r"\bvs\.?\b",
        r"\bversus\b",
        r"\$[\d,]+\s+vs\.?\s+\$[\d,]+",
        r"\b(cheap|expensive|worst|best|biggest|smallest)\b.*\bvs\.?\b",
        r"\b(world'?s?\s+(largest|smallest|most|least|biggest|cheapest))\b",
    ],
    "情感型": [
        r"\b(emotional|crying|tears|heartwarming|giving|donated|surprise)\b",
        r"!{2,}",
        r"\b(amazing|incredible|insane|crazy|epic|extreme)\b",
    ],
}


def load_titles(filepath: str) -> list[str]:
    """从文本文件加载标题，每行一个"""
    path = Path(filepath)
    if not path.exists():
        print(f"[ERROR] 文件不存在: {filepath}", file=sys.stderr)
        sys.exit(1)
    titles = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not titles:
        print(f"[ERROR] 文件为空: {filepath}", file=sys.stderr)
        sys.exit(1)
    return titles


def analyze_length(titles: list[str]) -> dict:
    """分析标题长度分布"""
    lengths = [len(t) for t in titles]
    word_counts = [len(t.split()) for t in titles]
    return {
        "char_avg": sum(lengths) / len(lengths),
        "char_min": min(lengths),
        "char_max": max(lengths),
        "char_median": sorted(lengths)[len(lengths) // 2],
        "word_avg": sum(word_counts) / len(word_counts),
        "word_min": min(word_counts),
        "word_max": max(word_counts),
        "brackets": [
            sum(1 for l in lengths if l <= 30),
            sum(1 for l in lengths if 30 < l <= 50),
            sum(1 for l in lengths if 50 < l <= 70),
            sum(1 for l in lengths if l > 70),
        ],
    }


def analyze_numbers(titles: list[str]) -> dict:
    """分析数字使用情况"""
    has_number = [t for t in titles if re.search(r"\d", t)]
    has_dollar = [t for t in titles if "$" in t]
    numbers_found = []
    for t in titles:
        numbers_found.extend(int(n.replace(",", "")) for n in re.findall(r"[\d,]+", t) if n.replace(",", "").isdigit())
    return {
        "with_number_pct": len(has_number) / len(titles) * 100,
        "with_dollar_pct": len(has_dollar) / len(titles) * 100,
        "common_numbers": Counter(numbers_found).most_common(10),
    }


def analyze_words(titles: list[str], top_n: int = 20) -> list[tuple[str, int]]:
    """提取高频词汇（去除停用词）"""
    words = []
    for t in titles:
        tokens = re.findall(r"[a-zA-Z]+", t.lower())
        words.extend(w for w in tokens if w not in STOP_WORDS and len(w) > 1)
    return Counter(words).most_common(top_n)


def classify_titles(titles: list[str]) -> dict[str, list[str]]:
    """按标题公式分类"""
    results = {cat: [] for cat in TITLE_PATTERNS}
    for t in titles:
        for cat, patterns in TITLE_PATTERNS.items():
            if any(re.search(p, t, re.IGNORECASE) for p in patterns):
                results[cat].append(t)
                break  # 每个标题只归入第一个匹配的类别
    results["其他"] = [
        t for t in titles
        if not any(t in v for v in results.values())
    ]
    return results


def analyze_punctuation(titles: list[str]) -> dict:
    """分析标点和大写模式"""
    return {
        "ends_exclamation": sum(1 for t in titles if t.endswith("!")),
        "ends_question": sum(1 for t in titles if t.endswith("?")),
        "ends_ellipsis": sum(1 for t in titles if t.endswith("...")),
        "has_all_caps_word": sum(1 for t in titles if re.search(r"\b[A-Z]{2,}\b", t)),
        "has_emoji": sum(1 for t in titles if re.search(r"[\U0001F600-\U0001F9FF]", t)),
    }


def generate_report(titles: list[str], top_n: int) -> str:
    """生成Markdown分析报告"""
    total = len(titles)
    length_stats = analyze_length(titles)
    number_stats = analyze_numbers(titles)
    top_words = analyze_words(titles, top_n)
    categories = classify_titles(titles)
    punct_stats = analyze_punctuation(titles)

    lines = []
    lines.append(f"# YouTube标题分析报告\n")
    lines.append(f"共分析 **{total}** 个标题\n")

    # 长度分布
    lines.append("## 1. 标题长度分布\n")
    lines.append("| 指标 | 字符数 | 词数 |")
    lines.append("|------|--------|------|")
    lines.append(f"| 平均 | {length_stats['char_avg']:.1f} | {length_stats['word_avg']:.1f} |")
    lines.append(f"| 最短 | {length_stats['char_min']} | {length_stats['word_min']} |")
    lines.append(f"| 最长 | {length_stats['char_max']} | {length_stats['word_max']} |")
    lines.append(f"| 中位数 | {length_stats['char_median']} | - |")
    lines.append("")
    b = length_stats["brackets"]
    lines.append(f"- 30字符以内: {b[0]} ({b[0]/total*100:.1f}%)")
    lines.append(f"- 31-50字符: {b[1]} ({b[1]/total*100:.1f}%)")
    lines.append(f"- 51-70字符: {b[2]} ({b[2]/total*100:.1f}%)")
    lines.append(f"- 70字符以上: {b[3]} ({b[3]/total*100:.1f}%)")
    lines.append("")

    # 数字使用
    lines.append("## 2. 数字使用\n")
    lines.append(f"- 含数字的标题: {number_stats['with_number_pct']:.1f}%")
    lines.append(f"- 含$金额的标题: {number_stats['with_dollar_pct']:.1f}%")
    if number_stats["common_numbers"]:
        lines.append("\n常见数字:")
        for num, count in number_stats["common_numbers"]:
            lines.append(f"  - {num:,}: 出现 {count} 次")
    lines.append("")

    # 高频词汇
    lines.append(f"## 3. 高频词汇 (Top {top_n})\n")
    lines.append("| 排名 | 词汇 | 出现次数 |")
    lines.append("|------|------|----------|")
    for i, (word, count) in enumerate(top_words, 1):
        lines.append(f"| {i} | {word} | {count} |")
    lines.append("")

    # 标题公式分类
    lines.append("## 4. 标题公式分类\n")
    lines.append("| 类型 | 数量 | 占比 | 示例 |")
    lines.append("|------|------|------|------|")
    for cat in ["挑战型", "数字型", "悬念型", "对比型", "情感型", "其他"]:
        items = categories.get(cat, [])
        pct = len(items) / total * 100 if total else 0
        example = items[0][:50] + "..." if items and len(items[0]) > 50 else (items[0] if items else "-")
        lines.append(f"| {cat} | {len(items)} | {pct:.1f}% | {example} |")
    lines.append("")

    # 标点与格式
    lines.append("## 5. 标点与格式特征\n")
    lines.append(f"- 感叹号结尾: {punct_stats['ends_exclamation']} ({punct_stats['ends_exclamation']/total*100:.1f}%)")
    lines.append(f"- 问号结尾: {punct_stats['ends_question']} ({punct_stats['ends_question']/total*100:.1f}%)")
    lines.append(f"- 省略号结尾: {punct_stats['ends_ellipsis']} ({punct_stats['ends_ellipsis']/total*100:.1f}%)")
    lines.append(f"- 含全大写词: {punct_stats['has_all_caps_word']} ({punct_stats['has_all_caps_word']/total*100:.1f}%)")
    lines.append("")

    # 洞察
    lines.append("## 6. 关键洞察\n")
    # 自动生成一些洞察
    if number_stats["with_number_pct"] > 60:
        lines.append("- **数字驱动**: 超过60%的标题使用数字，数字是核心吸引力元素")
    if number_stats["with_dollar_pct"] > 30:
        lines.append("- **金钱叙事**: 大量使用$金额，制造价值感和规模感")
    dominant_cat = max(
        [(cat, len(items)) for cat, items in categories.items() if cat != "其他"],
        key=lambda x: x[1],
    )
    lines.append(f"- **主导公式**: 「{dominant_cat[0]}」是使用最多的标题类型 ({dominant_cat[1]}/{total})")
    if length_stats["char_avg"] < 50:
        lines.append("- **简洁风格**: 平均标题长度不到50字符，倾向短标题")
    else:
        lines.append("- **详细风格**: 平均标题超过50字符，倾向描述性标题")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(
        description="分析YouTube频道视频标题模式",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n  python analyze_titles.py mrbeast_titles.txt\n  python analyze_titles.py titles.txt -o report.md --top 30",
    )
    parser.add_argument("input", help="标题文本文件（每行一个标题）")
    parser.add_argument("-o", "--output", help="输出报告文件路径（默认打印到终端）")
    parser.add_argument("--top", type=int, default=20, help="显示的高频词数量（默认20）")
    args = parser.parse_args()

    titles = load_titles(args.input)
    report = generate_report(titles, args.top)

    if args.output:
        Path(args.output).write_text(report, encoding="utf-8")
        print(f"[OK] 报告已保存到: {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
