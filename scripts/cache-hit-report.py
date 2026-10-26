#!/usr/bin/env python3
"""从项目落盘数据统计真实的前缀缓存命中率。

数据来源：`<项目>/.qmai/**` 里每条 assistant 消息的
`contextHubSnapshot.stats.requestDiagnostics.requests[]`，其中
`inputTokens` / `cacheReadTokens` 来自 provider 的真实 usage。

用法：
    python scripts/cache-hit-report.py "C:/QM-BOOK/黑雨之下"
    python scripts/cache-hit-report.py "C:/QM-BOOK/黑雨之下" --conversation c31b44

指标口径（重要）：
    主指标是 `命中率`（cached / input，两个数都来自 provider 真实 usage）；
    辅指标是 `零命中占比`——多大比例的请求一个字节都没吃到缓存。

    `指纹重复率` 只作参考，不能当结论：`prefixFingerprint` 把 provider/model/apiMode/
    tools/toolChoice/reasoning 一起算了进去，所以「工具集或推理档位变了」也会让它变，
    而实际文本前缀可能没变。实测存在「新指纹但命中 94.9%」的请求，因此它会**高估**
    前缀变化。它只适合用来看趋势。

验收基准（改造前实测，见 docs/scratch-20261025-缓存命中率-真机基线.md）：
    全局命中 31.4%、零命中 46%；DeepSeek-V4.1 命中 5.7%、零命中 86%。
    这一层的目标：命中 > 70%，零命中 < 20%。
"""

from __future__ import annotations

import argparse
import datetime
import glob
import io
import json
import os
import sys
from collections import defaultdict


def collect(rows: list[dict], node, source: str, surface: str) -> None:
    for message in node.get("messages") or []:
        diagnostics = (
            ((message.get("contextHubSnapshot") or {}).get("stats") or {}).get("requestDiagnostics")
        ) or {}
        for request in diagnostics.get("requests") or []:
            rows.append({
                "source": source,
                "surface": surface,
                "conversation": node.get("id"),
                "started_at": request.get("startedAt") or 0,
                "model": request.get("model"),
                "provider": request.get("provider"),
                "api_mode": request.get("apiMode"),
                "fingerprint": request.get("prefixFingerprint"),
                "estimated": request.get("prefixEstimatedTokens") or 0,
                "input": request.get("inputTokens") or 0,
                "cached": request.get("cacheReadTokens") or 0,
                "status": request.get("status"),
            })


def load_rows(project_path: str) -> list[dict]:
    root = os.path.join(project_path, ".qmai")
    files = [os.path.join(root, "outline-chats.json")] + sorted(
        glob.glob(os.path.join(root, "chats", "*.json"))
    )
    rows: list[dict] = []
    for path in files:
        if not os.path.isfile(path):
            continue
        try:
            data = json.load(io.open(path, encoding="utf-8", errors="ignore"))
        except Exception:
            continue
        name = os.path.basename(path).replace(".json", "")
        if isinstance(data, dict) and "conversations" in data:
            for conversation in data["conversations"] or []:
                collect(rows, conversation, name, name)
        elif isinstance(data, list):
            # chats/<conv>.json 存的是**单个会话的消息数组**（不是会话数组）。
            # 早先误写成 for conversation in data，导致主对话链路的数据一条都读不到。
            collect(rows, {"id": name, "messages": data}, name, "chat")
        elif isinstance(data, dict):
            collect(rows, data, name, "chat")
    return [row for row in rows if row["input"] > 0]


def pct(numerator: float, denominator: float) -> str:
    return f"{numerator / denominator * 100:.1f}%" if denominator else "-"


def summarize(label: str, rows: list[dict]) -> None:
    total_in = sum(r["input"] for r in rows)
    total_cached = sum(r["cached"] for r in rows)
    cold = sum(1 for r in rows if r["cached"] == 0)
    seen: set[str] = set()
    repeated = 0
    for row in sorted(rows, key=lambda r: r["started_at"]):
        fingerprint = row["fingerprint"]
        if fingerprint in seen:
            repeated += 1
        else:
            seen.add(fingerprint)
    print(f"  {label:<26} 请求 {len(rows):>3}  input {total_in:>10,}  "
          f"cached {total_cached:>10,}  命中 {pct(total_cached, total_in):>6}  "
          f"零命中 {cold / len(rows) * 100:>4.0f}%  指纹重复 {pct(repeated, len(rows)):>6}")


def main() -> int:
    parser = argparse.ArgumentParser(description="统计项目真实的缓存前缀命中情况")
    parser.add_argument("project", help="小说项目目录（含 .qmai）")
    parser.add_argument("--conversation", help="只看某个会话 id 的后缀")
    parser.add_argument("--timeline", action="store_true", help="按时间逐条列出")
    args = parser.parse_args()

    rows = load_rows(args.project)
    if args.conversation:
        rows = [r for r in rows if (r["conversation"] or "").endswith(args.conversation)]
    if not rows:
        print("没有找到带 usage 的请求记录。先在软件里真实生成几次再跑。")
        return 1

    print(f"\n共 {len(rows)} 条带 provider usage 的请求\n")
    print("=" * 108)
    summarize("全局", rows)
    print("-" * 108)
    for model in sorted({r["model"] or "?" for r in rows}):
        subset = [r for r in rows if (r["model"] or "?") == model]
        summarize(model, subset)
    print("=" * 108)

    # 按请求大小分层：实测存在"小请求完全不吃缓存"的门槛效应。
    for label, low, high in (("≤20k token", 0, 20_000), (">20k token", 20_000, float("inf"))):
        subset = [r for r in rows if low < r["input"] <= high]
        if not subset:
            continue
        cold = sum(1 for r in subset if r["cached"] == 0)
        print(f"  {label:<16} 请求 {len(subset):>3}  input {sum(r['input'] for r in subset):>10,}  "
              f"命中 {pct(sum(r['cached'] for r in subset), sum(r['input'] for r in subset)):>6}  "
              f"零命中 {cold / len(subset) * 100:>4.0f}%")
    print("=" * 108)

    if args.timeline:
        print()
        header = f"{'时间':<17}{'会话':<8}{'指纹':<10}{'est':>8}{'input':>8}{'cached':>8}{'命中':>7}"
        print(header)
        previous = None
        for row in sorted(rows, key=lambda r: r["started_at"]):
            when = datetime.datetime.fromtimestamp(row["started_at"] / 1000).strftime("%m-%d %H:%M:%S")
            fingerprint = (row["fingerprint"] or "")[:8]
            same = "=" if fingerprint == previous else " "
            print(f"{when:<17}{(row['conversation'] or '')[-6:]:<8}{fingerprint + same:<10}"
                  f"{row['estimated']:>8}{row['input']:>8}{row['cached']:>8}"
                  f"{pct(row['cached'], row['input']):>7}  {row['status']}")
            previous = fingerprint

    print("\n判读方式：")
    print("  1. 「零命中」占比高（>50%）⇒ 前缀真的在被改写，或缓存已过期；先看 --timeline 的间隔与内容变化。")
    print("  2. 同一前缀连续两次仍 0% ⇒ 注意缓存写入有延迟：实测 DeepSeek 间隔 7 秒仍不命中，35 秒才有。")
    print("  3. 「指纹重复」低但「零命中」也低 ⇒ 多半是 tools/reasoning 变了，文本前缀没变，属误报。")
    print("  4. 命中稳定但绝对值低 ⇒ 前缀太短（低于 provider 的最小可缓存长度），不是布局问题。")
    print("  5. 「≤20k token」整层零命中 ⇒ 命中门槛效应：小请求不进缓存。看它占 input 的比例，")
    print("     低于 1% 就只管命中率、别为它改结构；占比高才值得合并碎调用。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
