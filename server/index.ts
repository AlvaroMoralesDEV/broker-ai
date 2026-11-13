import "./env.ts";
import express from "express";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_PROFILE, type Profile } from "../shared/finance.ts";
import { CCAA_IDS } from "../shared/taxes.ts";
import { describeError, runAgent, type AgentEvent } from "./agent.ts";
import { idealistaConfigured } from "./idealista.ts";
import { searchHomes } from "./search.ts";
import { loadRates } from "./tools.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

const profileSchema = z.object({
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
});

const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

app.get("/api/status", (_req, res) => {
  res.json({ idealista: idealistaConfigured(), ai: aiConfigured() });
});

app.get("/api/rates", (_req, res) => {
  res.json(loadRates());
});

// La web guarda aquí el perfil para que el servidor MCP use los mismos datos.
app.put("/api/profile", (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Perfil no válido" });
  writeFileSync(new URL("../data/profile.json", import.meta.url), JSON.stringify(parsed.data, null, 2));
  res.json({ ok: true });
});

const searchSchema = z.object({
  zone: z.string().min(2).max(120),
  maxPrice: z.coerce.number().positive().optional(),
  minPrice: z.coerce.number().positive().optional(),
  minRooms: z.coerce.number().int().min(0).max(4).optional(),
  minSize: z.coerce.number().positive().optional(),
  radiusKm: z.coerce.number().min(0.5).max(50).optional(),
  order: z.enum(["price", "size", "ratio"]).optional(),
});

app.get("/api/search", async (req, res) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) return void res.status(400).json({ error: "Indica una zona de al menos 2 letras." });
  try {
    res.json(await searchHomes(parsed.data));
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const chatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20_000) })).min(1).max(60),
  profile: profileSchema,
});

app.post("/api/chat", async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Petición no válida" });
  if (!aiConfigured()) {
    return void res.status(503).json({ error: "Falta ANTHROPIC_API_KEY. Añádela al archivo .env y reinicia el servidor." });
  }

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const emit = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    await runAgent(parsed.data.messages, parsed.data.profile as Profile, emit, abort.signal);
  } catch (err) {
    if (!abort.signal.aborted) emit({ type: "error", message: describeError(err) });
  }
  emit({ type: "done" });
  res.end();
});

// En producción (npm run build && npm start) sirve también la web.
const dist = fileURLToPath(new URL("../dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile("index.html", { root: dist }));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, "127.0.0.1", () => {
  console.log(`API en http://localhost:${port}  ·  Idealista: ${idealistaConfigured() ? "API real" : "datos de ejemplo"}  ·  IA: ${aiConfigured() ? "activada" : "sin clave"}`);
});

export { DEFAULT_PROFILE };
