"""AI screening zone for panel cases. Zone = top-scoring land whose area is 0.81 x the HAND<=5 m area of the same grid
(0.81 = median 'same flood coverage' area ratio of v2 in storm-grouped leave-out evaluation)."""
import json, sys, glob
import numpy as np, geopandas as gpd, lightgbm as lgb
from rasterio.transform import Affine
from rasterio.features import shapes
from shapely.geometry import shape
from shapely.ops import unary_union

RATIO = 0.81
ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
USE = [f for f in ALL if f not in {"built500", "wc_built"}]
bst = lgb.Booster(model_file="out/model_v2.txt")
cases = {"bozkurt": ["grids/bozkurt_t0.npz", "grids/bozkurt_t1.npz", "grids/bozkurt_t2.npz"],
         "kumluca": ["grids/kumluca.npz"], "trabzon": ["grids/trabzon.npz"]}
out = {}
for case, gl in cases.items():
    polys, a_ai, a_h5 = [], 0.0, 0.0
    for gp in gl:
        d = np.load(gp); names = [str(n) for n in d["names"]]; st = d["stack"]; v = d["valid"]; tr = Affine(*d["transform"]); epsg = int(d["epsg"])
        pv = bst.predict(np.stack([st[names.index(f)][v] for f in USE], 1))
        h = st[names.index("hand1")][v]
        f5 = (h <= 5).mean(); target = RATIO * (h <= 5).sum() * 900
        # shrink the raw share until the generalized (closed + simplified) zone has the target area
        k = RATIO
        for _ in range(4):
            thr = np.quantile(pv, 1 - k * f5); m = np.zeros(v.shape, bool); m[v] = pv >= thr
            ps0 = [shape(g0) for g0, val in shapes(m.astype(np.uint8), mask=m, transform=tr) if val == 1]
            u1 = unary_union([q.buffer(30) for q in ps0]).buffer(-30)
            gg1 = gpd.GeoSeries(list(u1.geoms) if u1.geom_type == "MultiPolygon" else [u1], crs=epsg)
            got = gg1[gg1.area >= 10000].simplify(40, preserve_topology=True).area.sum()
            k *= target / got
        print(f"   ham pay katsayısı {k:.3f}, son alan/HAND≤5 = {got / ((h <= 5).sum() * 900):.3f}")
        a_ai += m.sum() * 900 / 1e6; a_h5 += (h <= 5).sum() * 900 / 1e6
        ps = [shape(g) for g, val in shapes(m.astype(np.uint8), mask=m, transform=tr) if val == 1]
        g = gpd.GeoSeries(ps, crs=epsg)
        raw_km2 = g.area.sum() / 1e6
        u0 = unary_union(list(g.buffer(30))).buffer(-30)          # closing: merge fragments 60 m apart
        g = gpd.GeoSeries(list(u0.geoms) if u0.geom_type == "MultiPolygon" else [u0], crs=epsg)
        g = g[g.area >= 10000].simplify(40, preserve_topology=True)
        print(f"   sadeleştirme: alan {raw_km2:.1f} → {g.area.sum()/1e6:.1f} km²")
        polys.append(g.to_crs(4326))
        print(case, gp, f"HAND≤5 payı {f5:.3f}, AI bölgesi {m.sum()*900/1e6:.1f} km²", flush=True)
    allp = gpd.GeoSeries(np.concatenate([p.values for p in polys]), crs=4326)
    u = unary_union(list(allp))   # tiles overlap
    geoms = list(u.geoms) if u.geom_type == "MultiPolygon" else [u]
    def rnd(c): return [round(c[0], 5), round(c[1], 5)]
    feats = []
    for gg in geoms:
        if gg.is_empty: continue
        rings = [[rnd(c) for c in gg.exterior.coords]] + [[rnd(c) for c in r.coords] for r in gg.interiors if len(r.coords) >= 4]
        feats.append({"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": rings}})
    out[case] = {"zone": {"type": "FeatureCollection", "features": feats}, "ratio": RATIO}
    print(case, len(feats), "poligon")
json.dump(out, open("out/aiz_panel.json", "w"), separators=(",", ":"))
import os; print("boyut MB", os.path.getsize("out/aiz_panel.json") / 1e6)
