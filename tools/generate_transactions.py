#!/usr/bin/env python3
"""
generate_transactions.py  –  Builds transactions.json from XTB XLSX exports.

Produkuje dva typy záznámů:
  - BUY: otevřené pozice (Open Positions sheet) + uzavřené (Closed Positions, open strana)
  - SELL: uzavřené pozice (Closed Positions, close strana)

Výstup: transactions.json (frontend/public/transactions.json)

Použití:
    python tools/generate_transactions.py EUR_*.xlsx USD_*.xlsx
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

warnings.filterwarnings("ignore")

# ── Paths ──────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent

# ── Ticker normalization (matches xtb_to_holdings.py) ─────────────────────
TICKER_OVERRIDE: dict[str, str] = {
    "BRKB.US": "BRK-B",
    "DUOL.US": "DUOL",
    "PYPL.US": "PYPL",
    "META.US": "META",
    "MSFT.US": "MSFT",
    "NFLX.US": "NFLX",
    "VST.US":  "VST",
    "VICI.US": "VICI",
}

# EUR account tickers are already clean (VUAA.DE, etc.)

def norm_ticker(raw: str) -> str:
    return TICKER_OVERRIDE.get(str(raw).strip(), str(raw).strip())

# ── Detect account currency from filename ─────────────────────────────────
def account_currency(path: Path) -> str:
    """Returns 'EUR' or 'USD' based on filename prefix."""
    name = path.name.upper()
    if name.startswith("EUR"):
        return "EUR"
    if name.startswith("USD"):
        return "USD"
    return "EUR"   # fallback

# ── Date helpers ──────────────────────────────────────────────────────────
def to_date_str(val: Any) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val[:19]).strftime("%Y-%m-%d")
        except ValueError:
            return None
    if isinstance(val, (pd.Timestamp, datetime)):
        return val.strftime("%Y-%m-%d")
    return None

def to_iso(val: Any) -> str | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val[:19]).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            return None
    if isinstance(val, (pd.Timestamp, datetime)):
        return val.strftime("%Y-%m-%dT%H:%M:%S")
    return None

# ── Find latest XLSX per account (EUR / USD) ──────────────────────────────
def pick_latest(paths: list[Path]) -> dict[str, Path]:
    """
    Among multiple files with the same account prefix (EUR_*/USD_*),
    pick the one with the latest date embedded in the filename.
    """
    by_acct: dict[str, list[tuple[str, Path]]] = {}
    date_re = re.compile(r"(\d{4}-\d{2}-\d{2})")
    for p in paths:
        cur = account_currency(p)
        # Extract last date in filename
        dates = date_re.findall(p.stem)
        sort_key = dates[-1] if dates else "0000-00-00"
        by_acct.setdefault(cur, []).append((sort_key, p))
    return {cur: sorted(pairs, key=lambda x: x[0])[-1][1]
            for cur, pairs in by_acct.items()}

# ── Parse closed positions ────────────────────────────────────────────────
def parse_closed(path: Path, cur: str) -> list[dict]:
    """
    Returns list of transaction dicts (both BUY and SELL sides).
    Each closed position creates TWO records:
      - buy at open_time  (type='buy',  price=open_price,  total=purchase_value)
      - sell at close_time (type='sell', price=close_price, total=sale_value)
    """
    df = pd.read_excel(path, sheet_name="Closed Positions", header=4)
    # Drop rows without ticker
    df = df[df["Ticker"].notna() & (df["Ticker"] != "Ticker")]

    records: list[dict] = []
    for _, row in df.iterrows():
        ticker = norm_ticker(row["Ticker"])
        name   = str(row.get("Instrument", ticker)).strip()
        vol    = float(row["Volume"]) if pd.notna(row.get("Volume")) else 0.0

        # BUY record (open side)
        open_price = float(row["Open Price"]) if pd.notna(row.get("Open Price")) else 0.0
        purch_val  = float(row["Purchase Value"]) if pd.notna(row.get("Purchase Value")) else 0.0
        open_time  = to_iso(row.get("Open Time (UTC)"))
        open_date  = to_date_str(row.get("Open Time (UTC)"))

        if open_date and vol > 0:
            records.append({
                "date":       open_date,
                "datetime":   open_time,
                "ticker":     ticker,
                "name":       name,
                "type":       "buy",
                "shares":     round(vol, 6),
                "price":      round(open_price, 4),
                "total":      round(purch_val, 2),
                "currency":   cur,
                "position_id": str(int(row["Position ID"])) if pd.notna(row.get("Position ID")) else None,
                "source":     "closed_open_side",
            })

        # SELL record (close side)
        close_price = float(row["Close Price"]) if pd.notna(row.get("Close Price")) else 0.0
        sale_val    = float(row["Sale Value"])   if pd.notna(row.get("Sale Value"))  else 0.0
        profit_loss = float(row["Profit/Loss"])  if pd.notna(row.get("Profit/Loss")) else 0.0
        close_time  = to_iso(row.get("Close Time (UTC)"))
        close_date  = to_date_str(row.get("Close Time (UTC)"))

        if close_date and vol > 0:
            records.append({
                "date":       close_date,
                "datetime":   close_time,
                "ticker":     ticker,
                "name":       name,
                "type":       "sell",
                "shares":     round(vol, 6),
                "price":      round(close_price, 4),
                "total":      round(sale_val, 2),
                "currency":   cur,
                "profit_loss": round(profit_loss, 2),
                "position_id": str(int(row["Position ID"])) if pd.notna(row.get("Position ID")) else None,
                "source":     "closed_close_side",
            })

    return records

# ── Parse open positions ───────────────────────────────────────────────────
def parse_open(path: Path, cur: str) -> list[dict]:
    """
    Returns BUY records for currently open positions.
    Only the individual lot rows (Type == 'BUY'), not the summary group rows.
    """
    df = pd.read_excel(path, sheet_name="Open Positions", header=8)
    df = df[df["Type"] == "BUY"]

    records: list[dict] = []
    for _, row in df.iterrows():
        ticker = norm_ticker(row.get("Ticker", ""))
        if not ticker:
            continue
        # Instrument/Position column holds position ID for individual rows
        pos_id = str(row.get("Instrument/Position", "")).strip()

        # Use Value (current market value) for display, Open price for cost
        vol        = float(row["Volume"]) if pd.notna(row.get("Volume")) else 0.0
        open_price = float(row["Open price"]) if pd.notna(row.get("Open price")) else 0.0
        cost       = round(vol * open_price, 2)
        open_time  = to_iso(row.get("Open time (UTC)"))
        open_date  = to_date_str(row.get("Open time (UTC)"))

        if open_date and vol > 0:
            records.append({
                "date":       open_date,
                "datetime":   open_time,
                "ticker":     ticker,
                "name":       ticker,   # no name in open positions
                "type":       "buy",
                "shares":     round(vol, 6),
                "price":      round(open_price, 4),
                "total":      cost,
                "currency":   cur,
                "position_id": pos_id,
                "source":     "open_position",
            })

    return records

# ── Deduplicate: open positions may overlap with closed buy sides ──────────
def dedup(records: list[dict]) -> list[dict]:
    """
    Remove open-position BUY records that are already covered by
    closed-position BUY records (same position_id).
    """
    closed_buy_ids = {
        r["position_id"]
        for r in records
        if r["source"] == "closed_open_side" and r.get("position_id")
    }
    return [
        r for r in records
        if not (r["source"] == "open_position" and r.get("position_id") in closed_buy_ids)
    ]

# ── Czech tax limit computation ───────────────────────────────────────────
def czk_tax_per_year(records: list[dict], czk_eur: float, czk_usd: float) -> dict[str, dict]:
    """
    Returns {year: {used_czk, limit_czk, pct, sells: [{...}]}}
    Only SELL transactions count. Sale value is converted to CZK.
    """
    LIMIT = 100_000.0
    by_year: dict[str, list[dict]] = {}
    for r in records:
        if r["type"] != "sell":
            continue
        year = r["date"][:4]
        by_year.setdefault(year, []).append(r)

    result = {}
    for year, sells in sorted(by_year.items()):
        rate = czk_eur if sells[0]["currency"] == "EUR" else czk_usd
        # Each sell record may have a different currency
        total_czk = sum(
            r["total"] * (czk_eur if r["currency"] == "EUR" else czk_usd)
            for r in sells
        )
        result[year] = {
            "used_czk":  round(total_czk, 0),
            "limit_czk": LIMIT,
            "pct":       round(min(total_czk / LIMIT, 1.0), 4),
            "count":     len(sells),
        }
    return result

# ── Main ──────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx", nargs="*", help="XTB XLSX export files")
    parser.add_argument("--out", default=str(ROOT / "frontend" / "public" / "transactions.json"))
    parser.add_argument("--czk-eur", type=float, default=24.5, help="CZK/EUR exchange rate")
    parser.add_argument("--czk-usd", type=float, default=22.5, help="CZK/USD exchange rate")
    args = parser.parse_args()

    # Find XLSX files — args or scan repo root
    if args.xlsx:
        paths = [Path(p) for p in args.xlsx]
    else:
        paths = list(ROOT.glob("*.xlsx"))

    if not paths:
        print("[WARN] No XLSX files found, writing empty transactions.json")
        out = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "transactions": [],
            "tax_by_year":  {},
        }
        Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=2))
        return

    # Pick latest file per account
    chosen = pick_latest(paths)
    print(f"[INFO] Processing: {[str(v) for v in chosen.values()]}")

    all_records: list[dict] = []
    for cur, path in chosen.items():
        print(f"  [{cur}] {path.name}")
        try:
            closed = parse_closed(path, cur)
            open_  = parse_open(path, cur)
            all_records.extend(closed)
            all_records.extend(open_)
            print(f"        {len(closed)} closed records, {len(open_)} open positions")
        except Exception as exc:
            print(f"  [WARN] Failed to parse {path.name}: {exc}")

    # Deduplicate and sort
    all_records = dedup(all_records)
    all_records.sort(key=lambda r: (r["date"], r["ticker"], r["type"]), reverse=True)

    # Tax summary
    tax = czk_tax_per_year(all_records, args.czk_eur, args.czk_usd)

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        "generated_at":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "czk_eur_rate":  args.czk_eur,
        "czk_usd_rate":  args.czk_usd,
        "transactions":  all_records,
        "tax_by_year":   tax,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    print(f"[OK] {len(all_records)} transactions → {out_path}")
    for year, t in sorted(tax.items()):
        print(f"     {year}: {t['used_czk']:,.0f} CZK / {t['limit_czk']:,.0f} CZK ({t['pct']*100:.1f}%)")


if __name__ == "__main__":
    main()
