"""Build EA (England) training events from Recorded Flood Outlines (2015+), written as AOI dirs for features.py.
Rules fixed before modelling: fluvial outlines only (fluvial_f true, flood_src not sea/groundwater/surface water),
cluster by identical start_date and <=10 km proximity, flood area >= 0.3 km2, AOI = bbox + 2 km <= 1500 km2,
Lancaster test window excluded, keep the 40 largest events."""
import json, os, collections
import geopandas as gpd, pandas as pd
from shapely.geometry import shape, box

fc = json.load(open("ea/ea_2015plus.geojson"))
rows = []
for f in fc["features"]:
    p = f["properties"]
    try:
        g = shape(f["geometry"]).buffer(0)
    except Exception:
        continue
    rows.append(dict(p, geometry=g))
g = gpd.GeoDataFrame(rows, geometry="geometry", crs=4326).to_crs(27700)
print(len(g), "outline;", g.fluvial_f.value_counts().to_dict())
src = g.flood_src.fillna("").str.lower(); cause = g.flood_caus.fillna("").str.lower()
fl = g[(g.fluvial_f.astype(str).str.lower().isin(["true", "1", "y", "yes"])) &
       ~src.str.contains("sea|groundwater|surface water") & ~cause.str.contains("surface water|groundwater")]
fl = fl[fl.start_date.notna()].copy()
fl["day"] = fl.start_date.str[:10]
print(len(fl), "nehir kaynaklı outline")
lanc = gpd.GeoSeries([box(-2.95, 53.95, -2.45, 54.2)], crs=4326).to_crs(27700).iloc[0]
events = []
for day, grp in fl.groupby("day"):
    buf = grp.geometry.buffer(5000)
    u = gpd.GeoSeries(list(buf.union_all().geoms) if buf.union_all().geom_type == "MultiPolygon" else [buf.union_all()], crs=27700)
    for k, cl in enumerate(u):
        mem = grp[grp.geometry.intersects(cl)]
        area = mem.geometry.union_all().area / 1e6
        b = mem.total_bounds; aoi = box(b[0] - 2000, b[1] - 2000, b[2] + 2000, b[3] + 2000)
        if area < 0.3 or aoi.area / 1e6 > 1500 or aoi.intersects(lanc):
            continue
        events.append(dict(id=f"EA{day.replace('-', '')}_{k}", day=day, area=area, aoi_km2=aoi.area / 1e6, n=len(mem), mem=mem, aoi=aoi))
events.sort(key=lambda e: -e["area"])
events = events[:40]
for e in events:
    d = f"ea/shp/{e['id']}/x"; os.makedirs(d, exist_ok=True)
    e["mem"][["geometry"]].to_file(f"{d}/observedEventA.shp")
    gpd.GeoDataFrame(geometry=[e["aoi"]], crs=27700).to_file(f"{d}/areaOfInterestA.shp")
print(len(events), "olay")
print(pd.DataFrame([{k: v for k, v in e.items() if k not in ("mem", "aoi")} for e in events]).round(2).to_string())
