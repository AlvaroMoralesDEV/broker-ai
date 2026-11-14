import "./env.ts";
import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { CONTRACT_TYPES, HOME_STATUSES, missingKeyFacts, toHomeListing } from "../shared/broker.ts";
import type { ChatEvent } from "../shared/chat.ts";
import { analyzePurchase } from "../shared/finance.ts";
import { OFFER_TYPES } from "../shared/offers.ts";
import { CCAA_IDS } from "../shared/taxes.ts";
import { describeError, runAgent, toDisplay } from "./agent.ts";
import { DEFAULT_USER, withUser } from "./context.ts";
import { getDb } from "./db.ts";
import { resolveProvider } from "./provider.ts";
import * as store from "./store.ts";
import { loadRates } from "./tools.ts";

const app = express();
// las capturas de anuncios viajan en base64
app.use(express.json({ limit: "25mb" }));

// Usuario de la petición: cabecera X-Broker-User (la pone la web). Sin login: es una app local.
app.use("/api", (req, res, next) => {
  const user = req.get("x-broker-user") || DEFAULT_USER;
  store
    .userExists(user)
    .then((ok) => {
      if (!ok) return void res.status(404).set("X-Unknown-User", "1").json({ error: "Ese usuario ya no existe." });
      withUser(user, next);
    })
    .catch(next);
});

const asyncRoute =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });

app.get("/api/health", asyncRoute(async (_req, res) => {
  const db = await getDb();
  await db.query("SELECT 1");
  res.json({ ok: true, db: db.kind });
}));

app.get("/api/status", asyncRoute(async (_req, res) => {
  res.json({ db: (await getDb()).kind, provider: await resolveProvider() });
}));

app.get("/api/rates", (_req, res) => {
  res.json(loadRates());
});

// ------------------------------------------------------------ usuarios

app.get("/api/users", asyncRoute(async (_req, res) => {
  res.json(await store.listUsers());
}));

app.post("/api/users", asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Pon un nombre" });
  res.json(await store.createUser(parsed.data.name));
}));

app.patch("/api/users/:id", asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Pon un nombre" });
  await store.renameUser(String(req.params.id), parsed.data.name);
  res.json({ ok: true });
}));

app.delete("/api/users/:id", asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (id === DEFAULT_USER) return void res.status(400).json({ error: "El usuario principal no se puede borrar." });
  await store.deleteUser(id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------ ofertas de bancos

const offerSchema = z.object({
  id: z.string().optional(),
  bank: z.string().trim().min(1).max(60),
  type: z.enum(OFFER_TYPES),
  tinPct: z.number().min(0).max(15),
  fixedYears: z.number().min(0).max(40).optional(),
  spreadPct: z.number().min(-1).max(5).optional(),
  loan: z.number().min(1000).optional(),
  years: z.number().int().min(1).max(40).optional(),
  bonuses: z.array(z.object({ name: z.string().trim().min(1).max(60), discountPct: z.number().min(0).max(3), costPerYear: z.number().min(0) })).max(10),
  openingFee: z.number().min(0).optional(),
  otherCosts: z.number().min(0).optional(),
  taePct: z.number().min(0).max(20).optional(),
  notes: z.string().max(1000).optional(),
});

app.get("/api/offers", asyncRoute(async (_req, res) => {
  res.json(await store.listOffers());
}));

app.post("/api/offers", asyncRoute(async (req, res) => {
  const parsed = offerSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Revisa los datos de la oferta" });
  res.json((await store.saveOffer(parsed.data)).offer);
}));

app.delete("/api/offers/:id", asyncRoute(async (req, res) => {
  res.json({ ok: await store.removeOffer(String(req.params.id)) });
}));

// ------------------------------------------------------------ notas del bróker

// Lo que el agente ha apuntado para recordarlo en otras conversaciones. El usuario puede verlo y borrarlo
// sin pasar por el modelo: es su información.
app.get("/api/notes", asyncRoute(async (_req, res) => {
  res.json(await store.listNotes(200));
}));

app.delete("/api/notes/:id", asyncRoute(async (req, res) => {
  res.json({ ok: await store.removeNote(String(req.params.id)) });
}));

// ------------------------------------------------------------ perfil

app.get("/api/profile", asyncRoute(async (_req, res) => {
  const given = await store.givenFields();
  res.json({
    ...(await store.getProfile()),
    history: await store.profileHistory(50),
    facts: { known: [...given], missing: missingKeyFacts(given).map((f) => f.key) },
  });
}));

const profilePatch = z
  .object({
    age: z.number().min(18).max(90),
    netIncome: z.number().min(0),
    monthlyDebts: z.number().min(0),
    savings: z.number().min(0),
    ccaa: z.enum(CCAA_IDS),
    firstHome: z.boolean(),
    newBuild: z.boolean(),
    ltvPct: z.number().min(0).max(100),
    ratePct: z.number().min(0).max(20),
    years: z.number().min(1).max(40),
    debtRatioPct: z.number().min(5).max(60),
    otherCostsPct: z.number().min(0).max(10),
    taxOverridePct: z.number().min(0).max(25).nullable(),
    personalLoanRatePct: z.number().min(0).max(30),
    personalLoanYears: z.number().min(1).max(15),
  })
  .partial();

const extraPatch = z
  .object({
    contractType: z.enum(CONTRACT_TYPES),
    yearsInJob: z.number().min(0),
    netPay: z.number().min(0),
    pagas: z.number().int().min(12).max(16),
    coBuyer: z.boolean(),
    coBuyerNetPay: z.number().min(0),
    coBuyerPagas: z.number().int().min(12).max(16),
    monthlyExpenses: z.number().min(0),
    familyHelp: z.number().min(0),
    monthlySaving: z.number().min(0),
    targetZones: z.array(z.string()),
    mustHaves: z.array(z.string()),
    timeline: z.string(),
    notes: z.string(),
  })
  .partial();

// El formulario de la web envía solo los campos que cambian.
app.patch("/api/profile", asyncRoute(async (req, res) => {
  const parsed = z.object({ profile: profilePatch.default({}), extra: extraPatch.default({}) }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Perfil no válido" });
  const updated = await store.updateProfile(parsed.data.profile, parsed.data.extra, { source: "form" });
  res.json(updated);
}));

// ------------------------------------------------------------ viviendas

app.get("/api/homes", asyncRoute(async (req, res) => {
  res.json(await store.listHomes({ includeDiscarded: req.query.all === "1" }));
}));

// Guardar desde la tarjeta del chat, sin pasar por el modelo.
app.post("/api/homes", asyncRoute(async (req, res) => {
  const parsed = z.object({ listing: z.object({ title: z.string().min(1), price: z.number().min(1000) }).passthrough() }).safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Vivienda no válida" });
  const listing = toHomeListing(parsed.data.listing as never);
  const { profile } = await store.getProfile();
  const verdict = analyzePurchase({ ...profile, ccaa: listing.ccaa ?? profile.ccaa, newBuild: listing.newDevelopment || profile.newBuild }, listing.price).verdict;
  res.json((await store.saveHome(listing, { verdict })).home);
}));

app.patch("/api/homes/:id", asyncRoute(async (req, res) => {
  const parsed = z
    .object({ status: z.enum(HOME_STATUSES).optional(), notes: z.string().max(2000).optional(), price: z.number().min(1000).optional() })
    .safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Cambios no válidos" });
  const home = await store.updateHome(String(req.params.id), parsed.data);
  if (!home) return void res.status(404).json({ error: "No existe esa vivienda" });
  res.json(home);
}));

app.delete("/api/homes/:id", asyncRoute(async (req, res) => {
  res.json({ ok: await store.removeHome(String(req.params.id)) });
}));

// ------------------------------------------------------------ conversaciones

app.get("/api/conversations", asyncRoute(async (_req, res) => {
  res.json(await store.listConversations());
}));

app.get("/api/conversations/:id", asyncRoute(async (req, res) => {
  const id = String(req.params.id);
  if (!(await store.conversationExists(id))) return void res.status(404).json({ error: "No existe esa conversación" });
  res.json({ id, messages: toDisplay(await store.getMessages(id)) });
}));

app.delete("/api/conversations/:id", asyncRoute(async (req, res) => {
  await store.deleteConversation(String(req.params.id));
  res.json({ ok: true });
}));

const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  text: z.string().min(1).max(30_000),
  images: z
    .array(z.object({ mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), data: z.string().max(7_000_000) }))
    .max(5)
    .optional(),
});

app.post("/api/chat", asyncRoute(async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Petición no válida (máximo 5 imágenes de 5 MB)." });
  let { conversationId } = parsed.data;
  if (conversationId && !(await store.conversationExists(conversationId))) conversationId = undefined;
  const title = parsed.data.text.split("\n")[0].slice(0, 60);
  const id = conversationId ?? (await store.createConversation(title));

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const emit = (e: ChatEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  if (!conversationId) emit({ type: "conversation", id, title });
  try {
    await runAgent(id, { text: parsed.data.text, images: parsed.data.images }, emit, abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) emit({ type: "error", message: describeError(err) });
  }
  emit({ type: "done" });
  res.end();
}));

// En producción (npm run build && npm start, o Docker) sirve también la web.
const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile("index.html", { root: dist }));
}

const db = await getDb();

const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  resolveProvider().then((p) => console.log(`API en http://localhost:${port}  ·  base de datos: ${db.kind}  ·  IA: ${p.label}${p.kind === "anthropic" ? ` (${p.model})` : ""}`));
});
