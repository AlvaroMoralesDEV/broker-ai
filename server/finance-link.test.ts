// El enlace con la app de Finanzas, contra un Finanzas falso que responde exactamente como el de verdad
// (finance-contract.fixture.json, el mismo archivo en los dos repositorios). Lo que hace Finanzas con sus
// datos se prueba en su repositorio; aquí, lo que hace el bróker con lo que recibe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import type { ChatEvent } from "../shared/chat.ts";
import { contextSnapshot } from "./agent.ts";
import { withUser } from "./context.ts";
import { openDb, setDb, type Db } from "./db.ts";
import { HOUSING_SHARE_PATH, type HousingShare } from "./finance-contract.ts";
import { getLink, link, savingsBlock, syncFinance } from "./finance-link.ts";
import { runLocal } from "./local.ts";
import type { ProviderInfo } from "./provider.ts";
import * as store from "./store.ts";
import { makeContext, runTool } from "./tools.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./finance-contract.fixture.json", import.meta.url), "utf8")) as HousingShare;
const TOKEN = "fin_tokentokentokentokentokentoken";
const REVOKED = "fin_revocadorevocadorevocadorevocado";

/** Lo que responde el Finanzas falso: se cambia en cada test. */
let share: HousingShare = { ...FIXTURE };
let reads = 0;

let db: Db;
let fake: Server;
before(async () => {
  db = await openDb("memory://");
  setDb(db);
  fake = createServer((req, res) => {
    if (req.url !== HOUSING_SHARE_PATH) return void res.writeHead(404).end();
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return void res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"no"}');
    reads++;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(share));
  }).listen(0, "127.0.0.1");
  await new Promise((ok) => fake.once("listening", ok));
  process.env.FINANCE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
after(async () => {
  fake.close();
  await db.close();
});

const NONE: ProviderInfo = { kind: "none", model: null, label: "Sin IA", vision: false, hint: null };
async function localChat(userId: string) {
  const conversation = await withUser(userId, () => store.createConversation("test"));
  return (text: string) =>
    withUser(userId, async () => {
      const events: ChatEvent[] = [];
      await runLocal(NONE, conversation, { text }, (e) => events.push(e), new AbortController().signal);
      return { text: events.map((e) => (e.type === "text" ? e.text : "")).join(""), tools: events.flatMap((e) => (e.type === "tool" ? [e.name] : [])) };
    });
}

test("el fixture es el contrato: los cinco campos, ni uno más", () => {
  assert.deepEqual(Object.keys(FIXTURE).sort(), ["goal", "monthlyContribution", "saved", "target", "updatedAt"]);
  assert.equal(HOUSING_SHARE_PATH, "/api/share/v1/housing");
});

test("sin enlace el bróker funciona como siempre: ni regla ni línea en el contexto", async () => {
  const u = await store.createUser("Sin enlace");
  await withUser(u.id, async () => {
    assert.equal(await savingsBlock({ total: 12345 }), null);
    assert.doesNotMatch(await contextSnapshot(), /Finanzas/);
    const ctx = await makeContext("chat");
    await runTool("update_profile", { note: "tengo 12.345 ahorrados", savings: 12345 }, ctx);
    assert.equal((await store.getProfile()).profile.savings, 12345);
  });
});

test("al conectar, los ahorros pasan a ser los de Finanzas", async () => {
  share = { ...FIXTURE };
  const u = await store.createUser("Enlazado");
  await withUser(u.id, async () => {
    await assert.rejects(link("no-es-un-token"), /fin_/);
    await assert.rejects(link(REVOKED), /revocado/);
    const l = await link(TOKEN);
    assert.deepEqual(l.share, FIXTURE);
    assert.equal((await store.getProfile()).profile.savings, FIXTURE.saved);
    assert.equal((await store.profileHistory(1))[0].source, "finanzas");
  });
});

test("Finanzas manda: otra cifra no se guarda, por herramienta o cambio relativo; los demás datos sí", async () => {
  share = { ...FIXTURE };
  const u = await store.createUser("Manda");
  await withUser(u.id, async () => {
    await link(TOKEN);
    const ctx = await makeContext("chat");
    await assert.rejects(runTool("update_profile", { note: "tengo 35.000 ahorrados", savings: 35000 }, ctx), /no cuadra/);
    await assert.rejects(runTool("update_profile", { note: "réstale 2.000", savingsChange: -2000 }, ctx), /Finanzas/);
    const out = (await runTool("update_profile", { note: "cobro 2.000 en 14 pagas y tengo 35.000", netPay: 2000, pagas: 14, savings: 35000 }, ctx)) as Record<string, unknown>;
    assert.match(String(out.ahorros_no_guardados), /no cuadra/);
    const me = await store.getProfile();
    assert.equal(me.profile.savings, FIXTURE.saved);
    assert.equal(me.extra.netPay, 2000);
    await runTool("update_profile", { note: "tengo 10.000", savings: FIXTURE.saved }, ctx);
  });
});

test("modo local: «no cuadra», «ignora la app de finanzas» y «vuelve a usarla»; una pregunta no cambia nada", async () => {
  share = { ...FIXTURE };
  const u = await store.createUser("Local");
  await withUser(u.id, () => link(TOKEN));
  const say = await localChat(u.id);
  const r = await say("tengo 35.000 € ahorrados");
  assert.match(r.text, /no cuadra/);
  assert.match(r.text, /ignora la app de finanzas/);
  await withUser(u.id, async () => assert.equal((await store.getProfile()).profile.savings, FIXTURE.saved));

  assert.ok(!(await say("¿la app de finanzas usa mis movimientos?")).tools.includes("set_savings_source"));
  const ignore = await say("ignora la app de finanzas");
  assert.deepEqual(ignore.tools, ["set_savings_source"]);
  assert.ok(!(await say("mira lo que tengo en finanzas")).tools.includes("set_savings_source"), "ignorándola, «mira…» no la vuelve a activar");
  await withUser(u.id, async () => assert.equal((await getLink()).mode, "manual"));
  await say("tengo 35.000 € ahorrados");
  await withUser(u.id, async () => {
    assert.equal((await store.getProfile()).profile.savings, 35000, "ignorándola, guarda lo que dice el usuario");
    assert.match(await contextSnapshot(), /IGNORAR la app de Finanzas/);
  });

  const back = await say("vuelve a usar la app de finanzas");
  assert.match(back.text, /10\.000 €/);
  await withUser(u.id, async () => assert.equal((await store.getProfile()).profile.savings, FIXTURE.saved));
});

test("si cambia en Finanzas, el bróker se pone al día; la foto del contexto lleva fecha, no hora", async () => {
  share = { ...FIXTURE };
  const u = await store.createUser("Al día");
  await withUser(u.id, async () => {
    await link(TOKEN);
    const before = await contextSnapshot();
    assert.match(before, /vienen de la app de Finanzas del usuario y MANDAN/);
    assert.doesNotMatch(before.split("\n").find((l) => l.includes("Finanzas"))!, /T\d{2}:\d{2}/, "sin hora: la foto no cambia en cada turno");
    assert.equal(await contextSnapshot(), before, "nada cambia, nada que añadir al historial");
    share = { ...FIXTURE, saved: 15000, updatedAt: "2026-11-20" };
    await syncFinance();
    assert.equal((await store.getProfile()).profile.savings, 15000);
    assert.notEqual(await contextSnapshot(), before);
  });
  share = { ...FIXTURE };
});

test("Finanzas caída o token revocado: no bloquea, usa lo último y lo dice", async () => {
  share = { ...FIXTURE };
  const u = await store.createUser("Caída");
  await withUser(u.id, () => link(TOKEN));
  const url = process.env.FINANCE_URL;
  process.env.FINANCE_URL = "http://127.0.0.1:1";
  try {
    await withUser(u.id, async () => {
      const t0 = Date.now();
      const l = await syncFinance();
      assert.ok(Date.now() - t0 < 2000, "no espera más de 1,5 s");
      assert.match(l.error ?? "", /No consigo conectar/);
      assert.equal(l.share?.saved, FIXTURE.saved, "se queda con lo último que leyó");
      assert.match((await savingsBlock({ total: 1 }))!, /lo último que leí/);
    });
  } finally {
    process.env.FINANCE_URL = url;
  }

  // revocado en Finanzas: el enlace sigue, pero ya no lee nada nuevo
  await db.query("UPDATE finance_links SET token = $2 WHERE user_id = $1", [u.id, REVOKED]);
  await withUser(u.id, async () => {
    const l = await syncFinance();
    assert.match(l.error ?? "", /revocado/);
    assert.equal((await getLink()).linked, true);
  });
});

test("el bróker solo pide la ruta del contrato", () => {
  assert.ok(reads > 0);
});
