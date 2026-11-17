// ============================== main.js ==============================
let _renderToken = 0, _mapDs = null;

function setLoading(text, pct) {
  const l = $('loading'); l.classList.remove('done'); l.style.display = 'flex';
  $('loading-status').textContent = text; if (pct != null) $('loading-bar').style.width = pct + '%';
}
function hideLoading() { const l = $('loading'); l.classList.add('done'); setTimeout(() => { if (l.classList.contains('done')) l.style.display = 'none'; }, 350); }

async function ensureScn(key, sid) {
  if (DS[key].scn[sid]) return DS[key].scn[sid];
  setLoading('Carregando ' + DS_LABEL[key].toLowerCase() + '…', 15);
  try { return await loadScenario(key, sid, setLoading); } finally { hideLoading(); }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem('od-theme', state.theme); } catch (e) { /* ignore */ }
}

function buildCtx(ds, S) {
  const cs = catSel(ds, state.cat), ctx = { ds, S, cs, conns: [], top: [], filteredTotal: 0, topNational: [], pass: null, nPairsFiltered: 0 };
  if (state.unit != null) {
    const mask = maskFor(ds, state.dir === 'origem' ? state.fd : state.fo);
    ctx.conns = conns(ds, S, state.unit, state.dir, cs, mask);
    ctx.top = ctx.conns.slice(0, 12);
    ctx.filteredTotal = ctx.conns.reduce((a, t) => a + t.val, 0);
  } else {
    ctx.topNational = topPairs(ds, S, cs, state.fo, state.fd, 500);
  }
  if (state.unit == null || state.mode !== 'pontos') {
    ctx.pass = passAll(ds, S, cs, state.fo, state.fd);
    ctx.nPairsFiltered = ctx.pass.nPairs;
    if (state.unit == null) ctx.filteredTotal = ctx.pass.total;
  }
  return ctx;
}

async function render() {
  const token = ++_renderToken;
  const isAgg = state.view === 'agg';
  $('view-od').classList.toggle('hidden', isAgg); $('view-agg').classList.toggle('hidden', !isAgg);
  const dsKey = isAgg ? state.agg.ds : state.ds;
  const S = await ensureScn(dsKey, state.scn);
  if (state.cmp) await ensureScn(dsKey, state.cmp);
  if (token !== _renderToken) return;
  syncControls();
  document.body.classList.remove('busy');
  if (isAgg) {
    fillCatSelect($('agg-cat'), DS[state.agg.ds], state.agg.cat);
    $('agg-cat-label').textContent = state.agg.ds === 'pessoas' ? 'Modal' : 'Categoria de carga';
    $('agg-ds').value = state.agg.ds; $('agg-level').value = state.agg.level;
    renderHeader(DS[state.agg.ds], S);
    renderAgg(); syncHash(); return;
  }
  const ds = DS[state.ds];
  MAP.map.invalidateSize();
  if (_mapDs !== ds.key) { buildDots(); _mapDs = ds.key; if (state.unit == null) fitBrazil(); }
  setTiles_if_needed();
  const ctx = CTX = buildCtx(ds, S);
  renderHeader(ds, S);
  renderBanner(ctx);
  const ch = state.mode !== 'pontos';
  $('map-sub').textContent = state.unit == null
    ? (ch ? `${METRIC_LABEL[state.metric]} por ${state.mode === 'uf' ? 'UF' : ds.key === 'pessoas' ? 'município (valor da UTP)' : 'zona'}` : `todos os ${ds.key === 'pessoas' ? 'municípios' : 'pontos'} · nenhuma unidade selecionada`)
    : `${ds.name[state.unit]} · ${state.dir === 'origem' ? 'principais destinos' : 'principais origens'} (${ctx.top.length}) · ${state.route === 'off' ? 'linhas de desejo' : 'rotas rodoviárias'}`;
  mapRender(ctx);
  renderSankey(ctx); renderCatLegend(ds); renderMapLegendRow();
  renderIndicators(ctx); renderRanking(ctx);
  syncHash();
}
function setTiles_if_needed() {
  if (MAP._tileKey !== state.tiles + '|' + state.theme) { setTiles(state.tiles); MAP._tileKey = state.tiles + '|' + state.theme; }
}

function setView(tab) {
  if (tab === 'agg') { state.view = 'agg'; state.agg.ds = state.ds; state.agg.cat = state.cat; }
  else if (state.view !== 'od' || state.ds !== tab) {
    const leavingAgg = state.view === 'agg';
    state.view = 'od';
    if (state.ds !== tab) { state.ds = tab; state.unit = null; state.cat = 'total'; state.fo = state.fd = ''; state.rankN = 15; $('search-input').value = ''; }
    else if (leavingAgg) { /* mantém seleção */ }
  }
  render();
}

function wire() {
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.tab)));
  $('dir-toggle').addEventListener('click', (e) => { const b = e.target.closest('button[data-dir]'); if (!b) return; state.dir = b.dataset.dir; state.rankN = 15; render(); });
  $('cat-select').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
  $('fo-select').addEventListener('change', (e) => { state.fo = e.target.value; render(); });
  $('fd-select').addEventListener('change', (e) => { state.fd = e.target.value; render(); });
  $('clear-btn').addEventListener('click', () => { MAP.fitPending = true; state.unit = null; state.fo = state.fd = ''; state.rankN = 15; $('search-input').value = ''; render(); });
  $('mode-select').addEventListener('change', (e) => { state.mode = e.target.value; render(); });
  $('metric-select').addEventListener('change', (e) => { state.metric = e.target.value; render(); });
  $('route-select').addEventListener('change', (e) => { state.route = e.target.value; render(); });
  $('scn-select').addEventListener('change', (e) => { state.scn = e.target.value; if (state.cmp === state.scn) state.cmp = ''; render(); });
  $('cmp-select').addEventListener('change', (e) => { state.cmp = e.target.value; render(); });
  $('agg-ds').addEventListener('change', (e) => { state.agg.ds = e.target.value; state.agg.cat = 'total'; render(); });
  $('agg-cat').addEventListener('change', (e) => { state.agg.cat = e.target.value; render(); });
  $('agg-level').addEventListener('change', (e) => { state.agg.level = e.target.value; render(); });
  $('theme-btn').addEventListener('click', () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); styleBase(); render(); });
  $('link-btn').addEventListener('click', copyLink);
  wireSearch();

  const menu = $('export-menu');
  $('export-btn').addEventListener('click', (e) => { e.stopPropagation(); const o = menu.classList.toggle('open'); $('export-btn').setAttribute('aria-expanded', o); });
  document.addEventListener('click', () => { menu.classList.remove('open'); $('export-btn').setAttribute('aria-expanded', 'false'); });
  menu.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => {
    ({ 'csv-rank': exportCSVRank, 'csv-uf': exportCSVMatrix, 'csv-ufsum': exportCSVSummary, 'png-map': exportPngMap, 'png-sankey': exportPngSankey, print: () => window.print() })[b.dataset.exp]();
  }));

  $('overlay-add').addEventListener('click', () => $('overlay-file').click());
  $('overlay-file').addEventListener('change', (e) => { loadGeoJSONFiles(e.target.files); e.target.value = ''; });
  const mw = $('map-wrap');
  ['dragover', 'dragenter'].forEach((n) => mw.addEventListener(n, (e) => { e.preventDefault(); }));
  mw.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) loadGeoJSONFiles(e.dataTransfer.files); });
  window.addEventListener('resize', () => MAP.map && MAP.map.invalidateSize());
  window.addEventListener('hashchange', () => {           // link colado/navegação: reaplica o estado
    if (location.hash.replace(/^#/, '') === stateToHash()) return;
    hashToState(); MAP.fitPending = state.unit != null; _mapDs = null; render();
  });
}

async function init() {
  try {
    hashToState(); applyTheme();
    setLoading('Carregando malhas…', 10);
    await tick(); await loadGeo();
    initMap();
    META.overlays.forEach((o) => addOverlay(o.nome, o.geojson));
    setLoading('Preparando dados…', 25);
    await tick();
    const dsKey = state.view === 'agg' ? state.agg.ds : state.ds;
    await loadScenario(dsKey, state.scn, setLoading);
    if (state.cmp) await loadScenario(dsKey, state.cmp, setLoading);
    wire();
    MAP.fitPending = state.unit != null;
    await render();
    hideLoading();
  } catch (err) {
    console.error(err);
    $('loading-status').innerHTML = 'Erro ao iniciar: ' + escapeHtml(err.message) + '<br><small>Requer navegador recente (DecompressionStream). Veja o console (F12).</small>';
  }
}
window.__od = { state, MAP, DS, META };   // gancho de depuração (console do navegador)
init();
