#!/usr/bin/env python3
"""
update_fedwatch.py — lokální skript pro aktualizaci CME FedWatch dat.

Spouštěj z PC/Mac kde YF/CME funguje:
    python tools/update_fedwatch.py
    git add fedwatch_cache.json
    git commit -m "chore: update FedWatch cache"
    git push

Data se pak zobrazí v dashboardu na GitHub Pages.
"""

import json, sys, warnings
from pathlib import Path
from datetime import datetime, timezone

warnings.filterwarnings("ignore")

OUT = Path(__file__).parent.parent / "fedwatch_cache.json"

# FOMC zasedání 2026-2027
FOMC_DATES = [
    "2026-09-16", "2026-10-28", "2026-12-09",
    "2027-01-26", "2027-03-17",
]
MONTH_CODES = {1:"F",2:"G",3:"H",4:"J",5:"K",6:"M",7:"N",8:"Q",9:"U",10:"V",11:"X",12:"Z"}

def main():
    import yfinance as yf
    yf.set_tz_cache_location("/tmp/yf-fedwatch")

    # Nejbližší FOMC
    from datetime import datetime as dt
    now = dt.now()
    fomc_date = next((d for d in FOMC_DATES if dt.strptime(d, "%Y-%m-%d") > now), None)
    if not fomc_date:
        print("❌ Žádné nadcházející FOMC zasedání v databázi.")
        return

    fomc_dt = dt.strptime(fomc_date, "%Y-%m-%d")
    print(f"📅 Příští FOMC: {fomc_date}")

    # ZQ kontrakt pro toto zasedání
    if fomc_dt.day > 15:
        cm, cy = fomc_dt.month % 12 + 1, fomc_dt.year + (1 if fomc_dt.month == 12 else 0)
    else:
        cm, cy = fomc_dt.month, fomc_dt.year
    code = MONTH_CODES[cm]
    yr1, yr2 = str(cy)[-1:], str(cy)[-2:]

    price = None
    ticker_used = None
    for t in [f"ZQ{code}{yr1}.CBT", f"ZQ{code}{yr2}.CBT", f"ZQ{code}{yr1}=F"]:
        print(f"  Zkouším {t}...", end=" ", flush=True)
        try:
            d = yf.download(t, period="5d", auto_adjust=True, progress=False)
            if not d.empty:
                price = float(d["Close"].dropna().iloc[-1])
                ticker_used = t
                print(f"✓ {price:.4f}")
                break
        except Exception:
            pass
        print("prázdné")

    if price is None:
        print("❌ ZQ futures nedostupné ani lokálně.")
        print("   Zkus v obchodních hodinách CME (9:30-16:00 ET).")
        return

    implied = round(100 - price, 4)
    print(f"\n📊 Mid Price: {price:.4f}")
    print(f"   Implied rate: {implied:.3f}%")

    # FedWatch výpočet - zjisti aktuální cílovou sazbu
    fed = yf.download("^IRX", period="5d", auto_adjust=True, progress=False)
    current_rate = float(fed["Close"].dropna().iloc[-1]) if not fed.empty else 3.75
    print(f"   Aktuální sazba (~): {current_rate:.2f}%")

    step = 0.25; diff = implied - current_rate
    if diff < -step / 2:
        cut_p = min(0.99, 0.5 + (-diff - step/2) / step)
        hold_p = 1 - cut_p; hike_p = 0.0
    elif diff > step / 2:
        hike_p = min(0.99, 0.5 + (diff - step/2) / step)
        hold_p = 1 - hike_p; cut_p = 0.0
    else:
        cut_p = max(0, (step/2 + diff) / step * 0.4)
        hike_p = max(0, (step/2 - diff) / step * 0.4)
        hold_p = 1 - cut_p - hike_p

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "CME ZQ Futures (lokálně)",
        "source_ticker": ticker_used,
        "futures_price": round(price, 4),
        "current_rate": round(current_rate, 2),
        "implied_rate": implied,
        "next_meeting": fomc_date,
        "cut_probability": round(cut_p, 3),
        "hold_probability": round(hold_p, 3),
        "hike_probability": round(hike_p, 3),
    }

    OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(f"\n✅ Uloženo do {OUT}")
    print(f"   EASE (snížení): {cut_p:.1%}")
    print(f"   NO CHANGE:      {hold_p:.1%}")
    print(f"   HIKE (zvýšení): {hike_p:.1%}")
    print(f"\nTed commitni: git add fedwatch_cache.json && git commit -m 'chore: FedWatch update' && git push")

if __name__ == "__main__":
    main()
