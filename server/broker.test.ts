// Tests del agente sin llamar al modelo: base de datos en memoria (PGlite) y las herramientas directamente.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { toHomeListing } from "../shared/broker.ts";
import { currentUser, withUser } from "./context.ts";
import { getDb, openDb, setDb, type Db } from "./db.ts";
import * as store from "./store.ts";
import { loadRates, makeContext, ratesWarning, runTool, runToolCalls } from "./tools.ts";
import { CONTINUE, apiMessages, buildRequest, contextSnapshot, lastContext, searchDomains, toDisplay } from "./agent.ts";

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

test("cada usuario ve solo sus datos", async () => {
  const ana = await store.createUser("Ana");
  const mine = (await store.listHomes({ includeDiscarded: true })).length;

  await withUser(ana.id, async () => {
    assert.equal((await store.getProfile()).known, false, "Ana empieza de cero");
    assert.equal((await store.listHomes({ includeDiscarded: true })).length, 0);
    assert.equal((await store.listConversations()).length, 0);
    // el mismo anuncio puede estar guardado por dos usuarios
    await runTool("save_home", PISO, await makeContext("chat"));
    await runTool("update_profile", { note: "tengo 10.000", savings: 10000 }, await makeContext("chat"));
  });

  assert.equal((await store.listHomes({ includeDiscarded: true })).length, mine, "lo de Ana no aparece en el usuario principal");
  assert.notEqual((await store.getProfile()).profile.savings, 10000);
  const someoneElses = (await store.listConversations())[0].id;
  await withUser(ana.id, async () => {
    assert.equal(await store.conversationExists(someoneElses), false);
    assert.deepEqual(await store.getMessages(someoneElses), []);
    await store.appendMessage(someoneElses, { role: "user", content: "intruso" });
  });
  assert.ok(!(await store.getMessages(someoneElses)).some((m) => m.content === "intruso"), "no puede escribir en conversaciones ajenas");

  await store.deleteUser(ana.id);
  assert.ok(!(await store.listUsers()).some((u) => u.id === ana.id));
});

test("findSavedHomeId y homeIdByUrl solo miran las viviendas del usuario actual", async () => {
  const url = "https://www.habitaclia.com/comprar-piso-luminoso-en-gracia-barcelona-i500012345678.htm";
  const ana = await store.createUser("Ana enlaces");
  const id = await withUser(ana.id, async () => (await store.saveHome(toHomeListing({ title: "Piso en Gràcia", price: 300000, url: `${url}?f=1` }))).home.id);
  await withUser(ana.id, async () => assert.equal(await store.findSavedHomeId(url), id));
  await withUser((await store.createUser("Berta enlaces")).id, async () => {
    assert.equal(await store.findSavedHomeId(url), null);
    assert.equal(await store.homeIdByUrl(url), null);
  });
});

test("cambiar el precio de una vivienda no toca otra con el mismo enlace", async () => {
  await withUser((await store.createUser("Copias")).id, async () => {
    const url = "https://www.fotocasa.es/es/comprar/vivienda/madrid/111222333/d";
    const first = (await store.saveHome(toHomeListing({ title: "Copia 1", price: 200000, url }))).home;
    // una copia de antes de evitar duplicados: mismo anuncio con otra query, guardada aparte
    const db = await getDb();
    await db.query("INSERT INTO homes (user_id, id, title, price, listing, status) VALUES ($1, 'manual-copia', 'Copia 2', 200000, $2::jsonb, 'interesa')", [
      currentUser(),
      JSON.stringify({ ...first.listing, id: "manual-copia", title: "Copia 2", url: `${url}?from=list` }),
    ]);
    await store.updateHome("manual-copia", { price: 190000 });
    assert.equal((await store.getHome("manual-copia"))?.listing.price, 190000);
    assert.equal((await store.getHome(first.id))?.listing.price, 200000);
  });
});

test("ofertas de bancos: guardar, comparar y borrar", async () => {
  const ctx = await makeContext("chat");
  await runTool("save_bank_offer", { bank: "Banco A", type: "fija", tinPct: 2.3, bonuses: [{ name: "Seguro de vida", discountPct: 0.25, costPerYear: 1200 }] }, ctx);
  const b = (await runTool("save_bank_offer", { bank: "Banco B", type: "fija", tinPct: 2.45, bonuses: [{ name: "Nómina", discountPct: 0.2, costPerYear: 0 }] }, ctx)) as {
    id: string;
    total_ofertas: number;
  };
  assert.equal(b.total_ofertas, 2);
  const out = (await runTool("compare_bank_offers", { loan: 180000, years: 30 }, ctx)) as {
    ofertas: { banco: string; contratar_solo: string[]; vinculaciones: { compensa: boolean }[] }[];
  };
  assert.equal(out.ofertas.length, 2);
  const a = out.ofertas.find((o) => o.banco === "Banco A")!;
  assert.deepEqual(a.contratar_solo, [], "un seguro de 1.200 €/año no compensa 0,25 puntos");
  assert.equal(out.ofertas.find((o) => o.banco === "Banco B")!.vinculaciones[0].compensa, true);
  await runTool("remove_bank_offer", { id: b.id }, ctx);
  assert.equal((await store.listOffers()).length, 1);
});

test("update_profile no guarda un sueldo en bruto o anual: devuelve qué preguntar", async () => {
  const ctx = await makeContext("chat");
  const before = (await store.getProfile()).extra.netPay;
  await assert.rejects(runTool("update_profile", { note: "Cobro 30.000 brutos al año", netPay: 30000 }, ctx), /BRUTO/);
  await assert.rejects(runTool("update_profile", { note: "gano 28.000 al año", netPay: 2000, pagas: 14 }, ctx), /ANUAL/);
  await assert.rejects(runTool("update_profile", { note: "mi pareja gana 24000", coBuyer: true, coBuyerNetPay: 24000 }, ctx), /ANUAL/);
  assert.equal((await store.getProfile()).extra.netPay, before, "no se ha guardado nada");

  // con el neto y el bruto en la misma frase no hay duda: se guarda el neto
  const ok = (await runTool("update_profile", { note: "Cobro 1.850 netos en 14 pagas (unos 34.000 brutos al año)", netPay: 1850, pagas: 14 }, ctx)) as { avisos: string[] };
  assert.equal((await store.getProfile()).extra.netPay, 1850);
  assert.deepEqual(ok.avisos, []);
});

test("update_profile avisa si falta el número de pagas y lista las viviendas que cambian", async () => {
  await withUser((await store.createUser("Pagas")).id, async () => {
    const ctx = await makeContext("chat");
    const first = (await runTool("update_profile", { note: "tengo 60.000 ahorrados y cobro 2.400 netos al mes", savings: 60000, netPay: 2400 }, ctx)) as { avisos: string[] };
    assert.match(first.avisos[0], /pagas/);
    await runTool("save_home", PISO, ctx);

    const out = (await runTool("update_profile", { note: "me he quedado con 3.000 de ahorros", savings: 3000 }, ctx)) as {
      avisos: string[];
      viviendas_que_cambian_de_veredicto: { id: string; veredicto_ahora: string }[];
    };
    assert.deepEqual(out.avisos, [], "solo avisa cuando se da el sueldo sin pagas");
    assert.deepEqual(
      out.viviendas_que_cambian_de_veredicto.map((h) => [h.id, h.veredicto_ahora]),
      [["idealista-99887766", "no"]],
    );
  });
});

test("varias herramientas a la vez: las que guardan van antes que las que calculan", async () => {
  await withUser((await store.createUser("Orden")).id, async () => {
    const ctx = await makeContext("chat");
    const started: string[] = [];
    // el modelo pide evaluar el anuncio ANTES que el cambio de perfil, y las dos en el mismo paso
    const [evaluation, update, broken] = await runToolCalls(
      [
        { id: "a", name: "evaluate_listing", input: PISO },
        { id: "b", name: "update_profile", input: { note: "tengo 90.000 ahorrados y cobro 3.000 netos en 12 pagas", savings: 90000, netPay: 3000, pagas: 12 } },
        { id: "c", name: "no_existe", input: {} },
      ],
      ctx,
      (name) => started.push(name),
    );
    assert.equal(started[0], "update_profile", "primero se guarda el perfil");
    assert.deepEqual([evaluation.id, update.id, broken.id], ["a", "b", "c"], "los resultados vuelven en el orden pedido");
    assert.equal(broken.ok, false);
    assert.match(String(broken.output), /Herramienta desconocida/);

    // la evaluación ha usado el perfil nuevo: el resultado es el mismo que evaluando después
    const after = (await runTool("evaluate_listing", PISO, await makeContext("chat"))) as { compra: { ahorros_que_faltan: number; veredicto: string }; aviso_perfil: string | null };
    const got = evaluation.output as typeof after;
    assert.equal(got.aviso_perfil, null, "ya no usa el perfil de ejemplo");
    assert.deepEqual(got.compra, after.compra);
  });
});

test("notas del bróker: se guardan, salen en el contexto y cada usuario ve solo las suyas", async () => {
  const ctx = await makeContext("chat");
  const saved = (await runTool("save_note", { text: "Descartó Vallecas: la derrama del ascensor era de 9.000 €.", topic: "decision" }, ctx)) as { id: string };
  const profile = (await runTool("get_profile", {}, ctx)) as { notas: { id: string; nota: string }[] };
  assert.equal(profile.notas[0].id, saved.id);
  assert.match(await contextSnapshot(), /Descartó Vallecas/);

  const otro = await store.createUser("Notas");
  await withUser(otro.id, async () => {
    assert.deepEqual(await store.listNotes(), [], "no ve las notas de otro usuario");
    assert.doesNotMatch(await contextSnapshot(), /Vallecas/);
    assert.equal(await store.removeNote(saved.id), false, "ni puede borrarlas");
    await runTool("save_note", { text: "Prefiere hipoteca fija." }, await makeContext("chat"));
  });
  assert.equal((await store.listNotes()).length, 1);

  assert.deepEqual(await runTool("remove_note", { id: saved.id }, ctx), { borrada: true });
  assert.deepEqual(await store.listNotes(), []);
});

test("datos de hipotecas antiguos: se avisa a partir de 30 días", () => {
  const rates = { ...loadRates(), updated: "2026-01-01" };
  assert.equal(ratesWarning(rates, new Date("2026-01-20T12:00:00Z")), null);
  assert.match(ratesWarning(rates, new Date("2026-03-01T12:00:00Z")) ?? "", /59 días/);
});

test("la petición a Claude: prompt fijo, contexto en el historial y nada que cambie por delante", async () => {
  const id = await store.createConversation("caché");
  const history: store.StoredMessage[] = [{ role: "user", content: [{ type: "text", text: "hola" }] }];
  const day1 = await contextSnapshot(new Date("2026-11-14T10:00:00Z"));
  history.push({ role: "system", content: day1 });
  const first = buildRequest(history);

  // el prompt de sistema no lleva fecha ni datos del usuario, y lleva el punto de caché
  const system = first.system as { text: string; cache_control?: unknown }[];
  assert.equal(system.length, 1);
  assert.doesNotMatch(system[0].text, /2026-11-14|Perfil guardado|ahorros \d/);
  assert.ok(system[0].cache_control);
  assert.match(day1, /^<contexto_actual>\nFecha de hoy: 2026-11-14/);

  // al día siguiente, con el perfil cambiado: lo anterior se envía byte a byte igual
  history.push({ role: "assistant", content: [{ type: "text", text: "¡Hola!" }] });
  history.push({ role: "user", content: [{ type: "text", text: "sigo aquí" }] });
  const day2 = await contextSnapshot(new Date("2026-11-15T10:00:00Z"));
  assert.notEqual(day2, day1);
  history.push({ role: "system", content: day2 });
  const second = buildRequest(history);
  assert.equal(JSON.stringify(second.system), JSON.stringify(first.system));
  assert.equal(JSON.stringify(second.tools), JSON.stringify(first.tools));
  assert.equal(JSON.stringify(second.messages.slice(0, first.messages.length)), JSON.stringify(first.messages));
  assert.equal(lastContext(history), day2);

  // los mensajes 'system' se guardan y se recuperan como cualquier otro
  for (const m of history) await store.appendMessage(id, m);
  assert.deepEqual(
    (await store.getMessages(id)).map((m) => m.role),
    ["user", "system", "assistant", "user", "system"],
  );
});

test("un contexto al que no siguió respuesta no se envía, y el chat no pinta mensajes del servidor", () => {
  const history: store.StoredMessage[] = [
    { role: "user", content: [{ type: "text", text: "primer intento" }] },
    { role: "system", content: "<contexto_actual>\nviejo\n</contexto_actual>" }, // el turno se cortó aquí
    { role: "user", content: [{ type: "text", text: "segundo intento" }] },
  ];
  assert.equal(lastContext(history), null, "esa foto no cuenta: hay que añadir otra");
  history.push({ role: "system", content: "<contexto_actual>\nnuevo\n</contexto_actual>" });
  assert.deepEqual(
    apiMessages(history, true).map((m) => m.role),
    ["user", "user", "system"],
  );
  // en un modelo sin mensajes 'system' intermedios va como texto del usuario
  assert.deepEqual(
    apiMessages(history, false).map((m) => m.role),
    ["user", "user", "user"],
  );

  history.push({ role: "assistant", content: [{ type: "text", text: "Primera parte" }] });
  history.push({ role: "user", content: [{ type: "text", text: CONTINUE }] });
  history.push({ role: "assistant", content: [{ type: "text", text: "y segunda." }] });
  const display = toDisplay(history);
  assert.deepEqual(
    display.map((d) => [d.role, d.text]),
    [
      ["user", "primer intento"],
      ["user", "segundo intento"],
      ["assistant", "Primera parte\n\ny segunda."],
    ],
  );
});

test("la búsqueda web se limita a fuentes conocidas salvo que se configure otra cosa", () => {
  assert.ok(searchDomains(undefined)!.includes("ine.es"));
  assert.deepEqual(searchDomains("ine.es, bde.es"), ["ine.es", "bde.es"]);
  assert.equal(searchDomains("*"), null);
  const search = buildRequest([{ role: "user", content: "hola" }]).tools!.find((t) => "name" in t && t.name === "web_search") as { allowed_domains?: string[] };
  assert.ok(search.allowed_domains?.includes("idealista.com"));
});

test("update_profile: un cambio de ahorros se suma o resta en código, y un total mal leído se rechaza", async () => {
  const user = await store.createUser("Ahorros relativos");
  await withUser(user.id, async () => {
    const ctx = await makeContext("chat");
    await runTool("update_profile", { note: "Tengo 30.000 ahorrados", savings: 30000 }, ctx);
    // el modelo guarda el número de la frase como total: se rechaza y se le dice que use savingsChange
    await assert.rejects(runTool("update_profile", { note: "réstale al ahorro 20 mil", savings: 20000 }, ctx), /savingsChange/);
    assert.equal((await store.getProfile()).profile.savings, 30000);
    const out = (await runTool("update_profile", { note: "réstale al ahorro 20 mil", savingsChange: -20000 }, ctx)) as { ahorros_antes: number; ahorros_ahora: number };
    assert.deepEqual([out.ahorros_antes, out.ahorros_ahora], [30000, 10000]);
    await assert.rejects(runTool("update_profile", { note: "quita 50.000 de los ahorros", savingsChange: -50000 }, ctx), /negativo/);
    assert.equal((await store.getProfile()).profile.savings, 10000);
  });
});

test("data/rates.json tiene el formato que espera la aplicación (se edita a mano)", () => {
  const rates = loadRates();
  assert.match(rates.updated, /^\d{4}-\d{2}-\d{2}$/, "updated: fecha AAAA-MM-DD");
  assert.ok(Number.isFinite(rates.euribor.monthlyAvg) && rates.euribor.month, "euribor.monthlyAvg y euribor.month");
  assert.ok(rates.offers.length > 0);
  const ids = new Set<string>();
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  for (const o of rates.offers) {
    const where = `oferta ${o.id}`;
    assert.ok(o.id && !ids.has(o.id), `${where}: id repetido o vacío`);
    ids.add(o.id);
    assert.ok(o.bank && o.product, `${where}: bank y product`);
    assert.ok(["fija", "variable", "mixta"].includes(o.type), `${where}: type`);
    assert.ok(num(o.tinBonif) && o.tinBonif > 0 && o.tinBonif < 15, `${where}: tinBonif en %, p. ej. 2.75`);
    assert.ok(o.tinNoBonif === null || (num(o.tinNoBonif) && o.tinNoBonif >= o.tinBonif), `${where}: tinNoBonif es null o mayor que tinBonif`);
    assert.ok(num(o.maxLtv) && num(o.maxYears) && Array.isArray(o.bonificaciones) && typeof o.notes === "string", where);
    assert.ok(o.openingFee === null || num(o.openingFee), `${where}: openingFee es un número o null`);
    if (o.type !== "fija") assert.ok(num(o.initialYears) && num(o.diffBonif), `${where}: variable y mixta necesitan initialYears y diffBonif`);
    const known = ["minLoan", "minHouseholdIncome", "minHouseholdIncomeCivilServant", "payrollForBonus"];
    for (const [k, v] of Object.entries(o.requirements ?? {})) assert.ok(known.includes(k) && num(v), `${where}: requisito desconocido o no numérico: ${k}`);
  }
});
