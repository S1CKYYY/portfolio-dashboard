"""
XTB XLSX → holdings.json adaptér pro chrispathway/portfolio-dashboard

Použití:
    python xtb_to_holdings.py EUR_*.xlsx USD_*.xlsx --currency CZK

Výstup: holdings.json kompatibilní s chrispathway dashboardem
"""

import argparse
import json
import sys
import warnings
from pathlib import Path
from datetime import datetime

import pandas as pd

warnings.filterwarnings("ignore", category=UserWarning)


# ── Mapování XTB category → asset_class ──────────────────────────────────────
CATEGORY_MAP = {
    "ETF": "ETF",
    "ETC": "ETC",
    "STOCK": "Stock",
    "CFD": "CFD",
}

# ── Mapování XTB tickerů na Yahoo Finance symboly ────────────────────────────
# XTB používá např. VUAA.DE, Yahoo Finance totéž — většinou funguje přímo.
# Pokud by nefungovalo, přidat sem výjimku.
TICKER_OVERRIDE = {
    # "EGLN.UK": "EGLN.L",  # příklad: UK listing (pence) se liší
}

NAMES = {
    "VUAA.DE": "Vanguard S&P 500 UCITS ETF",
    "ZPRV.DE": "SPDR MSCI USA Small Cap Value Weighted UCITS ETF",
    "XNAS.DE": "Xtrackers NASDAQ 100 UCITS ETF",
    "VWCE.DE": "Vanguard FTSE All-World UCITS ETF",
    "4GLD.DE": "Xetra-Gold",
    "IS3N.DE": "iShares Core MSCI EM IMI UCITS ETF",
    "BRKB.US": "Berkshire Hathaway Inc.",
    "DUOL.US": "Duolingo Inc.",
    "PYPL.US": "PayPal Holdings Inc.",
    "META.US": "Meta Platforms Inc.",
    "MSFT.US": "Microsoft Corporation",
    "NFLX.US": "Netflix Inc.",
}

def excel_serial_to_date(serial) -> str | None:
    """Převede Excel sériové číslo na ISO datum string."""
    if serial is None or (isinstance(serial, float) and pd.isna(serial)):
        return None
    if isinstance(serial, datetime):
        return serial.strftime("%Y-%m-%d")
    if isinstance(serial, str):
        try:
            return datetime.fromisoformat(serial).strftime("%Y-%m-%d")
        except ValueError:
            return None
    # Excel epoch = 1899-12-30
    try:
        base = datetime(1899, 12, 30)
        return (base + pd.Timedelta(days=float(serial))).strftime("%Y-%m-%d")
    except Exception:
        return None


def parse_open_positions(xlsx_path: Path) -> list[dict]:
    """
    Parsuje 'Open Positions' list z XTB XLSX exportu.

    Vrátí seznam slovníků pro každý AGREGOVANÝ ticker (ne individuální loty).
    Individuální loty slouží pro VWAP cost basis a nejstarší datum nákupu.
    """
    df = pd.read_excel(xlsx_path, sheet_name="Open Positions", header=None)

    # Najdi řádek s hlavičkami (obsahuje 'Ticker' a 'Volume')
    header_row = None
    for i, row in df.iterrows():
        vals = [str(v) for v in row if pd.notna(v)]
        if "Ticker" in vals and "Volume" in vals:
            header_row = i
            break

    if header_row is None:
        print(f"  ⚠️  {xlsx_path.name}: Nenašel jsem hlavičkový řádek v Open Positions", file=sys.stderr)
        return []

    # Přeindex s hlavičkou
    df.columns = df.iloc[header_row]
    df = df.iloc[header_row + 1:].reset_index(drop=True)

    # Sloupce: Product, Instrument/Position, Ticker, Category, Type, Volume,
    #          Value, Current price, Open price, Open time (UTC), ...
    col_position = "Instrument/Position"
    col_ticker = "Ticker"
    col_type = "Type"
    col_volume = "Volume"
    col_open_price = "Open price"
    col_open_time = "Open time (UTC)"
    col_category = "Category"

    holdings = {}  # ticker → {lots: [...], category: str}

    current_ticker = None
    current_category = None

    for _, row in df.iterrows():
        ticker = row.get(col_ticker)
        position = row.get(col_position)
        typ = row.get(col_type)
        volume = row.get(col_volume)
        open_price = row.get(col_open_price)
        open_time = row.get(col_open_time)
        category = row.get(col_category)

        # Přeskoč prázdné řádky
        if pd.isna(position) and pd.isna(ticker):
            continue

        # Souhrnný řádek (Type = NaN, position = název instrumentu)
        if pd.isna(typ):
            if pd.notna(ticker):
                current_ticker = str(ticker).strip()
                current_category = str(category).strip() if pd.notna(category) else "ETF"
                if current_ticker not in holdings:
                    holdings[current_ticker] = {"lots": [], "category": current_category}
        # Individuální lot (Type = BUY)
        elif str(typ).strip().upper() == "BUY" and current_ticker:
            if pd.isna(volume) or pd.isna(open_price):
                continue
            lot = {
                "quantity": float(volume),
                "open_price": float(open_price),
                "open_time": open_time,
            }
            holdings[current_ticker]["lots"].append(lot)

    # Agreguj loty → VWAP cost basis + nejstarší datum
    result = []
    for ticker, data in holdings.items():
        lots = data["lots"]
        if not lots:
            continue

        total_qty = sum(l["quantity"] for l in lots)
        total_cost = sum(l["quantity"] * l["open_price"] for l in lots)
        vwap = total_cost / total_qty if total_qty > 0 else None

        # Nejstarší datum nákupu
        dates = []
        for l in lots:
            d = excel_serial_to_date(l["open_time"])
            if d:
                dates.append(d)
        earliest_date = min(dates) if dates else None

        yahoo_ticker = TICKER_OVERRIDE.get(ticker, ticker)
        asset_class = CATEGORY_MAP.get(data["category"].upper(), data["category"])

        currency = "USD" if yahoo_ticker.endswith(".US") else "EUR"
        holding = {
            "ticker": yahoo_ticker,
            "name": NAMES.get(yahoo_ticker, yahoo_ticker),
            "currency": currency,
            "quantity": round(total_qty, 6),
            "asset_class": asset_class,
        }
        if vwap is not None:
            holding["cost_basis_per_unit"] = round(vwap, 6)
        if earliest_date:
            holding["acquired"] = earliest_date

        result.append(holding)

    return result


def build_holdings_json(xlsx_paths: list[Path], base_currency: str) -> dict:
    """Sestaví kompletní holdings.json z jednoho nebo více XTB exportů."""
    all_holdings = []

    for path in xlsx_paths:
        print(f"  Načítám {path.name}...")
        h = parse_open_positions(path)
        print(f"    → {len(h)} pozic nalezeno")
        all_holdings.extend(h)

    # Deduplikace — pokud stejný ticker ve více souborech, sečti množství
    merged: dict[str, dict] = {}
    for h in all_holdings:
        t = h["ticker"]
        if t not in merged:
            merged[t] = h.copy()
        else:
            # Vážený průměr cost basis
            existing = merged[t]
            q1 = existing["quantity"]
            q2 = h["quantity"]
            c1 = existing.get("cost_basis_per_unit", 0)
            c2 = h.get("cost_basis_per_unit", 0)
            merged[t]["quantity"] = round(q1 + q2, 6)
            if c1 and c2:
                merged[t]["cost_basis_per_unit"] = round(
                    (q1 * c1 + q2 * c2) / (q1 + q2), 6
                )
            # Starší datum vyhraje
            d1 = existing.get("acquired")
            d2 = h.get("acquired")
            if d1 and d2:
                merged[t]["acquired"] = min(d1, d2)
            elif d2:
                merged[t]["acquired"] = d2

    return {
        "base_currency": base_currency,
        "holdings": list(merged.values()),
    }


def main():
    parser = argparse.ArgumentParser(description="XTB XLSX → holdings.json")
    parser.add_argument("files", nargs="+", type=Path, help="XTB XLSX export soubory")
    parser.add_argument(
        "--currency",
        default="EUR",
        help="Základní měna pro reporting (default: EUR)",
    )
    parser.add_argument(
        "--out",
        default="holdings.json",
        type=Path,
        help="Výstupní soubor (default: holdings.json)",
    )
    args = parser.parse_args()

    missing = [f for f in args.files if not f.exists()]
    if missing:
        for f in missing:
            print(f"❌ Soubor nenalezen: {f}", file=sys.stderr)
        sys.exit(1)

    print(f"\n🔄 Zpracovávám {len(args.files)} soubor(ů)...")
    result = build_holdings_json(args.files, args.currency)

    out_path = args.out
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False))

    print(f"\n✅ Hotovo! {len(result['holdings'])} pozic uloženo do {out_path}")
    print(f"   Base currency: {result['base_currency']}")
    print()
    for h in result["holdings"]:
        cost = f"  cost: {h['cost_basis_per_unit']}" if "cost_basis_per_unit" in h else ""
        print(f"   {h['ticker']:12s} {h['quantity']:>10.4f} ks   [{h['asset_class']}]{cost}")


if __name__ == "__main__":
    main()
