"""qhaway CLI — `qhaway stats` prints a recent cost summary from local storage."""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import List

from .cost import calculate_cost
from .storage import SqliteStorage
from .trace import QhawaySpan


def main(argv: List[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="qhaway", description="Qhaway agent observability CLI")
    sub = parser.add_subparsers(dest="command")

    stats = sub.add_parser("stats", help="Print recent cost summary from local SQLite storage")
    stats.add_argument("--db", default=None, help="SQLite database path (default: QHAWAY_DB or qhaway.db)")
    stats.add_argument("--limit", type=int, default=1000, help="Max spans to consider (default: 1000)")
    stats.add_argument("--hours", type=int, default=24, help="Look back window in hours (default: 24)")

    args = parser.parse_args(argv)
    if args.command == "stats":
        asyncio.run(run_stats(args))
    else:
        parser.print_help()
        sys.exit(0)


async def run_stats(args: argparse.Namespace) -> None:
    storage = SqliteStorage(path=args.db)
    spans = await storage.query()
    if not spans:
        print("No spans found. Instrument your app and call the same storage path.")
        return

    cutoff = now_iso_offset(-args.hours)
    recent = [s for s in spans if s.timestamp >= cutoff][-args.limit :]
    if not recent:
        print(f"No spans in the last {args.hours}h.")
        return

    total_cost = sum(s.cost_usd for s in recent)
    total_calls = len(recent)
    total_in = sum(s.tokens_in for s in recent)
    total_out = sum(s.tokens_out for s in recent)
    errors = sum(1 for s in recent if not s.success)
    avg_latency = sum(s.latency_ms for s in recent) / total_calls if total_calls else 0

    by_model: dict[str, float] = {}
    for s in recent:
        by_model[s.model] = by_model.get(s.model, 0.0) + s.cost_usd

    print(f"Qhaway stats (last {args.hours}h, {len(recent)} spans)")
    print(f"  Total cost:   ${total_cost:.4f}")
    print(f"  Calls:        {total_calls}")
    print(f"  Tokens:       {total_in} in / {total_out} out")
    print(f"  Errors:       {errors}")
    print(f"  Avg latency:  {avg_latency:.0f}ms")
    if by_model:
        print("  Cost by model:")
        for model, cost in sorted(by_model.items(), key=lambda kv: -kv[1]):
            print(f"    {model:<24} ${cost:.4f}")

    estimated = estimate_uncosted(recent)
    if estimated:
        print("  (estimated cost for uncosted spans)")

    await storage.close()


def estimate_uncosted(spans: List[QhawaySpan]) -> bool:
    """Backfills cost for spans with cost_usd == 0 using the local pricing map."""
    estimated = False
    for span in spans:
        if span.cost_usd == 0.0 and (span.tokens_in or span.tokens_out):
            cost = calculate_cost(span.model, span.tokens_in, span.tokens_out, span.provider)
            if cost >= 0:
                estimated = True
                span.cost_usd = cost
    return estimated


def now_iso_offset(hours: float) -> str:
    from datetime import datetime, timedelta, timezone

    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


if __name__ == "__main__":
    main()
