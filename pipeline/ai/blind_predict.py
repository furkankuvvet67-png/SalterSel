"""Blind predictions for 2026 AOIs (no labels touched). Writes blind/pred/<aoi>.npz (prob, hand, ai mask, aoi mask) and
blind/predictions_2026.csv (one row per OSM energy asset)."""
import json, glob, os
import numpy as np, pandas as pd, geopandas as gpd, lightgbm as lgb
from rasterio.transform import Affine, rowcol
from rasterio.features import rasterize

RATIO = 0.81
ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
USE = [f for f in ALL if f not in {"built500", "wc_built"}]
bst = lgb.Booster(model_file="out/model_v2.txt")
os.makedirs("blind/pred", exist_ok=True)
rows, summ = [], []
for gp in sorted(glob.glob("blind/grids/*.npz")):
    aoi = os.path.basename(gp)[:-4]
    d = np.load(gp); names = [str(n) for n in d["names"]]; st = d["stack"]; v = d["valid"]; tr = Affine(*d["transform"]); epsg = int(d["epsg"])
    if v.sum() == 0:
        print(aoi, "geçerli piksel yok"); continue
    pv = bst.predict(np.stack([st[names.index(f)][v] for f in USE], 1))
    hand = st[names.index("hand1")]
    hv = hand[v]; f5 = (hv <= 5).mean()
    thr = np.quantile(pv, 1 - RATIO * f5)
    prob = np.full(v.shape, np.nan, np.float32); prob[v] = pv
    ai = np.zeros(v.shape, bool); ai[v] = pv >= thr
    np.savez_compressed(f"blind/pred/{aoi}.npz", prob=prob.astype(np.float16), hand=hand.astype(np.float16), ai=ai, valid=v,
                        transform=d["transform"], epsg=epsg, thr=thr)
    summ.append(dict(aoi=aoi, kara_km2=round(v.sum() * 9e-4, 1), hand5_km2=round((hv <= 5).sum() * 9e-4, 1), ai_km2=round(ai.sum() * 9e-4, 1)))
    ap = f"blind/assets/{aoi}.geojson"
    if not os.path.exists(ap):
        print(aoi, "varlık dosyası yok"); continue
    A = gpd.read_file(ap)
    if not len(A): continue
    Au = A.to_crs(epsg)
    for i, a in Au.iterrows():
        g = a.geometry
        if g.geom_type in ("LineString", "MultiLineString"):
            cells = [rowcol(tr, p.x, p.y) for p in (g.interpolate(t) for t in np.arange(0, g.length + 1, 15))]
        elif g.geom_type == "Point":
            cells = [rowcol(tr, g.x, g.y)]
        else:
            m = rasterize([(g, 1)], out_shape=v.shape, transform=tr, all_touched=True); cells = list(zip(*np.nonzero(m)))
            if not cells: c = g.centroid; cells = [rowcol(tr, c.x, c.y)]
        cells = [(r, c) for r, c in cells if 0 <= r < v.shape[0] and 0 <= c < v.shape[1] and v[r, c]]
        if not cells:
            continue   # outside analysed land (outside AOI, water, DEM edge)
        rr = np.array([r for r, _ in cells]); cc = np.array([c for _, c in cells])
        hmin = float(np.nanmin(hand[rr, cc]))
        tier = "≤2" if hmin <= 2 else "≤5" if hmin <= 5 else "≤10" if hmin <= 10 else ">10"
        kind = a.get("power") or ("dam" if a.get("waterway") == "dam" else "?")
        rows.append(dict(aoi=aoi, osm=a.osm, name=a.get("name"), kind=kind, geom=g.geom_type,
                         ai_bolgede=bool(ai[rr, cc].any()), ai_pay=round(float(ai[rr, cc].mean()), 3), hand_min=round(hmin, 2), hand_kademe=tier,
                         n_hucre=len(cells)))
P = pd.DataFrame(rows); P.to_csv("blind/predictions_2026.csv", index=False)
S = pd.DataFrame(summ); S.to_csv("blind/pred_summary_2026.csv", index=False)
pt = P[P.geom != "LineString"]
print(len(S), "AOI;", len(P), "varlık (", len(pt), "nokta/alan )")
print("Nokta/alan: AI bölgesinde", int(pt.ai_bolgede.sum()), "| HAND ≤5:", int(pt.hand_kademe.isin(["≤2", "≤5"]).sum()))
print("AI alanı / HAND≤5 alanı:", round(S.ai_km2.sum() / S.hand5_km2.sum(), 3))
