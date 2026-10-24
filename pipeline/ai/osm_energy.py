"""Fetch current OSM energy assets for an AOI via the OSM API /map call (Overpass unreachable here).
Tiles of 0.04 deg, split into 4 when the API refuses (too many nodes). Keeps power=substation/plant/generator/line/minor_line
and waterway=dam ways/nodes, with geometry. python osm_energy.py AOI_SHP OUT_GEOJSON
"""
import sys, json, time, urllib.request, urllib.error
import geopandas as gpd
from shapely.geometry import Point, LineString, Polygon, box

aoi = gpd.read_file(sys.argv[1]).to_crs(4326).union_all()
out = sys.argv[2]
UA = {"User-Agent": "climathon-research (kuvvet21@itu.edu.tr)"}
keep = lambda t: t.get("power") in ("substation", "plant", "generator", "line", "minor_line") or t.get("waterway") == "dam"
nodes, ways = {}, {}

def fetch(x0, y0, x1, y1, depth=0):
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={x0:.5f},{y0:.5f},{x1:.5f},{y1:.5f}"
    for t in range(4):
        try:
            d = json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180)); break
        except urllib.error.HTTPError as e:
            if e.code == 400 and depth < 4:
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                for a in [(x0, y0, mx, my), (mx, y0, x1, my), (x0, my, mx, y1), (mx, my, x1, y1)]:
                    fetch(*a, depth + 1)
                return
            time.sleep(5 * (t + 1))
        except Exception:
            time.sleep(5 * (t + 1))
    else:
        print("başarısız karo", x0, y0, flush=True); return
    for e in d["elements"]:
        if e["type"] == "node":
            nodes[e["id"]] = e
        elif e["type"] == "way" and keep(e.get("tags", {})):
            ways[e["id"]] = e
    time.sleep(0.5)

x0, y0, x1, y1 = aoi.bounds
s = 0.08
x = x0
while x < x1:
    y = y0
    while y < y1:
        if box(x, y, x + s, y + s).intersects(aoi):
            fetch(x, y, min(x + s, x1), min(y + s, y1))
        y += s
    x += s
feats = []
for i, e in ways.items():
    pts = [(nodes[n]["lon"], nodes[n]["lat"]) for n in e["nodes"] if n in nodes]
    if len(pts) < 2: continue
    t = e.get("tags", {})
    closed = e["nodes"][0] == e["nodes"][-1] and len(pts) >= 4 and t.get("power") not in ("line", "minor_line")
    g = Polygon(pts) if closed else LineString(pts)
    feats.append(dict(osm=f"way/{i}", name=t.get("name"), power=t.get("power"), waterway=t.get("waterway"),
                      source=t.get("plant:source") or t.get("generator:source"), voltage=t.get("voltage"), geometry=g))
for i, e in nodes.items():
    t = e.get("tags", {})
    if t and keep(t) and t.get("power") not in ("line", "minor_line"):
        feats.append(dict(osm=f"node/{i}", name=t.get("name"), power=t.get("power"), waterway=t.get("waterway"),
                          source=t.get("plant:source") or t.get("generator:source"), voltage=t.get("voltage"), geometry=Point(e["lon"], e["lat"])))
g = gpd.GeoDataFrame(feats, geometry="geometry", crs=4326) if feats else gpd.GeoDataFrame(columns=["osm", "geometry"], geometry="geometry", crs=4326)
if len(g):
    g = g[g.intersects(aoi)]
g.to_file(out, driver="GeoJSON")
print(out, len(g), "varlık", g.power.value_counts().to_dict() if len(g) else {})
