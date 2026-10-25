"""İstek anında değerlendirme uçtan uca: serve.py çalışırken. python test_ondemand.py http://localhost:8000/index.html [SHOT_PREFIX]"""
import sys, asyncio
from playwright.async_api import async_playwright
PAGE = sys.argv[1]
SHOT = sys.argv[2] if len(sys.argv) > 2 else "shot_od"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console.error: " + m.text) if m.type == "error" else None)
        await pg.goto(PAGE, wait_until="load", timeout=120000); await pg.wait_for_timeout(2500)
        print("DURUM ÇUBUĞU:", await pg.inner_text("#stSvc"))
        await pg.fill("#q", "İkizdere TM"); await pg.press("#q", "Enter"); await pg.wait_for_timeout(1500)
        print("KART:", (await pg.inner_text("#rDetail")).split("\n")[0])
        await pg.click("#bEval")
        await pg.wait_for_function("document.querySelector('#evOut').innerText.length > 0", timeout=240000)
        await pg.wait_for_timeout(2500)
        print("DURUM:", await pg.inner_text("#evState"))
        print("SONUÇ:", (await pg.inner_text("#evOut")).replace("\n", " | "))
        print("LİSTE:", [(await r.inner_text()).replace("\n", " ") for r in (await pg.query_selector_all("#vList .row"))[:3]])
        await pg.screenshot(path=f"{SHOT}_tm.png")
        # rapor kartları: çevir, arka yüz görünüyor mu, metin sığıyor mu
        cards = await pg.query_selector_all("#evOut .bc")
        print("KART SAYISI:", len(cards))
        for c in cards[:3]: await c.click()
        await pg.wait_for_timeout(700)
        print("ÇEVRİLEN:", await pg.evaluate("[...document.querySelectorAll('#evOut .bc[aria-pressed=true]')].length"))
        print("TAŞAN ARKA YÜZ:", await pg.evaluate("[...document.querySelectorAll('#evOut .bc-b')].filter(b => b.scrollHeight > b.clientHeight + 1).map(b => b.querySelector('.bc-l').textContent)"))
        await pg.screenshot(path=f"{SHOT}_tm_cevir.png")
        for c in cards[:3]: await c.click()
        await pg.click('.tab[data-tab="layers"]'); await pg.wait_for_timeout(300)
        await pg.click('.ov[data-ov="ai"]'); await pg.wait_for_timeout(800)
        await pg.screenshot(path=f"{SHOT}_tm_ai.png")
        # herhangi bir nokta: harita aracıyla
        await pg.click("#tPick")
        box = await (await pg.query_selector("#rmap")).bounding_box()
        await pg.mouse.click(box["x"] + box["width"] * 0.35, box["y"] + box["height"] * 0.55)
        await pg.wait_for_function("document.querySelector('#evState').innerText.startsWith('Tamamlandı')", timeout=240000)
        await pg.wait_for_timeout(2500)
        print("NOKTA:", (await pg.inner_text("#info")).replace("\n", " | ")[:400])
        await pg.click('.tab[data-tab="eval"]'); await pg.wait_for_timeout(300)
        print("GEÇMİŞ:", [(await r.inner_text()).replace("\n", " ") for r in await pg.query_selector_all("#evHist .row")])
        await pg.screenshot(path=f"{SHOT}_nokta.png")
        print("HATALAR:", errs or "yok")
        await b.close()
asyncio.run(main())
