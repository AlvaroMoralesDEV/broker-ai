// El agente bróker: Claude con herramientas propias, memoria en base de datos y entrevista inicial.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { missingKeyFacts } from "../shared/broker.ts";
import type { ChatEvent, DisplayMsg, ImageInput } from "../shared/chat.ts";
import { ccaaName } from "../shared/taxes.ts";
import { runLocal } from "./local.ts";
import { CLAUDE_MODEL as MODEL, resolveProvider } from "./provider.ts";
import * as store from "./store.ts";
import { TOOLS, loadRates, makeContext, runTool, type ToolName } from "./tools.ts";

const MAX_STEPS = 16;

type Block = Anthropic.Beta.BetaContentBlockParam;
type Msg = store.StoredMessage;

function toolDefinitions(): Anthropic.Beta.BetaToolUnion[] {
  const custom = (Object.keys(TOOLS) as ToolName[]).map((name): Anthropic.Beta.BetaTool => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(TOOLS[name].schema) as Record<string, unknown>;
    return {
      name,
      description: TOOLS[name].description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
      eager_input_streaming: true,
    };
  });
  return [...custom, { type: "web_search_20260209", name: "web_search", max_uses: 4 }];
}

// Parte fija del prompt (se cachea). Lo que cambia (perfil, fecha) va en un segundo bloque.
const INSTRUCTIONS = `Eres el bróker hipotecario e inmobiliario personal del usuario: alguien que quiere comprar vivienda en España. Trabajas para él, no para un banco ni una agencia. Tu trabajo:

1. Conocer su situación financiera y mantenerla al día.
2. Decirle con números cuánto puede comprar y qué le limita.
3. Evaluar los anuncios que te pega (texto o capturas de Idealista u otro portal): si puede comprarlo, coste real, alertas y qué preguntar.
4. Guardar las viviendas que le interesan, seguirlas (estado, notas, cambios de precio) y compararlas.
5. Orientarle con la hipoteca: tipos, bancos, bonificaciones, y los pasos de la compra.

## Cómo trabajas
- Todos los números salen de las herramientas (mismo motor que el resto de la aplicación). No calcules cuotas, impuestos ni presupuestos de cabeza.
- Cuando el usuario te cuente algo de su situación (ahorros, sueldo, contrato, deudas, pareja, zonas, plazos), llama a update_profile en ese momento, con su frase en 'note'. Si corrige un dato, actualízalo. Después dile en una frase cómo cambia su presupuesto y, si tiene viviendas guardadas, cuáles cambian de veredicto.
- Pregunta el sueldo como neto por nómina y número de pagas (12 o 14), no por semanas ni en bruto.
- Cuando pegue un anuncio: evaluate_listing con todos los datos que veas (pasa la descripción completa en 'description' para que salten las alertas). Responde con: veredicto en una línea, coste real (ahorros necesarios, cuota, gastos al mes), las alertas que importen, lo que falta en el anuncio, y 2-4 preguntas para el vendedor o la agencia. Pregunta si quiere guardarla; si ya lo ha pedido, save_home directamente.
- Si el anuncio no dice algo (comunidad, IBI, planta, ascensor), no lo inventes: omítelo y señálalo como pregunta pendiente.
- No tienes acceso a buscar anuncios en portales: el usuario los busca y te los pega. Si te pide buscar, díselo y ofrécele qué filtros poner en Idealista según su presupuesto.
- Para saber si un precio por m² es razonable puedes buscar en la web informes de precios por zona; cita la fuente y la fecha, y dilo como orientación.
- Los impuestos y las reducciones para jóvenes tienen requisitos (renta, edad, valor máximo, empadronamiento); cuando cambien mucho el resultado, menciónalo. Las ofertas de bancos son punto de partida para negociar, no ofertas en firme.

## Entrevista
Si el perfil no está guardado o faltan datos clave, entrevístale como lo haría un bróker: una o dos preguntas cada vez, en orden de impacto (ahorros, sueldo neto y pagas, contrato y antigüedad, deudas, si compra solo o acompañado, comunidad autónoma, zonas, plazo). En cuanto tengas ahorros e ingresos, dale una primera cifra de presupuesto y sigue con lo demás. No le hagas un formulario de diez preguntas seguidas. Si te pega un anuncio antes de la entrevista, evalúalo igualmente y avisa de que el análisis usa datos de ejemplo hasta que te dé los suyos.

## Estilo
Responde en el idioma del usuario, directo y con cifras concretas en euros. Markdown sencillo: negritas y listas cortas, sin tablas. Las viviendas que evalúas o guardas aparecen como tarjetas debajo de tu respuesta: no repitas todos sus datos, comenta lo que importa.`;

async function contextBlock(): Promise<string> {
  const { profile: p, extra, known } = await store.getProfile();
  const missing = missingKeyFacts(await store.givenFields()).map((f) => f.ask);
  const homes = await store.listHomes();
  const rates = loadRates();
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `Fecha de hoy: ${today}. Datos de hipotecas de la aplicación: ${rates.updated} (euríbor medio de ${rates.euribor.month}: ${rates.euribor.monthlyAvg} %).`,
    known
      ? `Perfil guardado: ${p.age} años; ingresos netos del hogar ${p.netIncome} €/mes; deudas ${p.monthlyDebts} €/mes; ahorros ${p.savings} €; ${ccaaName(p.ccaa)}; ${p.firstHome ? "primera vivienda" : "no es primera vivienda"}; simulando ${p.ltvPct} % de financiación al ${p.ratePct} % a ${p.years} años. Datos de bróker: ${JSON.stringify(extra)}.`
      : "Perfil: AÚN NO GUARDADO. Empieza por la entrevista.",
    missing.length ? `Datos clave que aún no te ha dado: ${missing.join("; ")}.` : "Tienes todos los datos clave.",
    `Viviendas guardadas: ${homes.length}${homes.length ? ` (${homes.map((h) => `${h.listing.title}, ${h.listing.price} €, ${h.status}`).join(" | ")})` : ""}.`,
  ];
  return lines.join("\n");
}

const isToolUse = (b: Block): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use";
const blocksOf = (m: Msg): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content);

/** Si el turno anterior se cortó entre la llamada a una herramienta y su resultado, se añade un resultado de "interrumpido". */
function danglingToolResults(history: Msg[]): Msg | null {
  const last = history.at(-1);
  if (!last || last.role !== "assistant") return null;
  const calls = blocksOf(last).filter(isToolUse);
  if (!calls.length) return null;
  return {
    role: "user",
    content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Interrumpido por el usuario antes de terminar." })),
  };
}

export interface UserTurn {
  text: string;
  images?: ImageInput[];
}

/** Un turno del agente con el mejor cerebro disponible: Claude, modelo local o solo el enrutador. */
export async function runAgent(conversationId: string, turn: UserTurn, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const provider = await resolveProvider();
  const repair = danglingToolResults(await store.getMessages(conversationId));
  if (repair) await store.appendMessage(conversationId, repair);
  if (provider.kind === "anthropic") return runClaude(conversationId, turn, emit, signal);
  return runLocal(provider, conversationId, turn, emit, signal);
}

async function runClaude(conversationId: string, turn: UserTurn, emit: (e: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const client = new Anthropic();
  const ctx = await makeContext("chat", conversationId, (e) => emit(e));
  const tools = toolDefinitions();

  const messages = await store.getMessages(conversationId);
  const userMsg: Msg = {
    role: "user",
    content: [
      ...(turn.images ?? []).map((img): Block => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
      { type: "text", text: turn.text },
    ],
  };
  await store.appendMessage(conversationId, userMsg);
  messages.push(userMsg);

  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 32000,
        system: [
          { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
          { type: "text", text: await contextBlock() },
        ],
        tools,
        messages,
        output_config: { effort: "medium" },
        // Si un clasificador de seguridad rechaza la petición, la API la reintenta con otro modelo.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    stream.on("text", (text) => emit({ type: "text", text }));
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "El modelo ha rechazado esta petición. Prueba a reformularla." });
      return;
    }
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", message: "La respuesta se ha cortado por longitud. Pídeme que continúe." });
      return;
    }

    // El contenido se guarda tal cual (incluidos los bloques de razonamiento): el historial solo crece.
    const assistant: Msg = { role: "assistant", content: message.content as Block[] };
    await store.appendMessage(conversationId, assistant);
    messages.push(assistant);
    if (message.stop_reason === "pause_turn") continue;

    for (const b of message.content) if (b.type === "server_tool_use") emit({ type: "tool", name: b.name });
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return;

    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        emit({ type: "tool", name: call.name });
        try {
          const output = await runTool(call.name, call.input, ctx);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    const resultMsg: Msg = { role: "user", content: results };
    await store.appendMessage(conversationId, resultMsg);
    messages.push(resultMsg);
  }
  emit({ type: "error", message: "He hecho demasiados pasos sin terminar. Prueba con una petición más concreta." });
}

/** Historial para pintar: agrupa los pasos de cada respuesta y saca las tarjetas de viviendas. */
export function toDisplay(history: Msg[]): DisplayMsg[] {
  const out: DisplayMsg[] = [];
  let current: DisplayMsg | null = null;
  for (const m of history) {
    const blocks = blocksOf(m);
    if (m.role === "user") {
      if (blocks.every((b) => b.type === "tool_result")) continue;
      current = null;
      out.push({
        role: "user",
        text: blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim(),
        images: blocks.filter((b) => b.type === "image").length,
        tools: [],
        homes: [],
      });
      continue;
    }
    if (!current) {
      current = { role: "assistant", text: "", tools: [], homes: [], images: 0 };
      out.push(current);
    }
    for (const b of blocks) {
      if (b.type === "text" && b.text.trim()) current.text += (current.text ? "\n\n" : "") + b.text;
      else if (b.type === "server_tool_use") current.tools.push(b.name);
      else if (isToolUse(b)) {
        current.tools.push(b.name);
        if (b.name === "evaluate_listing" || b.name === "save_home") {
          const { status: _s, notes: _n, ...listing } = b.input as Record<string, unknown>;
          current.homes.push({ listing: listing as unknown as DisplayMsg["homes"][number]["listing"], savedId: b.name === "save_home" ? "guardada" : undefined });
        }
      }
    }
  }
  return out;
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "La clave ANTHROPIC_API_KEY no es válida. Revísala en el archivo .env.";
  if (err instanceof Anthropic.RateLimitError) return "Límite de peticiones de la API de Claude alcanzado. Espera un momento y vuelve a intentarlo.";
  if (err instanceof Anthropic.APIConnectionError) return "No he podido conectar con la API de Claude. Comprueba tu conexión.";
  if (err instanceof Anthropic.APIError) return `Error de la API de Claude (${err.status ?? "?"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
