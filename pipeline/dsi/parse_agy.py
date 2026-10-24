"""Parse DSİ Akım Gözlem Yıllığı text (pdftotext -layout) for given stations.
Outputs daily series CSV and annual summary CSV.
Usage: python parse_agy.py out_dir station1 station2 ... -- t2016.txt t2017.txt ...
"""
import re, sys, csv, datetime as dt
from pathlib import Path

args = sys.argv[1:]
sep = args.index("--")
out = Path(args[0]); stations = args[1:sep]; files = args[sep + 1:]
out.mkdir(parents=True, exist_ok=True)

NUM = r"-?\d+(?:[.,]\d*)?|-{3,}|KURU"
months_wy = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]

def num(s):
    if s.startswith("---") or s == "KURU":
        return None
    return float(s.replace(",", ".").rstrip("."))

daily, summary = [], []
for f in files:
    lines = Path(f).read_text(errors="ignore").splitlines()
    for st in stations:
        # page header: line containing code, followed within 5 lines by "YERİ"
        starts = [i for i, l in enumerate(lines)
                  if re.search(rf"\b{st}\b", l) and any("YER" in x for x in lines[i + 1:i + 5])]
        if not starts:
            print(f"{f}: {st} not found")
        for start in starts:
          if True:
            end = start + 1
            while end < len(lines) and end < start + 200:
                if re.match(r"^\s*\d+\.\s+\S.*Havzas", lines[end]) or (end > start + 3 and re.search(r"\b[DE]\d{2}[A-Z]\d{3}\b", lines[end]) and any("YER" in x for x in lines[end+1:end+4])):
                    break
                end += 1
            block = lines[start:end]
            name = block[0].strip()
            info = {"station": st, "name": name, "file": Path(f).name}
            wy = None
            for l in block:
                m = re.search(r"Akımlar 01 Ekim (\d{4})", l)
                if m:
                    wy = int(m.group(1)) + 1
                m = re.search(r"GÖZLEM SÜRESİ\s*:\s*(\S+)\s*-\s*(\S+)", l)
                if m: info["gozlem_bas"], info["gozlem_son"] = m.groups()
                m = re.search(r"YAĞIŞ ALANI\s*:\s*([\d.,]+)", l)
                if m: info["alan_km2"] = num(m.group(1))
                m = re.search(r"Su yılında anlık ençok akım\s*:\s*(\S+)\s*m3/sn\s*(\S+)?", l)
                if m: info["anlik_max"] = num(m.group(1)); info["anlik_max_tarih"] = m.group(2)
                m = re.search(r"Gözlem süresinde anlık ençok akım\s*:\s*(\S+)\s*m3/sn\s*(\S+)?", l)
                if m: info["rekor"] = num(m.group(1)); info["rekor_tarih"] = m.group(2)
                m = re.search(r"YILLIK TOPLAM AKIM\s+([\d.,]+)", l)
                if m: info["yillik_hm3"] = num(m.group(1))
            wy2 = None
            for l in block:
                m = re.search(r"(\d{4}) Su yılında anlık ençok", l)
                if m: wy2 = int(m.group(1))
            if wy2 and wy and wy2 != wy:
                print(f"{f}: {st} başlık su yılı {wy}, özet satırı {wy2} -> {wy2} kullanıldı")
                wy = wy2
            info["su_yili"] = wy
            # daily rows: after the "Akımlar" line, take first 31 rows with day 01..31 and 12 tokens
            try:
                k = next(i for i, l in enumerate(block) if "Akımlar 01 Ekim" in l)
            except StopIteration:
                print(f"{f}: {st} no table"); continue
            rows = {}
            for l in block[k:k + 60]:
                toks = l.split()
                if len(toks) == 13 and re.fullmatch(r"\d{1,2}", toks[0]) and 1 <= int(toks[0]) <= 31:
                    if all(re.fullmatch(NUM, t) for t in toks[1:]):
                        rows.setdefault(int(toks[0]), toks[1:])
                if l.strip().startswith("Maks"):
                    break
            bad = 0
            for d, vals in rows.items():
                for j, v in enumerate(vals):
                    mo = months_wy[j]; yr = wy - 1 if mo >= 10 else wy
                    try:
                        date = dt.date(yr, mo, d)
                    except ValueError:
                        continue
                    q = num(v)
                    daily.append({"station": st, "date": date.isoformat(), "q_m3s": q})
            info["gun_satiri"] = len(rows)
            summary.append(info)

daily.sort(key=lambda r: (r["station"], r["date"]))
with open(out / "dsi_daily.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, ["station", "date", "q_m3s"]); w.writeheader(); w.writerows(daily)
keys = ["station", "name", "su_yili", "file", "alan_km2", "gozlem_bas", "gozlem_son", "anlik_max",
        "anlik_max_tarih", "rekor", "rekor_tarih", "yillik_hm3", "gun_satiri"]
with open(out / "dsi_summary.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, keys); w.writeheader()
    for s in sorted(summary, key=lambda r: (r["station"], r["su_yili"] or 0)):
        w.writerow({k: s.get(k) for k in keys})
print(len(daily), "daily rows;", len(summary), "station-years")
