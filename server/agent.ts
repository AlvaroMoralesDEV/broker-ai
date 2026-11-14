// El agente bróker: Claude con herramientas propias, memoria en base de datos y entrevista inicial.
//
// Cómo se construye cada petición a la API (el porqué de cada punto está en docs/agent-design.md):
//   · tools + system  → fijos. No llevan fecha ni datos del usuario, así que se leen de la caché.
//   · messages        → el historial guardado, que solo crece. El contexto del usuario (perfil,
//                       viviendas, notas, fecha) entra como mensajes 'system' DENTRO del historial.
//   · al final        → un punto de caché automático, para que cada paso reutilice todo lo anterior.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { isLinkOnly, linkListing, missingKeyFacts } from "../shared/broker.ts";
import type { ChatEvent, DisplayMsg, ImageInput } from "../shared/chat.ts";
import { ccaaName } from "../shared/taxes.ts";
import { runLocal } from "./local.ts";
import { CLAUDE_MODEL as MODEL, resolveProvider } from "./provider.ts";
import * as store from "./store.ts";
import { TOOLS, loadRates, makeContext, ratesWarning, runToolCalls, type ToolName } from "./tools.ts";

/** Pasos (peticiones a la API) con herramientas por turno. Al agotarlos se pide un cierre sin herramientas. */
export const MAX_STEPS = 16;

type Block = Anthropic.Beta.BetaContentBlockParam;
type Msg = store.StoredMessage;
type Request = Parameters<Anthropic["beta"]["messages"]["stream"]>[0];

/**
 * Dónde puede buscar el agente. Sin esta lista, una búsqueda de «precio m² en Carabanchel» devuelve
 * sobre todo blogs y agregadores de dudosa calidad, y el modelo los cita con la misma seguridad que al
 * INE. WEB_SEARCH_DOMAINS (dominios separados por comas) la sustituye; "*" quita la restricción.
 */
const DEFAULT_SEARCH_DOMAINS = [
  "idealista.com",
  "fotocasa.es",
  "pisos.com",
  "tinsa.es",
  "st-tasacion.es",
  "ine.es",
  "bde.es",
  "notariado.org",
  "registradores.org",
  "mivau.gob.es",
  "agenciatributaria.gob.es",
  "boe.es",
];

export function searchDomains(env = process.env.WEB_SEARCH_DOMAINS): string[] | null {
  const raw = env?.trim();
  if (!raw) return DEFAULT_SEARCH_DOMAINS;
  if (raw === "*") return null;
  return raw.split(",").map((d) => d.trim()).filter(Boolean);
}

/** Las definiciones no cambian mientras el proceso vive: se calculan una vez, siempre en el mismo orden. */
let toolDefs: Anthropic.Beta.BetaToolUnion[] | null = null;
function toolDefinitions(): Anthropic.Beta.BetaToolUnion[] {
  if (toolDefs) return toolDefs;
  const custom = (Object.keys(TOOLS) as ToolName[]).map((name): Anthropic.Beta.BetaTool => {
    const { $schema: _drop, ...schema } = z.toJSONSchema(TOOLS[name].schema) as Record<string, unknown>;
    return {
      name,
      description: TOOLS[name].description,
      input_schema: schema as Anthropic.Beta.BetaTool["input_schema"],
      eager_input_streaming: true,
    };
  });
  const domains = searchDomains();
  toolDefs = [...custom, { type: "web_search_20260209", name: "web_search", max_uses: 4, ...(domains ? { allowed_domains: domains } : {}) }];
  return toolDefs;
}

// El prompt de sistema. Es FIJO: nada de fecha, perfil ni datos que cambien. Va al principio de cada
// petición, así que cualquier cambio aquí invalida la caché de todo lo que viene detrás y, en los
// modelos actuales, los bloques de razonamiento ya guardados (van ligados al prompt con el que nacieron).
const INSTRUCTIONS = `Eres el bróker hipotecario e inmobiliario personal del usuario: alguien que quiere comprar vivienda en España. Trabajas para él, no para un banco ni una agencia. Tu trabajo:

1. Conocer su situación financiera y mantenerla al día.
2. Decirle con números cuánto puede comprar y qué le limita.
3. Evaluar los anuncios que te pega (texto o capturas de Idealista u otro portal): si puede comprarlo, coste real, alertas y qué preguntar.
4. Guardar las viviendas que le interesan, seguirlas (estado, notas, cambios de precio) y compararlas.
5. Orientarle con la hipoteca: tipos, bancos, bonificaciones, y los pasos de la compra.

## Cómo trabajas
- Todos los números salen de las herramientas (mismo motor que el resto de la aplicación). No calcules cuotas, impuestos ni presupuestos de cabeza.
- Cuando el usuario te cuente algo de su situación (ahorros, sueldo, contrato, deudas, pareja, zonas, plazos), llama a update_profile en ese momento, con su frase en 'note'. Si corrige un dato, actualízalo. Si dice cuánto cambian sus ahorros («réstale 20.000», «he gastado 3.000»), pasa ese cambio en savingsChange: el total se calcula en la herramienta. Después dile en una frase cómo cambia su presupuesto y, si tiene viviendas guardadas, cuáles cambian de veredicto.
- Pregunta el sueldo como neto por nómina y número de pagas (12 o 14), no por semanas ni en bruto. Si te lo da en bruto o anual, no lo conviertas tú ni lo guardes: pregunta el neto. update_profile rechaza esos casos y te dice qué preguntar; si devuelve 'avisos', atiéndelos.
- Puedes pedir varias herramientas en el mismo paso. Las que guardan datos se ejecutan primero y las de cálculo después, así que un anuncio evaluado en el mismo paso que un cambio de perfil ya usa el perfil nuevo.
- Cuando pegue un anuncio: evaluate_listing con todos los datos que veas (pasa la descripción completa en 'description' para que salten las alertas). Responde con: veredicto en una línea, coste real (ahorros necesarios, cuota, gastos al mes), las alertas que importen, lo que falta en el anuncio, y 2-4 preguntas para el vendedor o la agencia. Antes de guardar pregunta siempre si quiere guardarla; solo si ya lo ha pedido en ese mensaje, save_home directamente.
- Si el anuncio no dice algo (comunidad, IBI, planta, ascensor), no lo inventes: omítelo y señálalo como pregunta pendiente.
- No puedes abrir enlaces. Si te manda solo la URL de un anuncio (Idealista u otro portal), sin su texto ni una captura, no has visto esa vivienda: dilo claramente, no inventes ni supongas precio, metros ni ningún dato, y no digas que la has analizado ni guardado. Pídele que pegue el texto del anuncio (Ctrl+A y Ctrl+C en la página) o una captura. Ofrécele guardar mientras tanto el enlace en «Mis viviendas» como vivienda que le interesa y, solo cuando acepte, llama a save_home_link. Si después pega el anuncio, pasa ese mismo enlace en 'url' para que la vivienda guardada se complete en vez de duplicarse.
- No tienes acceso a buscar anuncios en portales: el usuario los busca y te los pega. Si te pide buscar, díselo y ofrécele qué filtros poner en Idealista según su presupuesto.
- Cuando te pase ofertas de hipoteca que le han dado los bancos (texto, captura, FEIN o FIPRE), guarda cada una con save_bank_offer y compáralas con compare_bank_offers. Para cada vinculación necesitas su rebaja en puntos y lo que cuesta al año: si falta el precio de un seguro, pregúntalo, porque decide si compensa. Recomienda por el coste total, no por el TIN, y dile qué vinculaciones no contratar. Distingue estas ofertas de las de mercado (mortgage_offers).
- Para saber si un precio por m² es razonable puedes buscar en la web informes de precios por zona (la búsqueda está limitada a portales inmobiliarios y fuentes oficiales); cita la fuente y la fecha, y dilo como orientación. Si no encuentras nada fiable, dilo en vez de estimar.
- Los impuestos y las reducciones para jóvenes tienen requisitos (renta, edad, valor máximo, empadronamiento); cuando cambien mucho el resultado, menciónalo. Las ofertas de bancos son punto de partida para negociar, no ofertas en firme.

## Contexto y memoria
- Recibirás mensajes de sistema con un bloque <contexto_actual>: es la foto del perfil, las viviendas guardadas, tus notas y la fecha en ese momento. Vale el más reciente; si después una herramienta devuelve datos más nuevos, valen los de la herramienta.
- Tus notas son tu memoria entre conversaciones. Cuando el usuario tome una decisión, descarte algo por un motivo, o te cuente lo que le ha dicho un banco o una agencia, apúntalo con save_note (una idea por nota, con el motivo). No apuntes ahí datos financieros (van a update_profile) ni lo que ya queda en las notas de una vivienda guardada. Si una nota deja de ser cierta, bórrala con remove_note.
- Si el contexto o una herramienta avisan de que los datos de hipotecas son antiguos, díselo al usuario antes de dar tipos.

## Saludo
Si el usuario solo saluda («hola», «buenas»), preséntate en una o dos frases como un agente de IA especializado en compra de vivienda e hipotecas en España y pregúntale en qué puedes ayudarle, con dos o tres ejemplos de lo que haces. No empieces la entrevista hasta que diga qué quiere o pida empezar. Si ya le conoces, salúdale como a alguien conocido y menciona brevemente lo que tienes guardado.

## Entrevista
Si el perfil no está guardado o faltan datos clave, entrevístale como lo haría un bróker: una o dos preguntas cada vez, en orden de impacto (ahorros, sueldo neto y pagas, contrato y antigüedad, deudas, si compra solo o acompañado, comunidad autónoma, zonas, plazo). En cuanto tengas ahorros e ingresos, dale una primera cifra de presupuesto y sigue con lo demás. No le hagas un formulario de diez preguntas seguidas. Si te pega un anuncio antes de la entrevista, evalúalo igualmente y avisa de que el análisis usa datos de ejemplo hasta que te dé los suyos.

## Estilo
Responde en el idioma del usuario, directo y con cifras concretas en euros. Markdown sencillo: negritas y listas cortas, sin tablas. Las viviendas que evalúas o guardas aparecen como tarjetas debajo de tu respuesta: no repitas todos sus datos, comenta lo que importa.`;

const CONTEXT_OPEN = "<contexto_actual>";

/**
 * Foto del contexto del usuario para el modelo. Se guarda en el historial como mensaje 'system' al
 * empezar un turno, y solo si ha cambiado respecto a la última foto (ver runClaude).
 */
export async function contextSnapshot(now = new Date()): Promise<string> {
  const { profile: p, extra, known } = await store.getProfile();
  const missing = missingKeyFacts(await store.givenFields()).map((f) => f.ask);
  const homes = await store.listHomes();
  const notes = await store.listNotes(12);
  const rates = loadRates();
  const stale = ratesWarning(rates, now);
  const lines = [
    CONTEXT_OPEN,
    `Fecha de hoy: ${now.toISOString().slice(0, 10)}. Datos de hipotecas de la aplicación: ${rates.updated} (euríbor medio de ${rates.euribor.month}: ${rates.euribor.monthlyAvg} %).`,
    ...(stale ? [stale] : []),
    known
      ? `Perfil guardado: ${p.age} años; ingresos netos del hogar ${p.netIncome} €/mes; deudas ${p.monthlyDebts} €/mes; ahorros ${p.savings} €; ${ccaaName(p.ccaa)}; ${p.firstHome ? "primera vivienda" : "no es primera vivienda"}; simulando ${p.ltvPct} % de financiación al ${p.ratePct} % a ${p.years} años. Datos de bróker: ${JSON.stringify(extra)}.`
      : "Perfil: AÚN NO GUARDADO. Empieza por la entrevista.",
    missing.length ? `Datos clave que aún no te ha dado: ${missing.join("; ")}.` : "Tienes todos los datos clave.",
    `Viviendas guardadas: ${homes.length}${homes.length ? ` (${homes.map((h) => `${h.listing.title}, ${isLinkOnly(h.listing) ? "solo el enlace, sin datos" : `${h.listing.price} €`}, ${h.status}`).join(" | ")})` : ""}.`,
    notes.length ? `Tus notas de otras conversaciones (id · fecha · nota):\n${notes.map((n) => `- ${n.id} · ${n.at.slice(0, 10)} · ${n.text}`).join("\n")}` : "Aún no has apuntado notas.",
    "</contexto_actual>",
  ];
  return lines.join("\n");
}

/** Aviso al modelo cuando agota los pasos: cierra con lo que tiene en vez de dejar al usuario con un error. */
const WRAP_UP =
  "Has llegado al límite de pasos de este turno y ya no puedes usar más herramientas. Responde ahora al usuario con lo que tienes: qué has hecho, qué has averiguado y qué queda pendiente.";

/** Lo que se añade (como turno del usuario) cuando una respuesta se corta por longitud. No se pinta en el chat. */
export const CONTINUE = "Continúa exactamente donde te has cortado, sin repetir lo anterior.";

const isToolUse = (b: Block): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use";
const blocksOf = (m: Msg): Block[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content);

/** Los mensajes 'system' en mitad de la conversación no existen en Claude Sonnet 5 ni en modelos anteriores a Opus 4.8. */
const SYSTEM_ROLE = /fable|mythos|opus-(4-8|5)|sonnet-5-5|haiku-5-5/.test(MODEL);

/**
 * El historial guardado, tal y como se envía a la API. Es una función pura del historial: la misma
 * entrada da siempre los mismos mensajes, que es lo que necesitan la caché y los bloques de razonamiento.
 *
 * Única diferencia con lo guardado: un mensaje 'system' al que no siguió ninguna respuesta (el turno
 * se cortó o falló justo después de añadirlo) no se envía. La API exige que a un mensaje 'system' le
 * siga un turno del asistente, y como ninguna respuesta llegó a generarse con él, omitirlo no cambia
 * nada de lo que el modelo ya vio. El historial de la base de datos no se toca.
 */
export function apiMessages(history: Msg[], systemRole = SYSTEM_ROLE): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  history.forEach((m, i) => {
    if (m.role !== "system") return void out.push(m);
    const next = history[i + 1];
    if (next && next.role !== "assistant") return;
    // en un modelo sin mensajes 'system' intermedios, el mismo texto va como turno del usuario
    out.push(systemRole ? m : { role: "user", content: [{ type: "text", text: `<system-reminder>\n${m.content}\n</system-reminder>` }] });
  });
  return out;
}

/** La última foto de contexto que el modelo tiene delante (null si no hay ninguna). */
export function lastContext(history: Msg[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "system" || !m.content.startsWith(CONTEXT_OPEN)) continue;
    const next = history[i + 1];
    if (!next || next.role === "assistant") return m.content;
  }
  return null;
}

/**
 * La petición a la API para un historial dado. Está separada del bucle para poder comprobar en los
 * tests, sin llamar al modelo, que el principio de la petición no cambia de un paso a otro.
 */
export function buildRequest(history: Msg[], opts: { noTools?: boolean } = {}): Request {
  return {
    model: MODEL,
    max_tokens: 32000,
    // Punto de caché 1: herramientas + prompt de sistema (lo que comparten todas las conversaciones).
    system: [{ type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
    tools: toolDefinitions(),
    // En el cierre por límite de pasos las herramientas siguen declaradas (quitarlas cambiaría el
    // principio de la petición); simplemente no se pueden usar.
    ...(opts.noTools ? { tool_choice: { type: "none" as const } } : {}),
    messages: apiMessages(history),
    // Punto de caché 2 (automático): el último bloque del historial. El paso siguiente del bucle, y el
    // turno siguiente si llega en menos de 5 minutos, leen de caché todo lo anterior a un 5 % del precio.
    cache_control: { type: "ephemeral" },
    // Si un bloque de razonamiento guardado ya no encaja con el principio de la conversación (se generó
    // con un prompt o unas herramientas anteriores a un cambio de código), la API lo descarta y sigue,
    // en vez de rechazar la petición con un error 400.
    thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: "medium" },
    // Conversaciones largas: cuando la entrada pasa de 40.000 tokens, la API deja fuera los resultados
    // de herramientas antiguos (conserva los 6 últimos) antes de que el modelo los lea. Ocurre en el
    // servidor de Anthropic: el historial guardado aquí no se toca. Solo actúa si libera al menos
    // 8.000 tokens, porque cada limpieza obliga a reescribir la caché desde ese punto.
    context_management: {
      edits: [
        {
          type: "clear_tool_uses_20250919",
          trigger: { type: "input_tokens", value: 40_000 },
          keep: { type: "tool_uses", value: 6 },
          clear_at_least: { type: "input_tokens", value: 8_000 },
        },
      ],
    },
    betas: [
      // Si un clasificador de seguridad rechaza la petición, la API la reintenta con otro modelo.
      "server-side-fallback-2026-07-01",
      "context-management-2025-06-27",
      "thinking-binding-controls-2026-08-01",
    ],
    fallbacks: "default",
  };
}

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

export interface AgentHooks {
  /** consumo de cada petición a la API (lo usa scripts/eval-claude.ts para comprobar la caché) */
  onUsage?: (usage: Anthropic.Beta.BetaUsage) => void;
}

/** Un turno del agente con el mejor cerebro disponible: Claude, modelo local o solo el enrutador. */
export async function runAgent(conversationId: string, turn: UserTurn, emit: (e: ChatEvent) => void, signal: AbortSignal, hooks: AgentHooks = {}): Promise<void> {
  const provider = await resolveProvider();
  const repair = danglingToolResults(await store.getMessages(conversationId));
  if (repair) await store.appendMessage(conversationId, repair);
  if (provider.kind === "anthropic") return runClaude(conversationId, turn, emit, signal, hooks);
  return runLocal(provider, conversationId, turn, emit, signal);
}

/** BROKER_LOG_USAGE=1 escribe en la consola el consumo de cada paso: es la forma de ver si la caché funciona. */
function logUsage(step: number, message: Anthropic.Beta.BetaMessage): void {
  if (process.env.BROKER_LOG_USAGE !== "1") return;
  const u = message.usage;
  const cleared = message.context_management?.applied_edits.length ? " · resultados antiguos retirados del contexto" : "";
  const dropped = message.input_transformations?.length ? ` · ${message.input_transformations.length} bloques de razonamiento descartados` : "";
  console.log(
    `[claude] paso ${step + 1}: entrada sin caché ${u.input_tokens} · leída de caché ${u.cache_read_input_tokens ?? 0} · escrita en caché ${u.cache_creation_input_tokens ?? 0} · salida ${u.output_tokens}${cleared}${dropped}`,
  );
}

async function runClaude(conversationId: string, turn: UserTurn, emit: (e: ChatEvent) => void, signal: AbortSignal, hooks: AgentHooks): Promise<void> {
  const client = new Anthropic();
  const ctx = await makeContext("chat", conversationId, (e) => emit(e));

  // `history` es siempre igual a lo guardado: todo lo que se envía a la API se guarda antes.
  const history = await store.getMessages(conversationId);
  const add = async (m: Msg) => {
    await store.appendMessage(conversationId, m);
    history.push(m);
  };

  await add({
    role: "user",
    content: [
      ...(turn.images ?? []).map((img): Block => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
      { type: "text", text: turn.text },
    ],
  });

  // Contexto: una vez por turno, detrás del mensaje del usuario, y solo si algo ha cambiado (un dato
  // del perfil, una vivienda, una nota, el día). Dentro del turno no se repite: lo que cambien las
  // herramientas ya le llega al modelo en sus resultados.
  const snapshot = await contextSnapshot();
  if (snapshot !== lastContext(history)) await add({ role: "system", content: snapshot });

  let continued = false;
  for (let step = 0; step <= MAX_STEPS; step++) {
    // Paso extra tras agotar el límite: un cierre sin herramientas.
    const wrapUp = step === MAX_STEPS;
    if (wrapUp) await add({ role: "system", content: WRAP_UP });

    const stream = client.beta.messages.stream(buildRequest(history, { noTools: wrapUp }), { signal });
    stream.on("text", (text) => emit({ type: "text", text }));
    const message = await stream.finalMessage();
    hooks.onUsage?.(message.usage);
    logUsage(step, message);

    if (message.stop_reason === "refusal") {
      emit({ type: "error", message: "El modelo ha rechazado esta petición. Prueba a reformularla." });
      return;
    }
    if (message.stop_reason === "max_tokens") {
      // Respuesta cortada por longitud. Antes se perdía (el usuario veía el texto, pero no se guardaba).
      // Ahora se guarda lo escrito hasta el último texto y se le pide que siga, una sola vez por turno.
      // Las llamadas a herramientas a medias se descartan: sus parámetros pueden estar incompletos.
      const lastText = message.content.findLastIndex((b) => b.type === "text" && b.text.trim() !== "");
      if (continued || wrapUp || lastText < 0) {
        emit({ type: "error", message: "La respuesta se ha cortado por longitud. Pídeme que continúe." });
        return;
      }
      await add({ role: "assistant", content: (message.content.slice(0, lastText + 1) as Block[]).filter((b) => !isToolUse(b)) });
      await add({ role: "user", content: [{ type: "text", text: CONTINUE }] });
      continued = true;
      continue;
    }

    // El contenido se guarda tal cual (incluidos los bloques de razonamiento): el historial solo crece.
    await add({ role: "assistant", content: message.content as Block[] });
    if (message.stop_reason === "pause_turn") continue;

    for (const b of message.content) if (b.type === "server_tool_use") emit({ type: "tool", name: b.name });
    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0 || wrapUp) return;

    // Primero las herramientas que guardan datos (en orden), luego las que solo calculan (en paralelo).
    // Todos los resultados vuelven en un único mensaje, en el orden en que el modelo las pidió.
    const outcomes = await runToolCalls(calls, ctx, (name) => emit({ type: "tool", name }));
    await add({
      role: "user",
      content: outcomes.map(
        (o): Anthropic.Beta.BetaToolResultBlockParam =>
          o.ok ? { type: "tool_result", tool_use_id: o.id, content: JSON.stringify(o.output) } : { type: "tool_result", tool_use_id: o.id, is_error: true, content: String(o.output) },
      ),
    });
  }
}

/** Historial para pintar: agrupa los pasos de cada respuesta y saca las tarjetas de viviendas. */
export function toDisplay(history: Msg[]): DisplayMsg[] {
  const out: DisplayMsg[] = [];
  let current: DisplayMsg | null = null;
  for (const m of history) {
    // contexto y avisos del servidor al modelo: no son parte de lo que se ve en el chat
    if (m.role === "system") continue;
    const blocks = blocksOf(m);
    if (m.role === "user") {
      if (blocks.every((b) => b.type === "tool_result")) continue;
      // «continúa» automático tras un corte por longitud: la respuesta sigue siendo la misma burbuja
      if (blocks.length === 1 && blocks[0].type === "text" && blocks[0].text === CONTINUE) continue;
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
        if (b.name === "save_home_link") {
          const url = (b.input as { url?: unknown }).url;
          if (typeof url === "string") current.homes.push({ listing: linkListing(url), savedId: "guardada" });
        } else if (b.name === "evaluate_listing" || b.name === "save_home") {
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
