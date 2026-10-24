"""Compare parsed daily means with the yearbook's monthly 'Ortalama' row."""
import re, csv, collections, sys
from pathlib import Path

daily = collections.defaultdict(dict)
for r in csv.DictReader(open('out/dsi_daily.csv')):
    if r['q_m3s']:
        daily[r['station']][r['date']] = float(r['q_m3s'])
mw = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]
tot = bad = 0
for y in range(2005, 2022):
    L = Path(f't{y}.txt').read_text(errors='ignore').splitlines()
    for st in daily:
        for i, l in enumerate(L):
            if not (re.search(rf"\b{st}\b", l) and any('YER' in x for x in L[i + 1:i + 5])):
                continue
            ak = next((j for j in range(i, min(i + 200, len(L))) if 'Akımlar 01 Ekim' in L[j]), None)
            if ak is None or ak - i > 60:
                continue
            ys = [int(m.group(1)) for x in L[i:ak + 40] for m in [re.search(r"(\d{4}) Su yılında anlık ençok", x)] if m]
            wy = ys[0] if ys else int(re.search(r'Ekim (\d{4})', L[ak]).group(1)) + 1
            ort = next((j for j in range(ak, ak + 60) if L[j].strip().startswith('Ortalama')), None)
            if ort is None:
                print(y, st, wy, 'Ortalama satırı yok (kısmi yıl)'); continue
            out = []
            for k, t in enumerate(L[ort].split()[1:13]):
                try:
                    ref = float(t.rstrip('.'))
                except ValueError:
                    continue
                m = mw[k]; yr = wy - 1 if m >= 10 else wy
                vals = [v for d, v in daily[st].items() if d.startswith(f"{yr}-{m:02d}")]
                tot += 1
                if not vals or abs(sum(vals) / len(vals) - ref) > 0.03 * ref + 0.02:
                    bad += 1; out.append((m, round(sum(vals) / len(vals), 3) if vals else None, ref))
            if out:
                print(y, st, wy, 'uyuşmayan:', out)
print('kontrol edilen ay', tot, 'uyuşmayan', bad)
