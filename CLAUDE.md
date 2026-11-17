# CLAUDE.md — Matriz OD 2035 (ANTT / Inteligência de Planejamento)

## Objetivo
Dashboard único de exploração das matrizes Origem-Destino do cenário referencial 2035 do PNL (EPL) para apoiar a inteligência de planejamento da ANTT. Público: analistas técnicos, não desenvolvedores — a saída final é **um HTML autocontido** (`dist/matriz_od.html`) que abre com duplo clique, sem internet e sem chave de API.

## Como regenerar (só quem atualiza dados precisa de Python)
```
build.bat            # instala deps, baixa libs/malhas se faltarem, gera dist/matriz_od.html, valida (rápido)
build.bat full       # idem, mas a validação relê o CSV de 716 MB e confere cada zona
python build/routes.py --dataset pessoas|cargas [--top N] [--osrm URL]   # pré-calcula rotas rodoviárias (opcional)
python build/fetch_geo.py [--only geo|vendor]                            # atualiza coordenadas, malhas IBGE, libs, fontes
```
Testar no navegador: `python -m http.server 8765 --directory dist` (ou `preview_start` "dist" em `.claude/launch.json`). No console: `__od` expõe `state`, `MAP`, `DS`, `META`.

## Estrutura
- `src/template.html`, `src/css/app.css`, `src/js/*.js` — front-end. O build concatena os JS **nesta ordem** (util, data, geo, state, map, panels, analysis, export, main) dentro de um único closure; funções são compartilhadas por nome.
- `build/build.py` — lê os ZIPs (`data/raw` **não** é necessário; lê direto do ZIP), junta coordenadas, codifica matrizes, monta o HTML, grava `data/manifest.json`. Cache das matrizes em `build/cache/` (chave = SHA-256 dos ZIPs).
- `build/validate.py` — teste de integridade HTML × CSV (pares, somas por categoria, totais por zona, valor exato de cada par de pessoas, unidades sem coordenada, ausência de dependência externa). **Rodar após qualquer mudança no build.**
- `build/routes.py` — rotas OSRM para os maiores pares → `data/routes/rotas_*.json`.
- `data/geo/` — `municipios_coords.csv` (npm municipios-brasil, MIT), `malha_uf.json`/`malha_mun.json` (IBGE, simplificadas), `intl_zones.json` (coordenadas manuais das 19 zonas do exterior), `malha_mundo.json` (demais países: contorno + nome pt-BR, Natural Earth 50m, domínio público; hachura via `<pattern>` no SVG do renderer `pWorld`).
- `data/overlays/*.geojson` — camadas extras embutidas (SNV, concessões…). Ver `data/overlays/README.md`.
- `vendor/` — Leaflet, D3, d3-sankey, fontes (base64) e `MANIFEST.json` com URL/SHA-256 de cada um.
- `legado/` — os dois dashboards antigos (dependiam de CDN/CARTO). Só referência.

## Formato dos dados embutidos
Cada dataset/cenário é um bloco gzip+base64 de colunas little-endian: `o`(u16) `d`(u16) e uma coluna por modal/categoria, **`i4` ou `f8` conforme a magnitude** (fluxos ×10 estouram int32: há par de minério > 2,1 bi; o layout — tipo e offset de cada coluna — vem em `META.cenarios[].{pessoas,cargas}.layout`, alinhado a 8 bytes). Arestas ordenadas por (origem, destino) e sem repetição (o front usa busca binária). Índices por origem/destino são CSR construídos no navegador. Valores de cargas estão ×10 (uma casa decimal); pessoas ×1.

## Regras de trabalho
- Nunca ler `matriz_cargas.csv` inteiro (716 MB) nem imprimir linhas do HTML gerado (16 MB, linhas gigantes). Use `cut -c1-200`, ou edite os arquivos de `src/`, nunca o `dist/`.
- Sem backend e sem chave. Dependência externa só como opção (tiles CARTO/Esri/OSM, OSRM online), sempre com fallback offline.
- Interface em pt-BR; números via `Intl.NumberFormat('pt-BR')`; CSV exportado com `;`, vírgula decimal e BOM (abre no Excel).
- Dados são projeção (cenário referencial 2035), nunca observado; rotular assim em qualquer saída.
- Não abrir as abas do navegador embutido em segundo plano esperando `requestAnimationFrame`: use o helper `tick()` (tem fallback por `setTimeout`) e `animate:false` nos `fitBounds`, senão o Leaflet trava em abas pausadas.

## Achados de qualidade dos dados (não perder de vista)
1. **A matriz de pessoas fornecida é parcial**: 76.009 linhas no CSV contra 2.343.962 declaradas no dicionário (matriz densa 1.531²) — só ~3,2% dos pares. 475 das 1.531 UTPs nunca aparecem como origem. Logo **entradas, saldos e totais por UTP de pessoas estão subestimados/assimétricos** (ex.: Belo Horizonte: 54,5 mi de saídas × 1 mi de entradas). O dashboard exibe aviso; confirmar o arquivo original com a EPL antes de tirar conclusões de saldo. A matriz de cargas confere com o dicionário (31.236.921 linhas).
2. 1 par repetido no CSV de pessoas (452→130195) — somado pelo build.
3. Zonas do exterior usam ponto-centroide arbitrário: distâncias/t·km excluem fluxos de/para o exterior (dist = −1).
4. Distâncias são **linha reta** entre pontos de referência (sede da UTP / município da zona); rota real só onde há rota pré-calculada/online.
5. 2 UTPs (409 Belém do São Francisco, 260850 Lagoa de Itaenga) não casam o nome da sede com municipios.csv → coordenada = centroide dos municípios.
6. Proveniência: URL exata de download da EPL **não confirmada**; hashes dos ZIPs em `data/manifest.json`.

## Estado do roadmap
Feitos: offline (libs/fontes/malha embutidas), pipeline reprodutível, painel único Pessoas/Cargas/UF, indicadores (dist. média, volume×km, concentração, saldo, intra-UF), filtros UF/região origem→destino, matriz UF×UF e corredores, coroplético UF/município (escala p98), pontos que escalam com zoom, tema claro/impressão, exportação (CSV, PNG mapa/Sankey, PDF via impressão), link com estado (`#hash`), comparação de cenários (pipeline aceita N cenários com mesmo zoneamento), rotas rodoviárias (pré-calculadas + OSRM online opcional), camadas GeoJSON, validação automática, manifesto de proveniência.
Não feito / a decidir: **item 3 do roadmap (separar código de dados por fetch) — excluído a pedido**; camadas oficiais SNV/ferrovias/concessões ANTT (mecanismo pronto, dados não embutidos); atribuição de demanda à rede inteira / carga por trecho (**removida a pedido**); só existe o cenário referencial 2035 (comparação testada com cenário sintético).

## Convenções de código
- JS vanilla + D3 v7 + Leaflet 1.9; sem framework/bundler.
- Pontos neutros viram "+" (canvas, `options.plus` em `L.Canvas._updateCircle`) quando há unidade selecionada ou filtro geográfico; a rota mais frequente (vermelha) é sempre trazida para a frente (`MAP.topLine`).
- Canvas do Leaflet: **um único renderer interativo** (`MAP.rMain`) — canvases sobrepostos bloqueiam eventos do de baixo; fluxos ficam em SVG (`pFlows`) acima.
- Mudou algo em `state`? Atualize `stateToHash`/`hashToState`.
