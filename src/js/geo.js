// ============================== geo.js ==============================
// Malhas IBGE (UF e município) embutidas, simplificadas em build/fetch_geo.py.
const GEO = { uf: null, mun: null, world: [] };
async function loadGeo() {
  const dec = async (id) => JSON.parse(new TextDecoder().decode(await gunzip(b64ToBytes($(id).textContent))));
  GEO.uf = await dec('geo-uf');
  GEO.mun = await dec('geo-mun');
  if ($('geo-world') && $('geo-world').textContent.trim()) GEO.world = await dec('geo-world');   // demais países (contorno + nome)
}
const toLL = (ring) => ring.map((p) => [p[1], p[0]]);
