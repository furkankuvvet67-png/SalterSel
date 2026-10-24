"""Select EMS AOIs and download their flood delineation shapefiles.
Rule (fixed before modelling): AOI <= 1500 km2, mapped flood >= 50 ha and <= 60% of AOI,
up to 4 AOIs per activation (largest flood), DEL preferred over GRA. Derna dam break (EMSR696) excluded.
"""
import json, collections, urllib.request, zipfile, io, os, sys
from pathlib import Path

rows = json.load(open('ems/products.json'))
def fnum(x):
    try: return float(x)
    except: return 0.0
by = collections.defaultdict(lambda: collections.defaultdict(list))
for r in rows:
    if r['code'] == 'EMSR696':
        continue
    by[r['code']][r['aoi']].append(r)
sel = []
for code, aois in by.items():
    cands = []
    for aoi, ps in aois.items():
        area = ps[0]['area_km2']
        fh = max(fnum(p['flood_ha']) for p in ps)
        if area > 1500 or fh < 50 or fh / 100 > 0.6 * area:
            continue
        cands.append((fh, aoi, ps))
    cands.sort(reverse=True)
    for fh, aoi, ps in cands[:4]:
        sel.append(dict(code=code, aoi=aoi, area_km2=ps[0]['area_km2'], flood_ha=fh, event=ps[0]['event'],
                        country=ps[0]['country'] if isinstance(ps[0]['country'], str) else str(ps[0]['country']),
                        products=[p['url'] for p in ps]))
print(len(sel), 'AOI,', len({s['code'] for s in sel}), 'activations')
json.dump(sel, open('ems/selected.json', 'w'), indent=0)

out = Path('ems/shp'); out.mkdir(exist_ok=True)
for s in sel:
    d = out / f"{s['code']}_AOI{s['aoi']:02d}"
    if d.exists() and any(d.iterdir()):
        continue
    d.mkdir(exist_ok=True)
    for u in s['products']:
        try:
            b = urllib.request.urlopen(u, timeout=120).read()
            z = zipfile.ZipFile(io.BytesIO(b))
            for n in z.namelist():
                low = n.lower()
                if ('observedevent' in low or 'areaofinterest' in low or 'hydrography' in low) and not low.endswith('/'):
                    sub = d / Path(u).stem; sub.mkdir(exist_ok=True)
                    (sub / Path(n).name).write_bytes(z.read(n))
        except Exception as e:
            print('ERR', u, e)
    print(d.name, len(list(d.rglob('*.shp'))), flush=True)
