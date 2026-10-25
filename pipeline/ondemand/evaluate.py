"""İstek anında değerlendirme: verilen konum (nokta ya da tesis poligonu) için HAND kademesi, AI skoru ve AI tarama bölgesi.

Pencere: merkez 0,05° ızgaraya yaslanır (aynı varlık her zaman aynı pencereyi alır), 20 x 20 km değerlendirme alanı
+ 3 km tampon, 30 m yerel UTM. Özellikler pipeline/ai/features_full.py ile aynı tarifle üretilir (Copernicus DEM GLO-30,
ESA WorldCover 2021, Planetary Computer). Tier ve AI bölgesi panel vakalarındaki kuralla: kademe = varlık izinin değdiği
en düşük HAND ≤ 2 / 5 / 10 m bölgesi; AI bölgesi = pencerede en yüksek skorlu ve HAND ≤ 5 m alanının 0,81'i büyüklüğündeki kara.
Bölgeler panel gibi genelleştirilir (30 m kapama, < 1 ha parça atılır) ama raster üzerinde.
"""
import math, time, base64, threading, warnings
from pathlib import Path
import numpy as np
if not hasattr(np, "in1d"): np.in1d = np.isin
import rasterio
from rasterio.merge import merge
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin, from_bounds
from scipy import ndimage
import pystac_client, planetary_computer as pc
from pysheds.grid import Grid
from pysheds.sview import Raster, ViewFinder
from pyproj import CRS, Transformer
import lightgbm as lgb

warnings.filterwarnings("ignore")
RES, HALF, BUF, SNAP, RATIO = 30.0, 10000.0, 3000.0, 0.05, 0.81
MODEL = Path(__file__).resolve().parents[2] / "model" / "model_v2.txt"
USE = ["dist1", "dist25", "dist500", "hand1", "hand25", "hand500", "low2k", "relief1k", "sacc1", "slope", "twi",
       "wc_bare", "wc_crop", "wc_grass", "wc_shrub", "wc_tree", "wc_wetland"]   # model_v2 eğitim sırası
_bst = lgb.Booster(model_file=str(MODEL))
_cat = None
_cache, _lock = {}, threading.Lock()


def catalog():
    global _cat
    if _cat is None:
        _cat = pystac_client.Client.open("https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
    return _cat


def mosaic(collection, bbox, res_deg, asset):
    items = list(catalog().search(collections=[collection], bbox=bbox).items())
    srcs = [rasterio.open(it.assets[asset].href) for it in items]
    arr, tr = merge(srcs, bounds=bbox, res=res_deg, resampling=Resampling.nearest)
    crs = srcs[0].crs; nod = srcs[0].nodata
    for s in srcs: s.close()
    return arr[0], tr, crs, nod


def window_key(lat, lon):
    return round(round(lat / SNAP) * SNAP, 4), round(round(lon / SNAP) * SNAP, 4)


def build_window(clat, clon):
    """features_full.build ile aynı özellikler, kare pencere için. Dönen sözlük önbelleğe girer."""
    utm = CRS.from_epsg((32600 if clat >= 0 else 32700) + int((clon + 180) // 6) + 1)
    to_u = Transformer.from_crs(4326, utm, always_xy=True); to_ll = Transformer.from_crs(utm, 4326, always_xy=True)
    cx, cy = to_u.transform(clon, clat)
    minx, miny, maxx, maxy = cx - HALF - BUF, cy - HALF - BUF, cx + HALF + BUF, cy + HALF + BUF
    W = int(math.ceil((maxx - minx) / RES)); H = int(math.ceil((maxy - miny) / RES))
    tr = from_origin(minx, maxy, RES, RES)
    xs, ys = to_ll.transform([minx, maxx, minx, maxx], [miny, miny, maxy, maxy])
    bb = [min(xs) - 0.01, min(ys) - 0.01, max(xs) + 0.01, max(ys) + 0.01]

    dem_ll, dtr, dcrs, dnod = mosaic("cop-dem-glo-30", bb, 1 / 3600, "data")
    dem = np.full((H, W), np.nan, np.float32)
    reproject(dem_ll.astype(np.float32), dem, src_transform=dtr, src_crs=dcrs, src_nodata=dnod,
              dst_transform=tr, dst_crs=utm, dst_nodata=np.nan, resampling=Resampling.bilinear)
    wc_ll, wtr, wcrs, wnod = mosaic("esa-worldcover", bb, 1 / 3600, "map")
    wc = np.zeros((H, W), np.uint8)
    reproject(wc_ll, wc, src_transform=wtr, src_crs=wcrs, src_nodata=0, dst_transform=tr, dst_crs=utm,
              dst_nodata=0, resampling=Resampling.mode)

    valid_dem = np.isfinite(dem)
    sea = np.zeros_like(valid_dem)
    lab, n = ndimage.label(np.where(valid_dem, dem <= 0.5, False))
    if n:
        sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        sea = np.isin(lab, np.where(sizes >= 1000)[0] + 1)

    demf = np.where(valid_dem, dem, -9999).astype(np.float64)
    vf = ViewFinder(affine=tr, shape=dem.shape, crs=utm.to_proj4(), nodata=-9999.0)
    grid = Grid(viewfinder=vf)
    r = Raster(demf, viewfinder=vf)
    filled = grid.fill_pits(r); filled = grid.fill_depressions(filled); infl = grid.resolve_flats(filled)
    fdir = grid.flowdir(infl, nodata_out=np.int64(0))
    acc = grid.accumulation(fdir, nodata_out=0.0)
    accn = np.asarray(acc)
    cell_km2 = RES * RES / 1e6
    f, coast1 = {}, np.zeros(dem.shape, bool)
    for thr in (1, 25, 500):
        streams = accn >= thr / cell_km2
        if streams.sum() < 10:
            hand = np.full(dem.shape, np.nan); idx = np.full(dem.shape, -1)
        else:
            sr = Raster(streams, viewfinder=ViewFinder(affine=tr, shape=dem.shape, crs=utm.to_proj4(), nodata=False))
            idx = np.asarray(grid.compute_hand(fdir, r, sr, return_index=True, nodata_out=-1)).astype(np.int64)
            ok = idx >= 0
            hand = np.full(dem.shape, np.nan, np.float32)
            hand[ok] = demf[ok] - demf.ravel()[idx[ok]]
            hand[~valid_dem] = np.nan
        miss = valid_dem & ~np.isfinite(hand) & ~sea
        if miss.any():  # kıyı düzeltmesi
            ml, mn = ndimage.label(miss)
            touch = np.unique(ml[ndimage.binary_dilation(sea, iterations=1) & miss])
            fix = np.isin(ml, touch[touch > 0])
            hand[fix] = np.maximum(dem[fix], 0)
            if thr == 1: coast1 = fix
        hand = np.where(np.isfinite(hand), np.maximum(hand, 0), np.nan).astype(np.float32)
        rr, cc = np.divmod(np.where(idx >= 0, idx, 0), W)
        R, C = np.indices(dem.shape)
        dist = np.where(idx >= 0, np.hypot(rr - R, cc - C) * RES, np.nan).astype(np.float32)
        dist[np.isfinite(hand) & (idx < 0)] = np.nan
        f[f"hand{thr}"] = hand; f[f"dist{thr}"] = dist
        if thr == 1:
            f["sacc1"] = np.where(idx >= 0, np.log10(accn.ravel()[np.where(idx >= 0, idx, 0)] * cell_km2 + 1e-3), np.nan).astype(np.float32)

    gy, gx = np.gradient(np.where(valid_dem, dem, np.nanmean(dem)), RES)
    slope = np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)
    f["slope"] = slope
    f["relief1k"] = (dem - ndimage.minimum_filter(np.where(valid_dem, dem, 1e5), size=33)).astype(np.float32)
    f["twi"] = np.log((accn + 1) * RES / np.tan(np.radians(np.maximum(slope, 0.1)))).astype(np.float32)
    land = valid_dem & ~sea & (wc != 80)
    low = (np.nan_to_num(f["hand1"], nan=99) <= 5) & land
    k = int(2000 / RES) * 2 + 1
    f["low2k"] = (ndimage.uniform_filter(low.astype(np.float32), k) / np.maximum(ndimage.uniform_filter(land.astype(np.float32), k), 1e-3)).astype(np.float32)
    for name, code in [("tree", 10), ("shrub", 20), ("grass", 30), ("crop", 40), ("bare", 60), ("wetland", 90)]:
        f[f"wc_{name}"] = (wc == code).astype(np.float32)

    b = int(BUF / RES)
    aoi = np.zeros(dem.shape, bool); aoi[b:-b, b:-b] = True      # 20 x 20 km değerlendirme alanı
    valid = aoi & land & np.isfinite(f["hand1"])
    pv = np.full(dem.shape, np.nan, np.float32)
    pv[valid] = _bst.predict(np.stack([f[n][valid] for n in USE], 1))

    hand1 = np.nan_to_num(f["hand1"], nan=999)
    tiers = {lv: generalize(valid & (hand1 <= lv)) for lv in (2, 5, 10)}
    # AI bölgesi: genelleştirilmiş alan HAND ≤ 5 m alanının 0,81'i olana dek ham payı ayarla (ai_zone.py gibi)
    hv, pvv = hand1[valid], pv[valid]
    f5 = (hv <= 5).mean(); target = RATIO * (hv <= 5).sum(); kk = RATIO; zone = np.zeros(dem.shape, bool)
    for _ in range(4):
        if f5 == 0: break
        thr_ = np.quantile(pvv, 1 - min(kk * f5, 1)); m = valid & (pv >= thr_)
        zone = generalize(m); got = zone.sum(); kk *= target / max(got, 1)
    return dict(utm=utm, tr=tr, shape=dem.shape, valid=valid, hand1=f["hand1"], low2k=f["low2k"], coast1=coast1, pv=pv, tiers=tiers, zone=zone,
                f5=float(f5), zone_ratio=float(zone.sum() / max((hv <= 5).sum(), 1)), pv_sorted=np.sort(pvv), center=(clat, clon),
                aoi_ll=to_ll.transform([minx + BUF, maxx - BUF], [miny + BUF, maxy - BUF]))


def generalize(m):
    """Panel bölgelerinin raster karşılığı: 30 m kapama, 1 ha'dan küçük parçaları at."""
    m = m | ndimage.binary_closing(m, structure=np.ones((3, 3), bool), iterations=1)
    lab, n = ndimage.label(m)
    if not n: return m
    sizes = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    return np.isin(lab, np.where(sizes * RES * RES >= 10000)[0] + 1)


def get_window(lat, lon):
    key = window_key(lat, lon)
    with _lock:   # aynı anda tek ağır hesap; önbellekteyse anında
        if key not in _cache:
            t = time.time(); _cache[key] = build_window(*key); _cache[key]["secs"] = round(time.time() - t, 1)
            while len(_cache) > 12: _cache.pop(next(iter(_cache)))
        return _cache[key], key


def footprint(w, lat, lon, ring=None):
    to_u = Transformer.from_crs(4326, w["utm"], always_xy=True)
    m = np.zeros(w["shape"], bool)
    if ring and len(ring) >= 4:
        xs, ys = to_u.transform([p[1] for p in ring], [p[0] for p in ring])
        geom = {"type": "Polygon", "coordinates": [list(zip(xs, ys))]}
        m = rasterize([(geom, 1)], out_shape=w["shape"], transform=w["tr"], fill=0, all_touched=True).astype(bool)
    if not m.any():
        x, y = to_u.transform(lon, lat)
        c, r = ~w["tr"] * (x, y); r, c = int(r), int(c)
        if 0 <= r < w["shape"][0] and 0 <= c < w["shape"][1]: m[r, c] = True
    return m


def evaluate(lat, lon, ring=None):
    t0 = time.time()
    w, key = get_window(lat, lon)
    fp = footprint(w, lat, lon, ring)
    fv = fp & w["valid"]
    out = dict(lat=lat, lon=lon, window=dict(center=key, km=2 * HALF / 1000, built_secs=w["secs"]),
               model="model_v2", ratio=RATIO)
    if not fv.any():
        out.update(ok=False, reason="Varlık izi değerlendirilebilir karada değil (deniz, su yüzeyi ya da veri yok).")
        return out
    h = w["hand1"][fv]
    hmin = float(np.nanmin(h))
    # kademe = izin en düşük HAND'ı (gösterilen değerle çelişmesin diye genelleştirilmiş bölge kullanılmaz;
    # Rize vakasında 30 varlıkta 22 aynı, 29 en fazla bir kademe farklı; check_case.py)
    tier = next((lv for lv in (2, 5, 10) if hmin <= lv), None)
    tier_zone = next((lv for lv in (2, 5, 10) if (fp & w["tiers"][lv]).any()), None)
    sea = bool(tier and (fv & w["coast1"] & (w["hand1"] <= tier)).any())
    score = float(np.nanmax(w["pv"][fv]))
    pct = float(np.searchsorted(w["pv_sorted"], score) / len(w["pv_sorted"]))
    # arazi tipi (vaka panelindeki gibi): 2 km içinde HAND ≤ 5 m kara payı; < %20 dar vadi, %20-40 geniş vadi, > %40 ova (sezgisel)
    low2k = float(np.nanmean(w["low2k"][fv]))
    out.update(ok=True, hand_min=round(hmin, 1), tier=tier, tier_zone=tier_zone, sea=sea, low2k=round(low2k, 3), in_ai=bool((fp & w["zone"]).any()),
               score=round(score, 4), score_pct=round(pct, 3), cells=int(fv.sum()), hand5_share=round(w["f5"], 3),
               zone_ratio=round(w["zone_ratio"], 3), secs=round(time.time() - t0, 1))
    return out


def overlay(lat, lon):
    """Pencerenin kademe + AI bölgesi ızgarası, EPSG:4326'ya yeniden örneklenmiş: değer = kademe (1: ≤2, 2: ≤5, 3: ≤10) + 4 * AI."""
    w, key = get_window(lat, lon)
    cls = np.zeros(w["shape"], np.uint8)
    for code, lv in ((3, 10), (2, 5), (1, 2)): cls[w["tiers"][lv]] = code
    cls[w["zone"]] += 4
    (x0, x1), (y0, y1) = w["aoi_ll"]
    nx = 640; ny = int(round(nx * (y1 - y0) / ((x1 - x0) * math.cos(math.radians((y0 + y1) / 2)))))
    dst = np.zeros((ny, nx), np.uint8)
    # 0 GDAL'da veri yok sayıldığı için kodlar +1 kaydırılarak taşınır
    reproject(cls + 1, dst, src_transform=w["tr"], src_crs=w["utm"], dst_transform=from_bounds(x0, y0, x1, y1, nx, ny),
              dst_crs="EPSG:4326", resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
    dst = np.where(dst > 0, dst - 1, 0).astype(np.uint8)
    return dict(w=nx, h=ny, bounds=[[y0, x0], [y1, x1]], data=base64.b64encode(dst.tobytes()).decode(), center=key)
