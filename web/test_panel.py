import sys, asyncio
from playwright.async_api import async_playwright
PAGE = sys.argv[1]

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1400, "height": 1000})
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error",) else None)
        await pg.goto(("file://" if PAGE.startswith("/") else "") + PAGE, wait_until="load", timeout=120000)
        await pg.wait_for_timeout(2500)
        for case in ["bozkurt", "kumluca", "trabzon", "rize"]:
            await pg.click(f'button.cs[data-case="{case}"]'); await pg.wait_for_timeout(1500)
            for layer in (["scar"] if case == "bozkurt" else []) + ["zone", "ai"]:
                dis = await pg.get_attribute(f'button.ly[data-layer="{layer}"]', "disabled")
                await pg.click(f'button.ly[data-layer="{layer}"]'); await pg.wait_for_timeout(2500)
                summ = await pg.inner_text("#summary"); chips = await pg.inner_text("#chips")
                rows = await pg.query_selector_all("#list .row")
                first = [await r.inner_text() for r in rows[:4]]
                print(f"\n== {case} / {layer} (disabled={dis}) | {chips.strip()}\n  ÖZET: {summ[:600]}\n  LİSTE: {[f.replace(chr(10),' ') for f in first]}")
                if case == "bozkurt" and layer == "ai":
                    await pg.screenshot(path="/home/claude/panel/shot_bozkurt_ai.png")
                    if rows:
                        await rows[0].click(); await pg.wait_for_timeout(500)
                        print("  AYRINTI:", (await pg.inner_text("#detail"))[:500].replace("\n", " | "))
                    prompt = await pg.evaluate("currentPrompt()")
                    print("  İSTEM (ilk 900):", prompt[:900].replace("\n", " / "))
                    print("  İSTEM satır örneği:", [l for l in prompt.split("\n") if "HAND kademesi:" in l][:2])
        await pg.click('button.cs[data-case="kumluca"]'); await pg.wait_for_timeout(800)
        await pg.click('button.ly[data-layer="ai"]'); await pg.wait_for_timeout(1500)
        await pg.screenshot(path="/home/claude/panel/shot_kumluca_ai.png")
        card = await pg.inner_text("#aiValCard"); print("\nKART:", card[:900].replace("\n", " | "))
        print("\nHATALAR:", errs if errs else "yok")
        await b.close()
asyncio.run(main())
