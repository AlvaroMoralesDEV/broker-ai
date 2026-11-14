// Evaluación del agente con Claude DE VERDAD: conversaciones guionizadas y comprobaciones sobre qué
// herramientas llama y con qué parámetros.
//
//   npm run eval                 todas
//   npm run eval -- bruto cache  solo los casos cuyo nombre contenga alguna de esas palabras
//
// Por qué existe: `npm test` no llama a ningún modelo, así que un cambio en el prompt o de modelo puede
// romper el comportamiento (guardar un bruto, no pasar la descripción del anuncio…) sin que falle nada.
// Esto es lo que hay que ejecutar después de tocar INSTRUCTIONS, las descripciones de las herramientas
// o ANTHROPIC_MODEL.
//
// Cuesta dinero (unas 15 peticiones al modelo) y necesita ANTHROPIC_API_KEY. Usa una base de datos en
// memoria: no toca tus datos.
import "../server/env.ts";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatEvent } from "../shared/chat.ts";
import { runAgent } from "../server/agent.ts";
import { withUser } from "../server/context.ts";
import { openDb, setDb } from "../server/db.ts";
import { resolveProvider } from "../server/provider.ts";
import * as store from "../server/store.ts";

interface Call {
  name: string;
  input: Record<string, unknown>;
}

interface Turn {
  text: string;
  calls: Call[];
  errors: string[];
  usage: Anthropic.Beta.BetaUsage[];
}

interface Case {
  name: string;
  /** qué se comprueba y por qué importa */
  why: string;
  say: string[];
  /** devuelve la lista de fallos (vacía si todo está bien) */
  check: (turns: Turn[]) => Promise<string[]> | string[];
}

const ANUNCIO = `Piso en venta en calle de la Oca, Carabanchel, Madrid
189.000 €
68 m² 2 hab. Planta 3ª exterior sin ascensor
Para reformar. Derrama aprobada para la fachada. Gastos de comunidad 45 €/mes
https://www.idealista.com/inmueble/101234567/`;

const named = (turn: Turn, name: string) => turn.calls.filter((c) => c.name === name);
const fail = (ok: boolean, message: string) => (ok ? [] : [message]);

const CASES: Case[] = [
  {
    name: "bruto",
    why: "Un sueldo en bruto y anual no se guarda como neto: se pregunta.",
    say: ["Hola, quiero comprar. Cobro 30.000 euros brutos al año."],
    check: async ([t]) => [
      ...fail((await store.getProfile()).extra.netPay == null, `ha guardado un sueldo neto de ${(await store.getProfile()).extra.netPay} €`),
      ...fail(/net[oa]/i.test(t.text) && t.text.includes("?"), "no pregunta por el neto"),
    ],
  },
  {
    name: "perfil",
    why: "Datos claros: se guardan en una sola llamada, con las pagas, y da una primera cifra de presupuesto.",
    say: ["Tengo 42.000 euros ahorrados y cobro 1.900 netos en 14 pagas, con contrato indefinido."],
    check: async ([t]) => {
      const me = await store.getProfile();
      return [
        ...fail(named(t, "update_profile").length >= 1, "no ha llamado a update_profile"),
        ...fail(me.profile.savings === 42000, `ahorros guardados: ${me.profile.savings}`),
        ...fail(me.extra.netPay === 1900 && me.extra.pagas === 14, `sueldo guardado: ${me.extra.netPay} × ${me.extra.pagas}`),
        ...fail(/\d{2,3}\.\d{3}\s*€/.test(t.text), "no da ninguna cifra en euros"),
      ];
    },
  },
  {
    name: "anuncio",
    why: "Un anuncio pegado se evalúa pasando la descripción completa (de ahí salen las alertas) y no se guarda sin pedirlo.",
    say: ["Tengo 42.000 ahorrados y cobro 1.900 netos en 14 pagas.", `¿Qué te parece este?\n\n${ANUNCIO}`],
    check: ([, t]) => {
      const [call] = named(t, "evaluate_listing");
      return [
        ...fail(!!call, "no ha llamado a evaluate_listing"),
        ...fail(call?.input.price === 189000, `precio pasado: ${call?.input.price}`),
        ...fail(/derrama/i.test(String(call?.input.description ?? "")), "no ha pasado la descripción del anuncio"),
        ...fail(named(t, "save_home").length === 0, "la ha guardado sin que se lo pidan"),
        ...fail(/derrama/i.test(t.text), "no menciona la derrama"),
      ];
    },
  },
  {
    name: "orden",
    why: "Cambio de situación y anuncio en el mismo mensaje: el anuncio se evalúa con el sueldo nuevo.",
    say: ["Tengo 42.000 ahorrados y cobro 1.900 netos en 14 pagas.", `Me han subido el sueldo: ahora cobro 2.600 netos en 14 pagas. Con eso, ¿me llega para este?\n\n${ANUNCIO}`],
    check: async ([, t]) => [
      ...fail((await store.getProfile()).extra.netPay === 2600, `sueldo guardado: ${(await store.getProfile()).extra.netPay}`),
      ...fail(named(t, "evaluate_listing").length >= 1, "no ha evaluado el anuncio"),
      ...fail(t.calls.findIndex((c) => c.name === "update_profile") >= 0, "no ha actualizado el perfil"),
    ],
  },
  {
    name: "oferta",
    why: "Una oferta con un seguro sin precio: hay que preguntarlo antes de recomendar, porque decide si compensa.",
    say: ["BBVA me ofrece una fija al 2,45 % a 30 años si domicilio la nómina y contrato su seguro de vida. Sin el seguro sube 0,30 puntos."],
    check: ([t]) => [...fail(/seguro/i.test(t.text) && t.text.includes("?"), "no pregunta cuánto cuesta el seguro")],
  },
  {
    name: "memoria",
    why: "Una decisión con su motivo se apunta como nota y aparece en una conversación nueva.",
    say: ["He descartado los pisos de Vallecas: están demasiado lejos del trabajo de mi pareja, que está en Pozuelo. No me propongas nada por esa zona."],
    check: async ([t]) => [
      ...fail(named(t, "save_note").length >= 1, "no ha llamado a save_note"),
      ...fail((await store.listNotes()).some((n) => /vallecas/i.test(n.text)), "la nota no menciona Vallecas"),
    ],
  },
  {
    name: "cache",
    why: "El segundo turno de una conversación lee de caché el prompt, las herramientas y el turno anterior.",
    say: ["Hola", "¿Qué es el euríbor, en dos frases?"],
    check: ([, t]) => {
      const read = t.usage.reduce((n, u) => n + (u.cache_read_input_tokens ?? 0), 0);
      return fail(read > 0, "el segundo turno no ha leído nada de la caché (cache_read_input_tokens = 0)");
    },
  },
];

async function runCase(c: Case): Promise<{ failures: string[]; turns: Turn[] }> {
  // cada caso es un usuario nuevo: empieza sin perfil y no ve nada de los demás
  const user = await store.createUser(`eval-${c.name}`);
  return withUser(user.id, async () => {
    const conversation = await store.createConversation(c.name);
    const turns: Turn[] = [];
    for (const text of c.say) {
      const turn: Turn = { text: "", calls: [], errors: [], usage: [] };
      const before = (await store.getMessages(conversation)).length;
      const emit = (e: ChatEvent) => {
        if (e.type === "text") turn.text += e.text;
        else if (e.type === "error") turn.errors.push(e.message);
      };
      await runAgent(conversation, { text }, emit, new AbortController().signal, { onUsage: (u) => turn.usage.push(u) });
      // las llamadas se leen del historial guardado: es lo que de verdad se ejecutó
      for (const m of (await store.getMessages(conversation)).slice(before)) {
        if (m.role !== "assistant" || typeof m.content === "string") continue;
        for (const b of m.content) if (b.type === "tool_use") turn.calls.push({ name: b.name, input: b.input as Record<string, unknown> });
      }
      turns.push(turn);
    }
    const failures = [...turns.flatMap((t) => t.errors.map((e) => `error del agente: ${e}`)), ...(await c.check(turns))];
    return { failures, turns };
  });
}

const provider = await resolveProvider();
if (provider.kind !== "anthropic") {
  console.error("Esta evaluación necesita Claude: pon ANTHROPIC_API_KEY en .env (y no fuerces LLM_PROVIDER a ollama o none).");
  process.exit(2);
}
setDb(await openDb("memory://"));

const filters = process.argv.slice(2);
const cases = CASES.filter((c) => !filters.length || filters.some((f) => c.name.includes(f)));
console.log(`Modelo: ${provider.model} · ${cases.length} casos\n`);

let failed = 0;
for (const c of cases) {
  const t0 = Date.now();
  let failures: string[];
  let turns: Turn[] = [];
  try {
    ({ failures, turns } = await runCase(c));
  } catch (err) {
    failures = [`excepción: ${err instanceof Error ? err.message : String(err)}`];
  }
  const usage = turns.flatMap((t) => t.usage);
  const sum = (pick: (u: Anthropic.Beta.BetaUsage) => number | null | undefined) => usage.reduce((n, u) => n + (pick(u) ?? 0), 0);
  console.log(`${failures.length ? "✖" : "✔"} ${c.name} — ${c.why}`);
  console.log(
    `    ${((Date.now() - t0) / 1000).toFixed(1)} s · ${usage.length} peticiones · entrada ${sum((u) => u.input_tokens)} · caché leída ${sum((u) => u.cache_read_input_tokens)} · caché escrita ${sum((u) => u.cache_creation_input_tokens)} · salida ${sum((u) => u.output_tokens)}`,
  );
  console.log(`    herramientas: ${turns.map((t) => t.calls.map((x) => x.name).join(", ") || "-").join("  |  ")}`);
  for (const f of failures) console.log(`    · ${f}`);
  if (failures.length) {
    failed++;
    console.log(`    última respuesta: ${turns.at(-1)?.text.slice(0, 300).replace(/\n/g, " ") ?? "(ninguna)"}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} casos correctos`);
process.exit(failed ? 1 : 0);
