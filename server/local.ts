// El agente sin Claude: un enrutador determinista hace el trabajo de bróker (leer el anuncio, apuntar
// datos, calcular, guardar, comparar) y el modelo local, si lo hay, solo conversa. Un modelo de 2B en
// un portátil no rellena bien los parámetros de las herramientas, así que no se le pide.
import { randomUUID } from "node:crypto";
import { missingKeyFacts, toHomeListing, type ListingInput } from "../shared/broker.ts";
import type { ChatEvent } from "../shared/chat.ts";
import { extractAnswer, extractFacts, looksLikeListing, norm, numbersIn, parseListingText, parseNumberEs } from "../shared/extract.ts";
import { ollama, type ProviderInfo } from "./provider.ts";
import * as store from "./store.ts";
import { GLOSSARY, budgetLine, eur, factsSummary, homesSummary, listingSummary, offersSummary } from "./summaries.ts";
import { makeContext, runTool, type ToolContext } from "./tools.ts";

type Msg = store.StoredMessage;

const WANTS_SAVE = /\b(guarda(la|lo|r|me)?|guardala|apunta(la|r)?|anade(la)?|me la quedo|quiero (visitarla|seguirla))\b/;
const ASKS_BUDGET = /cuanto puedo|presupuesto|permitir|hasta cuanto|precio maximo|que puedo comprar/;
const ASKS_HOMES = /compara|mis viviendas|mis pisos|guardad[ao]s|cual (es|me) (la )?(mejor|conviene)/;
const ASKS_OFFERS = /(hipoteca|banco|fija|variable|mixta|tipo de interes).*(mejor|convien|oferta|compar|barat|cual)|(mejor|convien|oferta|compar|barat|cual|que).*(hipoteca|banco)/;
const GREETING = /^(hola|buenas|buenos dias|hey|ey|empez|empecemos)|primera (casa|vivienda)|quiero comprar|hazme las preguntas/;
const ASKS_PRICE = /(puedo comprar|me llega|me alcanza|podria comprar|permitirme).*?(\d{1,3}(?:\.\d{3})+|\d{5,8})|(\d{1,3}(?:\.\d{3})+|\d{5,8})\s*(?:€|euros?).*(puedo|llega|alcanza)/;

const HELP = `Esto lo hago al momento, sin esperas:
- **Evaluar un anuncio:** pega el texto del anuncio de Idealista y te digo si te encaja, el coste real y las alertas.
- **Apuntar tu situación:** dime tus ahorros, tu sueldo neto y pagas, contrato, deudas… y recalculo todo.
- **Tu presupuesto:** pregúntame cuánto puedes permitirte.
- **Tus viviendas:** di «guárdala» tras un anuncio, o «compara mis viviendas».
- **Hipotecas:** pregúntame qué hipoteca te conviene.`;

function textOf(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  return m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

/** El último anuncio evaluado o guardado en la conversación (para «guárdala»). */
function lastListing(history: Msg[]): ListingInput | null {
  for (const m of [...history].reverse()) {
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    for (const b of [...m.content].reverse()) {
      if (b.type === "tool_use" && (b.name === "evaluate_listing" || b.name === "save_home")) {
        const { status: _s, notes: _n, ...listing } = b.input as Record<string, unknown>;
        return listing as unknown as ListingInput;
      }
    }
  }
  return null;
}

/** Respuesta del modelo local a una pregunta libre, con el contexto del usuario y un glosario. */
async function localAnswer(model: string, history: Msg[], ctx: ToolContext, onText: (t: string) => void, signal: AbortSignal): Promise<string> {
  const homes = await store.listHomes();
  const missing = missingKeyFacts(await store.givenFields());
  const context = [
    ctx.me.known ? budgetLine(ctx.me.profile).replace(/\*\*/g, "") : "El usuario aún no ha dado sus datos financieros.",
    ctx.me.known ? `Ahorros ${eur(ctx.me.profile.savings)}; ingresos netos ${eur(ctx.me.profile.netIncome)}/mes; deudas ${eur(ctx.me.profile.monthlyDebts)}/mes.` : "",
    homes.length ? `Viviendas guardadas: ${homes.map((h) => `${h.listing.title} (${eur(h.listing.price)})`).join("; ")}.` : "No tiene viviendas guardadas.",
    missing.length ? `Datos que aún no ha dado: ${missing.map((m) => m.label.toLowerCase()).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const system = `Eres un bróker hipotecario en España que ayuda a una persona a comprar vivienda. Responde en español, claro y breve (máximo 6 frases o una lista corta).
Reglas:
- No inventes cifras en euros ni porcentajes concretos. Usa solo las del CONTEXTO y el GLOSARIO; si hace falta un cálculo, di al usuario que te pida «cuánto puedo permitirme» o que pegue el anuncio.
- No puedes buscar anuncios ni ver páginas web. El usuario pega el texto del anuncio.
- Si no sabes algo, dilo.

GLOSARIO
${GLOSSARY}

CONTEXTO
${context}`;

  const recent = history
    .map((m) => ({ role: m.role, content: textOf(m).slice(0, 700) }))
    .filter((m) => m.content)
    .slice(-6);

  const stream = await ollama.chat({
    model,
    messages: [{ role: "system", content: system }, ...recent],
    stream: true,
    think: false,
    keep_alive: "30m",
    options: { num_ctx: 4096, temperature: 0.3, num_predict: 450 },
  });
  const onAbort = () => stream.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  let out = "";
  try {
    for await (const part of stream) {
      const t = part.message?.content ?? "";
      if (!t) continue;
      out += t;
      onText(t);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  // cifras en euros que no salen del contexto: se avisa, porque un modelo pequeño se equivoca con los números
  const known = new Set(numbersIn(`${context} ${recent.map((r) => r.content).join(" ")}`));
  const invented = [...norm(out).matchAll(/(\d{1,3}(?:\.\d{3})+|\d{4,8})\s*(?:€|euros?)/g)].some((m) => !known.has(parseNumberEs(m[1])));
  if (invented) {
    const note = "\n\n_Comprueba esas cifras: el modelo local puede equivocarse con los números. Las fiables son las de las tarjetas y el panel._";
    out += note;
    onText(note);
  }
  return out;
}

export async function runLocal(
  provider: ProviderInfo,
  conversationId: string,
  turn: { text: string; images?: unknown[] },
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const ctx = await makeContext("chat", conversationId, (e) => emit(e));
  const history = await store.getMessages(conversationId);
  const text = turn.text.trim();
  const t = norm(text);
  const interviewStarted = history.some((m) => m.role === "assistant");
  const pending = missingKeyFacts(await store.givenFields())[0]?.key;

  const userMsg: Msg = { role: "user", content: [{ type: "text", text }] };
  await store.appendMessage(conversationId, userMsg);
  history.push(userMsg);

  let reply = "";
  const say = (chunk: string) => {
    if (!chunk) return;
    const piece = reply ? `\n\n${chunk}` : chunk;
    reply += piece;
    emit({ type: "text", text: piece });
  };

  /** Llamada a una herramienta hecha por el enrutador; queda en el historial igual que las de Claude. */
  const call = async (name: string, input: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    const id = `local_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    emit({ type: "tool", name });
    await store.appendMessage(conversationId, { role: "assistant", content: [{ type: "tool_use", id, name, input }] });
    let output: unknown;
    let failed = false;
    try {
      output = await runTool(name, input, ctx);
    } catch (err) {
      failed = true;
      output = err instanceof Error ? err.message : String(err);
    }
    await store.appendMessage(conversationId, {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, is_error: failed || undefined, content: typeof output === "string" ? output : JSON.stringify(output) }],
    });
    if (failed) say(`No he podido hacerlo: ${output}`);
    return failed ? null : (output as Record<string, unknown>);
  };

  if (turn.images?.length) {
    say("Sin Claude no puedo leer capturas. Abre el anuncio, selecciona todo el texto de la página (Ctrl+A), cópialo y pégalo aquí: con eso me basta.");
  }

  let handled = Boolean(turn.images?.length && !text);
  let factsTurn = false;

  if (!handled && looksLikeListing(text)) {
    const listing = parseListingText(text)!;
    if (await call("evaluate_listing", listing as unknown as Record<string, unknown>)) {
      say(listingSummary(ctx.me, toHomeListing(listing)));
      if (WANTS_SAVE.test(t)) {
        const saved = await call("save_home", listing as unknown as Record<string, unknown>);
        if (saved) say(`Guardada. Tienes ${saved.total_guardadas} en seguimiento.`);
      } else say("¿La guardo para seguirla? Dime «guárdala» o pulsa **Guardar** en la tarjeta.");
    }
    handled = true;
  } else if (!handled && WANTS_SAVE.test(t) && text.length < 120) {
    const listing = lastListing(history);
    if (listing) {
      const saved = await call("save_home", listing as unknown as Record<string, unknown>);
      if (saved) {
        say(
          saved.nueva
            ? `Guardada: **${listing.title}**. Tienes ${saved.total_guardadas} en seguimiento; en «Mis viviendas» puedes cambiar su estado y añadir notas.`
            : `Ya la tenías: la he actualizado${saved.precio_anterior ? ` (antes costaba ${eur(saved.precio_anterior as number)})` : ""}.`,
        );
      }
    } else say("Aún no hemos visto ningún anuncio en esta conversación. Pégame el texto del anuncio y la guardo.");
    handled = true;
  }

  if (!handled) {
    const facts = extractFacts(text);
    if (pending && interviewStarted && !facts.doubts.length) {
      const answer = extractAnswer(pending, text);
      facts.profile = { ...answer.profile, ...facts.profile };
      facts.extra = { ...answer.extra, ...facts.extra };
    }
    const fields = { ...facts.profile, ...facts.extra };
    if (Object.keys(fields).length) {
      const before = ctx.me;
      const out = await call("update_profile", { note: text.slice(0, 500), ...fields });
      if (out) {
        const changed = out.campos_cambiados as string[];
        say(changed.length ? factsSummary(before, { ...ctx.me, changed }, await store.listHomes(), facts.doubts) : `Eso ya lo tenía apuntado. ${budgetLine(ctx.me.profile)}`);
      }
      handled = factsTurn = true;
    } else if (facts.doubts.length) {
      say(facts.doubts.join("\n\n"));
      handled = true;
    }
  }

  if (!handled) {
    const price = t.match(ASKS_PRICE);
    if (price) {
      const value = parseNumberEs(price[2] ?? price[3]);
      await call("analyze_purchase", { price: value });
      say(listingSummary(ctx.me, toHomeListing({ title: "Una vivienda", price: value })).split("\n\n**No lo dice")[0].split("\n\n**Pregunta")[0]);
      handled = true;
    } else if (ASKS_HOMES.test(t)) {
      await call("list_saved_homes", {});
      say(homesSummary(ctx.me, await store.listHomes()));
      handled = true;
    } else if (ASKS_BUDGET.test(t)) {
      await call("max_budget", {});
      say(ctx.me.known ? budgetLine(ctx.me.profile) : "Todavía no puedo darte una cifra fiable: necesito al menos tus ahorros y tu sueldo.");
      handled = true;
    } else if (ASKS_OFFERS.test(t)) {
      const type = (["fija", "variable", "mixta"] as const).filter((k) => t.includes(k));
      const only = type.length === 1 ? type[0] : undefined;
      await call("mortgage_offers", only ? { type: only } : {});
      say(offersSummary(ctx.me, only));
      handled = true;
    } else if (GREETING.test(t) && !ctx.me.known) {
      say("¡Hola! Soy tu bróker. Te ayudo a saber cuánto puedes comprar, a revisar los anuncios que encuentres y a elegir hipoteca. Para empezar necesito conocer tu situación; son unas pocas preguntas.");
      handled = factsTurn = true;
    }
  }

  if (!handled && provider.kind === "ollama" && provider.model) {
    try {
      let first = true;
      const answer = await localAnswer(
        provider.model,
        history,
        ctx,
        (chunk) => {
          emit({ type: "text", text: first && reply ? `\n\n${chunk}` : chunk });
          first = false;
        },
        signal,
      );
      reply += (reply ? "\n\n" : "") + answer;
    } catch (err) {
      if (signal.aborted) return;
      console.error("Ollama:", err);
      say(`El modelo local no ha respondido (¿está Ollama arrancado?).\n\n${HELP}`);
    }
  } else if (!handled) {
    say(`Ahora mismo no hay ningún modelo de IA conectado, así que no puedo conversar libremente.${provider.hint ? ` ${provider.hint}` : ""}\n\n${HELP}`);
  }

  // La entrevista la lleva el código: siguiente dato que falta, en orden de impacto.
  const missing = missingKeyFacts(await store.givenFields());
  const essentials = missing.some((m) => m.key === "savings" || m.key === "netIncome");
  if (missing.length && (factsTurn || essentials)) say(missing[0].question);
  else if (factsTurn && !missing.length) say("Con esto ya tengo todo lo importante. Cuando veas un anuncio que te guste, pégamelo y lo revisamos.");

  if (reply.trim()) await store.appendMessage(conversationId, { role: "assistant", content: [{ type: "text", text: reply }] });
}
