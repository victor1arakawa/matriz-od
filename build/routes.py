#!/usr/bin/env python3
"""Pré-calcula rotas rodoviárias (OSRM) para os maiores pares OD.

    python build/routes.py --dataset pessoas --top 400
    python build/routes.py --dataset cargas  --top 400 --osrm http://localhost:5000

Saídas (lidas pelo build.py):
    data/routes/rotas_<ds>.json    {"pares": {"i-j": [km, min, "polyline5"]}}   (índices das unidades)

O cache bruto (geometria completa) fica em build/cache/routes_raw_<ds>.jsonl e o script é retomável.
ATENÇÃO: o servidor público do OSRM é só para demonstração (≈1 requisição/s). Para volume
maior ou uso institucional, suba um OSRM próprio com o extrato do Brasil e use --osrm.
"""
import argparse, base64, gzip, json, math, sys, time, urllib.request, zipfile
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import build as B  # noqa: E402

ROOT = B.ROOT


def decode_polyline(s, prec=5):
    pts, i, lat, lon, f = [], 0, 0, 0, 10 ** prec
    while i < len(s):
        for k in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 0x1F) << shift; shift += 5
                if b < 0x20:
                    break
            d = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: lat += d
            else: lon += d
        pts.append((lat / f, lon / f))
    return pts


def encode_polyline(pts, prec=5):
    out, plat, plon, f = [], 0, 0, 10 ** prec
    for la, lo in pts:
        ilat, ilon = round(la * f), round(lo * f)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return "".join(out)


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ay, ax), (by, bx) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy) or 1e-12
        dmax, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * pts[i][1] - dx * pts[i][0] + bx * ay - by * ax) / den
            if d > dmax: dmax, idx = d, i
        if dmax > tol:
            keep[idx] = True; stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def haversine(la1, lo1, la2, lo2):
    p = math.pi / 180
    a = math.sin((la2 - la1) * p / 2) ** 2 + math.cos(la1 * p) * math.cos(la2 * p) * math.sin((lo2 - lo1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def load_dataset(ds, cfg):
    sc = cfg["scenarios"][0]
    inner = sc.get("pasta_interna", "")
    coords = B.load_coords(); warn = []
    if ds == "pessoas":
        zp = zipfile.ZipFile(ROOT / sc["pessoas_zip"])
        units, _ = B.build_pessoas_territory(zp, inner, coords, warn)
        raw, chk = B.load_pessoas_edges(zp, inner, units, 1)
        ncat, scale = len(B.PESSOAS_CATS), 1
    else:
        zc = zipfile.ZipFile(ROOT / sc["cargas_zip"])
        units = B.build_cargas_territory(zc, inner, coords, warn)
        cache = next((ROOT / "build" / "cache").glob(f"{sc['id']}_*.json"))
        cj = json.loads(cache.read_text())
        raw, chk = gzip.decompress(base64.b64decode(cj["c"])), cj["cc"]
        ncat, scale = len(B.CARGAS_CATS), 10
    n, lay = chk["n"], chk["layout"]
    o = np.frombuffer(raw, "<u2", n, lay[0][1]); d = np.frombuffer(raw, "<u2", n, lay[1][1])
    vals = [np.frombuffer(raw, "<" + dt, n, off).astype(np.float64) / scale for dt, off in lay[2:]]
    return units, o, d, vals


def osrm_route(base, a, b):
    url = f"{base}/route/v1/driving/{a[1]:.5f},{a[0]:.5f};{b[1]:.5f},{b[0]:.5f}?overview=full&geometries=polyline&steps=false"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "matriz-od-build"}), timeout=60) as r:
        j = json.load(r)
    if j.get("code") != "Ok":
        return None
    rt = j["routes"][0]
    return dict(km=rt["distance"] / 1000, min=rt["duration"] / 60, geom=rt["geometry"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["pessoas", "cargas"], required=True)
    ap.add_argument("--top", type=int)
    ap.add_argument("--osrm")
    ap.add_argument("--delay", type=float, default=1.1, help="segundos entre requisições")
    ap.add_argument("--min-km", type=float, default=30)
    ap.add_argument("--only-output", action="store_true", help="não consulta o OSRM; só regera os JSONs do cache")
    a = ap.parse_args()
    cfg = json.loads((ROOT / "build" / "config.json").read_text(encoding="utf-8"))
    ds = a.dataset
    top = a.top or cfg["rotas"][f"top_pares_{ds}"]
    base = (a.osrm or cfg["rotas"]["osrm_url"]).rstrip("/")

    units, o, d, vals = load_dataset(ds, cfg)
    if ds == "pessoas":  # só modais rodoviários
        vol = vals[0] + vals[1]
    else:
        vol = sum(vals)
    la = np.array([u["la"] if u["la"] is not None else np.nan for u in units], dtype=float)
    lo = np.array([u["lo"] if u["lo"] is not None else np.nan for u in units], dtype=float)
    ok = ~(np.isnan(la[o]) | np.isnan(la[d])) & (o != d)
    hav = np.zeros(len(o))
    idx = np.where(ok)[0]
    p = np.pi / 180
    a1, a2 = la[o[idx]] * p, la[d[idx]] * p
    h = np.sin((a2 - a1) / 2) ** 2 + np.cos(a1) * np.cos(a2) * np.sin((lo[d[idx]] - lo[o[idx]]) * p / 2) ** 2
    hav[idx] = 12742 * np.arcsin(np.sqrt(h))
    sel = ok & (hav >= a.min_km) & (vol > 0)
    if ds == "cargas":  # exclui zonas internacionais (uf == -1)
        ufs = np.array([u["uf"] for u in units]); sel &= (ufs[o] >= 0) & (ufs[d] >= 0)
    cand = np.where(sel)[0]
    cand = cand[np.argsort(-vol[cand])][:top]
    # rota é simétrica na malha: consulta uma vez por par não-ordenado
    todo, seen = [], set()
    for k in cand:
        key = (int(min(o[k], d[k])), int(max(o[k], d[k])))
        if key not in seen:
            seen.add(key); todo.append(key)
    print(f"{ds}: {len(cand)} pares OD -> {len(todo)} rotas únicas a obter")

    rawp = ROOT / "build" / "cache" / f"routes_raw_{ds}.jsonl"
    done = {}
    if rawp.exists():
        for line in rawp.read_text().splitlines():
            r = json.loads(line); done[tuple(r["k"])] = r
    if not a.only_output:
        with open(rawp, "a") as f:
            for n, key in enumerate(todo):
                if key in done:
                    continue
                try:
                    r = osrm_route(base, (la[key[0]], lo[key[0]]), (la[key[1]], lo[key[1]]))
                except Exception as e:
                    print("  erro", key, str(e)[:80]); time.sleep(5); continue
                if r:
                    r["k"] = list(key); done[key] = r
                    f.write(json.dumps(r) + "\n"); f.flush()
                if n % 25 == 0:
                    print(f"  {n}/{len(todo)}", flush=True)
                time.sleep(a.delay)

    # ---- saídas
    pares = {}
    for key in todo:
        r = done.get(key)
        if not r: continue
        g = encode_polyline(dp(decode_polyline(r["geom"]), 0.0007))
        pares[f"{key[0]}-{key[1]}"] = [round(r["km"], 1), round(r["min"]), g]
    out_dir = ROOT / "data" / "routes"; out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"rotas_{ds}.json").write_text(json.dumps({"osrm": base, "pares": pares}, separators=(",", ":")))

    sz1 = (out_dir / f"rotas_{ds}.json").stat().st_size / 1024
    print(f"OK rotas={len(pares)} ({sz1:.0f} KB)")


if __name__ == "__main__":
    main()
