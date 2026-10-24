"""Build per-pixel features and flood labels for one EMS AOI (or a custom case).

python features.py AOI_DIR OUT_NPZ
Features (all from Copernicus DEM GLO-30 + ESA WorldCover 2021, 30 m local UTM):
  hand1, hand25, hand500   height above nearest drainage, stream thresholds 1 / 25 / 500 km2
  dist1, dist25, dist500   horizontal distance to that drainage cell (m)
  sacc1                    log10 upstream area (km2) of the drainage cell that hand1 refers to
  slope                    degrees
  relief1k                 elevation minus minimum elevation within 1 km
  twi                      ln(a / tan b)
  low2k                    share of land within 2 km with hand1 <= 5 m (panel "arazi tipi")
  built500                 share of built-up (WorldCover 50) within 500 m (panel "kent içi")
  wc_*                     WorldCover one-hot (tree, shrub, grass, crop, built, bare, wetland)
HAND coastal fix as in panel v2: land cells that do not drain to a stream but touch the sea get HAND = elevation.
"""
import sys, json, warnings, math
from pathlib import Path
import numpy as np
if not hasattr(np, "in1d"): np.in1d = np.isin
import geopandas as gpd
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy import ndimage
import pystac_client, planetary_computer as pc
from pysheds.grid import Grid
from pysheds.sview import Raster, ViewFinder
from pyproj import CRS, Transformer

warnings.filterwarnings("ignore")
RES = 30.0
BUF = 3000.0
CAT = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)


def read_union(d, key):
    parts = []
    for shp in Path(d).rglob("*.shp"):
        if key.lower() in shp.name.lower():
            g = gpd.read_file(shp)
            if len(g):
                parts.append(g.to_crs(4326)[["geometry"]])
    if not parts:
        return None
    import pandas as pd
    return gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=4326)


def mosaic(collection, bbox, res_deg, asset):
    items = list(CAT.search(collections=[collection], bbox=bbox).items())
    srcs = [rasterio.open(it.assets[asset].href) for it in items]
    arr, tr = merge(srcs, bounds=bbox, res=res_deg, resampling=Resampling.nearest)
    crs = srcs[0].crs; nod = srcs[0].nodata
    for s in srcs: s.close()
    return arr[0], tr, crs, nod


def build(aoi_dir, out):
    aoi = read_union(aoi_dir, "areaOfInterest")
    flood = read_union(aoi_dir, "observedEventA")
    if aoi is None:
        raise SystemExit("missing layers")
    if flood is None:
        flood = aoi.iloc[:0]
    geom = aoi.union_all()
    lon, lat = geom.centroid.x, geom.centroid.y
    utm = CRS.from_epsg((32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1)
    aoi_u = aoi.to_crs(utm); flood_u = flood.to_crs(utm)
    minx, miny, maxx, maxy = aoi_u.total_bounds
    minx -= BUF; miny -= BUF; maxx += BUF; maxy += BUF
    W = int(math.ceil((maxx - minx) / RES)); H = int(math.ceil((maxy - miny) / RES))
    tr = from_origin(minx, maxy, RES, RES)
    to_ll = Transformer.from_crs(utm, 4326, always_xy=True)
    xs, ys = to_ll.transform([minx, maxx, minx, maxx], [miny, miny, maxy, maxy])
    bb = [min(xs) - 0.01, min(ys) - 0.01, max(xs) + 0.01, max(ys) + 0.01]

    # DEM
    dem_ll, dtr, dcrs, dnod = mosaic("cop-dem-glo-30", bb, 1 / 3600, "data")
    dem = np.full((H, W), np.nan, np.float32)
    reproject(dem_ll.astype(np.float32), dem, src_transform=dtr, src_crs=dcrs, src_nodata=dnod,
              dst_transform=tr, dst_crs=utm, dst_nodata=np.nan, resampling=Resampling.bilinear)
    # WorldCover
    wc_ll, wtr, wcrs, wnod = mosaic("esa-worldcover", bb, 1 / 3600, "map")
    wc = np.zeros((H, W), np.uint8)
    reproject(wc_ll, wc, src_transform=wtr, src_crs=wcrs, src_nodata=0, dst_transform=tr, dst_crs=utm,
              dst_nodata=0, resampling=Resampling.mode)

    valid_dem = np.isfinite(dem)
    sea = np.zeros_like(valid_dem)
    lab, n = ndimage.label(np.where(valid_dem, dem <= 0.5, False))
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        big = np.where(sizes >= 1000)[0] + 1
        sea = np.isin(lab, big)

    # hydrology
    demf = np.where(valid_dem, dem, -9999).astype(np.float64)
    vf = ViewFinder(affine=tr, shape=dem.shape, crs=utm.to_proj4(), nodata=-9999.0)
    grid = Grid(viewfinder=vf)
    r = Raster(demf, viewfinder=vf)
    filled = grid.fill_pits(r); filled = grid.fill_depressions(filled); infl = grid.resolve_flats(filled)
    fdir = grid.flowdir(infl, nodata_out=np.int64(0))
    acc = grid.accumulation(fdir, nodata_out=0.0)
    accn = np.asarray(acc)
    cell_km2 = RES * RES / 1e6
    out_f = {}
    for thr in (1, 25, 500):
        streams = accn >= thr / cell_km2
        if streams.sum() < 10:
            hand = np.full(dem.shape, np.nan); idx = np.full(dem.shape, -1)
        else:
            sr = Raster(streams, viewfinder=ViewFinder(affine=tr, shape=dem.shape, crs=utm.to_proj4(), nodata=False))
            idx = np.asarray(grid.compute_hand(fdir, r, sr, return_index=True, nodata_out=-1)).astype(np.int64)
            ok = idx >= 0
            hand = np.full(dem.shape, np.nan, np.float32)
            flat = demf.ravel()
            hand[ok] = demf[ok] - flat[idx[ok]]
            hand[~valid_dem] = np.nan
        # coastal fix
        miss = valid_dem & ~np.isfinite(hand) & ~sea
        if miss.any():
            ml, mn = ndimage.label(miss)
            touch = np.unique(ml[ndimage.binary_dilation(sea, iterations=1) & miss])
            fix = np.isin(ml, touch[touch > 0])
            hand[fix] = np.maximum(dem[fix], 0)
        hand = np.where(np.isfinite(hand), np.maximum(hand, 0), np.nan).astype(np.float32)
        rr, cc = np.divmod(np.where(idx >= 0, idx, 0), W)
        R, C = np.indices(dem.shape)
        dist = np.where(idx >= 0, np.hypot(rr - R, cc - C) * RES, np.nan).astype(np.float32)
        dist[np.isfinite(hand) & (idx < 0)] = np.nan
        out_f[f"hand{thr}"] = hand; out_f[f"dist{thr}"] = dist
        if thr == 1:
            sacc = np.where(idx >= 0, np.log10(accn.ravel()[np.where(idx >= 0, idx, 0)] * cell_km2 + 1e-3), np.nan)
            out_f["sacc1"] = sacc.astype(np.float32)

    gy, gx = np.gradient(np.where(valid_dem, dem, np.nanmean(dem)), RES)
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    out_f["slope"] = slope
    out_f["relief1k"] = (dem - ndimage.minimum_filter(np.where(valid_dem, dem, 1e5), size=33)).astype(np.float32)
    out_f["twi"] = np.log((accn + 1) * RES / np.tan(np.radians(np.maximum(slope, 0.1)))).astype(np.float32)
    land = valid_dem & ~sea & (wc != 80)
    low = (np.nan_to_num(out_f["hand1"], nan=99) <= 5) & land
    k = int(2000 / RES) * 2 + 1
    out_f["low2k"] = (ndimage.uniform_filter(low.astype(np.float32), k) / np.maximum(ndimage.uniform_filter(land.astype(np.float32), k), 1e-3)).astype(np.float32)
    k5 = int(500 / RES) * 2 + 1
    out_f["built500"] = ndimage.uniform_filter((wc == 50).astype(np.float32), k5)
    for name, code in [("tree", 10), ("shrub", 20), ("grass", 30), ("crop", 40), ("built", 50), ("bare", 60), ("wetland", 90)]:
        out_f[f"wc_{name}"] = (wc == code).astype(np.float32)

    aoi_m = rasterize([(g, 1) for g in aoi_u.geometry if g is not None], out_shape=dem.shape, transform=tr, fill=0).astype(bool)
    fl_m = rasterize([(g, 1) for g in flood_u.geometry if g is not None and not g.is_empty], out_shape=dem.shape, transform=tr, fill=0, all_touched=False).astype(bool)
    valid = aoi_m & land & np.isfinite(out_f["hand1"])
    # keep away from DEM edge (2 km)
    edge = np.zeros_like(valid); m = int(2000 / RES); edge[m:-m, m:-m] = True
    valid &= edge

    names = sorted(out_f)
    if True:  # full-grid output for scoring assets
        stack = np.stack([out_f[n] for n in names]).astype(np.float32)
        np.savez_compressed(out, stack=stack, names=np.array(names), valid=valid, transform=np.array(tr)[:6], epsg=utm.to_epsg())
        print("full grid", stack.shape, "valid", int(valid.sum())); return
    vi = np.flatnonzero(valid.ravel())
    y_all = fl_m.ravel()[vi]
    rng = np.random.default_rng(0)
    n_uni = min(len(vi), 150_000)
    uni = rng.choice(len(vi), n_uni, replace=False)
    pos = np.flatnonzero(y_all)
    extra = rng.choice(pos, min(len(pos), 20_000), replace=False) if len(pos) else np.array([], int)
    take = np.concatenate([uni, extra]); is_uni = np.r_[np.ones(len(uni), bool), np.zeros(len(extra), bool)]
    X = np.stack([out_f[n].ravel()[vi[take]] for n in names], 1).astype(np.float32)
    meta = dict(aoi=Path(aoi_dir).name, lon=lon, lat=lat, epsg=utm.to_epsg(), valid_px=int(len(vi)),
                flood_px=int(y_all.sum()), flood_frac=float(y_all.mean()) if len(vi) else 0,
                hand5_frac=float((out_f["hand1"].ravel()[vi] <= 5).mean()),
                low2k_median=float(np.median(out_f["low2k"].ravel()[vi])))
    np.savez_compressed(out, X=X, y=y_all[take], uni=is_uni, names=np.array(names), meta=json.dumps(meta))
    print(json.dumps(meta))


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
