"""
tools/patch_true_history.py

Nahradí syntetickou equity křivku v snapshot.json skutečnou historií
portfolia rekonstruovanou z individuálních lotů v XTB XLSX exportu.

Použití:
    python tools/patch_true_history.py EUR_*.xlsx USD_*.xlsx --snapshot snapshot.json
"""

import argparse
import json
import sys
import warnings
from datetime import datetime
from pathlib import Path

import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")

TICKER_OVERRIDE = {
    "BRKB.US": "BRK-B",
    "DUOL.US": "DUOL",
    "PYPL.US": "PYPL",
    "META.US": "META",
    "MSFT.US": "MSFT",
    "NFLX.US": "NFLX",
}

USD_TICKERS = {"BRKB.US", "DUOL.US", "PYPL.US", "META.US", "MSFT.US", "NFLX.US"}


def parse_lots(xlsx_path: Path) -> list[dict]:
    df = pd.read_excel(xlsx_path, sheet_name="Open Positions", header=None)
    header_row = None
    for i, row in df.iterrows():
        vals = [str(v) for v in row if pd.notna(v)]
        if "Ticker" in vals and "Volume" in vals:
            header_row = i
            break
    if header_row is None:
        print(f"  ⚠️ {xlsx_path.name}: hlavička nenalezena", file=sys.stderr)
        return []
    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)
    lots = []
    current_ticker = None
    for _, row in df.iterrows():
        ticker = row.get("Ticker")
        typ = row.get("Type")
        volume = row.get("Volume")
        open_time = row.get("Open time (UTC)")
        if pd.isna(typ) and pd.notna(ticker):
            current_ticker = str(ticker).strip()
        elif str(typ).strip().upper() == "BUY" and current_ticker:
            if pd.isna(volume) or pd.isna(open_time):
                continue
            if isinstance(open_time, datetime):
                date_str = open_time.strftime("%Y-%m-%d")
            else:
                try:
                    date_str = pd.to_datetime(open_time).strftime("%Y-%m-%d")
                except Exception:
                    continue
            yahoo_ticker = TICKER_OVERRIDE.get(current_ticker, current_ticker)
            lots.append({
                "xtb_ticker": current_ticker,
                "yahoo_ticker": yahoo_ticker,
                "quantity": float(volume),
                "open_date": date_str,
                "is_usd": current_ticker in USD_TICKERS,
            })
    return lots


def build_true_history(lots, end_date):
    if not lots:
        return [], []
    start_date = min(lot["open_date"] for lot in lots)
    print(f"  Rozsah dat: {start_date} → {end_date}")
    yahoo_tickers = list(set(lot["yahoo_ticker"] for lot in lots))
    has_usd = any(lot["is_usd"] for lot in lots)
    all_tickers = yahoo_tickers + (["EURUSD=X"] if has_usd else [])
    print(f"  Stahuji historické ceny: {', '.join(all_tickers)}")
    end_plus = (pd.Timestamp(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    raw = yf.download(all_tickers, start=start_date, end=end_plus, auto_adjust=True, progress=False)
    if raw.empty:
        print("  ❌ Žádná data z Yahoo Finance", file=sys.stderr)
        return [], []
    if isinstance(raw.columns, pd.MultiIndex):
        closes = raw["Close"].copy()
    else:
        closes = raw[["Close"]].rename(columns={"Close": all_tickers[0]}).copy()
    closes = closes.ffill()
    dates = [d.strftime("%Y-%m-%d") for d in closes.index]
    portfolio_values = []
    for date_str in dates:
        try:
            day_prices = closes.loc[date_str]
        except KeyError:
            portfolio_values.append(None)
            continue
        eurusd = 1.0
        if has_usd:
            raw_fx = day_prices.get("EURUSD=X")
            if raw_fx is not None and not pd.isna(raw_fx) and float(raw_fx) > 0:
                eurusd = float(raw_fx)
        total = 0.0
        for lot in lots:
            if lot["open_date"] > date_str:
                continue
            price = day_prices.get(lot["yahoo_ticker"])
            if price is None or pd.isna(price):
                continue
            value = lot["quantity"] * float(price)
            if lot["is_usd"]:
                value /= eurusd
            total += value
        portfolio_values.append(total if total > 0 else None)
    first_valid = next((i for i, v in enumerate(portfolio_values) if v is not None), None)
    if first_valid is None:
        return [], []
    dates = dates[first_valid:]
    portfolio_values = portfolio_values[first_valid:]
    last = None
    result = []
    for v in portfolio_values:
        if v is not None:
            last = v
        result.append(last or 0.0)
    return dates, result


def compute_drawdown(values):
    drawdown = []
    peak = float("-inf")
    for v in values:
        if v > peak:
            peak = v
        drawdown.append((v - peak) / peak if peak > 0 else 0.0)
    return drawdown


def rebase_benchmark(ticker, dates, start_value):
    if not dates:
        return []
    print(f"  Stahuji benchmark {ticker}...")
    end_plus = (pd.Timestamp(dates[-1]) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    raw = yf.download(ticker, start=dates[0], end=end_plus, auto_adjust=True, progress=False)
    if raw.empty:
        return [start_value] * len(dates)
    if isinstance(raw.columns, pd.MultiIndex):
        closes = raw["Close"].iloc[:, 0].ffill()
    else:
        closes = raw["Close"].ffill()
    base = None
    rebased = []
    for date_str in dates:
        try:
            price = float(closes.loc[date_str])
        except KeyError:
            try:
                price = float(closes.asof(pd.Timestamp(date_str)))
            except Exception:
                price = None
        if price is not None and not pd.isna(price):
            if base is None:
                base = price
            rebased.append(start_value * price / base)
        else:
            rebased.append(rebased[-1] if rebased else start_value)
    return rebased


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path("snapshot.json"))
    parser.add_argument("--benchmark", default="^GSPC")
    args = parser.parse_args()

    if not args.snapshot.exists():
        print(f"❌ {args.snapshot} nenalezen", file=sys.stderr)
        sys.exit(1)

    snapshot = json.loads(args.snapshot.read_text())

    print("\n📂 Načítám loty z XLSX...")
    all_lots = []
    for path in args.files:
        if not path.exists():
            print(f"  ⚠️ {path} nenalezen, přeskakuji", file=sys.stderr)
            continue
        lots = parse_lots(path)
        print(f"  {path.name}: {len(lots)} lotů")
        all_lots.extend(lots)

    if not all_lots:
        print("❌ Žádné loty nenalezeny", file=sys.stderr)
        sys.exit(1)

    end_date = snapshot.get("summary", {}).get("as_of", datetime.today().strftime("%Y-%m-%d"))

    print("\n📈 Rekonstruuji skutečnou historii portfolia...")
    dates, values = build_true_history(all_lots, end_date)

    if not dates:
        print("❌ Nepodařilo se vygenerovat historii", file=sys.stderr)
        sys.exit(1)

    print(f"  ✅ {len(dates)} obchodních dní")
    print(f"  Start: {values[0]:,.0f} EUR  →  Konec: {values[-1]:,.0f} EUR")

    drawdown = compute_drawdown(values)

    print("\n📊 Přebazuji benchmark...")
    benchmark_rebased = rebase_benchmark(args.benchmark, dates, values[0])

    print("\n💾 Aktualizuji snapshot.json...")
    print(f"  Klíče v snapshot: {list(snapshot.keys())}")

    if "history" in snapshot:
        target = snapshot["history"]
    elif "data" in snapshot and "history" in snapshot["data"]:
        target = snapshot["data"]["history"]
    else:
        snapshot["history"] = {}
        target = snapshot["history"]

    target["dates"] = dates
    target["portfolio"] = [round(v, 2) for v in values]
    target["drawdown_pct"] = [round(v, 6) for v in drawdown]
    target["benchmark_rebased"] = [round(v, 2) for v in benchmark_rebased]

    args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"✅ Hotovo — skutečná historie {dates[0]} → {dates[-1]} zapsána do snapshot.json")


if __name__ == "__main__":
    main()
