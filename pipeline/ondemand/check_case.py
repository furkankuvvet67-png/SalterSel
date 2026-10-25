"""İstek anında değerlendirmeyi önceden hesaplanmış bir panel vakasıyla karşılaştırır (nokta ve poligon varlıklar).
Referans kademe: varlık izinin değdiği en düşük z2/z5/z10 poligonu (app.js gradeZone gibi); referans AI: AI bölgesine değiyor mu.
python check_case.py CASE_JSON AIZ_JSON OUT_CSV     (CASE_JSON: cover, assets, zones; AIZ_JSON: zone)
"""
import sys, json, csv
from collections import Counter
from shapely.geometry import shape
from shapely.strtree import STRtree
import evaluate as E

case, aiz = json.load(open(sys.argv[1], encoding="utf-8")), json.load(open(sys.argv[2], encoding="utf-8"))
tree = lambda fc: (lambda g: (STRtree(g), g))([shape(f["geometry"]) for f in fc["features"]])
Z = {lv: tree(case["zones"][f"z{lv}"]) for lv in (2, 5, 10)}; AI = tree(aiz["zone"])
hit = lambda t, g: len(t[0].query(g, predicate="intersects")) > 0
x0, y0, x1, y1 = case["cover"]
rows = []
for f in case["assets"]["features"]:
    g = shape(f["geometry"]); p = f["properties"]
    if g.geom_type not in ("Polygon", "Point"): continue
    if not (x0 + .01 <= g.bounds[0] and g.bounds[2] <= x1 - .01 and y0 + .01 <= g.bounds[1] and g.bounds[3] <= y1 - .01): continue
    ref_t = next((lv for lv in (2, 5, 10) if hit(Z[lv], g)), None)
    c = g.centroid
    ring = [[y, x] for x, y in g.exterior.coords] if g.geom_type == "Polygon" else None
    r = E.evaluate(c.y, c.x, ring)
    rows.append(dict(osm=p.get("osm"), name=p.get("name"), kind=p.get("power") or p.get("waterway"), ref_tier=ref_t, od_tier=r.get("tier_zone"), od_raw=r.get("tier"),
                     ref_ai=hit(AI, g), od_ai=r.get("in_ai"), hand_min=r.get("hand_min"), score_pct=r.get("score_pct"), ok=r["ok"], secs=r.get("secs")))
    print(rows[-1], flush=True)

with open(sys.argv[3], "w", newline="", encoding="utf-8") as fh:
    wr = csv.DictWriter(fh, fieldnames=list(rows[0])); wr.writeheader(); wr.writerows(rows)
ev = [r for r in rows if r["ok"]]
tl = lambda t: t or ">10"
print(f"\n{len(rows)} varlık, {len(ev)} değerlendirilebilir")
print("kademe aynı:", sum(r["ref_tier"] == r["od_tier"] for r in ev), "/", len(ev))
print("kademe farkı (ref → istek):", Counter(f'{tl(r["ref_tier"])}→{tl(r["od_tier"])}' for r in ev if r["ref_tier"] != r["od_tier"]))
print("kademe aynı (genelleştirmesiz kural):", sum(r["ref_tier"] == r["od_raw"] for r in ev), "/", len(ev),
      Counter(f'{tl(r["ref_tier"])}→{tl(r["od_raw"])}' for r in ev if r["ref_tier"] != r["od_raw"]))
gap = lambda a, b: abs([2, 5, 10, None].index(a) - [2, 5, 10, None].index(b))
print("en fazla bir kademe fark:", sum(gap(r["ref_tier"], r["od_tier"]) <= 1 for r in ev), "/", len(ev),
      "| genelleştirmesiz:", sum(gap(r["ref_tier"], r["od_raw"]) <= 1 for r in ev), "/", len(ev))
print("AI bölgesi aynı:", sum(r["ref_ai"] == r["od_ai"] for r in ev), "/", len(ev),
      "| ref içinde:", sum(r["ref_ai"] for r in ev), "istek içinde:", sum(r["od_ai"] for r in ev))
print("değerlendirilemeyen:", [(r["name"], r["kind"], r["ref_tier"]) for r in rows if not r["ok"]])
