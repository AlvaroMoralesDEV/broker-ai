# Hipoteca Searcher

Calculadora de hipoteca + buscador de viviendas + asistente IA, a partir del Excel `copia-hipoteca.xlsx`.

## Arrancar

```bash
npm install
npm run dev        # web en http://localhost:5173 (API en :8787)
```

O en un solo proceso: `npm run build && npm start` → http://localhost:8787

Sin configurar nada funciona todo el simulador; las viviendas son de **ejemplo** y el asistente está apagado.

## Claves (opcionales)

Copia `.env.example` a `.env`:

| Variable | Para qué | Dónde se consigue |
| --- | --- | --- |
| `IDEALISTA_API_KEY`, `IDEALISTA_SECRET` | Anuncios reales de Idealista | https://developers.idealista.com/access-request |
| `ANTHROPIC_API_KEY` | Asistente IA | https://console.anthropic.com |

## Qué hay

- **Simulador** — precio → cuota, entrada, impuestos de tu comunidad, ahorros que faltan y veredicto.
- **Buscar casas** — busca por zona y marca cada vivienda como *Encaja / Justa / Fuera de presupuesto*; las guardadas se comparan en una tabla.
- **Hipotecas** — ofertas fijas, variables y mixtas con tu cuota. Los datos están en `data/rates.json`.
- **Plan de ahorro** — cuánto tardas en reunir entrada, impuestos y gastos, y cómo crece tu presupuesto.
- **Amortizar antes** — intereses y años que ahorras con aportaciones extra (reducir plazo o cuota).
- **Bonificaciones** — si compensa contratar los seguros del banco.
- **Alquilar o comprar** — patrimonio año a año en cada camino.
- **Asistente IA** — Claude con herramientas: presupuesto, análisis de compra, búsqueda y ofertas.

Enlaces directos: `/#hipotecas`, `/?zona=Valencia#casas`.

## Servidor MCP

Las mismas herramientas del asistente, para usarlas desde Claude Desktop o Claude Code:

```bash
claude mcp add hipoteca -- npx tsx C:/Users/34658/Projects/hipoteca-searcher/server/mcp.ts
```

Usa el perfil que guardas en la web (`data/profile.json`).

## Actualizar los tipos

Edita `data/rates.json` (fecha en `updated`, euríbor y `offers`). Las fuentes están en el propio archivo.

## Estructura

- `shared/` — motor de cálculo (`finance.ts`), impuestos por comunidad (`taxes.ts`) y tests contra el Excel (`npm test`).
- `server/` — API local, cliente de Idealista, asistente (`agent.ts`) y servidor MCP (`mcp.ts`).
- `src/` — interfaz (React).
