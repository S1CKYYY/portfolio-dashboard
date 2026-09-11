#!/usr/bin/env python3
"""
Generuje morning/evening market brief pomocí Claude API + web_search.
Výstup: brief_morning.json nebo brief_evening.json (podle hodiny nebo --session)

Použití:
  python tools/generate_brief.py                  # auto-detect session
  python tools/generate_brief.py --session MORNING
  python tools/generate_brief.py --session EVENING
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import anthropic
except ImportError:
    print("pip install anthropic", file=sys.stderr)
    sys.exit(1)


# ── Konfigurace ────────────────────────────────────────────────────────────────
PASSIVE_TICKERS = {"VUAA.DE", "ZPRV.DE", "XNAS.DE", "4GLD.DE", "VWCE.DE", "IS3N.DE"}
MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 3000

# ── Session detection ──────────────────────────────────────────────────────────
def detect_session() -> tuple[str, str]:
    """Vrátí ('MORNING'|'EVENING', market_session_label)."""
    h = datetime.now(timezone.utc).hour
    if 4 <= h < 14:
        return "MORNING", "⬤ PRE-MARKET · 07:00 CET"
    else:
        return "EVENING", "⬤ POST-MARKET · 22:00 CET"


# ── Holdings kontext ───────────────────────────────────────────────────────────
def holdings_context() -> str:
    for p in [Path("backend/holdings.json"), Path("holdings.json")]:
        if p.exists():
            data = json.loads(p.read_text())
            hs = data.get("holdings", [])
            passive = [h["ticker"] for h in hs if h.get("portfolio_type") == "passive"]
            picks   = [h["ticker"] for h in hs if h.get("portfolio_type") == "picks"]
            return (
                f"Pasivní ETF/ETC portfolio: {', '.join(passive)}\n"
                f"Stock picks portfolio: {', '.join(picks)}"
            )
    return "Portfolio: VUAA.DE, VWCE.DE, ZPRV.DE, XNAS.DE, IS3N.DE, 4GLD.DE | BRK-B, META, MSFT, NFLX, DUOL, PYPL, RHM.DE"


# ── Prompt ─────────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """Jsi profesionální makroekonomický stratég na institucionální úrovni a editor finančních zpráv.
Odpovídáš VÝHRADNĚ validním JSON objektem — žádný text před ani po JSON, žádné markdown bloky.
Fakta odděluj od interpretace. Buď stručný a konkrétní, ne obecný."""

def build_user_prompt(session: str, now_str: str, portfolio: str) -> str:
    session_cz = "ranní" if session == "MORNING" else "večerní"
    return f"""Dnešní datum a čas: {now_str}
Session: {session} ({session_cz} brief)
Investorovo portfolio: {portfolio}

Prohledej aktuální tržní zprávy a vygeneruj {session_cz} tržní brief.

Analyzuj:
- Vývoj hlavních indexů (S&P 500, Nasdaq, evropské trhy)
- Fed, úrokové sazby, CME FedWatch pravděpodobnosti
- Výnosy dluhopisů (2Y, 10Y, 30Y)
- Makrodata dnešního dne a tento týden
- Klíčové zprávy pro akcie v portfoliu (META, MSFT, NFLX, DUOL, PYPL, RHM.DE, BRK-B)
- Měny: EUR/USD, USD/CZK
- Geopolitika, cla, regulace s dopadem na trhy
- Celkový sentiment

Vrať POUZE tento JSON (bez dalšího textu):
{{
  "headline": "max 80 znaků — nejdůležitější věc dnes pro investora",
  "summary_html": "2-3 věty HTML shrnutí s <strong> pro klíčová slova",
  "key_points": [
    {{"icon": "emoji", "color": "#hexcolor", "text": "HTML text bodu s <b>důrazem</b>"}},
    {{"icon": "emoji", "color": "#hexcolor", "text": "..."}}
  ],
  "rate_probabilities": {{
    "cut": 0.0,
    "hold": 0.0,
    "hike": 0.0,
    "source": "CME FedWatch",
    "next_meeting": "YYYY-MM-DD nebo null"
  }}
}}

Pravidla:
- key_points: 4-6 bodů, každý konkrétní s čísly (ne obecné věty)
- Barvy: bearish=#ef4444, bullish=#22c55e, neutral=#f59e0b, info=#60a5fa
- rate_probabilities: dej 0.0 pokud data nejsou dostupná (ne null)
- Pořadí key_points: nejdůležitější první
- Ignoruj víkendy a svátky (trhy zavřeny) — upozorni v headline"""


# ── JSON extrakce ──────────────────────────────────────────────────────────────
def extract_json(text: str) -> dict:
    """Extrahuje první JSON objekt z textu."""
    # Zkus přímý parse
    try:
        return json.loads(text.strip())
    except Exception:
        pass
    # Hledej JSON blok
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group())
        except Exception:
            pass
    raise ValueError(f"Nepodařilo se extrahovat JSON z odpovědi:\n{text[:500]}")


# ── Hlavní funkce ──────────────────────────────────────────────────────────────
def generate(session: str, market_session: str) -> dict:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("❌ ANTHROPIC_API_KEY není nastaven", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    now = datetime.now(timezone.utc)
    now_str = now.strftime("%A %d. %B %Y %H:%M UTC")
    portfolio = holdings_context()

    print(f"  Session:   {session}")
    print(f"  Čas:       {now_str}")
    print(f"  Portfolio: {portfolio[:80]}...")
    print(f"  Model:     {MODEL}")
    print("  Volám Claude API s web_search...")

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=SYSTEM_PROMPT,
        tools=[{"type": "web_search_20250305", "name": "web_search"}],
        messages=[{"role": "user", "content": build_user_prompt(session, now_str, portfolio)}],
    )

    # Sesbírej text z response (přeskočí tool_use bloky)
    text_parts = []
    for block in response.content:
        if hasattr(block, "text"):
            text_parts.append(block.text)
    full_text = "\n".join(text_parts).strip()

    print(f"  Odpověď: {len(full_text)} znaků, stop_reason={response.stop_reason}")

    brief_data = extract_json(full_text)

    # Validace a doplnění povinných polí
    brief_data.setdefault("headline", "Tržní brief")
    brief_data.setdefault("summary_html", "")
    brief_data.setdefault("key_points", [])
    rp = brief_data.get("rate_probabilities", {})
    brief_data["rate_probabilities"] = {
        "cut":          float(rp.get("cut", 0.0)),
        "hold":         float(rp.get("hold", 0.0)),
        "hike":         float(rp.get("hike", 0.0)),
        "source":       rp.get("source", "CME FedWatch"),
        "next_meeting": rp.get("next_meeting"),
    }

    return {
        "generated_at":   now.isoformat(),
        "session":        session,
        "market_session": market_session,
        "headline":       brief_data["headline"],
        "summary_html":   brief_data["summary_html"],
        "key_points":     brief_data["key_points"],
        "rate_probabilities": brief_data["rate_probabilities"],
    }


# ── Entry point ────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Generate market brief via Claude API")
    parser.add_argument("--session", choices=["MORNING", "EVENING"], default=None,
                        help="Override session detection")
    parser.add_argument("--out", type=Path, default=None,
                        help="Override output file path")
    args = parser.parse_args()

    session, market_session = (args.session, "⬤ PRE-MARKET · 07:00 CET") if args.session == "MORNING" \
        else (args.session, "⬤ POST-MARKET · 22:00 CET") if args.session == "EVENING" \
        else detect_session()

    out_path = args.out or Path(f"brief_{session.lower()}.json")

    print(f"\n📰 Generuji {session} brief → {out_path}")
    try:
        brief = generate(session, market_session)
        out_path.write_text(json.dumps(brief, ensure_ascii=False, indent=2))
        # Zkopíruj i do frontend/public
        fp = Path("frontend/public") / out_path.name
        if fp.parent.exists():
            fp.write_text(json.dumps(brief, ensure_ascii=False, indent=2))
            print(f"  ✅ Uloženo: {out_path} + {fp}")
        else:
            print(f"  ✅ Uloženo: {out_path}")
        print(f"  Headline: {brief['headline']}")
        print(f"  Key points: {len(brief['key_points'])}")
        rp = brief["rate_probabilities"]
        print(f"  Fed: cut={rp['cut']:.1%} hold={rp['hold']:.1%} hike={rp['hike']:.1%}")
    except Exception as e:
        print(f"  ❌ Chyba: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
