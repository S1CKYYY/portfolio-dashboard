"""
scrape_fedwatch.py — headless Chrome přes Playwright.
Spouštěno v GitHub Actions: čeká na načtení CME FedWatch stránky a čte DOM.
"""
import json, sys, asyncio
from pathlib import Path
from datetime import datetime, timezone

OUT = Path("fedwatch_cache.json")

async def scrape():
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("Playwright není nainstalován")
        return False

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
            locale="en-US",
        )
        page = await context.new_page()

        # Skryj že jsme headless
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)

        print("  Načítám CME FedWatch...")
        try:
            await page.goto(
                "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
                wait_until="networkidle",
                timeout=30000
            )
        except Exception as e:
            print(f"  Chyba načítání: {e}")
            await browser.close()
            return False

        # Čekej na tabulku s pravděpodobnostmi
        print("  Čekám na data...")
        try:
            await page.wait_for_selector("table", timeout=15000)
        except Exception:
            print("  Tabulka se nenačetla")

        # Zkus extrahovat data z DOM
        data = await page.evaluate("""() => {
            // Hledej pravděpodobnosti v tabulce nebo v textu
            const cells = Array.from(document.querySelectorAll('td, th'));
            const text = document.body.innerText;

            // Hledej pattern "X.X %" v blízkosti EASE/NO CHANGE/HIKE
            const patterns = {
                ease: /EASE[^\\d]*(\\d+\\.\\d+)\\s*%/i,
                noChange: /NO\\s+CHANGE[^\\d]*(\\d+\\.\\d+)\\s*%/i,
                hike: /HIKE[^\\d]*(\\d+\\.\\d+)\\s*%/i,
            };

            const result = {};
            for (const [key, pattern] of Object.entries(patterns)) {
                const match = text.match(pattern);
                if (match) result[key] = parseFloat(match[1]) / 100;
            }

            // Zkus i mid price kontraktu
            const midMatch = text.match(/MID\\s+PRICE[^\\d]*(\\d+\\.\\d+)/i);
            if (midMatch) result.midPrice = parseFloat(midMatch[1]);

            result.pageTitle = document.title;
            result.bodyLength = text.length;
            return result;
        }""")

        print(f"  DOM data: {data}")
        await browser.close()

        if data.get("noChange") is not None or data.get("ease") is not None:
            cut_p  = data.get("ease", 0)
            hold_p = data.get("noChange", 0)
            hike_p = data.get("hike", 0)
            total  = cut_p + hold_p + hike_p
            if total > 0:
                cut_p /= total; hold_p /= total; hike_p /= total

            result = {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "source": "CME FedWatch (Playwright)",
                "futures_price": data.get("midPrice"),
                "cut_probability":  round(cut_p,  3),
                "hold_probability": round(hold_p, 3),
                "hike_probability": round(hike_p, 3),
            }
            OUT.write_text(json.dumps(result, indent=2))
            print(f"  ✅ Uloženo: cut={cut_p:.1%} hold={hold_p:.1%} hike={hike_p:.1%}")
            return True
        else:
            print(f"  ⚠️ Data nenalezena v DOM (délka stránky: {data.get('bodyLength', 0)})")
            return False

if __name__ == "__main__":
    ok = asyncio.run(scrape())
    sys.exit(0 if ok else 1)
