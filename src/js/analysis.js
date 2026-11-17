// ============================== analysis.js ==============================
// Visão "UF & corredores": matriz origem×destino, maiores corredores e resumo por região.
let _sumSort = { key: 'saidas', dir: -1 };
let AGG = null;   // último resultado (para exportação)

function aggGroups(level, hasExterior) {
  const groups = level === 'uf'
    ? UFS.map((u, i) => ({ key: 'uf:' + i, label: u.sg, name: u.nm, members: [i] }))
    : MACROS.map((m) => ({ key: 'macro:' + m, label: m, name: 'Região ' + m, members: UFS.map((u, i) => [u, i]).filter(([u]) => u.macro === m).map(([, i]) => i) }));
  if (hasExterior) groups.push({ key: 'ex', label: 'Exterior', name: 'Exterior', members: [N_UF] });
  return groups;
}

function computeAgg(dsKey = state.agg.ds, cat = state.agg.cat, level = state.agg.level) {
  const ds = DS[dsKey], S = ds.scn[state.scn], cs = catSel(ds, cat);
  const p = passAll(ds, S, cs, '', ''), K = N_UF + 1;
  const hasEx = ds.key === 'cargas';
  const groups = aggGroups(level, hasEx), G = groups.length;
  const gi = new Int16Array(K).fill(-1);
  groups.forEach((g, i) => g.members.forEach((m) => { gi[m] = i; }));
  const M = new Float64Array(G * G), MD = new Float64Array(G * G), MV = new Float64Array(G * G);
  for (let a = 0; a < K; a++) for (let b = 0; b < K; b++) {
    const x = gi[a], y = gi[b]; if (x < 0 || y < 0) continue;
    M[x * G + y] += p.M[a * K + b]; MD[x * G + y] += p.MD[a * K + b]; MV[x * G + y] += p.MV[a * K + b];
  }
  const rows = groups.map((g, i) => {
    let out = 0, inn = 0, tkm = 0, vv = 0, intra = M[i * G + i];
    for (let j = 0; j < G; j++) { out += M[i * G + j]; inn += M[j * G + i]; tkm += MD[i * G + j]; vv += MV[i * G + j]; }
    return { ...g, out, inn, saldo: inn - out, intraPct: out > 0 ? intra / out * 100 : 0, avgKm: vv > 0 ? tkm / vv : 0, tkm };
  });
  return { ds, groups, G, M, MD, MV, rows, total: p.totalAll };
}

function renderAgg() {
  const A = AGG = computeAgg(), { ds, groups, G, M, MD, MV } = A, ul = ds.unitLabel;
  const catName = state.agg.cat === 'total' ? (ds.key === 'pessoas' ? 'todos os modais' : 'todas as categorias') : ds.cats[ds.catIdx[state.agg.cat]].l;
  $('agg-matrix-sub').textContent = `${catName} · ${ul} · clique numa célula para filtrar o par`;

  // --- heatmap
  const svg = d3.select('#uf-matrix'), lab = 46, cell = Math.min(22, Math.floor(620 / G)), W = lab + cell * G + 6, H = lab + cell * G + 6;
  svg.attr('viewBox', `0 0 ${W} ${H}`).selectAll('*').remove();
  let mx = 0; for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) if (a !== b && M[a * G + b] > mx) mx = M[a * G + b];   // escala pelo fluxo entre regiões (a diagonal — fluxo interno — dominaria tudo)
  const seq = state.theme === 'light' ? d3.interpolateYlOrRd : d3.interpolateInferno;
  const color = (v, diag) => v <= 0 ? css('--panel-2') : diag ? css('--line') : seq(0.1 + 0.9 * Math.sqrt(Math.min(1, v / mx)));
  const txt = css('--text-muted');
  groups.forEach((g, i) => {
    svg.append('text').attr('x', lab - 4).attr('y', lab + i * cell + cell / 2).attr('dy', '0.33em').attr('text-anchor', 'end').attr('font-size', 9.5).attr('fill', txt).text(g.label.length > 6 ? g.label.slice(0, 5) + '.' : g.label);
    svg.append('text').attr('transform', `translate(${lab + i * cell + cell / 2},${lab - 4}) rotate(-60)`).attr('font-size', 9.5).attr('fill', txt).text(g.label.length > 6 ? g.label.slice(0, 5) + '.' : g.label);
  });
  for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) {
    const v = M[a * G + b];
    svg.append('rect').attr('class', 'cell').attr('x', lab + b * cell).attr('y', lab + a * cell).attr('width', cell - 1).attr('height', cell - 1).attr('rx', 2).attr('fill', color(v, a === b))
      .attr('tabindex', v > 0 ? 0 : null).attr('role', 'button').attr('aria-label', `${groups[a].name} para ${groups[b].name}: ${fmtInt(v)}`)
      .on('click', () => applyPair(groups[a].key, groups[b].key))
      .on('keydown', (ev) => { if (ev.key === 'Enter') applyPair(groups[a].key, groups[b].key); })
      .append('title').text(`${groups[a].name} → ${groups[b].name}\n${fmtInt(v)} ${ul}` + (v > 0 ? `\ndist. média ${fmtInt(MD[a * G + b] / v)} km` : ''));
  }

  // --- corredores
  const pairs = [];
  for (let a = 0; a < G; a++) for (let b = 0; b < G; b++) if (a !== b && M[a * G + b] > 0) pairs.push({ a, b, v: M[a * G + b], km: MV[a * G + b] > 0 ? MD[a * G + b] / MV[a * G + b] : -1, tkm: MD[a * G + b] });
  pairs.sort((x, y) => y.v - x.v);
  A.pairs = pairs;
  const tot = A.total || 1;
  $('agg-corr-sub').textContent = `${state.agg.level === 'uf' ? 'UF → UF' : 'região → região'} · exclui fluxo interno · ${catName}`;
  $('corr-tbl').innerHTML = `<thead><tr><th>#</th><th>Corredor</th><th>Volume</th><th>% país</th><th>Dist. média</th></tr></thead><tbody>` +
    pairs.slice(0, 30).map((p, i) => `<tr data-a="${groups[p.a].key}" data-b="${groups[p.b].key}" style="cursor:pointer"><td>${i + 1}</td><td>${escapeHtml(groups[p.a].label)} → ${escapeHtml(groups[p.b].label)}</td><td>${fmtShort(p.v)}</td><td>${fmtPct(p.v / tot * 100)}</td><td>${p.km >= 0 ? fmtInt(p.km) + ' km' : '—'}</td></tr>`).join('') + '</tbody>';
  $('corr-tbl').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => applyPair(tr.dataset.a, tr.dataset.b)));

  renderSumTable();
}

function renderSumTable() {
  const A = AGG, ds = A.ds, ul = ds.unitLabel, tbl = $('sum-tbl');
  const cols = [['label', 'Região'], ['saidas', 'Saídas'], ['entradas', 'Entradas'], ['saldo', 'Saldo'], ['intra', '% intra'], ['km', 'Dist. média saídas'], ['tkm', 'Volume × km']];
  const val = (r, k) => ({ label: r.label, saidas: r.out, entradas: r.inn, saldo: r.saldo, intra: r.intraPct, km: r.avgKm, tkm: r.tkm }[k]);
  const rows = A.rows.slice().sort((a, b) => {
    const x = val(a, _sumSort.key), y = val(b, _sumSort.key);
    return (typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y) * _sumSort.dir;
  });
  tbl.innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" tabindex="0" aria-sort="${_sumSort.key === k ? (_sumSort.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${_sumSort.key === k ? (_sumSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>` +
    rows.map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${fmtShort(r.out)}</td><td>${fmtShort(r.inn)}</td><td class="${r.saldo >= 0 ? 'pos' : 'neg'}">${fmtSigned(r.saldo)}</td><td>${fmtPct(r.intraPct)}</td><td>${fmtInt(r.avgKm)} km</td><td>${fmtShort(r.tkm)}</td></tr>`).join('') + '</tbody>';
  tbl.querySelectorAll('th').forEach((th) => {
    const go = () => { const k = th.dataset.k; _sumSort = { key: k, dir: _sumSort.key === k ? -_sumSort.dir : (k === 'label' ? 1 : -1) }; renderSumTable(); };
    th.addEventListener('click', go); th.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  $('agg-sum-note').textContent = `Valores em ${ul}. Fluxos das zonas internacionais aparecem em "Exterior". Distância média = linha reta entre pontos de referência, ponderada pelo volume; fluxos com o exterior ficam fora das distâncias e do volume × km.`;
}

function applyPair(ka, kb) {
  state.view = 'od'; state.ds = state.agg.ds; state.cat = state.agg.cat; state.unit = null;
  state.fo = ka; state.fd = kb; state.rankN = 15;
  render();
}
