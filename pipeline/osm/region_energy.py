"""Türkiye (81 il) enerji envanteri: Overpass'tan güncel OSM varlıkları, il sınırları ve coğrafi bölgelerle.
power=substation/plant/generator noktası (poligonlar merkez + iz), power=line hattı, waterway=dam.
Dışarıda bırakılan: güneş paneli dizileri (generator:source=solar; GES santrali zaten var, ikinci kez sayar) ve
dağıtım hatları (power=minor_line; OSM'de dağınık, dosyayı ikiye katlıyor).
Sorgular: il sınırları 4 parti, varlıklar 2° karolar; il ataması shapely ile. python region_energy.py OUT_JS
"""
import sys, json, time, datetime, ssl, urllib.request, urllib.parse
from collections import Counter
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree
from shapely.prepared import prep
try:  # Windows'taki Python'un kök sertifika deposu eski kalabiliyor; certifi varsa onu kullan
    import certifi; CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    CTX = None

OUT = sys.argv[1]
URL = "https://overpass-api.de/api/interpreter"
UA = {"User-Agent": "climathon-research (furkankuvvet67@gmail.com)", "Accept": "*/*"}
TOL = 0.0002  # ~20 m hat sadeleştirme
REG = {  # coğrafi bölge → il plaka kodları
    "Marmara": [10, 11, 16, 17, 22, 34, 39, 41, 54, 59, 77],
    "Ege": [3, 9, 20, 35, 43, 45, 48, 64],
    "Akdeniz": [1, 7, 15, 31, 32, 33, 46, 80],
    "İç Anadolu": [68, 6, 18, 26, 70, 38, 71, 40, 42, 50, 51, 58, 66],
    "Karadeniz": [5, 8, 74, 69, 14, 19, 81, 28, 29, 78, 37, 52, 53, 55, 57, 60, 61, 67],
    "Doğu Anadolu": [4, 75, 12, 13, 23, 24, 25, 30, 76, 36, 44, 49, 62, 65],
    "Güneydoğu Anadolu": [2, 72, 21, 27, 79, 47, 56, 63, 73],
}
REG_OF = {f"TR-{n:02d}": r for r, ns in REG.items() for n in ns}
assert len(REG_OF) == 81


def op(q):
    for t in range(8):
        try:
            req = urllib.request.Request(URL, data=urllib.parse.urlencode({"data": q}).encode(), headers=UA)
            return json.load(urllib.request.urlopen(req, timeout=900, context=CTX))["elements"]
        except Exception as e:
            print("  yeniden", t, e, flush=True); time.sleep(15 * (t + 1))
    raise SystemExit("Overpass yanıt vermedi")


def simplify(pts, tol=TOL):
    if len(pts) < 3: return pts
    if pts[0] == pts[-1]:  # kapalı halka: uç noktalar çakışır, iki yarıyı ayrı sadeleştir
        h = len(pts) // 2
        return simplify(pts[:h + 1], tol) + simplify(pts[h:], tol)[1:]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay; L = (dx * dx + dy * dy) ** .5 or 1e-12
        i, dm = 0, 0
        for k in range(a + 1, b):
            d = abs(dy * (pts[k][0] - ax) - dx * (pts[k][1] - ay)) / L
            if d > dm: i, dm = k, d
        if dm > tol:
            keep[i] = True; st += [(a, i), (i, b)]
    return [p for p, k in zip(pts, keep) if k]


r5 = lambda g: [[round(p["lat"], 5), round(p["lon"], 5)] for p in g]

# 1) il sınırları (4 parti)
codes = sorted(REG_OF)
prov, geoms, border = [], [], {}
for i in range(0, 81, 21):
    part = "|".join(c[3:] for c in codes[i:i + 21])
    rels = [e for e in op(f'[out:json][timeout:900];rel["ISO3166-2"~"^TR-({part})$"]["admin_level"="4"];out geom;') if e["type"] == "relation"]
    for e in sorted(rels, key=lambda e: e["tags"]["ISO3166-2"]):
        code = e["tags"]["ISO3166-2"]
        outer = [m for m in e["members"] if m["type"] == "way" and m.get("role") == "outer" and m.get("geometry")]
        g = unary_union(list(polygonize([LineString([(p["lon"], p["lat"]) for p in m["geometry"]]) for m in outer])))
        prov.append({"c": code, "n": e["tags"].get("name:tr") or e["tags"]["name"], "r": REG_OF[code]})
        geoms.append(g)
        for m in outer: border.setdefault(m["ref"], simplify(r5(m["geometry"]), 0.0015))
    print(len(prov), "il", flush=True); time.sleep(3)
assert len(prov) == 81, sorted(set(codes) - {p["c"] for p in prov})
tree = STRtree(geoms); preps = [prep(g) for g in geoms]


def prov_of(lat, lon):
    pt = Point(lon, lat)
    for i in tree.query(pt):
        if preps[i].intersects(pt): return int(i)
    return None


# 2) varlıklar, 2° karolar
x0, y0, x1, y1 = unary_union(geoms).bounds
pts, lines = {}, {}
y = y0
while y < y1:
    x = x0
    while x < x1:
        bb = f"{y:.3f},{x:.3f},{min(y + 2, y1):.3f},{min(x + 2, x1):.3f}"
        els = op(f'[out:json][timeout:900][bbox:{bb}];'
                 f'(node["power"~"^(substation|plant)$"];node["power"="generator"]["generator:source"!="solar"];node["waterway"="dam"];);out;'
                 f'(way["power"~"^(substation|plant)$"];way["power"="generator"]["generator:source"!="solar"];way["waterway"="dam"];);out geom tags;'
                 f'(rel["power"~"^(substation|plant)$"];rel["waterway"="dam"];);out center tags;'
                 f'way["power"="line"];out geom tags;')
        for e in els:
            t = e.get("tags", {}); k = f'{e["type"]}/{e["id"]}'
            if k in pts or k in lines: continue
            if t.get("power") == "line":
                if not e.get("geometry"): continue
                g = r5(e["geometry"])
                ps = sorted({p for p in (prov_of(*q) for q in g[::5] + [g[-1]]) if p is not None})
                if not ps: continue
                lines[k] = {"id": k, "n": t.get("name"), "v": t.get("voltage"), "op": t.get("operator"), "p": ps, "g": simplify(g)}
                continue
            fp = None   # tesis izi: istek anında değerlendirmede kademe izin değdiği en düşük hücreden gelir
            if e.get("geometry"):
                g = r5(e["geometry"])
                ll = [round(sum(p[0] for p in g) / len(g), 5), round(sum(p[1] for p in g) / len(g), 5)]
                fp = simplify(g, 0.00005) if g[0] == g[-1] and len(g) >= 4 else g
            else:
                c = e if "lat" in e else e.get("center")
                if not c: continue
                ll = [round(c["lat"], 5), round(c["lon"], 5)]
            pi = prov_of(*ll)
            if pi is None: continue
            ty = {"substation": "sub", "plant": "plant", "generator": "gen"}.get(t.get("power"), "dam")
            pts[k] = {"id": k, "t": ty, "s": t.get("plant:source") or t.get("generator:source"), "n": t.get("name"),
                      "v": t.get("voltage"), "op": t.get("operator"), "mw": t.get("plant:output:electricity") or t.get("generator:output:electricity"),
                      "p": pi, "ll": ll, **({"fp": fp} if fp else {})}
        print(f"karo {bb}: {len(pts)} nokta, {len(lines)} hat", flush=True)
        time.sleep(2)
        x += 2
    y += 2

R = {"date": datetime.date.today().isoformat(), "scope": "Türkiye", "prov": prov, "regions": list(REG),
     "border": list(border.values()), "pts": list(pts.values()), "lines": list(lines.values())}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("const REGION=" + json.dumps(R, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(OUT, Counter(p["t"] for p in pts.values()), len(lines), "hat")
print("bölgeye göre:", Counter(prov[p["p"]]["r"] for p in pts.values()))
