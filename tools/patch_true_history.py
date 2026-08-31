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
BENCHMARK = "VUAA.DE"

# Skutečné geografické složení ETF indexů (přibližné váhy)
ETF_REGION_WEIGHTS = {
    "VUAA.DE":  {"USA": 1.0},
    "ZPRV.DE":  {"USA": 1.0},
    "XNAS.DE":  {"USA": 1.0},
    "VWCE.DE":  {
        "USA":                    0.626,
        "Evropa":                 0.264,
        "Rozvíjející se trhy":    0.110,
    },
    "4GLD.DE":  {"Komodity": 1.0},
    "IS3N.DE":  {"Rozvíjející se trhy": 1.0},
    "BRK-B": {"USA": 1.0},
    "DUOL":  {"USA": 1.0},
    "PYPL":  {"USA": 1.0},
    "META":  {"USA": 1.0},
    "MSFT":  {"USA": 1.0},
    "NFLX":  {"USA": 1.0},
}


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


# Sektorové složení — přesná data z Yahoo Finance (2025)
ETF_SECTOR_WEIGHTS = {
    # VUAA.DE — S&P 500, zdroj: Yahoo Finance VUAA.L
    "VUAA.DE": {
        "Technologie":          0.3742,
        "Finance":              0.1220,
        "Komunikační služby":   0.0991,
        "Spotřební zboží":      0.0958,
        "Zdravotnictví":        0.0910,
        "Průmysl":              0.0816,
        "Základní spotřeba":    0.0462,
        "Energie":              0.0336,
        "Utility":              0.0215,
        "Reality":              0.0188,
        "Materiály":            0.0162,
    },
    # ZPRV.DE — MSCI USA Small Cap Value, zdroj: Yahoo Finance ZPRV.DE
    "ZPRV.DE": {
        "Finance":              0.1960,
        "Průmysl":              0.1470,
        "Spotřební zboží":      0.1392,
        "Technologie":          0.1060,
        "Energie":              0.1038,
        "Zdravotnictví":        0.0771,
        "Reality":              0.0623,
        "Materiály":            0.0603,
        "Základní spotřeba":    0.0563,
        "Komunikační služby":   0.0276,
        "Utility":              0.0244,
    },
    # XNAS.DE — NASDAQ 100, zdroj: Yahoo Finance XNAS.L
    "XNAS.DE": {
        "Technologie":          0.5782,
        "Komunikační služby":   0.1353,
        "Spotřební zboží":      0.1118,
        "Základní spotřeba":    0.0665,
        "Průmysl":              0.0405,
        "Zdravotnictví":        0.0380,
        "Utility":              0.0119,
        "Materiály":            0.0101,
        "Energie":              0.0054,
        "Finance":              0.0023,
    },
    # VWCE.DE — FTSE All-World, zdroj: Yahoo Finance VWCE.DE
    "VWCE.DE": {
        "Technologie":          0.3251,
        "Finance":              0.1585,
        "Průmysl":              0.1082,
        "Spotřební zboží":      0.0882,
        "Zdravotnictví":        0.0813,
        "Komunikační služby":   0.0794,
        "Základní spotřeba":    0.0465,
        "Energie":              0.0352,
        "Materiály":            0.0350,
        "Utility":              0.0248,
        "Reality":              0.0177,
    },
    # 4GLD.DE — Xetra-Gold
    "4GLD.DE": {"Komodity": 1.0},
    # IS3N.DE — MSCI EM IMI, zdroj: Yahoo Finance IS3N.DE
    "IS3N.DE": {
        "Technologie":          0.4210,
        "Finance":              0.1669,
        "Spotřební zboží":      0.0855,
        "Průmysl":              0.0799,
        "Materiály":            0.0624,
        "Komunikační služby":   0.0562,
        "Energie":              0.0327,
        "Zdravotnictví":        0.0326,
        "Základní spotřeba":    0.0282,
        "Utility":              0.0192,
        "Reality":              0.0154,
    },
    # Jednotlivé akcie
    "BRK-B":  {"Finance":              1.0},
    "DUOL":   {"Technologie":          1.0},
    "PYPL":   {"Finance":              1.0},
    "META":   {"Komunikační služby":   1.0},
    "MSFT":   {"Technologie":          1.0},
    "NFLX":   {"Komunikační služby":   1.0},
}


def compute_sector_allocation(holdings_data: list[dict]) -> list[dict]:
    """Spočítá sektorové rozložení portfolia."""
    sector_values: dict[str, float] = {}
    for h in holdings_data:
        ticker = h.get("ticker", "")
        value = h.get("value_base", 0) or 0
        weights = ETF_SECTOR_WEIGHTS.get(ticker, {"Ostatní": 1.0})
        for sector, weight in weights.items():
            sector_values[sector] = sector_values.get(sector, 0.0) + value * weight

    total = sum(sector_values.values())
    if total == 0:
        return []

    return sorted(
        [
            {
                "key": sector,
                "value": round(value, 2),
                "allocation_pct": round(value / total, 6),
                "holdings": 1,
            }
            for sector, value in sector_values.items()
        ],
        key=lambda x: -x["value"],
    )


def compute_currency_allocation(holdings_data: list[dict], holdings_json_path: str = "backend/holdings.json") -> list[dict]:
    """Spočítá alokaci podle měny pozice (čte původní měnu z holdings.json)."""
    # Načti původní měny z holdings.json
    ticker_currency: dict[str, str] = {}
    try:
        import json as _json
        with open(holdings_json_path) as f:
            orig = _json.load(f)
        for h in orig.get("holdings", []):
            ticker_currency[h["ticker"]] = h.get("currency", "EUR")
    except Exception:
        pass

    currency_values: dict[str, float] = {}
    for h in holdings_data:
        ticker = h.get("ticker", "")
        currency = ticker_currency.get(ticker, h.get("currency", "EUR"))
        value = h.get("value_base", 0) or 0
        currency_values[currency] = currency_values.get(currency, 0.0) + value

    total = sum(currency_values.values())
    if total == 0:
        return []

    return sorted(
        [
            {
                "key": currency,
                "value": round(value, 2),
                "allocation_pct": round(value / total, 6),
                "holdings": 1,
            }
            for currency, value in currency_values.items()
        ],
        key=lambda x: -x["value"],
    )


def compute_region_allocation(holdings_data: list[dict]) -> list[dict]:
    """Spočítá geografické rozložení portfolia s ETF rozepsanými podle skutečného složení."""
    region_values: dict[str, float] = {}
    for h in holdings_data:
        ticker = h.get("ticker", "")
        value = h.get("value_base", 0) or 0
        weights = ETF_REGION_WEIGHTS.get(ticker, {"USA": 1.0})
        for region, weight in weights.items():
            region_values[region] = region_values.get(region, 0.0) + value * weight

    total = sum(region_values.values())
    if total == 0:
        return []

    return sorted(
        [
            {
                "key": region,
                "value": round(value, 2),
                "allocation_pct": round(value / total, 6),
                "holdings": 1,
            }
            for region, value in region_values.items()
        ],
        key=lambda x: -x["value"],
    )


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

    # Přepiš allocation_by_region skutečným geografickým složením ETF
    holdings_list = snapshot.get("endpoints", {}).get("/holdings", {}).get("holdings", [])
    if holdings_list:
        region_alloc = compute_region_allocation(holdings_list)
        summary = snapshot.get("endpoints", {}).get("/portfolio/summary", {})
        if region_alloc:
            summary["allocation_by_region"] = region_alloc
            print(f"  Geografická alokace: {', '.join(f'{r["key"]} {r["allocation_pct"]*100:.1f}%' for r in region_alloc[:5])}")

    # Oprav max drawdown přímo z patchnuté history v snapshotu
    try:
        dd_series = target.get('drawdown_pct', [])
        dates_series = target.get('dates', [])
        vals_series = target.get('portfolio', [])
        if dd_series and dates_series and len(dd_series) > 1:
            min_dd = min(dd_series)
            min_idx = dd_series.index(min_dd)
            peak_idx = max(range(min_idx + 1), key=lambda i: vals_series[i]) if min_idx > 0 else 0
            recovery_idx = None
            if vals_series and peak_idx < len(vals_series):
                peak_val = vals_series[peak_idx]
                for i in range(min_idx + 1, len(vals_series)):
                    if vals_series[i] >= peak_val:
                        recovery_idx = i
                        break
            risk_ep = snapshot.get('endpoints', {}).get('/portfolio/risk', {})
            if risk_ep and 'max_drawdown' in risk_ep:
                risk_ep['max_drawdown']['pct'] = round(min_dd, 6)
                risk_ep['max_drawdown']['peak_date'] = dates_series[peak_idx] if peak_idx < len(dates_series) else None
                risk_ep['max_drawdown']['trough_date'] = dates_series[min_idx]
                risk_ep['max_drawdown']['recovery_date'] = dates_series[recovery_idx] if recovery_idx else None
                print(f'  Max drawdown opraveno: {min_dd*100:.2f}% ({dates_series[peak_idx]} → {dates_series[min_idx]})')
    except Exception as e:
        print(f'  ⚠️ Drawdown patch selhal: {e}', file=sys.stderr)

    # Přidej alokaci podle měny
    if holdings_list and summary:
        currency_alloc = compute_currency_allocation(holdings_list)
        if currency_alloc:
            summary["allocation_by_currency"] = currency_alloc
            print(f"  Měny: {', '.join(f'{c["key"]} {c["allocation_pct"]*100:.1f}%' for c in currency_alloc)}")

    # Přidej sektorovou alokaci
    if holdings_list:
        sector_alloc = compute_sector_allocation(holdings_list)
        if sector_alloc and summary:
            summary["allocation_by_sector"] = sector_alloc
            print(f"  Sektory: {', '.join(f'{s["key"]} {s["allocation_pct"]*100:.1f}%' for s in sector_alloc[:4])}")

    # Oprav summary.changes.all na skutečný výnos (cost basis)
    if summary:
        total_value = summary.get("total_value", 0)
        total_cost = summary.get("total_cost", 0)
        if total_cost and total_cost > 0:
            true_return = (total_value - total_cost) / total_cost
            true_absolute = total_value - total_cost
            if "changes" in summary and "all" in summary["changes"]:
                summary["changes"]["all"]["pct"] = round(true_return, 6)
                summary["changes"]["all"]["absolute"] = round(true_absolute, 2)
                summary["changes"]["all"]["start_value"] = round(total_cost, 2)
                print(f"  Opraveno All Time: cost={total_cost:.0f} EUR, return={true_return*100:.2f}%")

    # Vypočítej vážený roční poplatek portfolia z holdings.json (má ter_pct)
    if summary and holdings_list:
        import json as _json2
        ter_map = {}
        try:
            with open('backend/holdings.json') as f:
                orig_h = _json2.load(f)
            for h in orig_h.get('holdings', []):
                ter_map[h['ticker']] = h.get('ter_pct', 0.0)
        except Exception as e:
            print(f'  ⚠️ Nelze načíst ter z holdings.json: {e}')

        total_val = sum(h.get('value_base', 0) for h in holdings_list)
        weighted_ter = sum(
            h.get('value_base', 0) * ter_map.get(h.get('ticker', ''), 0.0)
            for h in holdings_list
        ) / total_val if total_val > 0 else 0.0
        annual_fee_eur = total_val * weighted_ter / 100.0
        summary['portfolio_ter_pct'] = round(weighted_ter, 4)
        summary['portfolio_annual_fee'] = round(annual_fee_eur, 2)
        print(f'  Portfolio TER: {weighted_ter:.3f}% = {annual_fee_eur:.0f} EUR/rok')

    args.snapshot.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')))
    print(f"✅ Hotovo — {dates[0]} → {dates[-1]}")


if __name__ == "__main__":
    main()
