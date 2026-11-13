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
