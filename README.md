# Matriz OD 2035 — Pessoas e Cargas (Brasil)

Dashboard interativo, em **um único arquivo HTML autocontido** (`dist/matriz_od.html`, ~16 MB), para explorar as matrizes Origem-Destino do cenário referencial 2035 do Plano Nacional de Logística (PNL/EPL) — pensado para a inteligência de planejamento da ANTT.

**Funciona offline e sem chave de API**: bibliotecas, fontes, malhas do IBGE e dados estão dentro do arquivo. O mapa-base padrão é o contorno das UFs e dos países (offline); um mapa-base online (CARTO, Esri ou OpenStreetMap) é opcional (seletor "Mapa-base online").

## Como usar
Abra `dist/matriz_od.html` no Chrome/Edge/Firefox recentes (duplo clique). Nada a instalar.

| Seção | O que faz |
|---|---|
| **Pessoas** | 1.531 UTPs (5.570 municípios), viagens/ano por modal (automóvel, ônibus, hidroviário, ferroviário, aéreo) |
| **Cargas** | 5.589 zonas (5.570 municípios + 19 do exterior), t/ano por categoria (CGC, CGNC, GL, GSA, GSM, OGSM), 2,57 mi de pares |
| **UF & corredores** | matriz UF×UF (ou região×região), maiores corredores, resumo por região (saídas, entradas, saldo, % intra, distância média, volume×km) |

Recursos: busca por cidade (ignora acento) · filtro por modal/categoria · **filtro por UF/macrorregião de origem e de destino** · mapa de pontos e fluxos, **coroplético por UF ou município** (saídas, entradas, saldo, volume×km) · **rota rodoviária** no lugar do arco (pré-calculada; ou consulta online ao OSRM) · Sankey · indicadores (distância média, volume×km, concentração top 1/5/10, saldo, % intra-UF) · ranking expansível com distância · comparação entre cenários (quando houver mais de um) · **camadas GeoJSON** (arraste um `.geojson` sobre o mapa: SNV, ferrovias, concessões…) · tema claro/escuro · exportação de CSV, PNG do mapa/Sankey e PDF (impressão) · **link com o estado atual** (botão "Copiar link").

## Regenerar o dashboard (só quem atualiza dados)
Requer Python 3.10+.

```
build.bat            # gera dist/matriz_od.html e valida (rápido)
build.bat full       # validação completa: relê o CSV de 716 MB e confere zona a zona
python build/routes.py --dataset pessoas --top 1000   # amplia as rotas rodoviárias (OSRM, ~1 req/s); ver aviso abaixo
```
Os ZIPs oficiais ficam na raiz (não são versionados como CSV). `build/config.json` lista os cenários (`id`, `label`, ZIPs); com mais de um cenário de **mesmo zoneamento** o dashboard habilita "Comparar com". `build/validate.py` garante que o HTML gerado bate com os CSVs (14 verificações no modo completo).

## Fontes e proveniência
- **Matrizes OD**: EPL — Plano Nacional de Logística 2035 (https://portal.epl.gov.br/plano-nacional-de-logistica-2035; ONTL: https://ontl.epl.gov.br/planejamento-pnl-2035/). Os ZIPs foram recebidos diretamente; **a URL exata de download não foi confirmada**. `data/manifest.json` registra SHA-256, tamanho e conteúdo de cada ZIP e a data do build — preencha `fonte.url_download_exata` em `build/config.json` quando souber.
- **Coordenadas dos municípios**: pacote npm [`municipios-brasil`](https://www.npmjs.com/package/municipios-brasil) 0.2.1 (MIT), baseado em dados do IBGE.
- **Malhas UF e município**: API de malhas do IBGE (qualidade mínima), simplificadas no build.
- **Demais países** (contorno e nomes): [Natural Earth](https://www.naturalearthdata.com/) 50m, domínio público.
- **Zonas do exterior** (19): pontos aproximados definidos manualmente — só ilustrativos.
- **Bibliotecas**: Leaflet 1.9.4 (BSD-2), D3 7.8.5 (ISC), d3-sankey 0.12.3 (BSD-3); fontes Space Grotesk, Inter, IBM Plex Mono (OFL). URL e SHA-256 em `vendor/MANIFEST.json`.
- **Tiles opcionais**: CARTO, Esri e OpenStreetMap (escolha no seletor; o OSM recusa pedidos sem Referer, como arquivos abertos por duplo clique).
- **Rotas**: OSRM sobre OpenStreetMap (© contribuidores do OSM, ODbL).

## Limitações e achados sobre os dados
1. **A matriz de pessoas fornecida é parcial.** O CSV tem 76.009 linhas; o dicionário de dados declara 2.343.962 (matriz densa 1.531²). Só ~3,2% dos pares estão presentes e 475 UTPs nunca são origem. Consequência: **entradas, saldos e totais por UTP de pessoas estão subestimados/assimétricos**. O dashboard mostra um aviso. Confirme com a EPL se existe o arquivo completo. (A matriz de cargas confere com o dicionário: 31.236.921 linhas, 2.571.162 não-zero.)
2. Um par repetido no CSV de pessoas (UTP 452→130195) é somado.
3. **Distâncias são em linha reta** entre pontos de referência (sede da UTP / município da zona) e **excluem o exterior**. A rota rodoviária só existe para os pares pré-calculados (ou online).
4. **Rotas rodoviárias**: o servidor público do OSRM é só para demonstração (≈1 req/s, sem garantia). O modo "pré-calculada" não depende dele. Para uso institucional em volume, suba um OSRM próprio (extrato do Brasil do OSM) e use `--osrm http://localhost:5000`.
6. Só existe o cenário referencial 2035. A comparação de cenários foi testada com um cenário sintético (×1,15), não com dados reais.
7. Valores são projeção do cenário referencial, não dado observado.

## Estrutura
```
dist/matriz_od.html        # o produto (gerado)
src/                       # template, CSS e JS do front-end
build/                     # build.py, validate.py, routes.py, fetch_geo.py, config.json
data/geo|routes|overlays   # insumos geográficos, rotas pré-calculadas, camadas GeoJSON
data/manifest.json         # proveniência (hashes) do último build
vendor/                    # bibliotecas e fontes embutidas
legado/                    # dashboards antigos (dependiam de CDN)
CLAUDE.md                  # guia para o Claude Code / desenvolvedores
```

## Licença
O código deste projeto pode ser reutilizado livremente. Os dados de origem (PNL/EPL) são informação pública governamental — consulte o [Portal EPL](https://portal.epl.gov.br/) para os termos oficiais. Bibliotecas e dados de terceiros mantêm suas licenças (MIT, BSD, ISC, OFL, ODbL).
