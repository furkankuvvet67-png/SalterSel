"""Rainfall (Open-Meteo reanalysis) vs DSİ observed discharge for the CLIMATHON catchments."""
import json, csv, collections, math
import numpy as np, pandas as pd
from scipy import stats

ST = {  # station: (name, area km2, rain point indices in era5.json)
    "E13A059": ("Ezine D. Bozkurt", 355.2, [0, 1]),
    "D22A044": ("Karadere Aytaş (Araklı)", 421.2, [2, 3]),
    "D22A049": ("Kapistre D. Başköy (Arhavi memba)", 186.2, [4, 5]),
    "D22A151": ("Kapistre D. Arhavi", 290.25, [4, 5]),
}
pts = json.load(open("rain/era5.json"))
rain = {}
for k, (_, _, idx) in ST.items():
    s = sum(pd.Series(pts[i]["daily"]["precipitation_sum"], index=pd.to_datetime(pts[i]["daily"]["time"]), dtype=float) for i in idx) / len(idx)
    rain[k] = s
q = pd.read_csv("out/dsi_daily.csv", parse_dates=["date"])
q = q.dropna(subset=["q_m3s"])

def wy(d):
    return d.year + 1 if d.month >= 10 else d.year

rows, ev_rows, lines = [], [], []
for st, (name, area, _) in ST.items():
    qs = q[q.station == st].set_index("date")["q_m3s"].sort_index()
    if qs.empty:
        continue
    P = rain[st]
    P3 = P.rolling(3).sum()
    df = pd.DataFrame({"Q": qs, "P": P, "P3": P3}).dropna()
    df["wy"] = [wy(d) for d in df.index]
    # complete water years only (>= 330 days)
    cnt = df.groupby("wy").size()
    full = cnt[cnt >= 330].index
    d = df[df.wy.isin(full)]
    lines.append(f"\n## {st} {name} ({area} km²)  tam su yılı: {len(full)} ({min(full) if len(full) else '-'}–{max(full) if len(full) else '-'})")
    if len(full) == 0:
        continue
    # annual water balance
    ann = d.groupby("wy").agg(Qmean=("Q", "mean"), P=("P", "sum"), Qmax=("Q", "max"), P1max=("P", "max"), P3max=("P3", "max"))
    ann["Q_mm"] = ann.Qmean * 365.25 * 86400 / (area * 1e6) * 1000
    ann["C"] = ann.Q_mm / ann.P
    r_tot = stats.spearmanr(ann.P, ann.Q_mm)
    r_max1 = stats.spearmanr(ann.P1max, ann.Qmax)
    r_max3 = stats.spearmanr(ann.P3max, ann.Qmax)
    lines.append(f"- Yıllık: yağış ort. {ann.P.mean():.0f} mm, akış ort. {ann.Q_mm.mean():.0f} mm, akış katsayısı {ann.C.mean():.2f} (min {ann.C.min():.2f}, max {ann.C.max():.2f})")
    lines.append(f"- Yıllık toplam yağış ↔ yıllık akış: Spearman ρ = {r_tot.correlation:.2f} (p={r_tot.pvalue:.2f}, n={len(ann)})")
    lines.append(f"- Yıllık maks. günlük debi ↔ yıllık maks. 1 g yağış: ρ = {r_max1.correlation:.2f} (p={r_max1.pvalue:.2f}); ↔ maks. 3 g yağış: ρ = {r_max3.correlation:.2f} (p={r_max3.pvalue:.2f})")
    # monthly regime
    mon = d.groupby(d.index.month).agg(Q=("Q", "mean"), P=("P", "mean"))
    pk_q = int(mon.Q.idxmax()); pk_p = int(mon.P.idxmax())
    lines.append(f"- Rejim: en yüksek ortalama debi ayı {pk_q}, en yağışlı ay {pk_p}")
    # daily: log Q vs P3
    rd = stats.spearmanr(d.P3, d.Q)
    lines.append(f"- Günlük: 3 g yağış ↔ debi ρ = {rd.correlation:.2f}")
    # top-10 discharge days (separated by >=7 days) and their rainfall
    top = []
    for t, v in d.Q.sort_values(ascending=False).items():
        if all(abs((t - u).days) > 7 for u, _ in top):
            top.append((t, v))
        if len(top) == 10:
            break
    # rank of the 3-day rain at those dates among all days
    pr = d.P3.rank(pct=True)
    hit = 0
    for t, v in top:
        win = d.loc[t - pd.Timedelta(days=1): t + pd.Timedelta(days=1)]
        p3 = win.P3.max(); pct = pr.loc[win.P3.idxmax()]
        hit += pct >= 0.95
        ev_rows.append({"station": st, "date": t.date(), "Q_gunluk": v, "P3_mm": round(p3, 1), "P3_yuzdelik": round(pct * 100, 1)})
    lines.append(f"- En büyük 10 debi olayından {hit}'inde olay günü ±1 günde 3 g yağış en üst %5'te")
    # top-10 rain events and response
    topp = []
    for t, v in d.P3.sort_values(ascending=False).items():
        if all(abs((t - u).days) > 7 for u, _ in topp):
            topp.append((t, v))
        if len(topp) == 10:
            break
    qr = d.Q.rank(pct=True); resp = 0
    for t, v in topp:
        w = d.loc[t: t + pd.Timedelta(days=2)]
        resp += qr.loc[w.Q.idxmax()] >= 0.95
    lines.append(f"- En büyük 10 yağış olayından {resp}'inde ardından 2 gün içinde debi en üst %5'te")
    for y, r in ann.iterrows():
        rows.append({"station": st, "su_yili": y, "P_mm": round(r.P), "Q_mm": round(r.Q_mm), "C": round(r.C, 2),
                     "Qmax_gunluk": r.Qmax, "P1max": round(r.P1max, 1), "P3max": round(r.P3max, 1)})

# specific events
lines.append("\n## Belirli olaylar")
def show(st, a, b):
    P = rain[st]; qs = q[q.station == st].set_index("date")["q_m3s"]
    for t in pd.date_range(a, b):
        lines.append(f"  {st} {t.date()}  P={P.get(t, float('nan')):.1f} mm  Q={qs.get(t, float('nan'))}")
show("E13A059", "2014-10-15", "2014-10-21")
show("D22A151", "2021-07-19", "2021-07-22")
show("D22A049", "2021-07-19", "2021-07-22")
show("E13A059", "2021-06-14", "2021-06-18")

pd.DataFrame(rows).to_csv("out/yillik_yagis_debi.csv", index=False)
pd.DataFrame(ev_rows).to_csv("out/buyuk_debi_olaylari.csv", index=False)
open("out/karsilastirma.txt", "w").write("\n".join(lines))
print("\n".join(lines))
