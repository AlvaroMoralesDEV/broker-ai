# Bróker IA

Un agente que hace de bróker hipotecario e inmobiliario personal para comprar vivienda en España.

Le cuentas tu situación y la recuerda. Le pegas un anuncio de Idealista (texto o captura) y te dice si puedes comprarlo, cuánto te cuesta de verdad, qué alertas tiene y qué preguntar. Te guarda las viviendas que te interesan y, cuando cambia tu situación, recalcula todas.

## Arrancar

```bash
cp .env.example .env          # pon tu ANTHROPIC_API_KEY
docker compose up -d --build  # http://localhost:8787
```

Sin Docker: `npm install && npm run dev` (web en http://localhost:5173). Usa una base de datos Postgres embebida en `data/pglite`.

Sin clave de la API funciona todo menos el chat.

## Cómo está hecho

```
docker compose
├── app   Node 24 + Express: agente, herramientas, API REST + SSE, y la web (React) compilada
└── db    Postgres 16 + pgvector: perfil, histórico de cambios, conversaciones, viviendas
```

- **El modelo extrae y conversa; el código decide.** Claude lee el anuncio y rellena los campos. Los números (cuota, impuestos por comunidad, presupuesto) salen de `shared/finance.ts`, que está testeado contra el Excel original. Las alertas (ocupada, nuda propiedad, derrama, sin ascensor…) son reglas en `shared/broker.ts`, y cada una muestra el trozo del anuncio que la ha hecho saltar.
- **Memoria en la base de datos.** El perfil tiene un histórico solo de añadir (`profile_facts`: qué dijiste, cuándo y por dónde). Las conversaciones se guardan exactamente como se envían a la API y nunca se editan.
- **Un solo registro de herramientas** (`server/tools.ts`) para el chat de la web y para el servidor MCP.

| Herramienta | Qué hace |
| --- | --- |
| `get_profile` / `update_profile` | Lo que sabe de ti y lo que le cuentas (sueldo por nómina y pagas, contrato, ahorros…), con el presupuesto antes y después |
| `evaluate_listing` | Anuncio pegado → veredicto, coste real, coste mensual de tenerla, alertas |
| `save_home` / `list_saved_homes` / `update_home` / `remove_home` | Viviendas en seguimiento: estado, notas, cambios de precio y veredicto recalculado |
| `max_budget` / `analyze_purchase` / `mortgage_offers` | Presupuesto, simulación a un precio y ofertas de bancos |
| `web_search` | Precios por zona y novedades (herramienta del servidor de Anthropic) |

## Servidor MCP

Las mismas herramientas desde Claude Desktop o Claude Code, sobre la misma base de datos:

```bash
claude mcp add broker -e DATABASE_URL=postgres://broker:broker@localhost:5433/broker -- node <ruta-al-proyecto>/server/mcp.ts
```

Requiere `docker compose up -d db`. Sin `DATABASE_URL` usa la base de datos embebida, que admite un solo proceso: no la abras a la vez desde la web y desde MCP.

## Desarrollo

- `npm test`: motor de cálculo, alertas y herramientas contra una base de datos en memoria (sin llamar al modelo).
- `npm run typecheck`
- Tipos de los bancos: `data/rates.json` (en Docker se monta, así que basta con editarlo y recargar).
- Migraciones: `server/migrations/*.sql`, que se aplican al arrancar.

## Límites conocidos

- No busca anuncios: Idealista no permite el scraping y su API requiere aprobación. Tú buscas y el agente evalúa.
- Las alertas son reglas de texto: pueden fallar con redacciones raras (en ambas direcciones). Cada alerta muestra su evidencia para que puedas comprobarla.
- Impuestos y reducciones para jóvenes son orientativos y tienen requisitos.
