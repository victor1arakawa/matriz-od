#!/usr/bin/env python3
"""Gera dist/matriz_od.html (arquivo único, offline) a partir dos ZIPs oficiais.

    python build/build.py                # usa build/config.json
    python build/build.py --config X.json
    python build/build.py --rebuild      # ignora cache de matrizes já codificadas

Etapas: (1) lê ZIPs e cadastro territorial, (2) junta coordenadas (IBGE/npm),
(3) codifica as matrizes em colunas binárias + gzip, (4) embute tudo com o
template em src/ e as bibliotecas em vendor/, (5) grava manifesto de proveniência.
"""
import argparse, base64, datetime as dt, gzip, hashlib, io, json, re, sys, unicodedata, zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "build" / "cache"
VERSION = "2.0.0"

UFS = [  # cd IBGE, sigla, nome, macrorregião
    (11, "RO", "Rondônia", "Norte"), (12, "AC", "Acre", "Norte"), (13, "AM", "Amazonas", "Norte"),
    (14, "RR", "Roraima", "Norte"), (15, "PA", "Pará", "Norte"), (16, "AP", "Amapá", "Norte"),
    (17, "TO", "Tocantins", "Norte"), (21, "MA", "Maranhão", "Nordeste"), (22, "PI", "Piauí", "Nordeste"),
    (23, "CE", "Ceará", "Nordeste"), (24, "RN", "Rio Grande do Norte", "Nordeste"),
    (25, "PB", "Paraíba", "Nordeste"), (26, "PE", "Pernambuco", "Nordeste"), (27, "AL", "Alagoas", "Nordeste"),
    (28, "SE", "Sergipe", "Nordeste"), (29, "BA", "Bahia", "Nordeste"), (31, "MG", "Minas Gerais", "Sudeste"),
    (32, "ES", "Espírito Santo", "Sudeste"), (33, "RJ", "Rio de Janeiro", "Sudeste"),
    (35, "SP", "São Paulo", "Sudeste"), (41, "PR", "Paraná", "Sul"), (42, "SC", "Santa Catarina", "Sul"),
    (43, "RS", "Rio Grande do Sul", "Sul"), (50, "MS", "Mato Grosso do Sul", "Centro-Oeste"),
    (51, "MT", "Mato Grosso", "Centro-Oeste"), (52, "GO", "Goiás", "Centro-Oeste"),
    (53, "DF", "Distrito Federal", "Centro-Oeste"),
]
UF_IDX = {cd: i for i, (cd, *_r) in enumerate(UFS)}
UF_SG = {sg: i for i, (_cd, sg, *_r) in enumerate(UFS)}

# Cores das categorias: propositalmente SEM ciano/laranja/vermelho, que no mapa e no Sankey
# significam papel (origem/selecionada, destino/conectada, maior fluxo).
PESSOAS_CATS = [("automovel", "Automóvel", "#5B8DEF"), ("onibus", "Ônibus", "#FFD65C"),
                ("hidro", "Hidroviário", "#94A3B8"), ("ferreo", "Ferroviário", "#4ADE93"),
                ("aereo", "Aéreo", "#B58CFF")]
CARGAS_CATS = [("cgc", "Carga Geral Conteinerizável", "#5B8DEF"), ("cgnc", "Carga Geral Não Conteinerizável", "#FFD65C"),
               ("gl", "Granel Líquido", "#B58CFF"), ("gsa", "Granel Sólido Agrícola", "#4ADE93"),
               ("gsm", "Granel Sólido Mineral", "#C8A27A"), ("ogsm", "Outros Granéis Sólidos Minerais", "#E879F9")]


def norm(s):
    s = unicodedata.normalize("NFD", str(s))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if unicodedata.category(c) != "Mn").lower())


def sha256_file(p, chunk=1 << 22):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while b := f.read(chunk):
            h.update(b)
    return h.hexdigest()


def gz_b64(b):
    return base64.b64encode(gzip.compress(b, 9, mtime=0)).decode("ascii")


def log(*a):
    print(*a, flush=True)


# ------------------------------------------------------------------ território
def load_coords():
    c = pd.read_csv(ROOT / "data" / "geo" / "municipios_coords.csv")
    return c.set_index("co_mun_ibge")


def read_csv_zip(z, inner, name, **kw):
    with z.open(f"{inner}/{name}") as f:
        return pd.read_csv(f, encoding="latin-1", **kw)


def build_pessoas_territory(zp, inner, coords, warnings):
    mun = read_csv_zip(zp, inner, "municipios.csv")
    utp = read_csv_zip(zp, inner, "utp.csv")
    mun["uf_i"] = (mun.co_mun_ibge // 100000).map(UF_IDX)
    miss = mun[~mun.co_mun_ibge.isin(coords.index)]
    if len(miss):
        warnings.append(f"pessoas: {len(miss)} municípios sem coordenada: {miss.nm_mun.tolist()[:10]}")
    mun = mun[mun.co_mun_ibge.isin(coords.index)].copy()
    mun["la"] = mun.co_mun_ibge.map(coords.latitude)
    mun["lo"] = mun.co_mun_ibge.map(coords.longitude)
    mun["nn"] = mun.nm_mun.map(norm)

    units = []
    for r in utp.itertuples():
        m = mun[mun.utp == r.utp]
        sede = str(r.sede)
        nm, sep, sg = sede.rpartition(" - ")
        if not sep:  # algumas UTPs (ex.: GO) vêm sem o sufixo " - UF"
            nm, sg = sede, ""
        uf_i = UF_SG.get(sg.strip())
        hit = m[(m.nn == norm(nm)) & (m.uf_i == uf_i)] if uf_i is not None else m[m.nn == norm(nm)]
        if len(hit):
            la, lo = float(hit.iloc[0].la), float(hit.iloc[0].lo)
        elif len(m):
            la, lo = float(m.la.mean()), float(m.lo.mean())
            warnings.append(f"UTP {r.utp} ({sede}): sede não localizada entre os municípios; usado centroide")
        else:
            warnings.append(f"UTP {r.utp} ({sede}) sem municípios com coordenada; descartada do mapa")
            la = lo = float("nan")
        if uf_i is None:
            uf_i = int(m.uf_i.mode().iloc[0]) if len(m) else -1
        if not sep and uf_i >= 0:
            sede = f"{sede} - {UFS[uf_i][1]}"
        units.append(dict(id=int(r.utp), name=sede, la=la, lo=lo, uf=int(uf_i), n=int(len(m))))
    return units, mun


def build_cargas_territory(zc, inner, coords, warnings):
    zonas = read_csv_zip(zc, inner, "zonas.csv")
    intl = json.loads((ROOT / "data" / "geo" / "intl_zones.json").read_text(encoding="utf-8"))
    units = []
    for r in zonas.itertuples():
        if pd.isna(r.co_mun_ibge):
            la, lo = intl.get(r.nm_zona, (float("nan"), float("nan")))
            if r.nm_zona not in intl:
                warnings.append(f"zona internacional sem coordenada: {r.nm_zona}")
            units.append(dict(id=int(r.zona), name=r.nm_zona, la=la, lo=lo, uf=-1, ibge=0))
            continue
        ib = int(r.co_mun_ibge)
        uf_i = UF_IDX.get(ib // 100000, -1)
        if ib in coords.index:
            la, lo = float(coords.at[ib, "latitude"]), float(coords.at[ib, "longitude"])
        else:
            la = lo = float("nan")
            warnings.append(f"zona {r.zona} {r.nm_zona} ({ib}) sem coordenada")
        sg = UFS[uf_i][1] if uf_i >= 0 else "??"
        units.append(dict(id=int(r.zona), name=f"{r.nm_zona} - {sg}", la=la, lo=lo, uf=uf_i, ibge=ib))
    return units


# ------------------------------------------------------------------ matrizes
def encode_edges(o_idx, d_idx, vals):
    """Colunas little-endian: o(u16) d(u16) v0..vk(i32). Ordenado por (o,d); pares repetidos são somados."""
    key = o_idx.astype(np.int64) * 65536 + d_idx.astype(np.int64)
    uk, inv = np.unique(key, return_inverse=True)
    dup = len(key) - len(uk)
    if dup:
        vals = [np.bincount(inv, weights=v.astype(np.float64), minlength=len(uk)).round().astype(np.int64) for v in vals]
        o_idx, d_idx = (uk // 65536).astype(np.int64), (uk % 65536).astype(np.int64)
    order = np.lexsort((d_idx, o_idx))
    cols = [("u2", o_idx[order]), ("u2", d_idx[order])]
    for v in vals:
        v = v[order]
        # int32 cobre até 2,1e9; fluxos maiores (ex.: minério, centenas de Mt ×10) usam float64 — exato até 2^53
        cols.append(("i4", v) if int(v.max(initial=0)) < 2**31 else ("f8", v))
    parts, layout, off = [], [], 0
    for dt, arr in cols:
        pad = (-off) % 8                       # alinhamento exigido pelos TypedArrays do navegador
        parts.append(bytes(pad)); off += pad
        layout.append([dt, off])
        b_ = arr.astype("<" + dt).tobytes(); parts.append(b_); off += len(b_)
    raw = b"".join(parts)
    checks = [int(v.astype(np.int64).sum()) for v in vals]
    return raw, dict(n=int(len(o_idx)), checks=checks, layout=layout, bytes=off, duplicados_somados=int(dup))


def dict_rows(z, inner):
    """Nº de linhas declarado no dicionário de dados (xlsx) — permite detectar CSV incompleto."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(z.read(f"{inner}/dicionario_dados.xlsx")))
    for ws in wb:
        for row in ws.iter_rows(values_only=True):
            for c in row:
                m = re.search(r"possui\s+([\d.]+)\s+linhas", str(c or ""))
                if m and "matriz" in ws.title.lower():
                    return int(m.group(1).replace(".", ""))
    return None


def load_pessoas_edges(zp, inner, units, scale):
    idx = {u["id"]: i for i, u in enumerate(units)}
    with zp.open(f"{inner}/matriz_pessoas.csv") as f:
        df = pd.read_csv(f)
    n_csv = len(df)
    cols = [c for c, *_ in PESSOAS_CATS]
    df = df[(df[cols] > 0).any(axis=1)]
    o = df.origem.map(idx).to_numpy(); d = df.destino.map(idx).to_numpy()
    ok = ~(pd.isna(o) | pd.isna(d))
    o = o[ok].astype(np.int64); d = d[ok].astype(np.int64)
    vals = [np.rint(df[c].to_numpy()[ok] * scale).astype(np.int64) for c in cols]
    raw, chk = encode_edges(o, d, vals)
    chk["linhas_csv"] = int(n_csv)
    chk["linhas_dicionario"] = dict_rows(zp, inner)
    return raw, chk


def load_cargas_edges(zc, inner, units, scale):
    idx = np.full(max(u["id"] for u in units) + 1, -1, dtype=np.int64)
    for i, u in enumerate(units):
        idx[u["id"]] = i
    cols = [c for c, *_ in CARGAS_CATS]
    O, D, V = [], [], [[] for _ in cols]
    total_rows = 0
    with zc.open(f"{inner}/matriz_cargas.csv") as f:
        for ch in pd.read_csv(f, encoding="latin-1", chunksize=2_000_000,
                              dtype={"origem": "int32", "destino": "int32", **{c: "float64" for c in cols}}):
            total_rows += len(ch)
            v = np.rint(ch[cols].to_numpy() * scale).astype(np.int64)
            keep = (v > 0).any(axis=1)
            if not keep.any():
                continue
            O.append(idx[ch.origem.to_numpy()[keep]]); D.append(idx[ch.destino.to_numpy()[keep]])
            for k in range(len(cols)):
                V[k].append(v[keep, k])
            log(f"    {total_rows:>11,} linhas lidas")
    o = np.concatenate(O); d = np.concatenate(D)
    if (o < 0).any() or (d < 0).any():
        raise SystemExit("matriz de cargas referencia zona ausente em zonas.csv")
    raw, chk = encode_edges(o, d, [np.concatenate(x) for x in V])
    chk["linhas_dicionario"] = dict_rows(zc, inner)
    return (raw, chk), total_rows


# ------------------------------------------------------------------ montagem
def js_safe(s):
    return s.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def columnar(units, keys):
    out = {}
    for k in keys:
        col = [u.get(k) for u in units]
        out[k] = [None if (isinstance(x, float) and x != x) else x for x in col]
    return out


def read_text(p):
    return Path(p).read_text(encoding="utf-8")


def leaflet_css():
    css = read_text(ROOT / "vendor" / "leaflet.min.css")
    for img, mime in (("layers.png", "png"), ("layers-2x.png", "png"), ("marker-icon.png", "png")):
        f = ROOT / "vendor" / img
        if f.exists():
            uri = "data:image/%s;base64,%s" % (mime, base64.b64encode(f.read_bytes()).decode())
            css = css.replace(f"images/{img}", uri)
    return css


def geo_blob(name):
    p = ROOT / "data" / "geo" / name
    return gz_b64(p.read_bytes()) if p.exists() else ""


def optional_json(path):
    p = ROOT / path
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(ROOT / "build" / "config.json"))
    ap.add_argument("--rebuild", action="store_true")
    a = ap.parse_args()
    cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    warnings, manifest = [], {"gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
                              "versao_build": VERSION, "fonte": cfg["fonte"], "arquivos": {}, "cenarios": []}

    coords = load_coords()
    scen_meta, blobs = [], {}
    pes_units = car_units = pes_mun = None
    pes_check = {}; car_check = {}

    for sc in cfg["scenarios"]:
        log(f"== cenário {sc['id']}")
        pzip, czip = ROOT / sc["pessoas_zip"], ROOT / sc["cargas_zip"]
        for z in (pzip, czip):
            manifest["arquivos"][z.name] = {"sha256": sha256_file(z), "bytes": z.stat().st_size}
        zp, zc = zipfile.ZipFile(pzip), zipfile.ZipFile(czip)
        inner = sc.get("pasta_interna", "")
        manifest["arquivos"][pzip.name]["membros"] = {i.filename: i.file_size for i in zp.infolist()}
        manifest["arquivos"][czip.name]["membros"] = {i.filename: i.file_size for i in zc.infolist()}

        units_p, mun = build_pessoas_territory(zp, inner, coords, warnings)
        units_c = build_cargas_territory(zc, inner, coords, warnings)
        if pes_units is None:
            pes_units, pes_mun, car_units = units_p, mun, units_c
        elif [u["id"] for u in units_p] != [u["id"] for u in pes_units] or \
                [u["id"] for u in units_c] != [u["id"] for u in car_units]:
            raise SystemExit(f"cenário {sc['id']} tem zoneamento diferente do primeiro; comparação exige mesmas zonas")

        fator = float(sc.get("fator", 1.0))   # só para testes: gera cenário sintético multiplicando os valores
        key = manifest["arquivos"][pzip.name]["sha256"][:12] + manifest["arquivos"][czip.name]["sha256"][:12] + (f"_x{fator}" if fator != 1.0 else "")
        cp = CACHE / f"{sc['id']}_{key}.json"
        if cp.exists() and not a.rebuild:
            cached = json.loads(cp.read_text())
            log("  matrizes em cache")
        else:
            log("  pessoas…")
            (raw_p, chk_p) = load_pessoas_edges(zp, inner, pes_units, 1 * fator)
            log("  cargas… (leitura de ~716 MB, alguns minutos)")
            (raw_c, chk_c), rows_c = load_cargas_edges(zc, inner, car_units, 10 * fator)
            chk_c["linhas_csv"] = rows_c
            cached = dict(p=gz_b64(raw_p), pc=chk_p, c=gz_b64(raw_c), cc=chk_c)
            cp.write_text(json.dumps(cached))
        blobs[sc["id"]] = cached
        for nm, chk in (("pessoas", cached["pc"]), ("cargas", cached["cc"])):
            dic = chk.get("linhas_dicionario")
            if dic and chk["linhas_csv"] < 0.9 * (dic - (1 if nm == "cargas" else 0)):
                warnings.append(f"[{sc['id']}] {nm}: CSV tem {chk['linhas_csv']:,} linhas e o dicionário declara {dic:,} — "
                                "arquivo parcial; totais por unidade, entradas e saldos refletem só os pares presentes")
            if chk.get("duplicados_somados"):
                warnings.append(f"[{sc['id']}] {nm}: {chk['duplicados_somados']} par(es) OD repetido(s) no CSV foram somados")
        scen_meta.append(dict(id=sc["id"], label=sc["label"], pessoas=cached["pc"], cargas=cached["cc"]))
        manifest["cenarios"].append(dict(id=sc["id"], pessoas=cached["pc"], cargas=cached["cc"]))
        log(f"  pessoas: {cached['pc']['n']:,} pares · cargas: {cached['cc']['n']:,} pares")

    # ---- META
    pes_meta = dict(
        unidade_rotulo="viagens/ano", escala=1, cats=[dict(k=k, l=l, c=c) for k, l, c in PESSOAS_CATS],
        units=columnar(pes_units, ["id", "name", "la", "lo", "uf", "n"]),
        mun=dict(name=pes_mun.nm_mun.tolist(), la=pes_mun.la.round(4).tolist(), lo=pes_mun.lo.round(4).tolist(),
                 ibge=pes_mun.co_mun_ibge.astype(int).tolist(),
                 unit=pes_mun.utp.map({u["id"]: i for i, u in enumerate(pes_units)}).astype(int).tolist()))
    car_meta = dict(
        unidade_rotulo="t/ano", escala=10, cats=[dict(k=k, l=l, c=c) for k, l, c in CARGAS_CATS],
        units=columnar(car_units, ["id", "name", "la", "lo", "uf", "ibge"]))
    routes = {k: optional_json(f"data/routes/{k}.json") for k in
              ("rotas_pessoas", "rotas_cargas")}
    overlays = []
    for p in sorted((ROOT / "data" / "overlays").glob("*.geojson")):
        overlays.append(dict(nome=p.stem, geojson=json.loads(p.read_text(encoding="utf-8"))))
    meta = dict(titulo=cfg["titulo"], versao=VERSION, gerado_em=manifest["gerado_em"], fonte=cfg["fonte"],
                osrm_url=cfg["rotas"]["osrm_url"],
                ufs=[dict(cd=cd, sg=sg, nm=nm, macro=mc) for cd, sg, nm, mc in UFS],
                cenarios=scen_meta, pessoas=pes_meta, cargas=car_meta,
                rotas={k: v for k, v in routes.items() if v}, overlays=overlays)

    # ---- HTML
    tpl = read_text(ROOT / "src" / "template.html")
    js_order = ["util", "data", "geo", "state", "map", "panels", "analysis", "export", "main"]
    app_js = "\n".join(read_text(ROOT / "src" / "js" / f"{n}.js") for n in js_order)
    vendor_js = "\n;\n".join(read_text(ROOT / "vendor" / f) for f in ("d3.min.js", "d3-sankey.min.js", "leaflet.min.js"))
    css = (read_text(ROOT / "vendor" / "fonts.css") + "\n" + leaflet_css() + "\n" + read_text(ROOT / "src" / "css" / "app.css"))
    data_tags = [f'<script id="meta" type="application/json">{js_safe(json.dumps(meta, ensure_ascii=False, separators=(",", ":"), allow_nan=False))}</script>']
    for sid, b in blobs.items():
        data_tags.append(f'<script type="text/plain" id="blob-pessoas-{sid}">{b["p"]}</script>')
        data_tags.append(f'<script type="text/plain" id="blob-cargas-{sid}">{b["c"]}</script>')
    data_tags.append(f'<script type="text/plain" id="geo-uf">{geo_blob("malha_uf.json")}</script>')
    data_tags.append(f'<script type="text/plain" id="geo-mun">{geo_blob("malha_mun.json")}</script>')
    data_tags.append(f'<script type="text/plain" id="geo-world">{geo_blob("malha_mundo.json")}</script>')

    html = (tpl.replace("{{TITLE}}", cfg["titulo"]).replace("{{CSS}}", css)
               .replace("{{DATA}}", "\n".join(data_tags))
               .replace("{{VENDOR_JS}}", js_safe(vendor_js)).replace("{{APP_JS}}", js_safe(app_js)))
    assert "{{" not in re.sub(r"<script[^>]*>.*?</script>|<style>.*?</style>", "", html, flags=re.S)
    out = ROOT / cfg["output"]
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    manifest["saida"] = {out.name: {"sha256": sha256_file(out), "bytes": out.stat().st_size}}
    manifest["avisos"] = warnings
    (ROOT / "data" / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    log(f"\nOK  {out}  ({out.stat().st_size / 1e6:.1f} MB)")
    for w in warnings:
        log("  AVISO:", w)


if __name__ == "__main__":
    main()
