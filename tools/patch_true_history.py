"""
tools/patch_true_history.py

Nahradí syntetickou equity křivku v snapshot.json skutečnou historií
portfolia. Navíc vypočítá:
- cash-flow matched benchmark (stejné investice ve stejných datech do S&P 500)
- cumulative_invested (kolik EUR bylo celkem vloženo k danému dni)
Tyto hodnoty umožňují správně zobrazit "Výnos" jako (hodnota - vloženo) / vloženo.
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
BENCHMARK = "^GSPC"


def parse_lots(xlsx_path):
    df = pd.read_excel(xlsx_path, sheet_name="Open Positions", header=None)
    header_row = None
    for i, row in df.iterrows():
        vals = [str(v) for v in row if pd.notna(v)]
        if "Ticker" in vals and "Volume" in vals:
            header_row = i
            break
    if header_row is None:
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
        open_price = row.get("Open price")
        if pd.isna(typ) and pd.notna(ticker):
            current_ticker = str(ticker).strip()
        elif str(typ).strip().upper() == "BUY" and current_ticker:
            if pd.isna(volume) or pd.isna(open_time) or pd.isna(open_price):
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
                "open_price": float(open_price),
                "open_date": date_str,
                "is_usd": current_ticker in USD_TICKERS,
            })
    return lots


def build_history(lots, end_date):
    if not lots:
        return [], [], [], []

    start_date = min(lot["open_date"] for lot in lots)
    print(f"  Rozsah dat: {start_date} → {end_date}")

    yahoo_tickers = list(set(lot["yahoo_ticker"] for lot in lots))
    all_tickers = yahoo_tickers + ["EURUSD=X", BENCHMARK]
    print(f"  Stahuji ceny: {', '.join(all_tickers)}")

    end_plus = (pd.Timestamp(end_date) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
    raw = yf.download(all_tickers, start=start_date, end=end_plus, auto_adjust=True, progress=False)
    if raw.empty:
        return [], [], [], []

    if isinstance(raw.columns, pd.MultiIndex):
        closes = raw["Close"].copy()
    else:
        closes = raw[["Close"]].rename(columns={"Close": all_tickers[0]}).copy()
    closes = closes.ffill()
    dates = [d.strftime("%Y-%m-%d") for d in closes.index]

    portfolio_values = []
    benchmark_values = []
    cumulative_invested = []

    # Předvýpočet benchmark lotů (kolik jednotek S&P 500 jsme koupili)
    # Na každý nákup simulujeme stejnou EUR částku do S&P 500
    benchmark_units = []  # list of (date, units)

    for lot in lots:
        d = lot["open_date"]
        try:
            eurusd = float(closes.loc[d, "EURUSD=X"]) if "EURUSD=X" in closes.columns and not pd.isna(closes.loc[d, "EURUSD=X"]) else 1.0
        except KeyError:
            eurusd = 1.0
        if eurusd <= 0:
            eurusd = 1.0

        # EUR náklad tohoto lotu
        cost_native = lot["quantity"] * lot["open_price"]
        cost_eur = cost_native / eurusd if lot["is_usd"] else cost_native

        # Cena S&P 500 v EUR v den nákupu
        try:
            gspc_price_usd = float(closes.loc[d, BENCHMARK])
        except KeyError:
            gspc_price_usd = None
        if gspc_price_usd and not pd.isna(gspc_price_usd) and eurusd > 0:
            gspc_price_eur = gspc_price_usd / eurusd
            units = cost_eur / gspc_price_eur
            benchmark_units.append((d, units))

    # Pro každý obchodní den vypočítej hodnoty
    total_invested = 0.0
    invested_by_date = {}

    for lot in lots:
        d = lot["open_date"]
        try:
            eurusd = float(closes.loc[d, "EURUSD=X"]) if not pd.isna(closes.loc[d, "EURUSD=X"]) else 1.0
        except Exception:
            eurusd = 1.0
        cost_native = lot["quantity"] * lot["open_price"]
        cost_eur = cost_native / eurusd if lot["is_usd"] else cost_native
        invested_by_date[d] = invested_by_date.get(d, 0.0) + cost_eur

    running_invested = 0.0
    invested_cumulative = {}
    for d in sorted(invested_by_date.keys()):
        running_invested += invested_by_date[d]
        invested_cumulative[d] = running_invested

    for date_str in dates:
        try:
            day_prices = closes.loc[date_str]
        except KeyError:
            portfolio_values.append(None)
            benchmark_values.append(None)
            cumulative_invested.append(None)
            continue

        eurusd = 1.0
        if "EURUSD=X" in closes.columns:
            raw_fx = day_prices.get("EURUSD=X")
            if raw_fx is not None and not pd.isna(raw_fx) and float(raw_fx) > 0:
                eurusd = float(raw_fx)

        # Portfolio hodnota
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

        # Benchmark hodnota (cash-flow matched)
        gspc_today = day_prices.get(BENCHMARK)
        if gspc_today is not None and not pd.isna(gspc_today):
            gspc_eur = float(gspc_today) / eurusd
            bench_val = sum(
                units * gspc_eur
                for d, units in benchmark_units
                if d <= date_str
            )
            benchmark_values.append(bench_val if bench_val > 0 else None)
        else:
            benchmark_values.append(None)

        # Kumulativně vloženo
        inv = 0.0
        for d, amt in invested_cumulative.items():
            if d <= date_str:
                inv = amt
        cumulative_invested.append(inv if inv > 0 else None)

    # Ořízni prázdný začátek
    first_valid = next((i for i, v in enumerate(portfolio_values) if v is not None), None)
    if first_valid is None:
        return [], [], [], []

    dates = dates[first_valid:]
    portfolio_values = portfolio_values[first_valid:]
    benchmark_values = benchmark_values[first_valid:]
    cumulative_invested = cumulative_invested[first_valid:]

    # Forward-fill
    def ffill(lst):
        last = None
        result = []
        for v in lst:
            if v is not None:
                last = v
            result.append(last or 0.0)
        return result

    return dates, ffill(portfolio_values), ffill(benchmark_values), ffill(cumulative_invested)


def compute_drawdown(values):
    drawdown = []
    peak = float("-inf")
    for v in values:
        if v > peak:
            peak = v
        drawdown.append((v - peak) / peak if peak > 0 else 0.0)
    return drawdown


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--snapshot", type=Path, default=Path("snapshot.json"))
    args = parser.parse_args()

    if not args.snapshot.exists():
        print(f"❌ {args.snapshot} nenalezen", file=sys.stderr)
        sys.exit(1)

    snapshot = json.loads(args.snapshot.read_text())

    print("\n📂 Načítám loty z XLSX...")
    all_lots = []
    for path in args.files:
        if not path.exists():
            continue
        lots = parse_lots(path)
        print(f"  {path.name}: {len(lots)} lotů")
        all_lots.extend(lots)

    if not all_lots:
        print("❌ Žádné loty", file=sys.stderr)
        sys.exit(1)

    end_date = snapshot.get("as_of", datetime.today().strftime("%Y-%m-%d"))

    print("\n📈 Rekonstruuji historii portfolia + benchmark...")
    dates, portfolio, benchmark, invested = build_history(all_lots, end_date)

    if not dates:
        print("❌ Nepodařilo se vygenerovat historii", file=sys.stderr)
        sys.exit(1)

    print(f"  ✅ {len(dates)} obchodních dní")
    print(f"  Portfolio: {portfolio[0]:,.0f} EUR → {portfolio[-1]:,.0f} EUR")
    print(f"  Benchmark: {benchmark[0]:,.0f} EUR → {benchmark[-1]:,.0f} EUR")
    print(f"  Vloženo celkem: {invested[-1]:,.0f} EUR")

    drawdown = compute_drawdown(portfolio)

    print("\n💾 Aktualizuji snapshot.json...")
    if "endpoints" in snapshot and "/portfolio/history" in snapshot["endpoints"]:
        target = snapshot["endpoints"]["/portfolio/history"]
    elif "history" in snapshot:
        target = snapshot["history"]
    else:
        snapshot["history"] = {}
        target = snapshot["history"]

    # Spočítej výnos benchmarku stejnou metodou jako portfolio
    if invested and invested[-1] > 0 and benchmark:
        benchmark_return = (benchmark[-1] - invested[-1]) / invested[-1]
        summary = snapshot.get('endpoints', {}).get('/portfolio/summary', snapshot.get('summary', {}))
        summary['benchmark_return_pct'] = round(benchmark_return, 6)
        print(f'  Výnos benchmarku: {benchmark_return*100:.2f}%')

    target["dates"] = dates
    target["portfolio"] = [round(v, 2) for v in portfolio]
    target["benchmark_rebased"] = [round(v, 2) for v in benchmark]
    target["drawdown_pct"] = [round(v, 6) for v in drawdown]
    target["cumulative_invested"] = [round(v, 2) for v in invested]

    # Přidej aktuální kurz EUR/CZK do snapshotu
    print("\n💱 Stahuji kurz EUR/CZK...")
    try:
        czk_raw = yf.download("EURCZK=X", period="5d", auto_adjust=True, progress=False)
        if not czk_raw.empty:
            if isinstance(czk_raw.columns, pd.MultiIndex):
                czk_val = czk_raw["Close"].iloc[:, 0].dropna()
            else:
                czk_val = czk_raw["Close"].dropna()
            if not czk_val.empty:
                czk_rate = round(float(czk_val.iloc[-1]), 4)
                print(f"  EUR/CZK = {czk_rate}")
                summary = snapshot.get("endpoints", {}).get("/portfolio/summary", snapshot.get("summary", {}))
                summary["czk_rate"] = czk_rate
            else:
                print("  ⚠️ EURCZK data prázdná, přeskakuji")
        else:
            print("  ⚠️ EURCZK download selhal, přeskakuji")
    except Exception as e:
        print(f"  ⚠️ EURCZK chyba: {e}, přeskakuji")

    args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")))
    print(f"✅ Hotovo — {dates[0]} → {dates[-1]}")


if __name__ == "__main__":
    main()
