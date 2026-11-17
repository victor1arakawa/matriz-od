// ============================== panels.js ==============================
let CTX = null;                       // contexto do último render (usado por tooltips/export)
const unitOfNode = (ds, i) => ds.name[i];

function selectUnit(u) { state.unit = u; state.rankN = 15; MAP.fitPending = true; render(); }
function catColor(ds, k) { return ds.cats[k].c; }
function distUnit(ds) { return ds.key === 'pessoas' ? 'pax·km/ano' : 't·km/ano'; }

// ---------------- controles ----------------
function fillFilterSelect(sel, ds) {
  const cur = sel.value;
  const opts = ['<option value="">Brasil (todos)</option>', '<optgroup label="Macrorregiões">' +
    MACROS.map((m) => `<option value="macro:${m}">${m}</option>`).join('') + '</optgroup>',
    '<optgroup label="Unidades da Federação">' +
    UFS.map((u, i) => [u, i]).sort((a, b) => a[0].nm.localeCompare(b[0].nm, 'pt-BR'))
      .map(([u, i]) => `<option value="uf:${i}">${u.sg} — ${u.nm}</option>`).join('') + '</optgroup>'];
  if (ds.key === 'cargas') opts.push('<option value="ex">Exterior (zonas internacionais)</option>');
  sel.innerHTML = opts.join('');
  sel.value = cur;
}
function fillCatSelect(sel, ds, cur) {
  sel.innerHTML = `<option value="total">${ds.key === 'pessoas' ? 'Todos os modais' : 'Todas as categorias'}</option>` +
    ds.cats.map((c) => `<option value="${c.k}">${escapeHtml(c.l)}</option>`).join('');
  sel.value = cur;
}
function syncControls() {
  const ds = curDs();
  fillCatSelect($('cat-select'), ds, state.cat);
  $('cat-label').textContent = ds.key === 'pessoas' ? 'Modal' : 'Categoria de carga';
  fillFilterSelect($('fo-select'), ds); fillFilterSelect($('fd-select'), ds);
  $('fo-select').value = state.fo; $('fd-select').value = state.fd;
  $('mode-select').value = state.mode; $('metric-select').value = state.metric;
  $('route-select').value = state.route;
  $('metric-wrap').classList.toggle('hidden', state.mode === 'pontos');
  document.querySelectorAll('#dir-toggle button').forEach((b) => { const on = b.dataset.dir === state.dir; b.classList.toggle('active', on); b.setAttribute('aria-pressed', on); });
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String((state.view === 'agg' ? 'agg' : state.ds) === b.dataset.tab)));
  const multi = META.cenarios.length > 1;
  $('scn-wrap').classList.toggle('hidden', !multi); $('cmp-wrap').classList.toggle('hidden', !multi);
  if (multi) {
    $('scn-select').innerHTML = META.cenarios.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    $('cmp-select').innerHTML = '<option value="">— nenhum —</option>' + META.cenarios.filter((c) => c.id !== state.scn).map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
    $('scn-select').value = state.scn; $('cmp-select').value = state.cmp;
  }
}

// ---------------- cabeçalho / KPIs ----------------
function renderHeader(ds, S) {
  const sc = META.cenarios.find((c) => c.id === state.scn);
  $('eyebrow').textContent = 'PNL 2035 · CENÁRIO ' + sc.label.toUpperCase();
  $('h1').innerHTML = ds.key === 'pessoas'
    ? 'Matriz OD de Pessoas <span>entre Unidades Territoriais de Planejamento</span>'
    : 'Matriz OD de Cargas <span>entre zonas de planejamento logístico</span>';
  const total = S.checks.reduce((a, b) => a + b, 0) / ds.scale;
  const k = (v, l, acc) => `<div class="kpi"><div class="val${acc ? ' accent' : ''}">${v}</div><div class="lbl">${l}</div></div>`;
  $('kpis').innerHTML = ds.key === 'pessoas'
    ? k(fmtInt(ds.n), 'UTPs') + k(fmtInt(ds.nMun), 'Municípios') + k(fmtInt(S.n), 'Pares OD') + k(fmtShort(total), 'Viagens/ano', 1)
    : k(fmtInt(ds.n), 'Zonas') + k(fmtInt(S.n), 'Pares OD') + k(fmtShort(total), 'Toneladas/ano', 1);
  const inf = S.info, nt = $('data-notice');
  const partial = inf.linhas_dicionario && inf.linhas_csv < 0.9 * inf.linhas_dicionario;
  nt.classList.toggle('hidden', !partial);
  if (partial) nt.innerHTML = `<b>Atenção — dados parciais:</b> o arquivo de ${ds.key} fornecido tem ${fmtInt(inf.linhas_csv)} linhas, mas o dicionário de dados declara ${fmtInt(inf.linhas_dicionario)} (matriz densa ${fmtInt(ds.n)}²). Só ${nf1.format(inf.n / (ds.n * ds.n) * 100)}% dos pares OD estão presentes; totais por unidade, <b>entradas e saldos</b> podem estar subestimados. Confirme o arquivo original junto à EPL.`;
  $('foot-src').textContent = 'Fonte: EPL/PNL 2035 — cenário ' + sc.label + ' · malhas IBGE · coordenadas municípios-brasil (MIT)';
  $('foot-note').textContent = `v${META.versao} · gerado em ${META.gerado_em.slice(0, 10)} · renderizado localmente, sem envio de dados`;
}

// ---------------- tooltips ----------------
function catBreakdownHtml(ds, sums, total) {
  return ds.cats.map((c, k) => {
    const v = sums[k]; if (!(v > 0)) return '';
    return `<div class="tip-row"><span class="tip-label"><span class="tip-dot" style="background:${c.c}"></span>${escapeHtml(c.l)}</span>
      <span class="tip-val">${fmtInt(v)} <span class="tip-pct">${total > 0 ? nf1.format(v / total * 100) : 0}%</span></span></div>`;
  }).join('');
}
function unitTipHtml(unit, mun) {
  const ds = curDs(), S = curScn();
  let html = ds.key === 'pessoas'
    ? `<div class="t1">${escapeHtml(mun)}</div><div class="t2">UTP: ${escapeHtml(ds.name[unit])} · ${ds.meta.units.n[unit]} municípios</div>`
    : `<div class="t1">${escapeHtml(ds.name[unit])}</div><div class="t2">zona ${ds.id[unit]}${ds.uf[unit] < 0 ? ' · exterior' : ''}</div>`;
  if (!CTX) return html;
  if (state.unit === unit) {
    const a = unitAgg(ds, S, unit, state.dir);
    html += `<div class="tip-sep"></div><div class="tip-title">${state.dir === 'origem' ? 'total saindo' : 'total chegando'} (${ds.unitLabel})</div>
      ${catBreakdownHtml(ds, a.sums, a.total)}<div class="tip-total-row"><span>Total geral</span><b>${fmtInt(a.total)}</b></div>
      <div class="tip-meta">${fmtInt(a.n)} ${state.dir === 'origem' ? 'destinos' : 'origens'}</div>`;
  } else if (state.unit != null) {
    const i = CTX.top.findIndex((t) => t.other === unit);
    if (i >= 0) html += pairTipInner(CTX, CTX.top[i], i, null);
  }
  return html;
}
function pairTipInner(ctx, t, rank, route) {
  const { ds, S } = ctx, cats = edgeCats(ds, S, t.e), total = cats.reduce((a, b) => a + b, 0);
  const sel = ds.name[state.unit], oth = ds.name[t.other];
  const label = state.dir === 'origem' ? `${sel} → ${oth}` : `${oth} → ${sel}`;
  const share = ctx.filteredTotal > 0 ? nf1.format(t.val / ctx.filteredTotal * 100) : '0';
  const km = S.dist[t.e];
  return `<div class="tip-sep"></div><div class="tip-title">${escapeHtml(label)}</div>${catBreakdownHtml(ds, cats, total)}
    <div class="tip-total-row"><span>Total</span><b>${fmtInt(total)}</b></div>
    <div class="tip-meta">#${rank + 1} no ranking · ${share}% do total filtrado</div>
    <div class="tip-meta">${km >= 0 ? fmtInt(km) + ' km em linha reta' : 'exterior (sem distância)'}${route ? ` · ${fmtInt(route.km)} km por rodovia (${fmtInt(route.min / 60 * 10) / 10} h)` : ''}</div>` + roadsTipHtml(route);
}
// rodovias percorridas pela rota (só quando vêm da consulta online, que devolve os trechos com nome)
function roadsTipHtml(route) {
  if (!route || !route.roads || !route.roads.length) return '';
  const tot = route.km, top = route.roads.slice(0, 6), rest = route.roads.length - top.length;
  return `<div class="tip-sep"></div><div class="tip-title">Rodovias da rota</div>` +
    top.map((r) => `<div class="tip-row"><span class="tip-label">${escapeHtml(r.n.length > 26 ? r.n.slice(0, 24) + '…' : r.n)}</span><span class="tip-val">${fmtInt(r.km)} km <span class="tip-pct">${tot > 0 ? nf1.format(r.km / tot * 100) : 0}%</span></span></div>`).join('') +
    (rest > 0 ? `<div class="tip-meta">+ ${rest} outras vias menores</div>` : '') +
    `<div class="tip-meta">nomes/refs do OpenStreetMap; trechos sem nome não entram</div>`;
}
function pairTipHtml(ctx, t, rank, route) {
  const ds = ctx.ds;
  return `<div class="t1">${escapeHtml(ds.name[t.other])}</div>` + pairTipInner(ctx, t, rank, route);
}

// ---------------- busca ----------------
function searchGroups(q) {
  const ds = curDs(), out = [];
  if (ds.key === 'pessoas') {
    for (let u = 0; u < ds.n; u++) {
      const mems = ds.munByUnit[u]; let mc = 0;
      const rows = mems.map((mi) => { const isM = ds.munNN[mi].includes(q); if (isM) mc++; return { name: ds.meta.mun.name[mi], isM }; });
      const sede = ds.nn[u].includes(q);
      if (mc > 0 || sede) out.push({ unit: u, title: ds.name[u], sub: `${mems.length} cidade${mems.length > 1 ? 's' : ''} · UTP ${ds.id[u]}`, mc, rows });
    }
    out.sort((a, b) => b.mc - a.mc || a.rows.length - b.rows.length);
  } else {
    for (let u = 0; u < ds.n; u++) if (ds.nn[u].includes(q)) out.push({ unit: u, title: ds.name[u], sub: 'zona ' + ds.id[u], mc: 1, rows: null, exact: ds.nn[u].startsWith(q) ? 0 : 1 });
    out.sort((a, b) => a.exact - b.exact || a.title.localeCompare(b.title, 'pt-BR'));
  }
  return out.slice(0, 20);
}
let _searchItems = [], _kb = -1;
function renderSearch(query) {
  const res = $('search-results'), q = normalizeStr(query);
  if (!q) { res.classList.remove('show'); $('search-input').setAttribute('aria-expanded', 'false'); return; }
  const g = searchGroups(q); _searchItems = g; _kb = -1;
  res.innerHTML = !g.length ? '<div class="item" style="color:var(--text-dim)">nenhuma cidade encontrada</div>'
    : g.map((x, i) => x.rows
      ? `<div class="search-group" role="option" data-i="${i}"><div class="search-group-head"><span class="sede-name">${escapeHtml(x.title)}</span><span class="n">${x.sub}</span></div>
          <div class="search-group-cities">${x.rows.slice().sort((a, b) => (b.isM - a.isM) || a.name.localeCompare(b.name, 'pt-BR')).map((c) => `<span class="city-chip${c.isM ? ' match' : ''}">${escapeHtml(c.name)}</span>`).join('')}</div></div>`
      : `<div class="item" role="option" data-i="${i}"><span>${escapeHtml(x.title)}</span><span class="n">${x.sub}</span></div>`).join('');
  res.classList.add('show'); $('search-input').setAttribute('aria-expanded', 'true');
}
function pickSearch(i) {
  const x = _searchItems[i]; if (!x) return;
  $('search-input').value = x.title; $('search-results').classList.remove('show');
  $('search-input').setAttribute('aria-expanded', 'false');
  selectUnit(x.unit);
}
function wireSearch() {
  const inp = $('search-input'), res = $('search-results');
  inp.addEventListener('input', (e) => renderSearch(e.target.value));
  inp.addEventListener('focus', (e) => { if (e.target.value) renderSearch(e.target.value); });
  inp.addEventListener('keydown', (e) => {
    const els = [...res.querySelectorAll('[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!els.length) return; e.preventDefault();
      _kb = (_kb + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length;
      els.forEach((n, i) => n.classList.toggle('kb', i === _kb)); els[_kb].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { pickSearch(_kb >= 0 ? _kb : 0); }
    else if (e.key === 'Escape') { res.classList.remove('show'); inp.setAttribute('aria-expanded', 'false'); }
  });
  res.addEventListener('click', (e) => { const t = e.target.closest('[data-i]'); if (t) pickSearch(+t.dataset.i); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-wrap')) res.classList.remove('show'); });
}

// ---------------- banner ----------------
function renderBanner(ctx) {
  const { ds } = ctx, b = $('selection-banner');
  if (state.unit == null) { b.classList.remove('show'); return; }
  b.classList.add('show');
  const pill = $('banner-pill'); pill.textContent = ds.name[state.unit]; pill.classList.toggle('is-destino', state.dir === 'destino');
  $('banner-arrow').textContent = state.dir === 'origem' ? '→' : '←';
  $('banner-label').textContent = state.dir === 'origem' ? 'principais destinos' : 'principais origens';
  $('banner-total').textContent = fmtInt(ctx.filteredTotal) + ' ' + ds.unitLabel + ' (filtro atual)';
}

// ---------------- Sankey ----------------
const SK_W = 640, SK_H = 440;
function sankeyEmpty(svg) {
  svg.selectAll('*').remove();
  svg.append('text').attr('x', SK_W / 2).attr('y', SK_H / 2).attr('text-anchor', 'middle').attr('fill', css('--text-dim')).attr('font-size', 12.5).text('sem fluxos para exibir');
}
function showSkTip(html, evt) {
  const t = $('sankey-tip'), r = $('sankey-panel').getBoundingClientRect();
  t.innerHTML = html; t.style.opacity = 1;
  let x = evt.clientX - r.left + 14, y = evt.clientY - r.top + 14;
  if (x > r.width - 280) x = evt.clientX - r.left - 280;
  if (y > r.height - t.offsetHeight - 8) y = Math.max(4, evt.clientY - r.top - t.offsetHeight - 10);
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
const hideSkTip = () => { $('sankey-tip').style.opacity = 0; };

// levelNames: rótulo de cada coluna do diagrama (ex.: ['Origem', 'Modal', 'Destino'])
function drawSankey(nodes, links, levelNames) {
  const svg = d3.select('#sankey-svg'); svg.selectAll('*').remove(); hideSkTip();
  let g;
  try { g = d3.sankey().nodeId((d) => d.id).nodeWidth(14).nodePadding(12).extent([[6, 6], [SK_W - 6, SK_H - 6]])({ nodes: nodes.map((d) => ({ ...d })), links: links.map((d) => ({ ...d })) }); }
  catch (e) { sankeyEmpty(svg); return; }
  const ul = curDs().unitLabel, pct = (v, t) => (t > 0 ? nf1.format(v / t * 100) : '0') + '%';
  // totais por nível (coluna): nós somam o próprio valor; elos somam por coluna de origem
  const nodeTot = new Map(), linkTot = new Map();
  for (const n of g.nodes) nodeTot.set(n.depth, (nodeTot.get(n.depth) || 0) + (n.value || 0));
  for (const l of g.links) linkTot.set(l.source.depth, (linkTot.get(l.source.depth) || 0) + l.value);
  const lvl = (d) => (levelNames && levelNames[d]) || 'nível ' + (d + 1);
  const row = (label, val, share) => `<div class="tip-row"><span class="tip-label">${label}</span><span class="tip-val">${share}</span></div>`;
  const nodeTip = (d) => {
    const inV = d.targetLinks.reduce((a, l) => a + l.value, 0), outV = d.sourceLinks.reduce((a, l) => a + l.value, 0);
    let h = `<div class="t1">${escapeHtml(d.name)}</div><div class="t2">${lvl(d.depth)} · ${fmtInt(d.value || 0)} ${ul}</div><div class="tip-sep"></div>`;
    h += row(`% do nível “${escapeHtml(lvl(d.depth))}”`, d.value, pct(d.value || 0, nodeTot.get(d.depth)));
    d.targetLinks.forEach((l) => { h += row(`← ${escapeHtml(l.source.name.length > 22 ? l.source.name.slice(0, 20) + '…' : l.source.name)}`, l.value, pct(l.value, inV)); });
    if (d.targetLinks.length) h = h.replace('<div class="tip-sep"></div>', '<div class="tip-sep"></div>');
    d.sourceLinks.slice(0, 6).forEach((l) => { h += row(`→ ${escapeHtml(l.target.name.length > 22 ? l.target.name.slice(0, 20) + '…' : l.target.name)}`, l.value, pct(l.value, outV)); });
    return h + `<div class="tip-meta">percentuais entre os itens exibidos no diagrama</div>`;
  };
  const linkTip = (d) => {
    const outS = d.source.sourceLinks.reduce((a, l) => a + l.value, 0), inT = d.target.targetLinks.reduce((a, l) => a + l.value, 0);
    return `<div class="t1">${escapeHtml(d.source.name)} → ${escapeHtml(d.target.name)}</div><div class="t2">${fmtInt(d.value)} ${ul}</div><div class="tip-sep"></div>` +
      row(`% do nível “${escapeHtml(lvl(d.source.depth))} → ${escapeHtml(lvl(d.target.depth))}”`, d.value, pct(d.value, linkTot.get(d.source.depth))) +
      row(`% do que sai de ${escapeHtml(d.source.name.length > 18 ? d.source.name.slice(0, 16) + '…' : d.source.name)}`, d.value, pct(d.value, outS)) +
      row(`% do que chega em ${escapeHtml(d.target.name.length > 18 ? d.target.name.slice(0, 16) + '…' : d.target.name)}`, d.value, pct(d.value, inT)) +
      `<div class="tip-meta">percentuais entre os itens exibidos no diagrama</div>`;
  };
  const links_ = svg.append('g').attr('fill', 'none').selectAll('path').data(g.links).join('path')
    .attr('d', d3.sankeyLinkHorizontal()).attr('stroke', (d) => d.color).attr('stroke-opacity', 0.45).attr('stroke-width', (d) => Math.max(1, d.width))
    .style('cursor', 'default').style('pointer-events', 'stroke');
  links_.on('mousemove', function (ev, d) { d3.select(this).attr('stroke-opacity', 0.75); showSkTip(linkTip(d), ev); })
    .on('mouseleave', function () { d3.select(this).attr('stroke-opacity', 0.45); hideSkTip(); });
  const ng = svg.append('g').selectAll('g').data(g.nodes).join('g');
  ng.append('rect').attr('x', (d) => d.x0).attr('y', (d) => d.y0).attr('width', (d) => d.x1 - d.x0).attr('height', (d) => Math.max(1, d.y1 - d.y0)).attr('rx', 2).attr('fill', (d) => d.color)
    .on('mousemove', (ev, d) => showSkTip(nodeTip(d), ev)).on('mouseleave', hideSkTip);
  ng.append('text').attr('x', (d) => d.x0 < SK_W / 2 ? d.x1 + 6 : d.x0 - 6).attr('y', (d) => (d.y0 + d.y1) / 2).attr('dy', '0.32em')
    .attr('text-anchor', (d) => d.x0 < SK_W / 2 ? 'start' : 'end').attr('fill', css('--text')).attr('font-family', 'Inter, sans-serif').attr('font-size', 10.6)
    .style('pointer-events', 'none').text((d) => d.name.length > 24 ? d.name.slice(0, 22) + '…' : d.name);
}
function renderSankey(ctx) {
  const { ds, S, cs } = ctx, cO = css('--origem'), cD = css('--destino');
  const catName = cs < 0 ? (ds.key === 'pessoas' ? 'todos os modais' : 'todas as categorias') : ds.cats[cs].l;
  if (state.unit == null) {
    $('sankey-title').textContent = 'Maiores fluxos do país';
    $('sankey-sub').textContent = `top 10 pares · ${catName} · ${filterLabel(state.fo)} → ${filterLabel(state.fd)}`;
    const nodes = new Map(), links = [];
    ctx.topNational.slice(0, 10).forEach((t) => {
      const a = 'o' + t.o, b = 'd' + t.d;
      if (!nodes.has(a)) nodes.set(a, { id: a, name: ds.name[t.o], color: cO });
      if (!nodes.has(b)) nodes.set(b, { id: b, name: ds.name[t.d], color: cD });
      links.push({ source: a, target: b, value: t.val, color: cO });
    });
    return links.length ? drawSankey([...nodes.values()], links, ['Origem', 'Destino']) : sankeyEmpty(d3.select('#sankey-svg'));
  }
  const u = state.unit, top = ctx.top.slice(0, 8);
  $('sankey-title').textContent = ds.key === 'pessoas' ? 'Fluxo por modal' : 'Fluxo por categoria de carga';
  $('sankey-sub').textContent = `${ds.name[u]} · ${state.dir === 'origem' ? 'saídas' : 'entradas'} · ${catName}`;
  if (!top.length) return sankeyEmpty(d3.select('#sankey-svg'));
  const nodes = new Map([['c', { id: 'c', name: ds.name[u], color: state.dir === 'origem' ? cO : cD }]]), agg = new Map();
  const cats = cs < 0 ? ds.cats.map((_, k) => k) : [cs];
  cats.forEach((k) => {
    const cid = 'k' + k; let tot = 0; top.forEach((t) => { tot += S.v[k][t.e]; });
    if (tot <= 0) return;
    nodes.set(cid, { id: cid, name: ds.cats[k].l, color: ds.cats[k].c });
    top.forEach((t) => {
      const v = S.v[k][t.e] / ds.scale; if (v <= 0) return;
      const oid = 'x' + t.other;
      if (!nodes.has(oid)) nodes.set(oid, { id: oid, name: ds.name[t.other], color: state.dir === 'origem' ? cD : cO });
      const [s1, t1, s2, t2] = state.dir === 'origem' ? ['c', cid, cid, oid] : [oid, cid, cid, 'c'];
      for (const [s, tt] of [[s1, t1], [s2, t2]]) {
        const key = s + '|' + tt; if (!agg.has(key)) agg.set(key, { source: s, target: tt, value: 0, color: ds.cats[k].c }); agg.get(key).value += v;
      }
    });
  });
  drawSankey([...nodes.values()], [...agg.values()], state.dir === 'origem'
    ? [ds.name[u], ds.key === 'pessoas' ? 'Modal' : 'Categoria', 'Destinos']
    : ['Origens', ds.key === 'pessoas' ? 'Modal' : 'Categoria', ds.name[u]]);
}
function renderCatLegend(ds) {
  $('cat-legend').innerHTML = ds.cats.map((c) => `<div class="legend-item"><span class="legend-swatch" style="background:${c.c}"></span>${escapeHtml(c.l)}</div>`).join('');
}
function renderMapLegendRow() {
  const items = state.mode === 'pontos'
    ? [['var(--neutral-dot)', curDs().key === 'pessoas' ? 'município' : 'zona'], ['var(--origem)', 'unidade selecionada'], ['var(--destino)', 'unidades conectadas'], ['var(--flow-max)', 'maior fluxo do filtro']]
    : [];
  if (state.route !== 'off') items.push(['var(--text-muted)', 'tracejado = arco (rota indisponível)']);
  $('map-legend-row').innerHTML = items.map(([c, t]) => `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span>${t}</div>`).join('');
}

// ---------------- Indicadores ----------------
function computeUnitIndicators(ctx, u) {
  const { ds, S, cs } = ctx;
  const sumDir = (dir) => {
    let tot = 0, tkm = 0, vv = 0, n = 0, intra = 0; const vs = [];
    const each = (e, other) => { const v = edgeVal(S, cs, e) / ds.scale; if (v <= 0) return; tot += v; if (S.dist[e] >= 0) { tkm += v * S.dist[e]; vv += v; } n++; vs.push(v); if (ds.uf[other] === ds.uf[u] && ds.uf[u] >= 0) intra += v; };
    if (dir === 'o') for (let e = S.oStart[u]; e < S.oStart[u + 1]; e++) each(e, S.d[e]);
    else for (let k = S.dStart[u]; k < S.dStart[u + 1]; k++) { const e = S.dPerm[k]; each(e, S.o[e]); }
    vs.sort((a, b) => b - a);
    const topShare = (m) => tot > 0 ? vs.slice(0, m).reduce((a, b) => a + b, 0) / tot * 100 : 0;
    return { tot, tkm, n, intra, avgKm: vv > 0 ? tkm / vv : 0, t1: topShare(1), t5: topShare(5), t10: topShare(10) };
  };
  return { out: sumDir('o'), inn: sumDir('d') };
}
function indCard(v, l, s, cls) { return `<div class="ind"><div class="v ${cls || ''}">${v}</div><div class="l">${l}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }
function renderIndicators(ctx) {
  const { ds, S, cs } = ctx, ul = ds.unitLabel, cards = [];
  const catName = cs < 0 ? 'todas as categorias' : ds.cats[cs].l;
  if (state.unit != null) {
    const u = state.unit, r = computeUnitIndicators(ctx, u), saldo = r.inn.tot - r.out.tot;
    $('ind-sub').textContent = `${ds.name[u]} · ${catName}`;
    cards.push(indCard(fmtShort(r.out.tot), 'Saídas', ul), indCard(fmtShort(r.inn.tot), 'Entradas', ul),
      indCard(fmtSigned(saldo), 'Saldo (ent. − saí.)', saldo >= 0 ? 'atrator líquido' : 'emissor líquido', saldo >= 0 ? 'pos' : 'neg'),
      indCard(fmtInt(r.out.n) + ' / ' + fmtInt(r.inn.n), 'Destinos / origens', 'conexões com fluxo'),
      indCard(fmtInt(r.out.avgKm) + ' km', 'Dist. média das saídas', 'ponderada · linha reta'),
      indCard(fmtShort(r.out.tkm), 'Volume × km (saídas)', distUnit(ds)),
      indCard(fmtPct(r.out.t1) + ' · ' + fmtPct(r.out.t5) + ' · ' + fmtPct(r.out.t10), 'Concentração top 1·5·10', 'das saídas'),
      indCard(r.out.tot > 0 ? fmtPct(r.out.intra / r.out.tot * 100) : '–', 'Saídas dentro da própria UF', ''));
    if (state.cmp && DS[state.ds].scn[state.cmp]) {
      const ctx2 = { ...ctx, S: DS[state.ds].scn[state.cmp] }, r2 = computeUnitIndicators(ctx2, u);
      const d = r.out.tot - r2.out.tot;
      cards.push(indCard(fmtSigned(d) + (r2.out.tot ? ' (' + fmtSigned(d / r2.out.tot * 100, fmtPct) + ')' : ''), 'Δ saídas vs comparação', META.cenarios.find((c) => c.id === state.cmp).label, d >= 0 ? 'pos' : 'neg'));
    }
  } else {
    const p = ctx.pass;
    $('ind-sub').textContent = `Brasil · ${catName} · ${filterLabel(state.fo)} → ${filterLabel(state.fd)}`;
    let tk = 0, vv = 0; for (let i = 0; i < ds.n; i++) { tk += p.tkm[i]; vv += p.outV[i]; }
    const top10 = ctx.topNational.slice(0, 10).reduce((a, t) => a + t.val, 0);
    cards.push(indCard(fmtShort(p.total), 'Volume no filtro', ul), indCard(fmtInt(ctx.nPairsFiltered), 'Pares com fluxo', 'no filtro'),
      indCard(vv > 0 ? fmtInt(tk / vv) + ' km' : '–', 'Dist. média ponderada', 'linha reta'),
      indCard(fmtShort(tk), 'Volume × km', distUnit(ds)),
      indCard(p.total > 0 ? fmtPct(top10 / p.total * 100) : '–', 'Top 10 pares', 'do volume filtrado'),
      indCard(p.totalAll > 0 ? fmtPct(p.intra / p.totalAll * 100) : '–', 'Fluxo intra-UF', 'sem filtro geográfico'));
    if (state.cmp && DS[state.ds].scn[state.cmp]) {
      const p2 = passAll(ds, DS[state.ds].scn[state.cmp], cs, state.fo, state.fd), d = p.total - p2.total;
      cards.push(indCard(fmtSigned(d) + (p2.total ? ' (' + fmtSigned(d / p2.total * 100, fmtPct) + ')' : ''), 'Δ volume vs comparação', META.cenarios.find((c) => c.id === state.cmp).label, d >= 0 ? 'pos' : 'neg'));
    }
  }
  $('ind-grid').innerHTML = cards.join('');
  $('ind-note').textContent = 'Distâncias são em linha reta entre os pontos de referência das unidades (sede da UTP / município da zona); a distância rodoviária real é maior. ' +
    (ds.key === 'pessoas' ? 'Volume × km = pax·km.' : 'Volume × km = t·km; fluxos de/para o exterior ficam fora de distâncias e t·km (o ponto do país/continente é apenas ilustrativo).');
}

// ---------------- Ranking ----------------
function rankRows(ctx) {
  const { ds, S } = ctx;
  const cmp = state.cmp && DS[state.ds].scn[state.cmp];
  if (state.unit == null) {
    return ctx.topNational.slice(0, state.rankN).map((t) => ({ name: `${ds.name[t.o]} → ${ds.name[t.d]}`, sub: ufLabel(ds, t.o) + ' → ' + ufLabel(ds, t.d), val: t.val, km: S.dist[t.e], click: t.o, cmpVal: cmp ? (() => { const e2 = findEdge(cmp, t.o, t.d); return e2 < 0 ? 0 : edgeVal(cmp, ctx.cs, e2) / ds.scale; })() : null }));
  }
  return ctx.conns.slice(0, Math.min(ctx.conns.length, state.rankN)).map((t) => {
    let cv = null;
    if (cmp) { const [a, b] = state.dir === 'origem' ? [state.unit, t.other] : [t.other, state.unit]; const e2 = findEdge(cmp, a, b); cv = e2 < 0 ? 0 : edgeVal(cmp, ctx.cs, e2) / ds.scale; }
    const r = routeFor(ds.key, state.unit, t.other);
    return { name: ds.name[t.other], sub: (ds.key === 'pessoas' ? `UTP ${ds.id[t.other]} · ${ds.meta.units.n[t.other]} municípios` : ufLabel(ds, t.other)), val: t.val, km: S.dist[t.e], road: r ? r.km : null, click: t.other, cmpVal: cv };
  });
}
const ufLabel = (ds, i) => ds.uf[i] >= 0 ? UFS[ds.uf[i]].sg : 'Exterior';
function renderRanking(ctx) {
  const { ds } = ctx, el = $('rank-list'), rows = rankRows(ctx);
  const catName = ctx.cs < 0 ? (ds.key === 'pessoas' ? 'todos os modais' : 'todas as categorias') : ds.cats[ctx.cs].l;
  $('rank-sub').textContent = state.unit == null
    ? `maiores pares do país · ${catName} · ${filterLabel(state.fo)} → ${filterLabel(state.fd)}`
    : `${ds.name[state.unit]} · ${state.dir === 'origem' ? 'top destinos' : 'top origens'} · ${catName} · ${fmtInt(ctx.conns.length)} conexões no filtro`;
  if (!rows.length) { el.innerHTML = '<div class="empty-state">Nenhum fluxo registrado para esta seleção e filtros.</div>'; $('rank-more').innerHTML = ''; return; }
  const mx = rows[0].val, color = state.dir === 'origem' ? 'var(--destino)' : 'var(--origem)';
  const cmpName = state.cmp ? META.cenarios.find((c) => c.id === state.cmp).label : '';
  el.innerHTML = rows.map((r, i) => {
    const delta = r.cmpVal == null ? '' : (r.cmpVal > 0 ? `<span class="delta ${r.val >= r.cmpVal ? 'pos' : 'neg'}" title="vs ${escapeHtml(cmpName)}">${fmtSigned((r.val - r.cmpVal) / r.cmpVal * 100, fmtPct)}</span>` : '<span class="delta">novo</span>');
    return `<div class="rank-row" data-u="${r.click}" tabindex="0" role="button"><div class="idx">${String(i + 1).padStart(2, '0')}</div>
      <div class="name">${escapeHtml(r.name)}<span class="sub">${escapeHtml(r.sub)}</span></div>
      <div class="dist">${r.km >= 0 ? fmtInt(r.km) + ' km' : '—'}${r.road ? `<br>${fmtInt(r.road)} km rod.` : ''}</div>
      <div class="val">${fmtInt(r.val)} ${delta}</div>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${(r.val / mx * 100).toFixed(0)}%;background:${color}"></div></div></div>`;
  }).join('');
  el.querySelectorAll('.rank-row').forEach((row) => {
    const go = () => selectUnit(+row.dataset.u);
    row.addEventListener('click', go); row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  const more = $('rank-more'), total = state.unit == null ? ctx.topNational.length : ctx.conns.length;
  const steps = [15, 50, 150, 500].filter((n) => n > state.rankN && n < total + 1);
  more.innerHTML = steps.map((n) => `<button class="btn" data-n="${n}">mostrar ${n}</button>`).join('') +
    (state.unit != null && total > state.rankN ? `<button class="btn" data-n="${total}">mostrar todas (${fmtInt(total)})</button>` : '');
  more.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.rankN = +b.dataset.n; renderRanking(CTX); }));
}
function currentRankingCSV() {
  const ctx = CTX, ds = ctx.ds, rows = [['posição', 'origem', 'destino', 'UF origem', 'UF destino', 'volume (' + ds.unitLabel + ')', 'km linha reta']];
  const all = state.unit == null ? ctx.topNational : ctx.conns;
  all.forEach((t, i) => {
    const o = state.unit == null ? t.o : (state.dir === 'origem' ? state.unit : t.other), d = state.unit == null ? t.d : (state.dir === 'origem' ? t.other : state.unit);
    rows.push([i + 1, ds.name[o], ds.name[d], ufLabel(ds, o), ufLabel(ds, d), t.val, ctx.S.dist[t.e] >= 0 ? ctx.S.dist[t.e] : '']);
  });
  return rows;
}
