"""Platform düzeni: masaüstü (açık tema) ve telefon (koyu tema). python test_platform.py http://localhost:8000/index.html [SHOT_PREFIX]"""
import sys, asyncio
from playwright.async_api import async_playwright
PAGE = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else "shot_platform"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, scheme in [("masa", {"width": 1440, "height": 900}, "light"), ("telefon", {"width": 390, "height": 844}, "dark")]:
            pg = await b.new_page(viewport=vp, color_scheme=scheme)
            errs = []
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errs.append("console.error: " + m.text) if m.type == "error" else None)
            await pg.goto(PAGE, wait_until="load", timeout=120000); await pg.wait_for_timeout(3000)
            side = await pg.is_visible("#side")
            print(f"\n== {name} ({scheme}) | panel açık: {side} | {(await pg.inner_text('#chips')).strip()}")
            print("  DURUM ÇUBUĞU:", (await pg.inner_text("#status")).replace("\n", " "))
            print("  GÖRÜNEN:", (await pg.inner_text("#vSum"))[:300])
            print("  yatay kaydırma:", await pg.evaluate("document.documentElement.scrollWidth > innerWidth"))
            box = await (await pg.query_selector("#rmap")).bounding_box()
            print("  harita boyutu:", round(box["width"]), "x", round(box["height"]))
            await pg.screenshot(path=f"{SHOT}_{name}.png")
            if not side: await pg.click('.tab[data-tab="explore"]'); await pg.wait_for_timeout(500)
            await pg.screenshot(path=f"{SHOT}_{name}_panel.png")
            await pg.select_option("#prov", label="Artvin"); await pg.wait_for_timeout(1800)
            print("  ARTVİN:", (await pg.inner_text("#vSum"))[:300])
            rows = await pg.query_selector_all("#vList .row")
            await rows[0].click(); await pg.wait_for_timeout(1200)
            print("  KART:", (await pg.inner_text("#info")).replace("\n", " | ")[:300], "| panel açık:", await pg.is_visible("#side"))
            await pg.screenshot(path=f"{SHOT}_{name}_kart.png")
            await pg.click('.tab[data-tab="layers"]'); await pg.wait_for_timeout(400)
            print("  KATMANLAR:", (await pg.inner_text("#types")).replace("\n", " | ")[:200])
            await pg.screenshot(path=f"{SHOT}_{name}_katman.png")
            await pg.click('.tab[data-tab="layers"]'); await pg.wait_for_timeout(400)
            print("  panel kapandı:", not await pg.is_visible("#side"))
            print("  HATALAR:", errs or "yok")
            await pg.close()
        await b.close()
asyncio.run(main())
