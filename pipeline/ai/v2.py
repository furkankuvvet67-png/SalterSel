"""v2 susceptibility model (see out/onkayit-v2.md).
python v2.py eval            -> storm-grouped leave-out evaluation on EMS + EA, vs HAND<=5
python v2.py fit NAME [EXCL] -> train on everything except activations/events whose id starts with EXCL (comma list)
"""
import sys, json, glob, datetime as dt
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from scipy.stats import binomtest

ALL = [str(n) for n in np.load(sorted(glob.glob("feat/EMSR*.npz"))[0])["names"]]
DROP = {"built500", "wc_built"}
USE = [f for f in ALL if f not in DROP]
UI = [ALL.index(f) for f in USE]
MONO = {"hand1", "hand25", "hand500", "dist1", "dist25", "dist500", "relief1k"}
PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=31, min_child_samples=200, feature_fraction=0.8,
              bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=0,
              monotone_constraints=[-1 if f in MONO else 0 for f in USE], monotone_constraints_method="advanced")
sel = {f"{s['code']}_AOI{s['aoi']:02d}": s["event"] for s in json.load(open("ems/selected.json"))}


def load():
    data = []
    for f in sorted(glob.glob("feat/EMSR*.npz")) + sorted(glob.glob("feat/EA*.npz")):
        d = np.load(f); m = json.loads(str(d["meta"]))
        if m["flood_px"] < 300:
            continue
        src = "EMS" if m["aoi"].startswith("EMSR") else "EA"
        day = sel[m["aoi"]] if src == "EMS" else f"{m['aoi'][2:6]}-{m['aoi'][6:8]}-{m['aoi'][8:10]}"
        data.append(dict(m=m, src=src, ev=m["aoi"].split("_")[0], day=dt.date.fromisoformat(day),
                         X=d["X"], y=d["y"].astype(np.int8), u=d["uni"]))
    # storm groups: chain events whose dates are within 5 days
    evs = sorted({(r["day"], r["ev"]) for r in data})
    grp, cur, last = {}, None, None
    for day, ev in evs:
        if last is None or (day - last).days > 5:
            cur = ev
        grp[ev] = cur; last = day
    for r in data:
        r["g"] = grp[r["ev"]]
    return data


def train_rows(r):
    X, y = r["X"], r["y"]
    ii = np.random.default_rng(0).choice(len(y), min(len(y), 40_000), replace=False)
    X, y = X[ii], y[ii]
    if r["src"] == "EMS":   # SAR cannot see water in built-up areas: treat as unobserved
        keep = (X[:, ALL.index("wc_built")] == 0) & (X[:, ALL.index("built500")] < 0.3)
        X, y = X[keep], y[keep]
    return X[:, UI], y


def fit(rows):
    Xs, ys, ws = [], [], []
    for r in rows:
        X, y = train_rows(r); Xs.append(X); ys.append(y); ws.append(np.full(len(y), 1.0 / max(len(y), 1)))
    return lgb.train(PARAMS, lgb.Dataset(np.vstack(Xs), np.concatenate(ys), weight=np.concatenate(ws) * 1e5), 300)


def metrics(r, p):
    X, y = r["X"][r["u"]], r["y"][r["u"]].astype(bool)
    h = X[:, ALL.index("hand1")]; a = (h <= 5).mean(); rec_h = (y & (h <= 5)).sum() / y.sum()
    thr = np.quantile(p, 1 - a); rec_m = (y & (p >= thr)).sum() / y.sum()
    cum = np.cumsum(y[np.argsort(-p)]) / y.sum(); area_m = (np.searchsorted(cum, rec_h) + 1) / len(y)
    # ensemble: smaller of the two land-rank percentiles (flag if either HAND or model says risky)
    from scipy.stats import rankdata
    rh = rankdata(h, method="max") / len(h); rm = rankdata(-p, method="max") / len(p); c = -np.minimum(rh, rm)
    thr_c = np.quantile(c, 1 - a); rec_e = (y & (c >= thr_c)).sum() / y.sum()
    cum_e = np.cumsum(y[np.argsort(-c)]) / y.sum(); area_e = (np.searchsorted(cum_e, rec_h) + 1) / len(y)
    return dict(aoi=r["m"]["aoi"], src=r["src"], g=r["g"], low2k=r["m"]["low2k_median"], area_h5=a, rec_hand=rec_h,
                rec_ens=rec_e, alan_orani_ens=area_e / a,
                rec_model=rec_m, alan_orani=area_m / a, auc_hand=roc_auc_score(y, -h), auc_model=roc_auc_score(y, p))


if sys.argv[1] == "eval":
    data = load(); groups = np.array([r["g"] for r in data]); ug = np.unique(groups)
    print(len(data), "AOI (EMS", sum(r["src"] == "EMS" for r in data), ", EA", sum(r["src"] == "EA" for r in data), "),", len(ug), "fırtına grubu")
    res = []
    for k, (tr, te) in enumerate(GroupKFold(8).split(ug, groups=ug)):
        trg = set(ug[tr]); bst = fit([r for r in data if r["g"] in trg])
        for r in data:
            if r["g"] in trg: continue
            y = r["y"][r["u"]]
            if y.sum() < 30: continue
            res.append(metrics(r, bst.predict(r["X"][r["u"]][:, UI])))
        print("katman", k, "bitti", flush=True)
    R = pd.DataFrame(res); R["arazi"] = pd.cut(R.low2k, [-1, 0.2, 0.4, 2], labels=["dar vadi", "ara", "ova"])
    R.to_csv("out/v2_loeo.csv", index=False)
    def s(df, lab):
        w = int((df.rec_model > df.rec_hand).sum()); n = len(df)
        print(f"{lab:12s} n={n:3d} kapsam {df.rec_hand.median():.2f}→{df.rec_model.median():.2f} daha iyi {w}/{n} (p={binomtest(w, n, .5).pvalue:.2g}) "
              f"alan oranı {df.alan_orani.median():.2f} | birleşik: kapsam {df.rec_ens.median():.2f} daha iyi {int((df.rec_ens > df.rec_hand).sum())}/{n} alan {df.alan_orani_ens.median():.2f} | AUC {df.auc_hand.median():.3f}→{df.auc_model.median():.3f}")
    s(R, "TÜMÜ")
    for key in ["src", "arazi"]:
        for v, df in R.groupby(key, observed=True): s(df, str(v))
    ev = R.groupby("g")[["rec_hand", "rec_model"]].median(); w = int((ev.rec_model > ev.rec_hand).sum())
    print(f"grup düzeyinde {w}/{len(ev)} p={binomtest(w, len(ev), .5).pvalue:.2g}")
elif sys.argv[1] == "fit":
    name = sys.argv[2]; excl = sys.argv[3].split(",") if len(sys.argv) > 3 else []
    data = load(); rows = [r for r in data if not any(r["ev"].startswith(e) for e in excl)]
    fit(rows).save_model(f"out/model_{name}.txt"); print("ok", name, len(rows), "AOI")
