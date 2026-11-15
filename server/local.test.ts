// El bróker sin ningún modelo: la entrevista, la evaluación de anuncios y el guardado funcionan igual.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ChatEvent } from "../shared/chat.ts";
import { toDisplay } from "./agent.ts";
import { openDb, setDb, type Db } from "./db.ts";
import { runLocal } from "./local.ts";
import type { ProviderInfo } from "./provider.ts";
import * as store from "./store.ts";

const NONE: ProviderInfo = { kind: "none", model: null, label: "Sin IA", vision: false, hint: "Instala Ollama." };

let db: Db;
let conversation: string;
before(async () => {
  db = await openDb("memory://");
  setDb(db);
  conversation = await store.createConversation("test");
});
after(() => db.close());

async function say(text: string, images?: unknown[]) {
  const events: ChatEvent[] = [];
  await runLocal(NONE, conversation, { text, images }, (e) => events.push(e), new AbortController().signal);
  return {
    events,
    text: events.map((e) => (e.type === "text" ? e.text : "")).join(""),
    tools: events.flatMap((e) => (e.type === "tool" ? [e.name] : [])),
  };
}

const ANUNCIO = `Piso en venta en calle de la Oca, Carabanchel, Madrid
189.000 €
68 m² 2 hab. Planta 3ª exterior sin ascensor
Para reformar. Gastos de comunidad 45 €/mes
https://www.idealista.com/inmueble/101234567/`;

test("saludo: se presenta y hace la primera pregunta", async () => {
  const r = await say("Hola, quiero comprar mi primera casa");
  assert.match(r.text, /Soy tu bróker/);
  assert.match(r.text, /¿Cuánto tienes ahorrado/);
  assert.deepEqual(r.tools, []);
});

test("respuesta corta a la pregunta pendiente: se apunta y pasa a la siguiente", async () => {
  const r = await say("42.000");
  assert.deepEqual(r.tools, ["update_profile"]);
  assert.match(r.text, /ahorros 42\.000 €/);
  assert.match(r.text, /¿Cuánto cobras neto/);
  assert.equal((await store.getProfile()).profile.savings, 42000);
});

test("sueldo por nómina y pagas: calcula el equivalente mensual y el presupuesto", async () => {
  const r = await say("1900 en 14 pagas, indefinido");
  const me = await store.getProfile();
  assert.equal(me.extra.netPay, 1900);
  assert.equal(me.extra.pagas, 14);
  assert.equal(me.profile.netIncome, 2217);
  assert.equal(me.extra.contractType, "indefinido");
  assert.match(r.text, /2\.217 € netos al mes/);
  assert.match(r.text, /presupuesto máximo es \*\*/);
  assert.match(r.text, /¿Pagas alguna deuda/, "contrato ya dado: salta a deudas");
});

test("el sueldo en bruto no se guarda: se pregunta", async () => {
  const r = await say("bueno, en realidad cobro 32.000 brutos al año");
  assert.deepEqual(r.tools, []);
  assert.match(r.text, /neto/);
  assert.equal((await store.getProfile()).extra.netPay, 1900);
});

test("un dato que coincide con el valor por defecto también cuenta como dado", async () => {
  const r = await say("No tengo deudas");
  assert.match(r.text, /sin deudas/);
  assert.match(r.text, /¿Compras solo/, "no vuelve a preguntar por las deudas");
  assert.ok((await store.givenFields()).has("monthlyDebts"));
});

test("anuncio pegado: veredicto, costes, alertas, preguntas y tarjeta", async () => {
  const r = await say(ANUNCIO);
  assert.deepEqual(r.tools, ["evaluate_listing"]);
  assert.match(r.text, /189\.000 €/);
  assert.match(r.text, /2\.779 €\/m²/);
  assert.match(r.text, /Ahorros que necesitas/);
  assert.match(r.text, /Necesita reforma/);
  assert.match(r.text, /Planta 3 sin ascensor/);
  assert.match(r.text, /Pregunta a la agencia/);
  const card = r.events.find((e) => e.type === "home");
  assert.ok(card && card.type === "home" && card.listing.size === 68);
  assert.equal((await store.listHomes()).length, 0);
});

test("«guárdala» guarda el último anuncio de la conversación", async () => {
  const r = await say("Guárdala");
  assert.deepEqual(r.tools, ["save_home"]);
  assert.match(r.text, /Guardada/);
  const [home] = await store.listHomes();
  assert.equal(home.id, "idealista-101234567");
  assert.equal(home.listing.communityFees, 45);
});

test("comparar, presupuesto y ofertas sin modelo", async () => {
  assert.match((await say("compara mis viviendas")).text, /1\*\* vivienda guardada/);
  assert.match((await say("¿Cuánto puedo permitirme?")).text, /presupuesto máximo/);
  const offers = await say("¿Qué hipoteca fija me conviene?");
  assert.deepEqual(offers.tools, ["mortgage_offers"]);
  assert.match(offers.text, /TAE/);
});

test("cambio de situación: recalcula y avisa de las viviendas que cambian", async () => {
  const r = await say("Me he gastado parte, ahora tengo 9.000 euros ahorrados");
  assert.match(r.text, /Antes era/);
  assert.match(r.text, /Cambia en tus viviendas guardadas/);
});

test("capturas sin Claude y preguntas libres sin modelo: explica qué hacer", async () => {
  assert.match((await say("", [{}])).text, /pégalo aquí/);
  const r = await say("¿Qué opinas del mercado?");
  assert.match(r.text, /no hay ningún modelo de IA/);
  assert.match(r.text, /Instala Ollama/);
});

test("el historial queda en el mismo formato que con Claude", async () => {
  const display = toDisplay(await store.getMessages(conversation));
  assert.equal(display[0].role, "user");
  const withCard = display.find((m) => m.homes.length > 0);
  assert.equal(withCard?.homes[0].listing.price, 189000);
  assert.ok(display.every((m) => m.role === "user" || m.text.length > 0));
});

test("solo o acompañado: «estoy soltero» y «no tengo pareja» se entienden; lo que no, se pregunta", async () => {
  // un dato ya conocido hace que vuelva a la entrevista: la pregunta pendiente es la de comprar solo o no
  const asked = await say("Tengo contrato indefinido");
  assert.match(asked.text, /¿Compras solo o con otra persona\?/);
  const unclear = await say("depende de cómo vaya");
  assert.deepEqual(unclear.tools, [], "no guarda nada que no ha entendido");
  assert.match(unclear.text, /No me ha quedado claro/);
  assert.equal((await store.getProfile()).extra.coBuyer, undefined);

  const r = await say("no tengo pareja");
  assert.deepEqual(r.tools, ["update_profile"]);
  assert.equal((await store.getProfile()).extra.coBuyer, false, "«pareja» negada no es comprar en pareja");
  assert.doesNotMatch(r.text, /otra persona/);
});

test("«réstale al ahorro 20 mil»: resta a lo guardado, no guarda 20.000", async () => {
  const before = (await store.getProfile()).profile.savings;
  const r = await say("réstale al ahorro 20 mil euros");
  assert.deepEqual(r.tools, ["update_profile"]);
  assert.equal((await store.getProfile()).profile.savings, before - 20000);
  assert.match(r.text, /pasan de/);
  const back = await say("súmale 20.000 a mis ahorros");
  assert.match(back.text, /pasan de/);
  assert.equal((await store.getProfile()).profile.savings, before);
  // si deja un número negativo, no guarda nada
  const tooMuch = await say(`quita ${before + 1000} € de los ahorros`);
  assert.match(tooMuch.text, /No he podido hacerlo/);
  assert.equal((await store.getProfile()).profile.savings, before);
});

test("«suma 40 mil a los ahorros» y luego «réstale 5 mil»: la segunda también se aplica", async () => {
  const start = (await store.getProfile()).profile.savings;
  await say("suma a los ahorros 40 mil euros");
  assert.equal((await store.getProfile()).profile.savings, start + 40000);
  const r = await say("restale 5 mil euros");
  assert.deepEqual(r.tools, ["update_profile"], "lo guarda el código, no lo contesta el modelo");
  assert.equal((await store.getProfile()).profile.savings, start + 35000);
  const again = await say("pero te he dicho que le restes 5 mil");
  assert.equal((await store.getProfile()).profile.savings, start + 30000);
  assert.match(again.text, /pasan de/);
  // vuelve a como estaba para los tests siguientes
  await say(`tengo ${start} € ahorrados`);
  assert.equal((await store.getProfile()).profile.savings, start);
});

test("una orden de restar sin saber a qué: pregunta, no la pasa al modelo", async () => {
  // lo último que ha cambiado son las deudas, no los ahorros
  await say("No tengo deudas");
  await say("¿qué es el euríbor?");
  const r = await say("réstale 300");
  assert.deepEqual(r.tools, []);
  assert.match(r.text, /¿A qué quieres que se lo sume o reste/);
});

test("si compra acompañado, pregunta el sueldo de la otra persona y lo suma", async () => {
  const before = (await store.getProfile()).profile.netIncome;
  const r = await say("Al final compro con mi pareja");
  assert.match(r.text, /¿Cuánto cobra neto la otra persona/);
  const r2 = await say("1500 en 12");
  const me = await store.getProfile();
  assert.equal(me.extra.coBuyerNetPay, 1500);
  assert.equal(me.profile.netIncome, before + 1500);
  assert.match(r2.text, /sumando los dos sueldos/);
});

test("las preguntas de explicación no se confunden con pedir ofertas o presupuesto", async () => {
  for (const q of ["¿Qué es el euríbor y cómo afecta a una hipoteca variable?", "¿Qué diferencia hay entre hipoteca fija y mixta?", "¿Cómo se calcula el presupuesto máximo?"]) {
    const r = await say(q);
    assert.deepEqual(r.tools, [], q);
    assert.match(r.text, /no hay ningún modelo de IA/, q);
  }
  assert.deepEqual((await say("¿Qué banco me ofrece la mejor hipoteca?")).tools, ["mortgage_offers"]);
});

test("un saludo a secas: se presenta y pregunta en qué ayudar, sin interrogar", async () => {
  const fresh = await openDb("memory://");
  setDb(fresh);
  try {
    const id = await store.createConversation("saludo");
    const run = async (text: string) => {
      const events: ChatEvent[] = [];
      await runLocal(NONE, id, { text }, (e) => events.push(e), new AbortController().signal);
      return events.map((e) => (e.type === "text" ? e.text : "")).join("");
    };
    const hello = await run("Hola!");
    assert.match(hello, /Soy un agente de IA especializado/);
    assert.match(hello, /¿En qué puedo ayudarte\?/);
    assert.doesNotMatch(hello, /¿Cuánto tienes ahorrado/);
    assert.match(await run("buenas tardes"), /agente de IA/);
    // pedir empezar sí arranca la entrevista
    assert.match(await run("empezar"), /¿Cuánto tienes ahorrado/);
  } finally {
    setDb(db);
    await fresh.close();
  }
});

test("saludo cuando ya le conoce", async () => {
  const r = await say("hola");
  assert.match(r.text, /Hola de nuevo/);
  assert.match(r.text, /Tengo guardada tu situación/);
  assert.doesNotMatch(r.text, /\?[^?]*\?/, "una sola pregunta");
});

test("ofertas de bancos en modo local: comparar las apuntadas y guiar al formulario", async () => {
  const empty = await say("compara mis ofertas");
  assert.deepEqual(empty.tools, ["compare_bank_offers"]);
  assert.match(empty.text, /Ofertas de bancos/);

  await store.saveOffer({ bank: "Banco Uno", type: "fija", tinPct: 2.2, bonuses: [{ name: "Seguro de vida", discountPct: 0.25, costPerYear: 1100 }] });
  await store.saveOffer({ bank: "Banco Dos", type: "fija", tinPct: 2.5, bonuses: [{ name: "Nómina", discountPct: 0.2, costPerYear: 0 }] });
  const r = await say("¿Qué oferta elijo de las que me han dado?");
  assert.match(r.text, /2 ofertas/);
  assert.match(r.text, /Seguro de vida: ahorras .* No compensa/);
  assert.match(r.text, /La más barata es \*\*/);

  const pasted = await say("El Santander me ofrece una fija al 2,35% con seguro de vida y nómina");
  assert.deepEqual(pasted.tools, []);
  assert.match(pasted.text, /apúntala en \*\*Ofertas de bancos\*\*/);
});

test("anuncio importado con el marcador: se analiza y se guarda en el mismo turno", async () => {
  const { importMessage } = await import("../shared/importer.ts");
  const msg = importMessage({
    url: "https://www.idealista.com/inmueble/109876543/",
    title: "Piso en venta en calle de Arganzuela, Madrid — idealista",
    text: "Piso en venta en calle de Arganzuela\nArganzuela, Madrid\n245.000 €\n72 m² 2 hab. Planta 4ª exterior con ascensor\nComunidad 60 €/mes",
  });
  const before = (await store.listHomes()).length;
  const r = await say(msg);
  assert.deepEqual(r.tools, ["evaluate_listing", "save_home"]);
  assert.doesNotMatch(r.text, /No puedo abrir enlaces/);
  const homes = await store.listHomes();
  assert.equal(homes.length, before + 1);
  const saved = homes.find((h) => h.listing.url === "https://www.idealista.com/inmueble/109876543/");
  assert.equal(saved?.listing.price, 245000);
});

test("importar dos veces el mismo anuncio: dice que ya estaba y no lo duplica", async () => {
  const { importMessage } = await import("../shared/importer.ts");
  const page = {
    url: "https://www.fotocasa.es/es/comprar/vivienda/madrid-capital/ascensor/176543210/d?from=list",
    title: "Piso en venta en Tetuán, Madrid",
    text: "Piso en venta en Tetuán, Madrid\n230.000 €\n65 m² 2 hab. Planta 1ª exterior",
  };
  await say(importMessage(page));
  const before = (await store.listHomes()).length;
  const r = await say(importMessage({ ...page, url: page.url.replace("?from=list", "?multimedia=image") }));
  assert.match(r.text, /Ya la tenías guardada/);
  assert.equal((await store.listHomes()).length, before);
});
