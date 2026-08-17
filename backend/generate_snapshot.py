"""Run every computation once and write ``snapshot.json`` at the repo root.

The snapshot lets the frontend run with no backend process (and is what the
committed demo uses), so the repository is self-contained.

Usage::

    python generate_snapshot.py              # use the on-disk price cache
    python generate_snapshot.py --no-cache   # force a fresh download
    python generate_snapshot.py -o other.json
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from dataclasses import replace
from pathlib import Path

from config import SETTINGS
from portfolio import build_analytics

logger = logging.getLogger("generate_snapshot")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=SETTINGS.snapshot_path,
        help=f"output path (default: {SETTINGS.snapshot_path})",
    )
    parser.add_argument(
        "--holdings",
        type=Path,
        default=SETTINGS.holdings_path,
        help=f"portfolio definition to use (default: {SETTINGS.holdings_path})",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="ignore the on-disk price cache and refetch from Yahoo Finance",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=None,
        help="pretty-print with this indent (default: compact, smaller file)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args(argv)

    settings = replace(SETTINGS, holdings_path=args.holdings)
    analytics = build_analytics(settings, use_cache=not args.no_cache)
    logger.info("Priced %d holdings as of %s", len(analytics.positions), analytics.as_of)

    payloads = analytics.all_payloads()
    base_currency = analytics.portfolio.base_currency
    snapshot = {
        "generated_at": payloads["/health"]["generated_at"],
        "as_of": analytics.as_of,
        "base_currency": base_currency,
        "endpoints": payloads,
    }

    output: Path = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    # allow_nan=False turns any leftover NaN into an error rather than emitting
    # the non-standard `NaN` literal that browsers refuse to parse.
    text = json.dumps(snapshot, indent=args.indent, allow_nan=False, separators=(",", ":") if args.indent is None else None)
    output.write_text(text + "\n", encoding="utf-8")

    size_kb = output.stat().st_size / 1024
    logger.info("Wrote %s (%.1f KB)", output, size_kb)
    logger.info(
        "Total value %.2f %s | Monte Carlo p50 %.2f | P(loss) %.1f%%",
        payloads["/portfolio/summary"]["total_value"],
        base_currency,
        payloads["/portfolio/montecarlo"]["median_value"],
        payloads["/portfolio/montecarlo"]["probability_below_start_pct"] * 100,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
