#!/usr/bin/env python3
"""Baixa (uma única vez) os insumos geográficos e as bibliotecas de front-end.

Tudo é gravado no repositório (data/geo, vendor) para que o build e o dashboard
funcionem depois 100% offline. Rode de novo apenas para atualizar.

    python build/fetch_geo.py            # tudo
    python build/fetch_geo.py --only geo # só geografia
    python build/fetch_geo.py --only vendor
"""
import argparse, base64, csv, hashlib, io, json, re, sys, tarfile, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEO = ROOT / "data" / "geo"
VENDOR = ROOT / "vendor"
UA = {"User-Agent": "Mozilla/5.0 (matriz-od build)"}

NPM_PKG = "https://registry.npmjs.org/municipios-brasil/-/municipios-brasil-0.2.1.tgz"
IBGE_UF = ("https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
           "?intrarregiao=UF&formato=application/vnd.geo+json&qualidade=minima")
IBGE_MUN = ("https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
            "?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima")

NE_COUNTRIES = ("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
                "ne_50m_admin_0_countries.geojson")   # Natural Earth, domínio público

CDN = {
    "leaflet.min.js": "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
    "leaflet.min.css": "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
    "d3.min.js": "https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js",
    "d3-sankey.min.js": "https://cdnjs.cloudflare.com/ajax/libs/d3-sankey/0.12.3/d3-sankey.min.js",
}
FONTS_CSS = ("https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700"
             "&family=Inter:wght@400..600&family=IBM+Plex+Mono:wght@400;500;600&display=swap")


def get(url, binary=True):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
        enc = r.headers.get("Content-Encoding", "")
    if "gzip" in enc:  # alguns servidores respondem em gzip mesmo sem pedir
        import gzip
        data = gzip.decompress(data)
    return data if binary else data.decode("utf-8")


def sha(b):
    return hashlib.sha256(b).hexdigest()


# ---------------------------------------------------------------- geografia
def fetch_coords():
    print("coordenadas dos municípios (npm municipios-brasil)…")
    raw = get(NPM_PKG)
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
        member = next(m for m in tf.getmembers() if re.search(r"chunks/municipios-.*\.mjs$", m.name))
        txt = tf.extractfile(member).read().decode("utf-8")
    m = re.search(r"JSON\.parse\(\s*`(\[.*\])`\s*\)", txt, re.S)
    rows = json.loads(m.group(1))
    out = GEO / "municipios_coords.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["co_mun_ibge", "nome", "uf", "latitude", "longitude"])
        for r in sorted(rows, key=lambda r: r["codigoIbge"]):
            w.writerow([r["codigoIbge"], r["nome"], r["uf"], r["latitude"], r["longitude"]])
    print(f"  {len(rows)} municípios -> {out.name}  sha256={sha(raw)[:12]} (pacote npm)")
    return sha(raw)


def quantize(geojson, nd=2, tol=0.004):
    """{codarea: [[ [x,y],... ], ...]} com anéis simplificados (Douglas-Peucker) e arredondados."""
    def dp(pts, tol):
        if len(pts) < 4:
            return pts
        keep = [False] * len(pts)
        keep[0] = keep[-1] = True
        stack = [(0, len(pts) - 1)]
        while stack:
            a, b = stack.pop()
            ax, ay = pts[a]; bx, by = pts[b]
            dx, dy = bx - ax, by - ay
            den = (dx * dx + dy * dy) ** 0.5 or 1e-12
            dmax, idx = 0.0, -1
            for i in range(a + 1, b):
                d = abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / den
                if d > dmax:
                    dmax, idx = d, i
            if dmax > tol:
                keep[idx] = True
                stack += [(a, idx), (idx, b)]
        return [p for p, k in zip(pts, keep) if k]

    out = {}
    for ft in geojson["features"]:
        g = ft["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        res = []
        for poly in polys:
            for ring in poly[:1]:  # só anel externo (ilhas são polígonos separados)
                # anel fechado (1º == último ponto): quebra no ponto mais distante do início
                far = max(range(1, len(ring) - 1), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)                     if len(ring) > 4 else None
                if far is None:
                    continue
                s = dp(ring[:far + 1], tol)[:-1] + dp(ring[far:], tol)
                q, last = [], None
                for x, y in s:
                    p = (round(x, nd), round(y, nd))
                    if p != last:
                        q.append(list(p)); last = p
                if len(q) >= 4:
                    res.append(q)
        out[str(ft["properties"]["codarea"])] = res
    return out


def fetch_malhas():
    print("malhas IBGE (UF e município)…")
    uf = json.loads(get(IBGE_UF, False))
    mun = json.loads(get(IBGE_MUN, False))
    (GEO / "malha_uf.json").write_text(json.dumps(quantize(uf, 2, 0.02), separators=(",", ":")), encoding="utf-8")
    (GEO / "malha_mun.json").write_text(json.dumps(quantize(mun, 2, 0.008), separators=(",", ":")), encoding="utf-8")
    for n in ("malha_uf.json", "malha_mun.json"):
        print(f"  {n}: {(GEO / n).stat().st_size / 1024:.0f} KB")


def fetch_world():
    """Contorno dos demais países (Natural Earth 50m, domínio público), sem o Brasil, com nome em português."""
    print("países do mundo (Natural Earth 50m)…")
    raw = get(NE_COUNTRIES)
    (GEO / "ne_50m_admin_0_countries.geojson").write_bytes(raw)
    gj = json.loads(raw.decode("utf-8"))
    keep, meta = [], {}
    for ft in gj["features"]:
        p = ft["properties"]
        if p["ADM0_A3"] in ("BRA", "ATA"):      # Brasil vem da malha do IBGE; Antártida não é país
            continue
        ft["properties"] = {"codarea": p["ADM0_A3"]}
        meta[p["ADM0_A3"]] = [p.get("NAME_PT") or p["NAME"], round(p["LABEL_X"], 2), round(p["LABEL_Y"], 2),
                              p.get("MIN_LABEL", 3), p.get("MAX_LABEL", 8)]
        keep.append(ft)
    gj["features"] = keep
    rings = quantize(gj, 2, 0.03)
    out = [dict(n=m[0], x=m[1], y=m[2], a=m[3], z=m[4], r=rings.get(cd, [])) for cd, m in meta.items()]
    (GEO / "malha_mundo.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"  {len(out)} países -> malha_mundo.json ({(GEO / 'malha_mundo.json').stat().st_size / 1024:.0f} KB); sha256 origem={sha(raw)[:12]}")


# ---------------------------------------------------------------- vendor
def fetch_vendor():
    VENDOR.mkdir(exist_ok=True)
    manifest = {}
    print("bibliotecas…")
    for name, url in CDN.items():
        b = get(url)
        (VENDOR / name).write_bytes(b)
        manifest[name] = {"url": url, "sha256": sha(b), "bytes": len(b)}
        print(f"  {name}: {len(b) / 1024:.0f} KB")
    # imagens que o CSS do Leaflet referencia (controles de camada/zoom) -> data URI no build
    for img in ("layers.png", "layers-2x.png", "marker-icon.png"):
        url = f"https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/{img}"
        b = get(url)
        (VENDOR / img).write_bytes(b)
        manifest[img] = {"url": url, "sha256": sha(b), "bytes": len(b)}

    print("fontes (woff2, subset latin)…")
    css = get(FONTS_CSS, False) if False else urllib.request.urlopen(
        urllib.request.Request(FONTS_CSS, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                                                               "AppleWebKit/537.36 Chrome/124 Safari/537.36"}),
        timeout=60).read().decode()
    blocks = re.findall(r"/\* ([\w-]+) \*/\s*@font-face\s*\{(.*?)\}", css, re.S)
    out = []
    for subset, body in blocks:
        if subset != "latin":
            continue
        fam = re.search(r"font-family:\s*'([^']+)'", body).group(1)
        wt = re.search(r"font-weight:\s*([\d ]+);", body).group(1).strip()
        url = re.search(r"url\((https://[^)]+\.woff2)\)", body).group(1)
        b = get(url)
        manifest[f"font:{fam}:{wt}"] = {"url": url, "sha256": sha(b), "bytes": len(b)}
        out.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:%s;font-display:swap;"
            "src:url(data:font/woff2;base64,%s) format('woff2');}" % (fam, wt, base64.b64encode(b).decode()))
        print(f"  {fam} {wt}: {len(b) / 1024:.0f} KB")
    (VENDOR / "fonts.css").write_text("\n".join(out), encoding="utf-8")
    (VENDOR / "MANIFEST.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["geo", "vendor"])
    a = ap.parse_args()
    GEO.mkdir(parents=True, exist_ok=True)
    if a.only in (None, "geo"):
        fetch_coords(); fetch_malhas(); fetch_world()
    if a.only in (None, "vendor"):
        fetch_vendor()
