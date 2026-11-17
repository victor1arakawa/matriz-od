#!/usr/bin/env python3
"""Valida o HTML gerado contra os CSVs oficiais (teste automático de integridade).

    python build/validate.py            # valida dist/matriz_od.html
    python build/validate.py --quick    # pula a releitura de 716 MB das cargas (só compara totais gravados)

Verifica: (1) pares e somas por coluna == CSV; (2) somas por origem e destino == CSV;
(3) valor exato de cada par de pessoas; (4) unidades sem coordenada; (5) HTML sem
dependências externas (script/link/import); (6) cobertura do CSV vs. dicionário de dados.
Sai com código 1 se algo falhar.
"""
import argparse, base64, gzip, json, re, sys, zipfile
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import build as B  # noqa: E402

ROOT = B.ROOT
FAILS, OKS = [], []


def check(cond, msg):
    (OKS if cond else FAILS).append(msg)
    print(("  ok    " if cond else "  FALHA ") + msg, flush=True)


def blob(html, sid):
    m = re.search(rf'<script type="text/plain" id="{sid}">([^<]*)</script>', html)
    return gzip.decompress(base64.b64decode(m.group(1)))


def decode(raw, n, layout):
    cols = [np.frombuffer(raw, "<" + dt, n, off).astype(np.int64) for dt, off in layout]
    return cols[0], cols[1], cols[2:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    a = ap.parse_args()
    cfg = json.loads((ROOT / "build" / "config.json").read_text(encoding="utf-8"))
    out = ROOT / cfg["output"]
    html = out.read_text(encoding="utf-8")
    meta = json.loads(re.search(r'<script id="meta" type="application/json">(.*?)</script>', html, re.S).group(1).replace("<\\/", "</"))
    print(f"validando {out.name} ({out.stat().st_size / 1e6:.1f} MB)")

    print("\n[1] independência de rede")
    ext = re.findall(r'<(?:script|link|img|iframe)[^>]+(?:src|href)=["\']https?://[^"\']+', html)
    check(not ext, "nenhum <script src>/<link href>/<img> externo" + (f" — encontrados: {ext[:3]}" if ext else ""))
    check("@import" not in html.split("</style>")[0], "CSS sem @import externo")

    for sc in cfg["scenarios"]:
        sid = sc["id"]
        print(f"\n[2] cenário {sid}")
        inner = sc.get("pasta_interna", "")
        zp, zc = zipfile.ZipFile(ROOT / sc["pessoas_zip"]), zipfile.ZipFile(ROOT / sc["cargas_zip"])
        info = next(c for c in meta["cenarios"] if c["id"] == sid)

        # ---- pessoas: comparação par a par
        cols = [c for c, *_ in B.PESSOAS_CATS]
        df = pd.read_csv(zp.open(f"{inner}/matriz_pessoas.csv"))
        g = df.groupby(["origem", "destino"])[cols].sum()
        g = g[(g > 0).any(axis=1)]
        ids = meta["pessoas"]["units"]["id"]
        o, d, v = decode(blob(html, f"blob-pessoas-{sid}"), info["pessoas"]["n"], info["pessoas"]["layout"])
        check(len(g) == len(o), f"pessoas: nº de pares {len(o):,} == CSV agregado {len(g):,}")
        oi, di = np.array(ids)[o], np.array(ids)[d]
        rec = pd.DataFrame({"origem": oi, "destino": di, **{c: v[k] for k, c in enumerate(cols)}}).set_index(["origem", "destino"]).sort_index()
        same = rec.shape == g.shape and (rec.values == g.sort_index().values).all()
        check(bool(same), "pessoas: TODOS os valores (par × modal) idênticos ao CSV")
        check(int(df[cols].sum().sum()) == int(sum(int(x.sum()) for x in v)), f"pessoas: total geral {int(df[cols].sum().sum()):,} viagens/ano preservado")

        # ---- cargas
        ccols = [c for c, *_ in B.CARGAS_CATS]
        o, d, v = decode(blob(html, f"blob-cargas-{sid}"), info["cargas"]["n"], info["cargas"]["layout"])
        uid = np.array(meta["cargas"]["units"]["id"])
        check(info["cargas"]["n"] == len(o), f"cargas: {len(o):,} pares no blob")
        if a.quick:
            print("  (pulado: releitura das cargas — use sem --quick)")
        else:
            nz, tot_o, tot_d = 0, np.zeros(len(uid) + 1), np.zeros(len(uid) + 1)
            sums = np.zeros(len(ccols), dtype=np.int64)
            zmax = int(uid.max())
            pos = np.full(zmax + 1, -1); pos[uid] = np.arange(len(uid))
            with zc.open(f"{inner}/matriz_cargas.csv") as f:
                for ch in pd.read_csv(f, encoding="latin-1", chunksize=2_000_000,
                                      dtype={"origem": "int32", "destino": "int32", **{c: "float64" for c in ccols}}):
                    x = np.rint(ch[ccols].to_numpy() * 10).astype(np.int64)
                    k = (x > 0).any(axis=1)
                    nz += int(k.sum()); sums += x[k].sum(axis=0)
                    t = x[k].sum(axis=1)
                    np.add.at(tot_o, pos[ch.origem.to_numpy()[k]], t); np.add.at(tot_d, pos[ch.destino.to_numpy()[k]], t)
            check(nz == len(o), f"cargas: pares não-zero do CSV {nz:,} == blob {len(o):,}")
            check(all(int(v[k].sum()) == int(sums[k]) for k in range(len(ccols))), "cargas: soma de cada categoria idêntica ao CSV (0,1 t)")
            bo, bd = np.zeros(len(uid) + 1), np.zeros(len(uid) + 1)
            t = sum(v)
            np.add.at(bo, o, t); np.add.at(bd, d, t)
            check(bool((bo == tot_o).all()) and bool((bd == tot_d).all()), "cargas: total por zona (saída e entrada) idêntico ao CSV nas 5.589 zonas")

        # ---- ordenação exigida pelo front (busca binária)
        key = o * 65536 + d
        check(bool((np.diff(key) > 0).all()), "cargas: pares ordenados por (origem,destino) e sem repetição")

    print("\n[3] território")
    for ds in ("pessoas", "cargas"):
        U = meta[ds]["units"]
        semcoord = [U["name"][i] for i in range(len(U["id"])) if U["la"][i] is None]
        check(not semcoord, f"{ds}: todas as unidades têm coordenada" + (f" — faltam {semcoord[:5]}" if semcoord else ""))
        check(all(-35 < la < 6 or U["uf"][i] < 0 for i, la in enumerate(U["la"]) if la is not None), f"{ds}: latitudes brasileiras plausíveis")
    manifest = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
    for w in manifest.get("avisos", []):
        print("  AVISO ", w)

    print(f"\n{len(OKS)} verificações ok · {len(FAILS)} falhas")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
