// ============================== util.js ==============================
const $ = (id) => document.getElementById(id);
const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const fmtInt = (n) => nfInt.format(Math.round(n));
function fmtShort(n) {
  const a = Math.abs(n);
  if (a >= 1e12) return nf1.format(n / 1e12) + ' tri';
  if (a >= 1e9) return nf1.format(n / 1e9) + ' bi';
  if (a >= 1e6) return nf1.format(n / 1e6) + ' mi';
  if (a >= 1e3) return nf1.format(n / 1e3) + ' mil';
  return fmtInt(n);
}
const fmtPct = (x) => nf1.format(x) + '%';
function fmtSigned(n, f = fmtShort) { return (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n)); }

function normalizeStr(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function haversine(la1, lo1, la2, lo2) {
  const p = Math.PI / 180;
  const a = Math.sin((la2 - la1) * p / 2) ** 2 + Math.cos(la1 * p) * Math.cos(la2 * p) * Math.sin((lo2 - lo1) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// cede o controle para a UI pintar; setTimeout garante progresso mesmo com a aba em segundo plano (rAF pausa)
const tick = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });

function b64ToBytes(b64) {
  const s = atob(b64.trim());
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}

function decodePolyline(str, prec = 5) {
  const pts = []; let i = 0, lat = 0, lon = 0; const f = Math.pow(10, prec);
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, res = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    pts.push([lat / f, lon / f]);
  }
  return pts;
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
// CSV para Excel pt-BR: separador ';', vírgula decimal e BOM UTF-8
function toCSV(rows) {
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
    const s = String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
function downloadCSV(rows, name) { downloadBlob(new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' }), name); }

function toast(msg) {
  const el = $('map-status');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}
