"""Within-tier check: among land in the same HAND tier (<=2, 2-5, 5-10, >10 m), where does the facility's model score rank?"""
import glob, numpy as np, geopandas as gpd, lightgbm as lgb
from rasterio.transform import Affine
from rasterio.features import rasterize
ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
USE = [f for f in ALL if f not in {"built500", "wc_built"}]
tier = lambda h: np.digitize(h, [2, 5, 10], right=True)
items = [("47323821", "v2"), ("25640198", "v2"), ("58226629", "v2_no773"), ("310495252", "v2_nodesmond"),
         ("409049317", "v2"), ("95512216", "v2"), ("823477053", "v2"), ("ebru", "v2"), ("94745966", "v2_no720")]
out = []
for key, model in items:
    bst = lgb.Booster(model_file=f"out/model_{model}.txt")
    if key == "ebru":
        A = gpd.read_file("ext/case_bozkurt/assets.geojson"); geom = A.geometry.iloc[7]; name = "Ebru HES"; best = None
        for t in range(3):
            d = np.load(f"grids/bozkurt_t{t}.npz"); tr = Affine(*d["transform"]); v = d["valid"]
            m = rasterize([(gpd.GeoSeries([geom], crs=4326).to_crs(int(d["epsg"])).iloc[0], 1)], out_shape=v.shape, transform=tr, all_touched=True).astype(bool) & v
            if m.any():
                r, c = np.nonzero(m); e = min(r.min(), c.min(), v.shape[0] - r.max(), v.shape[1] - c.max())
                if best is None or e > best[0]: best = (e, d, m)
        _, d, m = best
    else:
        d = np.load(f"grids/tm_{key}.npz"); tr = Affine(*d["transform"]); v = d["valid"]
        a = gpd.read_file(f"ext/tm_{key}/assets.geojson").to_crs(int(d["epsg"])); name = a.name.iloc[0].split(" (")[0]
        m = rasterize([(a.geometry.iloc[0], 1)], out_shape=v.shape, transform=tr, all_touched=True).astype(bool) & v
    names = [str(n) for n in d["names"]]; st = d["stack"]; v = d["valid"]
    pv = bst.predict(np.stack([st[names.index(f)][v] for f in USE], 1))
    prob = np.full(v.shape, np.nan); prob[v] = pv; hand = st[names.index("hand1")]
    # facility cell = the cell with lowest HAND (the panel's tier), its model score
    cells = np.argwhere(m); hc = hand[m]; k = np.argmin(hc); h = hc[k]; s = prob[m][k]
    T = tier(h); same = tier(hand[v]) == T
    q = (pv[same] >= s).mean()
    out.append((name, ["≤2", "2–5", "5–10", ">10"][T], round(h, 2), round(q * 100, 1)))
    print(f"{name:32s} kademe {['≤2','2–5','5–10','>10'][T]:5s} HAND {h:5.2f} m | kademe içi model sırası: üst %{q*100:5.1f}")
qs = np.array([o[3] for o in out]); print(f"\nmedyan %{np.median(qs):.1f}; üst yarıda {int((qs <= 50).sum())}/{len(qs)}")
