// Asistente IA: Claude con herramientas propias (búsqueda de viviendas + cálculo de hipoteca).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Profile } from "../shared/finance.ts";
import { ccaaName } from "../shared/taxes.ts";
import { TOOLS, loadRates, type AnalyzedListing, type ToolContext, type ToolName } from "./tools.ts";
import type { SearchResult } from "../shared/listings.ts";

const MODEL = "claude-opus-5-5";

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "listings"; result: SearchResult; listings: AnalyzedListing[] }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

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

function systemPrompt(profile: Profile): string {
  const rates = loadRates();
  return `Eres el asistente de "Hipoteca Searcher", una aplicación personal para alguien que va a comprar su primera vivienda en España. Le ayudas a entender cuánto puede permitirse, a comparar hipotecas y a encontrar viviendas que encajen.

Su perfil guardado en la aplicación:
- Edad: ${profile.age} años
- Ingresos netos del hogar: ${profile.netIncome} €/mes; otras deudas: ${profile.monthlyDebts} €/mes
- Ahorros: ${profile.savings} €
- Comunidad autónoma: ${ccaaName(profile.ccaa)}; ${profile.firstHome ? "primera vivienda habitual" : "no es primera vivienda"}; ${profile.newBuild ? "obra nueva" : "segunda mano"}
- Hipoteca que está simulando: ${profile.ltvPct} % de financiación, ${profile.ratePct} % TIN, ${profile.years} años, endeudamiento máximo ${profile.debtRatioPct} %

Los datos de hipotecas de la aplicación se actualizaron el ${rates.updated} (euríbor medio de ${rates.euribor.month}: ${rates.euribor.monthlyAvg} %).

Haz los números siempre con las herramientas en lugar de calcularlos de cabeza: así coinciden con lo que la persona ve en el resto de la aplicación. Las viviendas que devuelve search_homes se muestran automáticamente como tarjetas debajo de tu respuesta, así que no hace falta que las repitas una a una: comenta cuáles destacan y por qué. Si la búsqueda devuelve viviendas de ejemplo, dilo con claridad, porque no son anuncios reales.

Los impuestos y los tipos reducidos para jóvenes son orientativos y tienen requisitos (renta, empadronamiento, valor máximo); cuando un tipo reducido cambie mucho el resultado, menciónalo. Las ofertas de los bancos cambian cada mes y la oferta real depende del perfil: preséntalas como punto de partida para negociar, no como una oferta en firme. Puedes buscar en la web si te preguntan por algo más reciente que los datos de la aplicación.

Responde en el idioma en que te escriban, con cifras concretas en euros y sin rodeos. Usa Markdown sencillo (negritas y listas cortas); evita las tablas.`;
}

export async function runAgent(history: ChatTurn[], profile: Profile, emit: (e: AgentEvent) => void, signal: AbortSignal): Promise<void> {
  const client = new Anthropic();
  const ctx: ToolContext = {
    profile,
    onListings: (result, listings) => emit({ type: "listings", result, listings }),
  };
  const tools = toolDefinitions();
  const messages: Anthropic.Beta.BetaMessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));

  for (let step = 0; step < 12; step++) {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 16000,
        system: systemPrompt(profile),
        tools,
        messages,
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

    messages.push({ role: "assistant", content: message.content });
    if (message.stop_reason === "pause_turn") continue;

    const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return;

    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        emit({ type: "tool", name: call.name, input: call.input });
        const tool = TOOLS[call.name as ToolName];
        if (!tool) return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Herramienta desconocida: ${call.name}` };
        const parsed = tool.schema.safeParse(call.input);
        if (!parsed.success) {
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: `Parámetros no válidos: ${parsed.error.message}` };
        }
        try {
          const output = await (tool.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(output) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: call.id, is_error: true, content: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  emit({ type: "error", message: "He hecho demasiados pasos sin terminar. Prueba con una pregunta más concreta." });
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "La clave ANTHROPIC_API_KEY no es válida. Revísala en el archivo .env.";
  if (err instanceof Anthropic.RateLimitError) return "Límite de peticiones de la API de Claude alcanzado. Espera un momento y vuelve a intentarlo.";
  if (err instanceof Anthropic.APIConnectionError) return "No he podido conectar con la API de Claude. Comprueba tu conexión.";
  if (err instanceof Anthropic.APIError) return `Error de la API de Claude (${err.status ?? "?"}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
