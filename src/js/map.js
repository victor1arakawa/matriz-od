// ============================== map.js ==============================
// Mapa Leaflet 100% offline por padrão: contorno de UFs (IBGE) como base; tiles do OpenStreetMap são opcionais.
const MAP = { map: null, ready: false, layers: {}, points: [], scene: null, routeToken: 0, chor: {}, overlays: [] };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// Mapa-base online opcional. Nenhum exige chave. Se um provedor bloquear (ex.: o OSM recusa pedidos sem "Referer",
// que é o caso de arquivos abertos por duplo clique), troque de provedor no seletor.
const TILE_PROVIDERS = {
  carto: { url: (t) => `https://{s}.basemaps.cartocdn.com/${t === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}{r}.png`, sub: 'abcd', dark: true,
           attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>' },
  esri: { url: () => 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', sub: '', dark: false,
          attr: 'Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors' },
  osm: { url: () => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', sub: '', dark: false,
         attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
};
const tipEl = () => $('map-tooltip');

function showTip(html, evt) {
  const t = tipEl(); t.innerHTML = html; t.style.opacity = 1;
  const wrap = $('map-wrap').getBoundingClientRect();
  const e = evt.originalEvent || evt;
  const mx = e.clientX - wrap.left, my = e.clientY - wrap.top;
  let left = mx + 14, top = my + 14;
  if (left > wrap.width - 300) left = mx - 300;
  if (top > wrap.height - t.offsetHeight - 10) top = Math.max(4, my - t.offsetHeight - 10);
  t.style.left = left + 'px'; t.style.top = top + 'px';
}
const hideTip = () => { tipEl().style.opacity = 0; };

function initMap() {
  const map = L.map('leaflet-map', { center: [-14.8, -51.9], zoom: 4, minZoom: 2, maxZoom: 12, zoomSnap: 0.5,
    preferCanvas: true, worldCopyJump: false, attributionControl: true });
  MAP.map = map;
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Malhas © IBGE · dados OD © EPL/PNL 2035');
  [['pWorld', 200], ['pBase', 210], ['pMain', 300], ['pFlows', 450], ['pSel', 620]]
    .forEach(([n, z]) => { map.createPane(n).style.zIndex = z; });
  const cv = (pane) => L.canvas({ pane, padding: 0.4 });
  // UM único canvas interativo (pMain): canvases sobrepostos bloqueariam os eventos do inferior
  MAP.rBase = cv('pBase'); MAP.rMain = cv('pMain');
  MAP.rFlows = L.svg({ pane: 'pFlows', padding: 0.4 });
  MAP.rWorld = L.svg({ pane: 'pWorld', padding: 0.5 });   // SVG (não canvas) para permitir a hachura via <pattern>

  initWorld();
  // base offline: UFs
  MAP.layers.base = L.layerGroup().addTo(map);
  for (const cd in GEO.uf) {
    for (const ring of GEO.uf[cd]) {
      MAP.layers.base.addLayer(L.polygon(toLL(ring), { renderer: MAP.rBase, pane: 'pBase', interactive: false, weight: 1.3, smoothFactor: 0.6 }));
    }
  }
  MAP.layers.dots = L.layerGroup().addTo(map);
  MAP.layers.flows = L.layerGroup().addTo(map);
  MAP.layers.sel = L.layerGroup().addTo(map);
  MAP.layers.tiles = null;
  map.on('zoomend', () => { updateDotSizes(); updateCountryLabels(); });
  map.on('mouseout', hideTip);
  map.on('movestart zoomstart', hideTip);
  MAP.ready = true;
  styleBase();
}

function styleBase() {
  const online = state.tiles;
  MAP.layers.base.eachLayer((l) => l.setStyle({ fillColor: css('--land'), fillOpacity: online ? 0 : 1, color: css('--uf-line'), opacity: online ? 0.75 : 1, weight: 1.3 }));
  styleWorld();
  $('leaflet-map').style.background = online ? '' : css('--sea');
  const P = TILE_PROVIDERS[state.tiles];
  $('leaflet-map').classList.toggle('osm-dark', !!P && !P.dark && state.theme === 'dark');   // provedores só claros: no tema escuro os tiles são invertidos por CSS
}


// ---------- demais países: contorno + nome, hachura bem leve ----------
function initWorld() {
  MAP.layers.world = L.layerGroup(); MAP.layers.wlabels = L.layerGroup(); MAP.world = [];
  for (const c of GEO.world) {
    for (const ring of c.r) {
      const p = L.polygon(toLL(ring), { renderer: MAP.rWorld, pane: 'pWorld', interactive: false, weight: 0.8, smoothFactor: 0.5, fillColor: 'url(#od-hatch)', fillOpacity: 1 });
      MAP.layers.world.addLayer(p);
    }
    const mk = L.marker([c.y, c.x], { icon: L.divIcon({ className: 'ct-label', html: escapeHtml(c.n), iconSize: null }), interactive: false, keyboard: false, pane: 'pWorld' });
    MAP.world.push({ c, mk, shown: false });
  }
  MAP.layers.world.addTo(MAP.map); MAP.layers.wlabels.addTo(MAP.map);
  // <pattern> no <svg> do renderer (as cores vêm de variáveis CSS, então acompanham o tema)
  const svg = MAP.rWorld._container;
  if (svg) {
    const ns = 'http://www.w3.org/2000/svg', defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = '<pattern id="od-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--hatch);stroke-width:1"/></pattern>';
    svg.insertBefore(defs, svg.firstChild);
  }
  updateCountryLabels();
}
function styleWorld() {
  if (!MAP.layers.world) return;
  const online = state.tiles;
  MAP.layers.world.eachLayer((l) => l.setStyle({ color: css('--ct-line'), opacity: online ? 0 : 1, fillOpacity: online ? 0 : 1 }));
  updateCountryLabels();
}
// nomes aparecem conforme o zoom (faixa MIN_LABEL–MAX_LABEL do Natural Earth)
function updateCountryLabels() {
  if (!MAP.world) return;
  const z = MAP.map.getZoom();
  for (const w of MAP.world) {
    const on = !state.tiles && z >= w.c.a - 0.5 && z <= w.c.z + 1;
    if (on && !w.shown) { MAP.layers.wlabels.addLayer(w.mk); w.shown = true; }
    else if (!on && w.shown) { MAP.layers.wlabels.removeLayer(w.mk); w.shown = false; }
  }
}

function setTiles(provider) {
  state.tiles = provider || '';
  if (MAP.layers.tiles) { MAP.map.removeLayer(MAP.layers.tiles); MAP.layers.tiles = null; }
  const P = TILE_PROVIDERS[state.tiles];
  if (P) {
    const tl = L.tileLayer(P.url(state.theme), { subdomains: P.sub || 'abc', maxZoom: 19, attribution: P.attr });
    let failed = 0;
    tl.on('tileerror', () => { if (++failed === 3) toast('Sem acesso a este mapa-base — troque o provedor ou use o modo offline'); });
    tl.addTo(MAP.map); tl.setZIndex(1); MAP.layers.tiles = tl;
  }
  styleBase();
}

// ---------- marcador "+" (canvas) ----------
// L.CircleMarker com options.plus=true é desenhado como cruz; os demais seguem como círculo.
(function () {
  const orig = L.Canvas.prototype._updateCircle;
  L.Canvas.include({
    _updateCircle(layer) {
      if (!layer.options.plus) return orig.call(this, layer);
      if (!this._drawing || layer._empty()) return;
      const p = layer._point, r = Math.max(Math.round(layer._radius), 2), ctx = this._ctx;
      ctx.beginPath();
      ctx.moveTo(p.x - r, p.y); ctx.lineTo(p.x + r, p.y);
      ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x, p.y + r);
      this._fillStroke(ctx, layer);
    },
  });
})();

// ---------- pontos ----------
function dotRadius(big) { const z = MAP.map.getZoom(); const r = Math.max(1.5, Math.min(7, 0.9 + (z - 3) * 0.75)); return big ? r * 1.7 : r; }
const plusRadius = () => Math.max(1.8, dotRadius(false) * 0.95);

// "+" com nível de detalhe por zoom: ao afastar, ficam mais transparentes e só os mais importantes
// (maior volume de entrada+saída) permanecem; ao aproximar, voltam todos. Unidades dentro do filtro sempre aparecem.
function plusZoomParams() {
  const z = MAP.map.getZoom();
  return { alpha: Math.max(0.28, Math.min(0.7, 0.28 + (z - 2) * 0.1)), keep: z <= 3 ? 0.15 : z <= 4 ? 0.3 : z <= 5 ? 0.55 : z <= 6 ? 0.8 : 1 };
}
function applyPlusZoom(p, zp) {
  const c = MAP.plusCtx || { shown: true, filtered: false };
  const vis = c.shown && (p.foc || p.pct <= zp.keep);
  p.m.setStyle({ opacity: !vis ? 0 : (c.filtered && !p.foc ? zp.alpha * 0.25 : zp.alpha) });
  p.m.options.interactive = vis;
  p.m.setRadius(plusRadius());
}
function updateDotSizes() {
  const zp = plusZoomParams();
  for (const p of MAP.points) { if (p.plus) applyPlusZoom(p, zp); else p.m.setRadius(dotRadius(p.big)); }
}
// percentil de importância de cada PONTO (0 = mais importante), memorizado por base/cenário.
// Importância = volume de entrada+saída da unidade; em pessoas divide-se entre os municípios da UTP.
function importancePct(ds, S) {
  const key = ds.key + '|' + S.id + '|' + MAP.points.length;
  if (MAP._imp && MAP._imp.key === key) return MAP._imp.pct;
  const p = passAll(ds, S, -1, '', ''), members = ds.key === 'pessoas' ? ds.meta.units.n : null;
  const w = MAP.points.map((pt) => (p.out[pt.unit] + p.inn[pt.unit]) / (members ? Math.max(1, members[pt.unit]) : 1));
  const idx = w.map((_, i) => i).sort((x, y) => w[y] - w[x]);
  const pct = new Float32Array(w.length); idx.forEach((i, r) => { pct[i] = r / w.length; });
  MAP._imp = { key, pct };
  return pct;
}

function buildDots() {
  const ds = curDs();
  MAP.layers.dots.clearLayers(); MAP.points = [];
  const add = (la, lo, unit, name) => {
    if (!isFinite(la) || !isFinite(lo)) return;
    const m = L.circleMarker([la, lo], { renderer: MAP.rMain, pane: 'pMain', radius: 2, weight: 0, fillOpacity: 0.85, fillColor: css('--neutral-dot') });
    m.on('mousemove', (ev) => showTip(unitTipHtml(unit, name), ev));
    m.on('mouseout', hideTip);
    m.on('click', () => selectUnit(unit));
    MAP.layers.dots.addLayer(m);
    MAP.points.push({ m, unit, i: MAP.points.length, sel: false, big: false, plus: false });
  };
  if (ds.key === 'pessoas') {
    const M = ds.meta.mun;
    for (let i = 0; i < M.name.length; i++) add(M.la[i], M.lo[i], M.unit[i], M.name[i]);
  } else {
    for (let i = 0; i < ds.n; i++) add(ds.la[i], ds.lo[i], i, ds.name[i]);
  }
  updateDotSizes();
}

// ---------- coroplético ----------
// Polígonos criados uma única vez por nível; a cada render só o estilo muda.
function ensureChor(level) {
  if (MAP.chor[level]) return MAP.chor[level];
  const src = level === 'uf' ? GEO.uf : GEO.mun, group = L.layerGroup(), list = [];
  for (const code in src) {
    const it = { code, polys: [], unit: -1, uf: null };
    for (const ring of src[code]) {
      const p = L.polygon(toLL(ring), { renderer: MAP.rMain, pane: 'pMain', weight: level === 'uf' ? 1.3 : 0.25, smoothFactor: 0.5, fillOpacity: 0.9 });
      p.on('mousemove', (ev) => showTip(chorTipHtml(MAP.curCtx, it), ev));
      p.on('mouseout', hideTip);
      p.on('click', () => {
        if (level === 'mun') { if (it.unit >= 0) selectUnit(it.unit); }
        else if (it.uf != null) { state.fo = 'uf:' + it.uf; render(); }
      });
      group.addLayer(p); it.polys.push(p);
    }
    list.push(it);
  }
  MAP.chor[level] = { list, group };
  return MAP.chor[level];
}

function metricValue(pass, metric, i) {
  if (metric === 'saidas') return pass.out[i];
  if (metric === 'entradas') return pass.inn[i];
  if (metric === 'saldo') return pass.inn[i] - pass.out[i];
  return pass.tkm[i];
}
const METRIC_LABEL = { saidas: 'Saídas', entradas: 'Entradas', saldo: 'Saldo (entradas − saídas)', tkm: 'Volume × km (saídas)' };

function chorScale(vals, metric) {
  const diverging = metric === 'saldo';
  // escala truncada no percentil 98: um único outlier (ex.: porto de minério) não deve apagar o resto do mapa
  const abs = vals.map((v) => Math.abs(v)).filter((v) => v > 0).sort((a, b) => a - b);
  const mx = abs.length ? Math.max(1e-9, abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.98))]) : 1;
  // paleta violeta (sequencial) e roxo↔verde (saldo): não usa ciano/laranja/vermelho, reservados às rotas e seleção
  const seq = state.theme === 'light' ? d3.interpolateLab('#efe9fb', '#3a1a8a') : d3.interpolateLab('#231a47', '#e6d9ff');
  const fn = diverging
    ? (v) => { const t = Math.pow(Math.min(1, Math.abs(v) / mx), 0.5) * Math.sign(v); return d3.interpolatePRGn(0.5 + 0.5 * t); }
    : (v) => seq(v <= 0 ? 0.03 : 0.08 + 0.92 * Math.pow(Math.min(1, v / mx), 0.4));
  return { fn, max: mx, diverging };
}

function renderChoro(ctx) {
  const { ds, pass } = ctx, level = state.mode;            // 'uf' | 'mun'
  MAP.curCtx = ctx;
  const { list, group } = ensureChor(level);
  for (const lv of ['uf', 'mun']) { const g = MAP.chor[lv] && MAP.chor[lv].group; if (g && lv !== level && MAP.map.hasLayer(g)) MAP.map.removeLayer(g); }
  if (!MAP.map.hasLayer(group)) group.addTo(MAP.map);
  const vals = new Map();
  if (level === 'mun') {
    for (const it of list) { const u = ds.ibgeToUnit.get(+it.code); it.unit = u == null ? -1 : u; vals.set(it.code, it.unit >= 0 ? metricValue(pass, state.metric, it.unit) : 0); }
  } else {
    const acc = new Float64Array(N_UF);
    for (let i = 0; i < ds.n; i++) if (ds.uf[i] >= 0) acc[ds.uf[i]] += metricValue(pass, state.metric, i);
    for (const it of list) { it.uf = UF_BY_CD[+it.code]; vals.set(it.code, it.uf == null ? 0 : acc[it.uf]); }
  }
  const sc = chorScale([...vals.values()], state.metric);
  MAP.scene.chor = { level, colors: new Map() };
  for (const it of list) {
    const v = vals.get(it.code); it.v = v;
    const nodata = level === 'mun' ? it.unit < 0 : it.uf == null;
    const col = nodata ? css('--land') : sc.fn(v);
    MAP.scene.chor.colors.set(it.code, col);
    const isSel = level === 'mun' && state.unit != null && it.unit === state.unit;
    for (const p of it.polys) p.setStyle({ fillColor: col, color: isSel ? css('--origem') : css(level === 'uf' ? '--uf-line' : '--land-line'), weight: isSel ? 1.6 : (level === 'uf' ? 1.3 : 0.25) });
  }
  drawMapLegend(sc, ds);
}

function chorTipHtml(ctx, it) {
  const ds = ctx.ds, uf = state.mode === 'uf';
  const name = uf ? (it.uf != null ? UFS[it.uf].nm : it.code) : (it.unit >= 0 ? ds.name[it.unit] : 'sem zona no modelo');
  const sign = state.metric === 'saldo' && it.v > 0 ? '+' : '';
  return `<div class="t1">${escapeHtml(name)}</div><div class="t2">${METRIC_LABEL[state.metric]} · ${ds.unitLabel}</div>
    <div class="tip-total-row"><span>Valor</span><b>${sign}${fmtInt(it.v)}</b></div>
    <div class="tip-meta">${uf ? 'clique: filtrar esta UF como origem' : ds.key === 'pessoas' ? 'valor da UTP à qual o município pertence' : 'clique: selecionar'}</div>`;
}

function drawMapLegend(sc, ds) {
  const el = $('map-legend'); el.style.display = 'block';
  const stops = [...Array(9)].map((_, i) => sc.fn(sc.diverging ? (i - 4) / 4 * sc.max : i / 8 * sc.max)).join(',');
  el.innerHTML = `<div>${METRIC_LABEL[state.metric]} <span style="opacity:.7">(${ds.unitLabel})</span></div>
    <div class="ramp" style="background:linear-gradient(90deg,${stops})"></div>
    <div class="lr"><span>${sc.diverging ? '−' + fmtShort(sc.max) + '+' : '0'}</span><span>${sc.diverging ? '0' : ''}</span><span>${sc.diverging ? '+' : ''}${fmtShort(sc.max)}+</span></div>
    <div style="opacity:.7">escala truncada no percentil 98</div>`;
}

// ---------- fluxos / arcos / rotas ----------
function arcPoints(a, b, steps = 28) {
  const mx = (a[1] + b[1]) / 2, my = (a[0] + b[0]) / 2, dx = b[1] - a[1], dy = b[0] - a[0], k = 0.16;
  const cx = mx - dy * k, cy = my + dx * k, pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * cy + t * t * b[0], u * u * a[1] + 2 * u * t * cx + t * t * b[1]]);
  }
  return pts;
}

const _liveRoutes = new Map();   // key -> Promise<{km,min,poly}|null>
let _liveQueue = Promise.resolve();
function liveRoute(dsKey, ds, i, j) {
  const key = dsKey + ':' + Math.min(i, j) + '-' + Math.max(i, j);
  if (_liveRoutes.has(key)) return _liveRoutes.get(key);
  const a = Math.min(i, j), b = Math.max(i, j);
  const p = (_liveQueue = _liveQueue.then(async () => {
    try {
      const url = `${META.osrm_url}/route/v1/driving/${ds.lo[a].toFixed(5)},${ds.la[a].toFixed(5)};${ds.lo[b].toFixed(5)},${ds.la[b].toFixed(5)}?overview=full&geometries=polyline&steps=true`;
      const r = await fetch(url); const j = await r.json();
      await new Promise((res) => setTimeout(res, 1100));      // respeita o limite do servidor público
      if (j.code !== 'Ok') return null;
      const rt = j.routes[0];
      // rodovias da rota: distância acumulada por ref (ex.: BR-381) ou, sem ref, pelo nome da via; trechos sem nome ficam de fora
      const acc = new Map();
      for (const leg of rt.legs) for (const st of leg.steps || []) {
        const label = st.ref ? st.ref.split(';')[0].trim() : (st.name || '').trim();
        if (label && st.distance > 0) acc.set(label, (acc.get(label) || 0) + st.distance);
      }
      const roads = [...acc].map(([n, d]) => ({ n, km: d / 1000 })).sort((a, b) => b.km - a.km);
      return { km: rt.distance / 1000, min: rt.duration / 60, pts: decodePolyline(rt.geometry), roads };
    } catch (e) { return null; }
  }));
  _liveRoutes.set(key, p);
  return p;
}

function drawFlows(ctx) {
  const { ds, S, top } = ctx;
  MAP.layers.flows.clearLayers(); MAP.layers.sel.clearLayers();
  MAP.scene.lines = []; MAP.scene.labels = [];
  if (state.unit == null) { if (MAP.fitPending) { MAP.fitPending = false; fitBrazil(); } return; }
  const u = state.unit, ua = [ds.la[u], ds.lo[u]];
  const maxV = top.length ? top[0].val : 1;
  const wScale = d3.scaleSqrt().domain([0, maxV]).range([1, 8]), oScale = d3.scaleSqrt().domain([0, maxV]).range([0.3, 0.9]);
  const token = ++MAP.routeToken; MAP.topLine = null;
  const colorFor = (i) => i === 0 ? css('--flow-max') : (state.dir === 'origem' ? css('--destino') : css('--origem'));
  let pending = 0, done = 0;
  const status = (txt) => { const el = $('map-status'); if (txt) { el.textContent = txt; el.style.display = 'block'; } else el.style.display = 'none'; };

  top.forEach((t, i) => {
    const ob = [ds.la[t.other], ds.lo[t.other]];
    if (!isFinite(ob[0]) || !isFinite(ob[1])) return;
    const w = wScale(t.val), op = i === 0 ? 0.95 : oScale(t.val), col = colorFor(i);
    const draw = (pts, dashed, route) => {
      if (token !== MAP.routeToken) return;
      let casing = null;
      if (state.mode !== 'pontos') { casing = L.polyline(pts, { renderer: MAP.rFlows, pane: 'pFlows', color: css('--bg'), weight: w + 3, opacity: 0.55, lineCap: 'round', interactive: false }); MAP.layers.flows.addLayer(casing); }  // contorno p/ contraste sobre o coroplético
      const line = L.polyline(pts, { renderer: MAP.rFlows, pane: 'pFlows', color: col, weight: w, opacity: op, lineCap: 'round', dashArray: dashed ? '6 6' : null });
      line.on('mousemove', (ev) => showTip(pairTipHtml(ctx, t, i, route), ev)); line.on('mouseout', hideTip);
      line.on('click', () => selectUnit(t.other));
      MAP.layers.flows.addLayer(line);
      const sc = { pts, color: col, w, op, dash: dashed, top: i === 0 };
      MAP.scene.lines.push(sc);
      if (i === 0 && !dashed) MAP.topLine = { line, casing };
      // a rota mais frequente (vermelha) sempre fica por cima das demais, mesmo quando outra chega depois (consulta online)
      if (MAP.topLine) { if (MAP.topLine.casing) MAP.topLine.casing.bringToFront(); MAP.topLine.line.bringToFront(); }
      return { line, casing, sc };
    };
    if (state.route === 'off') { draw(arcPoints(ua, ob), false, null); return; }
    const pre = routeFor(ds.key, u, t.other);
    if (pre) { draw(decodePolyline(pre.poly), false, pre); return; }
    const prov = draw(arcPoints(ua, ob), true, null);           // provisório tracejado até (ou sem) rota
    if (state.route === 'live') {
      pending++; status(`consultando rotas online… 0/${pending}`);
      liveRoute(ds.key, ds, u, t.other).then((r) => {
        done++; if (token !== MAP.routeToken) return;
        if (r) {
          if (prov) { MAP.layers.flows.removeLayer(prov.line); if (prov.casing) MAP.layers.flows.removeLayer(prov.casing); MAP.scene.lines.splice(MAP.scene.lines.indexOf(prov.sc), 1); }
          draw(r.pts, false, { km: r.km, min: r.min, roads: r.roads });
        }
        status(done < pending ? `consultando rotas online… ${done}/${pending}` : null);
      });
    }
  });

  if (MAP.fitPending) {
    MAP.fitPending = false;
    const dom = top.filter((t) => ds.uf[t.other] >= 0 || ds.key === 'pessoas');   // zonas do exterior não devem afastar o zoom
    const pts = [ua, ...(dom.length ? dom : top).map((t) => [ds.la[t.other], ds.lo[t.other]]).filter((p) => isFinite(p[0]) && isFinite(p[1]))];
    if (pts.length > 1) MAP.map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 8, animate: false });
    else MAP.map.setView(ua, 7, { animate: false });
  }
  // ponto selecionado: pulso + rótulo
  const icon = L.divIcon({ className: '', html: '<div class="sel-ring"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  L.marker(ua, { icon, pane: 'pSel', interactive: false, keyboard: false }).addTo(MAP.layers.sel);
  L.marker(ua, { icon: L.divIcon({ className: 'sel-label', html: escapeHtml(ds.name[u]), iconSize: null, iconAnchor: [-10, 12] }), pane: 'pSel', interactive: false, keyboard: false }).addTo(MAP.layers.sel);
  MAP.scene.labels.push({ la: ua[0], lo: ua[1], text: ds.name[u] });
}

function styleDots(ctx) {
  const ds = ctx.ds, others = new Set(ctx.top.map((t) => t.other));
  const hasSel = state.unit != null, shown = state.mode === 'pontos';
  const mo = maskFor(ds, state.fo), md = maskFor(ds, state.fd), filtered = !!(mo || md);
  const plusMode = hasSel || filtered;          // com seleção/filtro, os pontos neutros viram "+" para reduzir a poluição
  const cNeutral = css('--neutral-dot');
  MAP.plusCtx = { shown, filtered };
  const pctU = plusMode ? importancePct(ds, ctx.S) : null, zp = plusZoomParams();
  for (const p of MAP.points) {
    const u = p.unit, isSel = hasSel && u === state.unit, isOther = hasSel && others.has(u);
    const o = p.m.options;
    p.sel = isSel; p.big = isSel || isOther;
    if (isSel || isOther || !plusMode) {
      p.plus = false; o.plus = false;
      p.m.setStyle({ stroke: false, fill: true, fillColor: isSel ? css('--origem') : isOther ? css('--destino') : cNeutral,
                     fillOpacity: !shown ? 0 : isSel ? 1 : isOther ? 0.95 : 0.85 });
      p.m.setRadius(dotRadius(p.big));
    } else {
      p.foc = filtered && !!((mo && mo[u]) || (md && md[u]));
      p.pct = pctU[p.i]; p.plus = true; o.plus = true;
      p.m.setStyle({ stroke: true, fill: false, weight: 1, color: cNeutral });
      applyPlusZoom(p, zp);
      continue;
    }
    o.interactive = shown;
  }
  MAP.scene.dots = MAP.points.filter((p) => shown && !(p.plus && p.m.options.opacity === 0)).map((p) => {
    const ll = p.m.getLatLng(), o = p.m.options;
    return { la: ll.lat, lo: ll.lng, r: p.m.getRadius(), plus: p.plus, fill: p.plus ? o.color : o.fillColor, op: p.plus ? o.opacity : o.fillOpacity };
  });
}

// ---------- orquestração do mapa ----------
function mapRender(ctx) {
  MAP.scene = { dots: [], lines: [], labels: [], chor: null };
  const choro = state.mode !== 'pontos';
  if (choro) renderChoro(ctx);
  else {
    for (const lv in MAP.chor) if (MAP.map.hasLayer(MAP.chor[lv].group)) MAP.map.removeLayer(MAP.chor[lv].group);
    $('map-legend').style.display = 'none';
  }
  styleDots(ctx);
  drawFlows(ctx);
  const dotsOn = !choro;
  if (dotsOn && !MAP.map.hasLayer(MAP.layers.dots)) MAP.layers.dots.addTo(MAP.map);
  if (!dotsOn && MAP.map.hasLayer(MAP.layers.dots)) MAP.map.removeLayer(MAP.layers.dots);
}

function fitBrazil() {
  MAP.map.fitBounds([[-33.8, -73.9], [5.3, -34.8]], { padding: [10, 10], animate: false });
}

// ---------- camadas GeoJSON do usuário (SNV, ferrovias, concessões…) ----------
function addOverlay(name, gj) {
  const palette = ['#FFD65C', '#4ADE93', '#B58CFF', '#FF6B9D', '#35C9E1'];
  const color = palette[MAP.overlays.length % palette.length];
  const layer = L.geoJSON(gj, {
    renderer: MAP.rMain, pane: 'pMain',
    style: () => ({ color, weight: 2, opacity: 0.9, fillOpacity: 0.12 }),
    pointToLayer: (f, ll) => L.circleMarker(ll, { renderer: MAP.rMain, pane: 'pMain', radius: 4, color, weight: 1, fillOpacity: 0.7 }),
    onEachFeature: (f, l) => {
      const p = f.properties || {}, keys = Object.keys(p).slice(0, 6);
      if (!keys.length) return;
      l.on('mousemove', (ev) => showTip(`<div class="t1">${escapeHtml(name)}</div>` + keys.map((k) => `<div class="tip-row"><span>${escapeHtml(k)}</span><span class="tip-val">${escapeHtml(p[k])}</span></div>`).join(''), ev));
      l.on('mouseout', hideTip);
    },
  }).addTo(MAP.map);
  const ov = { name, layer, color, on: true, gj };
  MAP.overlays.push(ov);
  renderOverlayList();
  return ov;
}
function renderOverlayList() {
  document.querySelectorAll('.ov-item').forEach((n) => n.remove());
  const anchor = $('overlay-add');
  MAP.overlays.forEach((ov, i) => {
    const lb = document.createElement('label'); lb.className = 'ov-item';
    lb.innerHTML = `<input type="checkbox" ${ov.on ? 'checked' : ''} aria-label="Camada ${escapeHtml(ov.name)}"><span style="width:10px;height:10px;border-radius:2px;background:${ov.color};display:inline-block"></span> ${escapeHtml(ov.name)} <button class="btn" type="button" style="padding:2px 7px" aria-label="Remover camada ${escapeHtml(ov.name)}">✕</button>`;
    lb.querySelector('input').addEventListener('change', (e) => { ov.on = e.target.checked; ov.on ? ov.layer.addTo(MAP.map) : MAP.map.removeLayer(ov.layer); });
    lb.querySelector('button').addEventListener('click', (e) => { e.preventDefault(); MAP.map.removeLayer(ov.layer); MAP.overlays.splice(i, 1); renderOverlayList(); });
    anchor.parentNode.insertBefore(lb, anchor);
  });
}
