// Tests del agente sin llamar al modelo: base de datos en memoria (PGlite) y las herramientas directamente.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openDb, setDb, type Db } from "./db.ts";
import * as store from "./store.ts";
import { makeContext, runTool } from "./tools.ts";
import { toDisplay } from "./agent.ts";

let db: Db;
before(async () => {
  db = await openDb("memory://");
  setDb(db);
});
after(() => db.close());

const PISO = {
  title: "Piso de 2 habitaciones en Carabanchel",
  price: 210000,
  url: "https://www.idealista.com/inmueble/99887766/",
  size: 70,
  rooms: 2,
  municipality: "Madrid",
  ccaa: "madrid",
  communityFees: 60,
  description: "Piso exterior a reformar. Derrama aprobada para el ascensor.",
};

test("sin perfil, el agente lo sabe y pide los datos clave", async () => {
  const out = (await runTool("get_profile", {}, await makeContext("chat"))) as { perfil_guardado: boolean; datos_que_faltan: string[] };
  assert.equal(out.perfil_guardado, false);
  assert.ok(out.datos_que_faltan.length >= 6);
});

test("update_profile calcula el sueldo mensual a partir de nóminas y deja histórico", async () => {
  const ctx = await makeContext("chat");
  const out = (await runTool("update_profile", { note: "Cobro 1.800 netos en 14 pagas y tengo 40.000 ahorrados", netPay: 1800, pagas: 14, savings: 40000 }, ctx)) as {
    ingresos_netos_mensuales: number;
    presupuesto_ahora: { precio_maximo: number };
    datos_que_faltan: string[];
  };
  assert.equal(out.ingresos_netos_mensuales, 2100);
  assert.ok(out.presupuesto_ahora.precio_maximo > 0);
  assert.ok(!out.datos_que_faltan.some((d) => d.startsWith("ahorros")));
  assert.equal(ctx.me.profile.savings, 40000, "el resto del turno usa el perfil nuevo");

  const history = await store.profileHistory();
  const savings = history.find((f) => f.field === "savings");
  assert.equal(savings?.newValue, 40000);
  assert.equal(savings?.note, "Cobro 1.800 netos en 14 pagas y tengo 40.000 ahorrados");
});

test("evaluate_listing: veredicto, coste mensual y alertas, sin guardar", async () => {
  const events: unknown[] = [];
  const out = (await runTool("evaluate_listing", PISO, await makeContext("chat", undefined, (e) => events.push(e)))) as {
    compra: { veredicto: string; cuota_mensual: number };
    coste_mensual_de_tenerla: { comunidad: number; nota: string | null };
    alertas: { label: string }[];
    ya_guardada: unknown;
  };
  assert.ok(["ok", "justo", "no"].includes(out.compra.veredicto));
  assert.equal(out.coste_mensual_de_tenerla.comunidad, 60);
  assert.match(out.coste_mensual_de_tenerla.nota ?? "", /IBI/);
  assert.deepEqual(
    out.alertas.map((a) => a.label),
    ["Derrama", "Necesita reforma"],
  );
  assert.equal(out.ya_guardada, null);
  assert.equal(events.length, 1);
  assert.equal((await store.listHomes()).length, 0);
});

test("save_home no duplica la misma URL y apunta las bajadas de precio", async () => {
  const ctx = await makeContext("chat");
  const first = (await runTool("save_home", PISO, ctx)) as { id: string; nueva: boolean };
  assert.equal(first.id, "idealista-99887766");
  assert.equal(first.nueva, true);

  const again = (await runTool("save_home", { ...PISO, price: 199000, status: "visitar" }, ctx)) as { nueva: boolean; precio_anterior: number; estado: string };
  assert.equal(again.nueva, false);
  assert.equal(again.precio_anterior, 210000);
  assert.equal(again.estado, "visitar");

  const homes = await store.listHomes();
  assert.equal(homes.length, 1);
  assert.deepEqual(
    homes[0].prices.map((p) => p.price),
    [210000, 199000],
  );
});

test("al cambiar la situación, update_profile recalcula el veredicto de las guardadas", async () => {
  const ctx = await makeContext("chat");
  const out = (await runTool("update_profile", { note: "Me han bajado los ahorros a 5.000", savings: 5000 }, ctx)) as {
    viviendas_guardadas: { veredicto_antes: string; veredicto_ahora: string }[];
  };
  assert.equal(out.viviendas_guardadas.length, 1);
  assert.equal(out.viviendas_guardadas[0].veredicto_ahora, "no");

  const list = (await runTool("list_saved_homes", {}, ctx)) as { viviendas: { veredicto: string; precio_inicial: number }[] };
  assert.equal(list.viviendas[0].veredicto, "no");
  assert.equal(list.viviendas[0].precio_inicial, 210000);
});

test("update_home y las descartadas no aparecen por defecto", async () => {
  const ctx = await makeContext("chat");
  await runTool("update_home", { id: "idealista-99887766", status: "descartada", notes: "Demasiado ruido" }, ctx);
  assert.equal((await store.listHomes()).length, 0);
  assert.equal((await store.listHomes({ includeDiscarded: true }))[0].notes, "Demasiado ruido");
  await assert.rejects(runTool("update_home", { id: "no-existe" }, ctx), /list_saved_homes/);
});

test("entradas no válidas devuelven un error legible", async () => {
  await assert.rejects(runTool("evaluate_listing", { title: "x", price: -1 }, await makeContext("chat")), /Parámetros no válidos/);
});

test("conversaciones: el historial se guarda tal cual y se agrupa para pintarlo", async () => {
  const id = await store.createConversation("Piso en Carabanchel");
  await store.appendMessage(id, { role: "user", content: [{ type: "text", text: "Mira este piso" }] });
  await store.appendMessage(id, {
    role: "assistant",
    content: [
      { type: "text", text: "Lo miro." },
      { type: "tool_use", id: "t1", name: "evaluate_listing", input: PISO },
    ],
  });
  await store.appendMessage(id, { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] });
  await store.appendMessage(id, { role: "assistant", content: [{ type: "text", text: "Encaja justo." }] });

  const history = await store.getMessages(id);
  assert.equal(history.length, 4);
  const display = toDisplay(history);
  assert.equal(display.length, 2);
  assert.equal(display[1].text, "Lo miro.\n\nEncaja justo.");
  assert.deepEqual(display[1].tools, ["evaluate_listing"]);
  assert.equal(display[1].homes[0].listing.price, 210000);
  assert.equal((await store.listConversations())[0].id, id);
});

test("el perfil de ejemplo antiguo no se importa como si fueran datos reales", async () => {
  const fresh = await openDb("memory://");
  setDb(fresh);
  try {
    assert.equal(await store.importLegacyProfile(new URL("../data/profile.json", import.meta.url)), false);
  } finally {
    setDb(db);
    await fresh.close();
  }
});
