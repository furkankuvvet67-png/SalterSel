"""Sentinel-2 flood scar (sediment/vegetation loss) for a case, written as observedEventA/areaOfInterestA shapefiles.
Rule (does not use any terrain information): NDVI drop > 0.25 and post NDVI < 0.35, both scenes clear (SCL not 3,6,8,9,10),
not water before; morphological opening 1 px; clusters >= 10 px (0.1 ha).
python s2scar.py OUTDIR minlon minlat maxlon maxlat PRE_ID POST_ID
"""
import sys, os
import numpy as np, rasterio, geopandas as gpd
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds
from rasterio.features import shapes
from shapely.geometry import shape, box
from scipy import ndimage
import pystac_client, planetary_computer as pc

out, x0, y0, x1, y1, pre_id, post_id = sys.argv[1], *map(float, sys.argv[2:6]), sys.argv[6], sys.argv[7]
cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
col = cat.get_collection("sentinel-2-l2a")

def load(iid):
    it = pc.sign(col.get_item(iid))
    res = {}
    for b in ["B04", "B08", "SCL"]:
        with rasterio.open(it.assets[b].href) as s:
            bb = transform_bounds(4326, s.crs, x0, y0, x1, y1)
            w = from_bounds(*bb, transform=s.transform)
            scale = 2 if b == "SCL" else 1
            a = s.read(1, window=w, out_shape=(int(round(w.height * scale)), int(round(w.width * scale))) if b == "SCL" else None,
                       resampling=rasterio.enums.Resampling.nearest)
            if b == "B04":
                tr = s.window_transform(w); crs = s.crs
            res[b] = a
    h = min(v.shape[0] for v in res.values()); wdt = min(v.shape[1] for v in res.values())
    res = {k: v[:h, :wdt] for k, v in res.items()}
    return res, tr, crs

A, tr, crs = load(pre_id); B, _, _ = load(post_id)
def ndvi(d):
    r = d["B04"].astype(float); n = d["B08"].astype(float)
    return (n - r) / np.maximum(n + r, 1)
bad = lambda s: np.isin(s, [0, 3, 6, 8, 9, 10])
clear = ~bad(A["SCL"]) & ~bad(B["SCL"])
na, nb = ndvi(A), ndvi(B)
scar = clear & (na - nb > 0.25) & (nb < 0.35) & (A["SCL"] != 6)
scar = ndimage.binary_opening(scar, iterations=1)
lab, n = ndimage.label(scar)
sz = ndimage.sum(scar, lab, range(1, n + 1))
scar = np.isin(lab, np.where(sz >= 10)[0] + 1)
print("sel izi km2:", scar.sum() * 100 / 1e6, " geçerli (bulutsuz) pay:", clear.mean().round(3))
polys = [shape(g) for g, v in shapes(scar.astype(np.uint8), mask=scar, transform=tr) if v == 1]
os.makedirs(f"{out}/x", exist_ok=True)
gpd.GeoDataFrame(geometry=polys, crs=crs).to_file(f"{out}/x/observedEventA.shp")
# AOI = clear-sky area of the window (cloudy parts are unobserved, not negatives)
cpolys = [shape(g) for g, v in shapes(clear.astype(np.uint8), mask=clear, transform=tr) if v == 1]
gpd.GeoDataFrame(geometry=cpolys, crs=crs).to_file(f"{out}/x/areaOfInterestA.shp")
