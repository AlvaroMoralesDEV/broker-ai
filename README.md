# Bróker IA

Un agente que hace de bróker hipotecario e inmobiliario personal para comprar vivienda en España.

Le cuentas tu situación y la recuerda. Le pegas un anuncio de Idealista (texto o captura) y te dice si puedes comprarlo, cuánto te cuesta de verdad, qué alertas tiene y qué preguntar. Te guarda las viviendas que te interesan y, cuando cambia tu situación, recalcula todas.

## Arrancar

```bash
docker compose up -d --build  # http://localhost:8787
```

Sin Docker: `npm install && npm run dev` (web en http://localhost:5173). Usa una base de datos Postgres embebida en `data/pglite`.

No hace falta ninguna clave: el agente elige solo el mejor cerebro disponible.

| Modo | Cuándo | Qué cambia |
| --- | --- | --- |
| **Claude** | Hay `ANTHROPIC_API_KEY` en `.env` | Agente completo: conversa, lee capturas, busca en la web y usa las herramientas él mismo |
| **IA local** | Sin clave, con [Ollama](https://ollama.com) instalado (`ollama pull qwen3:1.7b`) | Gratis y privado. El trabajo de bróker lo hace el código al instante; el modelo solo responde preguntas libres |
| **Sin IA** | Ni clave ni Ollama | Todo lo determinista sigue funcionando: entrevista, anuncios pegados, guardar, comparar, hipotecas |

### Por qué el modo local no es «Claude pero peor»

Medido en un portátil sin GPU (i7 de 11ª, 16 GB) con `scripts/bench-local.ts`: `qwen3:4b` no respondió en 5 minutos, y `qwen3:1.7b` elegía bien la herramienta pero rellenaba mal los parámetros (campos inventados, ceros en datos que el usuario no dio). Así que en local el modelo no toca las herramientas:

- `shared/extract.ts` lee con reglas los datos del usuario («tengo 42.000 ahorrados», «1900 en 14 pagas») y los campos de un anuncio pegado. Lo ambiguo (sueldo en bruto, cifra anual) no se guarda: se pregunta.
- `server/summaries.ts` escribe el veredicto, los costes, las alertas y las preguntas para la agencia. Un anuncio se evalúa en menos de 100 ms.
- La entrevista la conduce el código (siguiente dato que falta, por orden de impacto).
- El modelo local responde lo demás con un glosario y tu contexto, y se avisa si da cifras en euros que no salen de tus datos.

Para probar otro modelo en tu máquina: `node scripts/bench-local.ts <modelo>` y luego `OLLAMA_MODEL=<modelo>` en `.env`. Para probar el chat desde la terminal: `node scripts/chat.mjs "hola" "tengo 30.000 ahorrados"`.

## Cómo está hecho

```
docker compose
├── app   Node 24 + Express: agente, herramientas, API REST + SSE, y la web (React) compilada
└── db    Postgres 16 + pgvector: perfil, histórico de cambios, conversaciones, viviendas
```

- **El modelo extrae y conversa; el código decide.** Claude lee el anuncio y rellena los campos. Los números (cuota, impuestos por comunidad, presupuesto) salen de `shared/finance.ts`, que está testeado contra el Excel original. Las alertas (ocupada, nuda propiedad, derrama, sin ascensor…) son reglas en `shared/broker.ts`, y cada una muestra el trozo del anuncio que la ha hecho saltar.
- **Memoria en la base de datos.** El perfil tiene un histórico solo de añadir (`profile_facts`: qué dijiste, cuándo y por dónde). Las conversaciones se guardan exactamente como se envían a la API y nunca se editan.
- **Un solo registro de herramientas** (`server/tools.ts`) para el chat de la web, el modo local y el servidor MCP. El historial tiene el mismo formato en los tres modos, así que una conversación empezada en local se puede continuar con Claude.
- **Interfaz centrada en el chat:** conversaciones a la izquierda, chat en el centro y, a la derecha, tu presupuesto, lo que el bróker sabe de ti (con lo que falta) y tus viviendas, todo actualizado en vivo. En móvil los paneles son cajones.

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
- Las alertas y la lectura de anuncios son reglas de texto: pueden fallar con redacciones raras (en ambas direcciones). Cada alerta muestra su evidencia para que puedas comprobarla.
- En modo local no se leen capturas (hay que pegar el texto) y las respuestas a preguntas libres son las de un modelo de 2B: útiles para conceptos, flojas para consejo fino.
- La lectura de anuncios está probada con el formato de Idealista copiado como texto; otros portales pueden necesitar ajustes en `shared/extract.ts`.
- Impuestos y reducciones para jóvenes son orientativos y tienen requisitos.
