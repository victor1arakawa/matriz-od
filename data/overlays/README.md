# Camadas GeoJSON (sobreposições)

Qualquer arquivo `*.geojson` colocado nesta pasta é **embutido** no dashboard no próximo
`python build/build.py` e aparece como camada ligável/desligável no mapa.

Também dá para arrastar um `.geojson` sobre o mapa (ou usar **＋ camada GeoJSON**) sem rebuild —
a camada vale só naquela sessão do navegador.

Sugestões para o planejamento da ANTT (dados abertos, https://dados.antt.gov.br):
- *Quilômetro Pista Principal* (concessões rodoviárias, SHP/KMZ, CC-BY) — converter com QGIS
  (Exportar → GeoJSON, EPSG:4326) ou `ogr2ogr -f GeoJSON -t_srs EPSG:4326 saida.geojson entrada.shp`.
- Malha do SNV (DNIT) e ferrovias (SNV ferroviário / ANTT), quando disponíveis em GeoJSON.

Dicas: mantenha < 15 MB por arquivo (simplifique no QGIS) e projeção WGS84 (EPSG:4326).
As 6 primeiras propriedades de cada feição aparecem no mouse-over.
