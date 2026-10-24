"""Evaluate blind 2026 predictions against EMS flood delineations (downloaded here, after predictions were saved)."""
import json, glob, os, io, zipfile, urllib.request
import numpy as np, pandas as pd, geopandas as gpd
from rasterio.transform import Affine
from rasterio.features import rasterize
from scipy.stats import binomtest

sel = {f"{r['code']}_AOI{r['aoi']:02d}": r for r in json.load(open("blind/selected_2026.json"))}
os.makedirs("blind/labels", exist_ok=True)

def labels(aoi):
    fp = f"blind/labels/{aoi}.geojson"
    if os.path.exists(fp):
        return gpd.read_file(fp)
    parts = []
    for u in sel[aoi]["urls"]:
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(u, timeout=300).read()))
        tmp = f"/tmp/claude-0/lab_{aoi}"; os.makedirs(tmp, exist_ok=True)
        z.extractall(tmp)
        for shp in glob.glob(f"{tmp}/**/*observedEventA*.shp", recursive=True):
            g = gpd.read_file(shp)
            if len(g): parts.append(g.to_crs(4326)[["geometry"]])
    g = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=4326) if parts else gpd.GeoDataFrame(geometry=[], crs=4326)
    g["geometry"] = g.geometry.buffer(0); g.to_file(fp, driver="GeoJSON")
    return g

pix, ast = [], []
P = pd.read_csv("blind/predictions_2026.csv")
for pp in sorted(glob.glob("blind/pred/*.npz")):
    aoi = os.path.basename(pp)[:-4]
    d = np.load(pp); v = d["valid"]; tr = Affine(*d["transform"]); epsg = int(d["epsg"])
    L = labels(aoi)
    if not len(L):
        print(aoi, "etiket yok"); continue
    Lu = L.to_crs(epsg)
    fl = rasterize([(g, 1) for g in Lu.geometry if g is not None and not g.is_empty], out_shape=v.shape, transform=tr, fill=0).astype(bool)
    y = fl[v]; p = d["prob"][v].astype(np.float32); h = d["hand"][v].astype(np.float32); ai = d["ai"][v]
    n_fl = int(y.sum())
    row = dict(aoi=aoi, olay=aoi.split("_")[0], sel_px=n_fl, sel_km2=round(n_fl * 9e-4, 2), kara_km2=round(len(y) * 9e-4, 1))
    if n_fl >= 300:
        a = (h <= 5).mean(); rec_h = (y & (h <= 5)).sum() / n_fl
        thr = np.quantile(p, 1 - a); rec_m = (y & (p >= thr)).sum() / n_fl
        cum = np.cumsum(y[np.argsort(-p)]) / n_fl; area_m = (np.searchsorted(cum, rec_h) + 1) / len(y)
        row.update(hand5_pay=round(a, 4), kapsam_hand5=round(rec_h, 3), kapsam_ai_esit_alan=round(rec_m, 3),
                   alan_orani=round(area_m / a, 3), kapsam_ai_bolgesi=round((y & ai).sum() / n_fl, 3), ai_pay=round(ai.mean(), 4))
    pix.append(row)
    # assets
    ap = f"blind/assets/{aoi}.geojson"
    if os.path.exists(ap):
        A = gpd.read_file(ap)
        if len(A):
            fu = Lu.union_all()
            hit = {o: bool(g.intersects(fu)) for o, g in zip(A.osm, A.to_crs(epsg).geometry)}
            for _, r in P[P.aoi == aoi].iterrows():
                ast.append(dict(r, selde=hit.get(r.osm, False)))
X = pd.DataFrame(pix); X.to_csv("blind/eval_pixels_2026.csv", index=False)
Y = pd.DataFrame(ast); Y.to_csv("blind/eval_assets_2026.csv", index=False)

E = X.dropna(subset=["alan_orani"])
print(f"Değerlendirilen AOI (≥300 sel pikseli): {len(E)} / {len(X)}; olay: {E.olay.nunique()}")
print(E[["aoi", "sel_km2", "hand5_pay", "kapsam_hand5", "kapsam_ai_esit_alan", "alan_orani", "kapsam_ai_bolgesi"]].to_string(index=False))
ev = E.groupby("olay")[["alan_orani", "kapsam_hand5", "kapsam_ai_esit_alan"]].median()
w = int((ev.alan_orani < 1).sum())
print(f"\nH1 olay düzeyi: alan oranı medyanı {ev.alan_orani.median():.2f}; model daha iyi {w}/{len(ev)} olay, işaret testi tek yönlü p={binomtest(w, len(ev), .5, alternative='greater').pvalue:.3g}")
print(f"   AOI düzeyi: alan oranı medyanı {E.alan_orani.median():.2f}; model daha iyi {(E.alan_orani < 1).sum()}/{len(E)}")
print(f"   AI bölgesinin (alan = %81 HAND≤5) yakaladığı sel, medyan {E.kapsam_ai_bolgesi.median():.2f}; HAND≤5 {E.kapsam_hand5.median():.2f}")
if len(Y):
    for lab, df in [("nokta/alan", Y[Y.geom != "LineString"]), ("hat", Y[Y.geom == "LineString"])]:
        h5 = df.hand_kademe.isin(["≤2", "≤5"])
        print(f"\nH2 {lab}: {len(df)} varlık, selde {int(df.selde.sum())}")
        print(f"   HAND≤5 işaretlenen {int(h5.sum())}, bunların selde olanı {int((h5 & df.selde).sum())}  (kesinlik {((h5 & df.selde).sum() / max(h5.sum(), 1)):.2f})")
        print(f"   AI bölgesi işaretlenen {int(df.ai_bolgede.sum())}, bunların selde olanı {int((df.ai_bolgede & df.selde).sum())}  (kesinlik {((df.ai_bolgede & df.selde).sum() / max(df.ai_bolgede.sum(), 1)):.2f})")
        print(f"   selde olup kaçırılan: HAND≤5 {int((~h5 & df.selde).sum())}, AI {int((~df.ai_bolgede & df.selde).sum())}")
