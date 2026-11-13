import { z } from "zod";
import { TOOLS } from "../server/tools.ts";
const model = process.argv[2];
const tools = Object.entries(TOOLS).map(([name, t]) => {
  const { $schema, ...parameters } = z.toJSONSchema(t.schema) as any;
  return { type: "function", function: { name, description: t.description, parameters } };
});
const system = "Eres un bróker hipotecario personal en España. Usa siempre las herramientas para guardar datos y calcular; no calcules de cabeza. Cuando el usuario te dé datos de su situación, llama a update_profile. Cuando pegue un anuncio, llama a evaluate_listing con los datos del anuncio. Responde en español, breve.";
const cases: [string, string][] = [
  ["perfil", "Hola, tengo 42.000 euros ahorrados y cobro 1.900 netos en 14 pagas. Contrato indefinido."],
  ["anuncio", "Mira este anuncio: Piso en venta en calle Oca, Carabanchel, Madrid. 189.000 €. 68 m², 2 habitaciones, 1 baño, planta 3ª sin ascensor. Para reformar. Gastos de comunidad 45 €/mes. https://www.idealista.com/inmueble/101234567/"],
  ["charla", "¿Qué diferencia hay entre TIN y TAE?"],
];
for (const [label, text] of cases) {
  const t0 = Date.now();
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({ model, stream: false, think: false, tools, options: { num_ctx: 8192, temperature: 0.2 }, messages: [{ role: "system", content: system }, { role: "user", content: text }] }) });
  const j: any = await r.json();
  if (j.error) { console.log(label, "ERROR", j.error); continue; }
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  const calls = (j.message.tool_calls ?? []).map((c: any) => c.function.name + " " + JSON.stringify(c.function.arguments)).join(" | ");
  console.log(`[${model}] ${label}: ${s}s  prompt ${j.prompt_eval_count}tok @${(j.prompt_eval_count / (j.prompt_eval_duration / 1e9)).toFixed(0)}/s  out ${j.eval_count}tok @${(j.eval_count / (j.eval_duration / 1e9)).toFixed(0)}/s  load ${(j.load_duration / 1e9).toFixed(1)}s`);
  console.log("   calls:", calls || "(none)", "\n   text:", (j.message.content || "").slice(0, 160).replace(/\n/g, " "));
}
