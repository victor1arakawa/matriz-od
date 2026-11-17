// ============================== export.js ==============================
const stamp = () => new Date().toISOString().slice(0, 10);
const fileBase = () => `matriz-od-${state.view === 'agg' ? state.agg.ds : state.ds}-${stamp()}`;

function exportCSVRank() { downloadCSV(currentRankingCSV(), fileBase() + '-ranking.csv'); }

function exportCSVMatrix() {
  const A = computeAgg(state.view === 'agg' ? state.agg.ds : state.ds, state.view === 'agg' ? state.agg.cat : state.cat, state.view === 'agg' ? state.agg.level : 'uf');
  const rows = [['origem \\ destino (' + A.ds.unitLabel + ')', ...A.groups.map((g) => g.label)]];
  A.groups.forEach((g, i) => rows.push([g.label, ...A.groups.map((_, j) => A.M[i * A.G + j])]));
  downloadCSV(rows, fileBase() + '-matriz-uf.csv');
}
function exportCSVSummary() {
  const A = computeAgg(state.view === 'agg' ? state.agg.ds : state.ds, state.view === 'agg' ? state.agg.cat : state.cat, state.view === 'agg' ? state.agg.level : 'uf');
  const rows = [['região', 'saídas', 'entradas', 'saldo', '% saídas intra-região', 'dist. média saídas (km, linha reta)', 'volume×km']];
  A.rows.forEach((r) => rows.push([r.name, r.out, r.inn, r.saldo, r.intraPct, r.avgKm, r.tkm]));
  downloadCSV(rows, fileBase() + '-resumo.csv');
}

// ---------- SVG -> PNG ----------
function svgToPng(svgText, w, h, name) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'), k = 2; c.width = w * k; c.height = h * k;
    const g = c.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    c.toBlob((b) => downloadBlob(b, name), 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Falha ao gerar a imagem'); };
  img.src = url;
}

function exportPngSankey() {
  const svg = $('sankey-svg').cloneNode(true);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); svg.setAttribute('width', SK_W); svg.setAttribute('height', SK_H + 40);
  svg.setAttribute('viewBox', `0 -34 ${SK_W} ${SK_H + 40}`);
  svg.insertAdjacentHTML('afterbegin', `<rect x="0" y="-34" width="${SK_W}" height="${SK_H + 40}" fill="${css('--panel')}"/>
    <text x="8" y="-14" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${css('--text')}">${escapeHtml($('sankey-title').textContent)} — ${escapeHtml($('sankey-sub').textContent)}</text>`);
  svgToPng(new XMLSerializer().serializeToString(svg), SK_W, SK_H + 40, fileBase() + '-sankey.png');
}

function exportPngMap() {
  if (!MAP.scene) return;
  const m = MAP.map, size = m.getSize(), W = size.x, H = size.y, TOP = 46;
  const P = (la, lo) => { const p = m.latLngToContainerPoint([la, lo]); return [p.x, p.y + TOP]; };
  const ringPath = (ring) => 'M' + ring.map((pt) => { const [x, y] = P(pt[1], pt[0]); return x.toFixed(1) + ' ' + y.toFixed(1); }).join('L') + 'Z';
  const out = [];
  out.push(`<rect width="${W}" height="${H + TOP}" fill="${css('--panel')}"/><rect y="${TOP}" width="${W}" height="${H}" fill="${css('--sea')}"/>`);
  out.push(`<clipPath id="cl"><rect y="${TOP}" width="${W}" height="${H}"/></clipPath><g clip-path="url(#cl)">`);
  const land = css('--land'), ll = css('--land-line'), ufl = css('--uf-line');
  if (!state.tiles) {   // demais países: hachura leve + contorno + nome (mesmas regras de zoom do mapa)
    out.push(`<defs><pattern id="hp" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="${css('--hatch')}" stroke-width="1"/></pattern></defs>`);
    for (const c of GEO.world) out.push(`<path d="${c.r.map(ringPath).join('')}" fill="url(#hp)" stroke="${css('--ct-line')}" stroke-width="0.8"/>`);
  }
  const z = m.getZoom();
  for (const cd in GEO.uf) out.push(`<path d="${GEO.uf[cd].map(ringPath).join('')}" fill="${land}" stroke="${ufl}" stroke-width="1.3"/>`);
  const ch = MAP.scene.chor;
  if (ch) {
    const src = ch.level === 'uf' ? GEO.uf : GEO.mun;
    for (const [code, col] of ch.colors) if (src[code]) out.push(`<path d="${src[code].map(ringPath).join('')}" fill="${col}" stroke="${ll}" stroke-width="${ch.level === 'uf' ? 0.8 : 0.15}"/>`);
  }
  for (const d of MAP.scene.dots) {
    const [x, y] = P(d.la, d.lo);
    if (d.plus) out.push(`<path d="M${(x - d.r).toFixed(1)} ${y.toFixed(1)}H${(x + d.r).toFixed(1)}M${x.toFixed(1)} ${(y - d.r).toFixed(1)}V${(y + d.r).toFixed(1)}" stroke="${d.fill}" stroke-opacity="${d.op}" stroke-width="1" fill="none"/>`);
    else out.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="${d.fill}" fill-opacity="${d.op}"/>`);
  }
  // rota mais frequente (vermelha) por último = por cima das demais
  for (const l of MAP.scene.lines.slice().sort((a, b) => (a.top ? 1 : 0) - (b.top ? 1 : 0))) out.push(`<polyline points="${l.pts.map((p) => P(p[0], p[1]).map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${l.color}" stroke-width="${l.w}" stroke-opacity="${l.op}" stroke-linecap="round"${l.dash ? ' stroke-dasharray="6 6"' : ''}/>`);
  for (const t of MAP.scene.labels) { const [x, y] = P(t.la, t.lo); out.push(`<text x="${x + 10}" y="${y - 8}" font-family="Arial, sans-serif" font-size="13" font-weight="700" fill="${css('--text')}" stroke="${css('--panel')}" stroke-width="3" paint-order="stroke">${escapeHtml(t.text)}</text>`); }
  if (!state.tiles) for (const w of MAP.world || []) {
    if (!(z >= w.c.a - 0.5 && z <= w.c.z + 1)) continue;
    const [x, y] = P(w.c.y, w.c.x);
    out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9.5" letter-spacing="0.4" fill="${css('--ct-label')}" stroke="${css('--sea')}" stroke-width="2.5" paint-order="stroke">${escapeHtml(w.c.n.toUpperCase())}</text>`);
  }
  out.push('</g>');
  const ds = curDs(), title = state.unit == null ? $('map-sub').textContent : $('map-sub').textContent;
  out.push(`<text x="12" y="20" font-family="Arial, sans-serif" font-size="15" font-weight="700" fill="${css('--text')}">${escapeHtml($('h1').textContent)}</text>
    <text x="12" y="38" font-family="Arial, sans-serif" font-size="11.5" fill="${css('--text-muted')}">${escapeHtml(title)} · ${escapeHtml(META.cenarios.find((c) => c.id === state.scn).label)} · ${stamp()}</text>
    <text x="${W - 8}" y="${H + TOP - 6}" text-anchor="end" font-family="Arial, sans-serif" font-size="9.5" fill="${css('--text-dim')}">Fonte: EPL/PNL 2035 · malhas IBGE${state.tiles ? ' (mapa-base online não incluído na imagem)' : ''}</text>`);
  if (ch) {
    const sc = chorLegendScale();
    if (sc) {
      const stops = sc.stops.map((c, i) => `<stop offset="${i / (sc.stops.length - 1) * 100}%" stop-color="${c}"/>`).join('');
      out.push(`<defs><linearGradient id="lg">${stops}</linearGradient></defs><rect x="12" y="${H + TOP - 34}" width="180" height="8" fill="url(#lg)"/>
        <text x="12" y="${H + TOP - 40}" font-family="Arial, sans-serif" font-size="10" fill="${css('--text')}">${escapeHtml(METRIC_LABEL[state.metric])} (${escapeHtml(ds.unitLabel)})</text>
        <text x="12" y="${H + TOP - 14}" font-family="Arial, sans-serif" font-size="10" fill="${css('--text-muted')}">${sc.lo}</text>
        <text x="192" y="${H + TOP - 14}" text-anchor="end" font-family="Arial, sans-serif" font-size="10" fill="${css('--text-muted')}">${sc.hi}</text>`);
    }
  }
  svgToPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + TOP}" viewBox="0 0 ${W} ${H + TOP}">${out.join('')}</svg>`, W, H + TOP, fileBase() + '-mapa.png');
}
function chorLegendScale() {
  const r = $('map-legend').querySelector('.ramp'); if (!r) return null;
  const spans = $('map-legend').querySelectorAll('.lr span');
  const stops = (r.style.background.match(/rgb\([^)]+\)/g)) || [];
  return { stops, lo: spans[0] ? spans[0].textContent : '', hi: spans[2] ? spans[2].textContent : '' };
}

// ---------- link, tema e camadas ----------
async function copyLink() {
  history.replaceState(null, '', '#' + stateToHash());
  const url = location.href;
  try { await navigator.clipboard.writeText(url); toast('Link copiado'); }
  catch (e) { window.prompt('Copie o link:', url); }
}

function loadGeoJSONFiles(files) {
  [...files].forEach((f) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const gj = JSON.parse(rd.result);
        if (!gj || !['FeatureCollection', 'Feature', 'GeometryCollection', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'Point', 'MultiPoint'].includes(gj.type)) throw new Error('não é GeoJSON');
        const ov = addOverlay(f.name.replace(/\.(geo)?json$/i, ''), gj);
        try { MAP.map.fitBounds(ov.layer.getBounds(), { padding: [20, 20] }); } catch (e) { /* vazio */ }
      } catch (e) { toast('Arquivo inválido: ' + f.name); }
    };
    rd.readAsText(f);
  });
}
