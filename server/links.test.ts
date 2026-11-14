// Un enlace sin el anuncio: el bróker dice que no puede abrirlo, pregunta antes de guardarlo y lo
// guarda como vivienda «solo enlace», que se completa cuando llega el texto del anuncio.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isLinkOnly, linkIn, linkListing } from "../shared/broker.ts";
import type { ChatEvent } from "../shared/chat.ts";
import { toDisplay } from "./agent.ts";
import { withUser } from "./context.ts";
import { openDb, setDb, type Db } from "./db.ts";
import { runLocal } from "./local.ts";
import type { ProviderInfo } from "./provider.ts";
import * as store from "./store.ts";
import { homesSummary } from "./summaries.ts";
import { makeContext, runTool } from "./tools.ts";

const NONE: ProviderInfo = { kind: "none", model: null, label: "Sin IA", vision: false, hint: null };
const LINK = "https://www.idealista.com/inmueble/109876543/";

let db: Db;
before(async () => {
  db = await openDb("memory://");
  setDb(db);
});
after(() => db.close());

async function chat() {
  const conversation = await store.createConversation("test");
  return async (text: string) => {
    const events: ChatEvent[] = [];
    await runLocal(NONE, conversation, { text }, (e) => events.push(e), new AbortController().signal);
    return {
      conversation,
      text: events.map((e) => (e.type === "text" ? e.text : "")).join(""),
      tools: events.flatMap((e) => (e.type === "tool" ? [e.name] : [])),
    };
  };
}

test("linkIn y linkListing: enlace limpio y título sin datos inventados", () => {
  assert.equal(linkIn(`mira este: ${LINK}.`), LINK);
  assert.equal(linkIn("no hay enlace"), null);
  const l = linkListing(LINK);
  assert.equal(l.title, "Anuncio de Idealista 109876543");
  assert.equal(isLinkOnly(l), true);
  assert.equal(linkListing("https://www.fotocasa.es/es/comprar/vivienda/123").title, "Anuncio en fotocasa.es");
});

test("solo un enlace: avisa de que no puede abrirlo y pregunta antes de guardar", async () => {
  const say = await chat();
  const r = await say(LINK);
  assert.match(r.text, /No puedo abrir enlaces/);
  assert.match(r.text, /Ctrl\+A/);
  assert.match(r.text, /¿guardo el enlace/);
  assert.deepEqual(r.tools, [], "no guarda ni evalúa nada sin permiso");
  assert.equal((await store.listHomes()).length, 0);
  // y no añade además la pregunta de la entrevista
  assert.doesNotMatch(r.text, /¿Cuánto tienes ahorrado/);
});

test("«sí» tras la oferta: guarda el enlace como vivienda que interesa, sin precio ni histórico", async () => {
  const say = await chat();
  await say(`He visto este piso ${LINK}`);
  const r = await say("sí, por favor");
  assert.deepEqual(r.tools, ["save_home_link"]);
  assert.match(r.text, /Guardado el enlace/);
  const [home] = await store.listHomes();
  assert.equal(home.id, "idealista-109876543");
  assert.equal(home.status, "interesa");
  assert.equal(home.listing.url, LINK);
  assert.equal(isLinkOnly(home.listing), true);
  assert.deepEqual(home.prices, []);

  // al recargar la conversación la tarjeta sigue ahí, como guardada
  const shown = toDisplay(await store.getMessages(r.conversation));
  assert.equal(shown.at(-1)?.homes[0]?.listing.url, LINK);

  // repetir no duplica
  const again = await say(`guárdame este enlace ${LINK}`);
  assert.match(again.text, /ya lo tenías guardado/);
  assert.equal((await store.listHomes()).length, 1);
});

test("un «sí» sin oferta de enlace pendiente no guarda nada", async () => {
  const before = (await store.listHomes()).length;
  const say = await chat();
  const r = await say("sí");
  assert.ok(!r.tools.includes("save_home_link"));
  assert.equal((await store.listHomes()).length, before);
});

test("la vivienda solo-enlace no se analiza ni se compara con números", async () => {
  const ctx = await makeContext("chat");
  const out = (await runTool("list_saved_homes", {}, ctx)) as { viviendas: Record<string, unknown>[] };
  assert.equal(out.viviendas[0].solo_enlace, true);
  assert.equal(out.viviendas[0].cuota_mensual, undefined);
  const summary = homesSummary(ctx.me, await store.listHomes());
  assert.match(summary, /solo tengo el enlace/);
  assert.doesNotMatch(summary, /cuota/);
});

test("al pegar después el texto del anuncio (sin URL) se completa la misma vivienda", async () => {
  const say = await chat();
  await say(LINK);
  const r = await say(`Piso en venta en calle de la Oca, Carabanchel, Madrid
189.000 €
68 m² 2 hab. Planta 3ª exterior sin ascensor. Guárdala`);
  assert.deepEqual(r.tools, ["evaluate_listing", "save_home"]);
  const homes = await store.listHomes();
  assert.equal(homes.length, 1, "no se duplica");
  assert.equal(homes[0].id, "idealista-109876543");
  assert.equal(homes[0].listing.price, 189000);
  assert.equal(homes[0].listing.url, LINK);
  assert.deepEqual(homes[0].prices.map((p) => p.price), [189000], "el 0 del enlace no cuenta como precio");
  assert.ok(homes[0].savedVerdict, "el veredicto se apunta al llegar los datos");
});

test("save_home_link no pisa una vivienda que ya tiene datos", async () => {
  const ctx = await makeContext("chat");
  const out = (await runTool("save_home_link", { url: LINK }, ctx)) as { nueva: boolean; solo_enlace: boolean };
  assert.equal(out.nueva, false);
  assert.equal(out.solo_enlace, false);
  assert.equal((await store.getHome("idealista-109876543"))?.listing.price, 189000);
});

test("enlaces de otros portales: se reconocen por la URL y cada usuario tiene los suyos", async () => {
  const url = "https://www.fotocasa.es/es/comprar/vivienda/madrid/123456/d";
  const ctx = await makeContext("chat");
  const first = (await runTool("save_home_link", { url }, ctx)) as { id: string; nueva: boolean };
  const second = (await runTool("save_home_link", { url }, ctx)) as { id: string; nueva: boolean };
  assert.equal(first.nueva, true);
  assert.equal(second.nueva, false);
  assert.equal(second.id, first.id);

  const other = await store.createUser("Otra persona");
  await withUser(other.id, async () => {
    assert.equal(await store.homeIdByUrl(url), null, "otro usuario no ve ese enlace");
    assert.equal((await store.listHomes()).length, 0);
  });
});
