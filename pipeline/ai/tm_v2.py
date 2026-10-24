"""Facility ranking test for v2 models.
python tm_v2.py dev        -> development set (Sinzig, Rheinbach, Quart, Caton Road)
python tm_v2.py holdout    -> independent set, run ONCE after model selection
"""
import sys, glob, numpy as np, geopandas as gpd, lightgbm as lgb, pandas as pd
from rasterio.transform import Affine
from rasterio.features import rasterize
sys.argv += [""]
ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
USE = [f for f in ALL if f not in {"built500", "wc_built"}]
tag = sys.argv[2] if len(sys.argv) > 3 and sys.argv[2] else "v2"
SETS = {"dev": [("47323821", tag), ("25640198", tag), ("58226629", f"{tag}_no773"), ("310495252", f"{tag}_nodesmond")],
        "holdout": [("409049317", tag), ("95512216", tag), ("823477053", tag), ("ebru", tag), ("94745966", f"{tag}_no720")]}

def pct_window(prob_valid, hand_valid, s, h):
    return (prob_valid >= s).mean(), (hand_valid <= h).mean()

rows = []
for key, model in SETS[sys.argv[1]]:
    bst = lgb.Booster(model_file=f"out/model_{model}.txt")
    if key == "ebru":
        best = None
        A = gpd.read_file("ext/case_bozkurt/assets.geojson"); geom = A.geometry.iloc[7]; name = "Ebru HES (Bozkurt 2021)"
        for t in range(3):
            d = np.load(f"grids/bozkurt_t{t}.npz"); tr = Affine(*d["transform"]); v = d["valid"]
            ga = gpd.GeoSeries([geom], crs=4326).to_crs(int(d["epsg"])).iloc[0]
            m = rasterize([(ga, 1)], out_shape=v.shape, transform=tr, all_touched=True).astype(bool) & v
            if not m.any(): continue
            r_, c_ = np.nonzero(m); edge = min(r_.min(), c_.min(), v.shape[0] - r_.max(), v.shape[1] - c_.max())
            if best is None or edge > best[0]: best = (edge, d, m)
        _, d, m = best
    else:
        d = np.load(f"grids/tm_{key}.npz"); tr = Affine(*d["transform"]); v = d["valid"]
        a = gpd.read_file(f"ext/tm_{key}/assets.geojson").to_crs(int(d["epsg"])); name = a.name.iloc[0]
        m = rasterize([(a.geometry.iloc[0], 1)], out_shape=v.shape, transform=tr, all_touched=True).astype(bool) & v
    names = [str(n) for n in d["names"]]; st = d["stack"]; v = d["valid"]
    Xv = np.stack([st[names.index(f)][v] for f in USE], 1); pv = bst.predict(Xv)
    prob = np.full(v.shape, np.nan); prob[v] = pv; hand = st[names.index("hand1")]
    s = np.nanmax(prob[m]); h = np.nanmin(hand[m])
    ai, hp = pct_window(pv, hand[v], s, h)
    from scipy.stats import rankdata
    hv = hand[v]; rh = rankdata(hv, method="max") / len(hv); rm = rankdata(-pv, method="max") / len(pv); cv = np.minimum(rh, rm)
    ca = min((hv <= h).mean(), (pv >= s).mean()); ens = (cv <= ca).mean()
    rows.append(dict(tesis=name, model=model, hand_m=round(float(h), 2), hand_sira=round(hp * 100, 1), model_sira=round(ai * 100, 1),
                     model_iyi_ya_da_esit=bool(ai <= hp), birlesik_sira=round(ens * 100, 1), birlesik_iyi_ya_da_esit=bool(ens <= hp)))
df = pd.DataFrame(rows); print(df.to_string(index=False)); df.to_csv(f"out/tm_{sys.argv[1]}_{tag}.csv", index=False)
