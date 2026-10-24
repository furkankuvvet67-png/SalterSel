"""Rize–Artvin current screening case for the panel: HAND tier polygons (z2/z5/z10) and AI zone (0.81 x HAND<=5 area),
generalized like the other AI zones (30 m closing, 40 m simplify, >= 1 ha)."""
import json, glob
import numpy as np, geopandas as gpd, lightgbm as lgb
from rasterio.transform import Affine
from rasterio.features import shapes
from shapely.geometry import shape, box
from shapely.ops import unary_union

ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
USE = [f for f in ALL if f not in {"built500", "wc_built"}]
bst = lgb.Booster(model_file="out/model_v2.txt")
tiles = ["grids/rize_t0.npz", "grids/rize_t1.npz", "grids/rize_t2.npz"]

def gen(mask, tr, epsg):
    ps = [shape(g) for g, v in shapes(mask.astype(np.uint8), mask=mask, transform=tr) if v == 1]
    if not ps: return gpd.GeoSeries([], crs=epsg)
    u = unary_union([p.buffer(30) for p in ps]).buffer(-30)
    g = gpd.GeoSeries(list(u.geoms) if u.geom_type == "MultiPolygon" else [u], crs=epsg)
    return g[g.area >= 10000].simplify(40, preserve_topology=True)

layers = {"z2": [], "z5": [], "z10": [], "ai": []}
area = {k: 0.0 for k in layers}
for gp in tiles:
    d = np.load(gp); names = [str(n) for n in d["names"]]; st = d["stack"]; v = d["valid"]; tr = Affine(*d["transform"]); epsg = int(d["epsg"])
    hand = st[names.index("hand1")]
    pv = bst.predict(np.stack([st[names.index(f)][v] for f in USE], 1)); hv = hand[v]; f5 = (hv <= 5).mean()
    for lv in (2, 5, 10):
        m = v & (np.nan_to_num(hand, nan=999) <= lv); g = gen(m, tr, epsg); layers[f"z{lv}"].append(g.to_crs(4326)); area[f"z{lv}"] += g.area.sum() / 1e6
    target = 0.81 * (hv <= 5).sum() * 900; k = 0.81
    for _ in range(4):
        thr = np.quantile(pv, 1 - k * f5); m = np.zeros(v.shape, bool); m[v] = pv >= thr
        g = gen(m, tr, epsg); got = g.area.sum(); k *= target / got
    layers["ai"].append(g.to_crs(4326)); area["ai"] += got / 1e6
    print(gp, "HAND≤5 payı", round(f5, 3), "AI/HAND5", round(got / ((hv <= 5).sum() * 900), 3), flush=True)

def fc(gl):
    u = unary_union([p for g in gl for p in g.values])
    geoms = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]
    r = lambda c: [round(c[0], 5), round(c[1], 5)]
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon",
            "coordinates": [[r(c) for c in g.exterior.coords]] + [[r(c) for c in i.coords] for i in g.interiors if len(i.coords) >= 4]}} for g in geoms if not g.is_empty]}

A = gpd.read_file("ext/case_rize/assets_all.geojson")
A = A[[c for c in ["osm", "name", "power", "waterway", "source", "voltage", "geometry"] if c in A.columns]]
assets = json.loads(A.to_json(drop_id=True))
for f in assets["features"]:
    f["properties"] = {k: v for k, v in f["properties"].items() if v is not None}
out = {"case": {"cover": [40.30, 40.85, 41.60, 41.45], "assets": assets, "zones": {k: fc(layers[k]) for k in ("z2", "z5", "z10")},
                "rain": "Güncel tarama: bu vaka bir sel olayı değil, Ekim 2026 itibarıyla Rize–Artvin kıyı şeridindeki enerji altyapısının maruziyetidir. Yağış verisi eklenmedi."},
       "aiz": {"zone": fc(layers["ai"]), "ratio": 0.81}}
json.dump(out, open("out/rize_case.json", "w"), separators=(",", ":"))
print({k: round(v, 1) for k, v in area.items()}, "km²;", len(assets["features"]), "varlık")
import os; print("boyut MB", round(os.path.getsize("out/rize_case.json") / 1e6, 2))
