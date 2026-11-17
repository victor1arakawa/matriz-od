// ============================== data.js ==============================
// Modelo de dados: colunas binárias (Uint16/Int32) por dataset e cenário, índices CSR e agregações memorizadas.
const META = JSON.parse($('meta').textContent);
const UFS = META.ufs;
const N_UF = UFS.length;               // índice N_UF = "Exterior" nas matrizes UF×UF
const MACROS = [...new Set(UFS.map((u) => u.macro))];
const UF_BY_CD = {}; UFS.forEach((u, i) => { UF_BY_CD[u.cd] = i; });
const DS = {};
const DS_LABEL = { pessoas: 'Pessoas', cargas: 'Cargas' };

function initDataset(key) {
  const m = META[key], U = m.units, n = U.id.length;
  const la = new Float64Array(n), lo = new Float64Array(n), uf = new Int16Array(n);
  for (let i = 0; i < n; i++) { la[i] = U.la[i] == null ? NaN : U.la[i]; lo[i] = U.lo[i] == null ? NaN : U.lo[i]; uf[i] = U.uf[i]; }
  const ds = {
    key, meta: m, n, id: U.id, name: U.name, la, lo, uf, scale: m.escala, cats: m.cats, unitLabel: m.unidade_rotulo,
    catIdx: Object.fromEntries(m.cats.map((c, i) => [c.k, i])),
    idToIdx: new Map(U.id.map((id, i) => [id, i])),
    nn: U.name.map(normalizeStr), scn: {}, _mask: new Map(), _pass: new Map(),
    ibgeToUnit: new Map(),
  };
  if (key === 'pessoas') {
    ds.nMun = m.units.n.reduce((a, b) => a + b, 0);
    ds.munNN = m.mun.name.map(normalizeStr);
    ds.munByUnit = Array.from({ length: n }, () => []);
    m.mun.unit.forEach((u, mi) => ds.munByUnit[u].push(mi));
    m.mun.ibge.forEach((ib, mi) => ds.ibgeToUnit.set(ib, m.mun.unit[mi]));
  } else {
    U.ibge.forEach((ib, i) => { if (ib) ds.ibgeToUnit.set(ib, i); });
  }
  DS[key] = ds;
  return ds;
}
initDataset('pessoas'); initDataset('cargas');

// ---------- carregamento de um cenário (descompressão assíncrona) ----------
async function loadScenario(key, sid, onStatus) {
  const ds = DS[key];
  if (ds.scn[sid]) return ds.scn[sid];
  if (ds._loading && ds._loading[sid]) return ds._loading[sid];
  ds._loading = ds._loading || {};
  ds._loading[sid] = (async () => {
    const info = META.cenarios.find((c) => c.id === sid)[key];
    const n = info.n, nk = ds.cats.length;
    onStatus && onStatus('Descomprimindo ' + DS_LABEL[key].toLowerCase() + '…', 30);
    await tick();
    const buf = await gunzip(b64ToBytes($('blob-' + key + '-' + sid).textContent));
    if (buf.byteLength !== info.bytes) throw new Error('tamanho inesperado do bloco de dados');
    onStatus && onStatus('Indexando ' + fmtInt(n) + ' pares…', 70);
    await tick();
    const lay = info.layout;   // [tipo, deslocamento] por coluna: o, d, categorias… (i4 ou f8 conforme a magnitude)
    const o = new Uint16Array(buf, lay[0][1], n), d = new Uint16Array(buf, lay[1][1], n);
    const v = []; for (let k = 0; k < nk; k++) { const [dt, off] = lay[2 + k]; v.push(dt === 'f8' ? new Float64Array(buf, off, n) : new Int32Array(buf, off, n)); }
    const N = ds.n;
    // origem: dados já ordenados por (o,d) -> apenas offsets
    const oStart = new Uint32Array(N + 1);
    for (let e = 0; e < n; e++) oStart[o[e] + 1]++;
    for (let i = 0; i < N; i++) oStart[i + 1] += oStart[i];
    // destino: permutação por contagem
    const dStart = new Uint32Array(N + 1);
    for (let e = 0; e < n; e++) dStart[d[e] + 1]++;
    for (let i = 0; i < N; i++) dStart[i + 1] += dStart[i];
    const dPerm = new Uint32Array(n), fill = dStart.slice(0, N);
    for (let e = 0; e < n; e++) dPerm[fill[d[e]]++] = e;
    // distância em linha reta (km) por par
    const dist = new Float32Array(n), la = ds.la, lo = ds.lo;
    // exterior: centroides de países/continentes não servem para distância -> -1 (excluído de km, volume×km e médias)
    for (let e = 0; e < n; e++) dist[e] = (ds.uf[o[e]] < 0 || ds.uf[d[e]] < 0) ? -1 : (haversine(la[o[e]], lo[o[e]], la[d[e]], lo[d[e]]) || 0);
    const S = { id: sid, n, o, d, v, oStart, dStart, dPerm, dist, checks: info.checks, info };
    ds.scn[sid] = S;
    return S;
  })();
  return ds._loading[sid];
}

// ---------- filtros geográficos ('', 'uf:<i>', 'macro:<nome>', 'ex') ----------
function maskFor(ds, f) {
  if (!f) return null;
  if (ds._mask.has(f)) return ds._mask.get(f);
  const m = new Uint8Array(ds.n);
  const [t, val] = f.split(':');
  for (let i = 0; i < ds.n; i++) {
    const u = ds.uf[i];
    if (t === 'uf') m[i] = u === +val ? 1 : 0;
    else if (t === 'macro') m[i] = u >= 0 && UFS[u].macro === val ? 1 : 0;
    else if (t === 'ex') m[i] = u < 0 ? 1 : 0;
  }
  ds._mask.set(f, m);
  return m;
}
function filterLabel(f) {
  if (!f) return 'Brasil (todos)';
  const [t, val] = f.split(':');
  if (t === 'uf') return UFS[+val].sg;
  if (t === 'macro') return 'Região ' + val;
  return 'Exterior';
}

const catSel = (ds, cat) => (cat === 'total' ? -1 : ds.catIdx[cat]);
function edgeVal(S, cs, e) {           // valor bruto (×escala) de uma aresta
  if (cs >= 0) return S.v[cs][e];
  let s = 0; for (let k = 0; k < S.v.length; k++) s += S.v[k][e];
  return s;
}
function edgeCats(ds, S, e) { return S.v.map((c) => c[e] / ds.scale); }

// ---------- conexões de uma unidade ----------
function conns(ds, S, unit, dir, cs, mask) {
  const out = [];
  if (dir === 'origem') {
    for (let e = S.oStart[unit]; e < S.oStart[unit + 1]; e++) {
      const other = S.d[e]; if (mask && !mask[other]) continue;
      const val = edgeVal(S, cs, e); if (val > 0) out.push({ other, e, val: val / ds.scale });
    }
  } else {
    for (let k = S.dStart[unit]; k < S.dStart[unit + 1]; k++) {
      const e = S.dPerm[k], other = S.o[e]; if (mask && !mask[other]) continue;
      const val = edgeVal(S, cs, e); if (val > 0) out.push({ other, e, val: val / ds.scale });
    }
  }
  return out.sort((a, b) => b.val - a.val);
}
function unitAgg(ds, S, unit, dir) {   // soma por categoria de TODAS as conexões (sem filtro)
  const sums = new Array(ds.cats.length).fill(0); let n = 0;
  const add = (e) => { n++; for (let k = 0; k < sums.length; k++) sums[k] += S.v[k][e]; };
  if (dir === 'origem') for (let e = S.oStart[unit]; e < S.oStart[unit + 1]; e++) add(e);
  else for (let k = S.dStart[unit]; k < S.dStart[unit + 1]; k++) add(S.dPerm[k]);
  const real = sums.map((x) => x / ds.scale);
  return { sums: real, total: real.reduce((a, b) => a + b, 0), n };
}
function findEdge(S, o, d) {           // busca binária dentro do bloco de origem (ordenado por destino)
  let lo = S.oStart[o], hi = S.oStart[o + 1] - 1;
  while (lo <= hi) { const mid = (lo + hi) >> 1, x = S.d[mid]; if (x === d) return mid; if (x < d) lo = mid + 1; else hi = mid - 1; }
  return -1;
}

// ---------- maiores pares do país (filtros aplicados) ----------
function topPairs(ds, S, cs, fo, fd, k) {
  const mo = maskFor(ds, fo), md = maskFor(ds, fd);
  const top = []; let min = 0;
  for (let e = 0; e < S.n; e++) {
    const o = S.o[e], d = S.d[e];
    if ((mo && !mo[o]) || (md && !md[d])) continue;
    const v = edgeVal(S, cs, e);
    if (v <= min && top.length >= k) continue;
    let i = top.length; while (i > 0 && top[i - 1].v < v) i--;
    top.splice(i, 0, { e, v, o, d });
    if (top.length > k) top.pop();
    if (top.length >= k) min = top[top.length - 1].v;
  }
  return top.map((t) => ({ ...t, val: t.v / ds.scale }));
}

// ---------- passada global memorizada: totais por unidade e matriz UF×UF ----------
function passAll(ds, S, cs, fo, fd) {
  const key = [S.id, cs, fo, fd].join('|');
  if (ds._pass.has(key)) return ds._pass.get(key);
  const mo = maskFor(ds, fo), md = maskFor(ds, fd), n = ds.n, K = N_UF + 1;
  const out = new Float64Array(n), inn = new Float64Array(n), tkm = new Float64Array(n);
  const M = new Float64Array(K * K), MD = new Float64Array(K * K), MV = new Float64Array(K * K), outV = new Float64Array(n);
  const ufi = new Int16Array(n); for (let i = 0; i < n; i++) ufi[i] = ds.uf[i] < 0 ? N_UF : ds.uf[i];
  const V = S.v, nk = V.length, o = S.o, d = S.d, dist = S.dist;
  let total = 0, totalAll = 0, tkmAll = 0, intra = 0, nPairs = 0;
  for (let e = 0; e < S.n; e++) {
    let v;
    if (cs >= 0) v = V[cs][e]; else { v = 0; for (let k = 0; k < nk; k++) v += V[k][e]; }
    if (v === 0) continue;
    const a = o[e], b = d[e], c = ufi[a] * K + ufi[b];
    const de = dist[e], ok = de >= 0;
    M[c] += v; totalAll += v;
    if (ok) { MD[c] += v * de; MV[c] += v; tkmAll += v * de; }
    if (ufi[a] === ufi[b]) intra += v;
    if ((!mo || mo[a]) && (!md || md[b])) { out[a] += v; inn[b] += v; if (ok) { tkm[a] += v * de; outV[a] += v; } total += v; nPairs++; }
  }
  const s = 1 / ds.scale;
  for (let i = 0; i < n; i++) { out[i] *= s; inn[i] *= s; tkm[i] *= s; outV[i] *= s; }
  for (let i = 0; i < M.length; i++) { M[i] *= s; MD[i] *= s; MV[i] *= s; }
  const r = { out, inn, tkm, outV, M, MD, MV, nPairs, total: total * s, totalAll: totalAll * s, tkmAll: tkmAll * s, intra: intra * s };
  if (ds._pass.size > 12) ds._pass.delete(ds._pass.keys().next().value);
  ds._pass.set(key, r);
  return r;
}

// ---------- rotas pré-calculadas ----------
function routeFor(dsKey, i, j) {
  const R = META.rotas['rotas_' + dsKey]; if (!R) return null;
  const r = R.pares[Math.min(i, j) + '-' + Math.max(i, j)];
  return r ? { km: r[0], min: r[1], poly: r[2] } : null;
}
