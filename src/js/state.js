// ============================== state.js ==============================
const state = {
  view: 'od', ds: 'pessoas',
  scn: META.cenarios[0].id, cmp: '',
  unit: null, dir: 'origem', cat: 'total', fo: '', fd: '',
  mode: 'pontos', metric: 'saidas', route: 'off', tiles: '',
  theme: 'dark',   // padrão fixo; a escolha do botão fica salva por navegador
  rankN: 15,
  agg: { ds: 'pessoas', cat: 'total', level: 'uf' },
};
try { const t = localStorage.getItem('od-theme'); if (t) state.theme = t; } catch (e) { /* storage bloqueado */ }

const DEFAULT_STATE = JSON.parse(JSON.stringify(state));
const curDs = () => DS[state.ds];
const curScn = () => curDs().scn[state.scn];

// ---- estado <-> hash (link compartilhável) ----
function stateToHash() {
  const ds = curDs(), p = new URLSearchParams();
  p.set('v', state.view === 'agg' ? 'agg' : state.ds);
  if (state.scn !== META.cenarios[0].id) p.set('s', state.scn);
  if (state.cmp) p.set('cmp', state.cmp);
  if (state.unit != null && state.view === 'od') p.set('u', ds.id[state.unit]);
  if (state.dir !== 'origem') p.set('r', state.dir);
  if (state.cat !== 'total') p.set('c', state.cat);
  if (state.fo) p.set('fo', state.fo);
  if (state.fd) p.set('fd', state.fd);
  if (state.mode !== 'pontos') p.set('m', state.mode);
  if (state.metric !== 'saidas') p.set('k', state.metric);
  if (state.route !== 'off') p.set('rt', state.route);
  if (state.tiles) p.set('t', state.tiles);
  if (state.view === 'agg') { p.set('ad', state.agg.ds); if (state.agg.cat !== 'total') p.set('ac', state.agg.cat); if (state.agg.level !== 'uf') p.set('al', state.agg.level); }
  return p.toString();
}
function hashToState() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (![...p.keys()].length) return;
  const theme = state.theme;
  Object.assign(state, JSON.parse(JSON.stringify(DEFAULT_STATE)), { theme });   // link colado = estado completo, sem herdar o anterior
  const v = p.get('v');
  if (v === 'agg') state.view = 'agg'; else if (v === 'cargas' || v === 'pessoas') { state.view = 'od'; state.ds = v; }
  const has = (id) => META.cenarios.some((c) => c.id === id);
  if (p.get('s') && has(p.get('s'))) state.scn = p.get('s');
  if (p.get('cmp') && has(p.get('cmp'))) state.cmp = p.get('cmp');
  const ds = curDs();
  if (p.get('u') != null && ds.idToIdx.has(+p.get('u'))) state.unit = ds.idToIdx.get(+p.get('u'));
  if (p.get('r') === 'destino') state.dir = 'destino';
  if (p.get('c') && (p.get('c') === 'total' || ds.catIdx[p.get('c')] != null)) state.cat = p.get('c');
  const okF = (f) => !f || /^(uf:\d+|macro:[\w-]+|ex)$/.test(f);
  if (okF(p.get('fo'))) state.fo = p.get('fo') || '';
  if (okF(p.get('fd'))) state.fd = p.get('fd') || '';
  if (['pontos', 'uf', 'mun'].includes(p.get('m'))) state.mode = p.get('m');
  if (['saidas', 'entradas', 'saldo', 'tkm'].includes(p.get('k'))) state.metric = p.get('k');
  if (['off', 'pre', 'live'].includes(p.get('rt'))) state.route = p.get('rt');
  state.tiles = '';   // mapa-base online removido
  if (p.get('ad') === 'cargas') state.agg.ds = 'cargas';
  const adK = DS[state.agg.ds].catIdx;
  if (p.get('ac') && adK[p.get('ac')] != null) state.agg.cat = p.get('ac');
  if (p.get('al') === 'macro') state.agg.level = 'macro';
}
let _hashTimer;
function syncHash() {
  clearTimeout(_hashTimer);
  _hashTimer = setTimeout(() => { try { history.replaceState(null, '', '#' + stateToHash()); } catch (e) { /* file:// restrito */ } }, 150);
}
