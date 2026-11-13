// Qué "cerebro" usa el agente: Claude (si hay clave), un modelo local con Ollama, o ninguno.
// Sin modelo la aplicación sigue evaluando anuncios y guardando datos: esa parte es código.
import { Ollama } from "ollama";

export type ProviderKind = "anthropic" | "ollama" | "none";

export interface ProviderInfo {
  kind: ProviderKind;
  model: string | null;
  /** texto corto para la interfaz */
  label: string;
  /** puede leer capturas de anuncios */
  vision: boolean;
  /** qué hacer para mejorar la situación (p. ej. instalar Ollama) */
  hint: string | null;
}

export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
export const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
/** Modelos pequeños que corren en un portátil sin GPU, por orden de preferencia. */
const LOCAL_PREFERENCE = ["qwen3:1.7b", "qwen3:4b", "qwen3:0.6b"];

export const ollama = new Ollama({ host: OLLAMA_HOST });

const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

async function localModel(): Promise<{ reachable: boolean; model: string | null }> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { reachable: false, model: null };
    const names: string[] = ((await res.json()) as { models: { name: string }[] }).models.map((m) => m.name);
    const wanted = process.env.OLLAMA_MODEL;
    if (wanted) return { reachable: true, model: names.includes(wanted) || names.includes(`${wanted}:latest`) ? wanted : null };
    return { reachable: true, model: LOCAL_PREFERENCE.find((m) => names.includes(m)) ?? names[0] ?? null };
  } catch {
    return { reachable: false, model: null };
  }
}

let cached: { at: number; info: ProviderInfo } | null = null;

export async function resolveProvider(): Promise<ProviderInfo> {
  if (cached && Date.now() - cached.at < 10_000) return cached.info;
  const forced = (process.env.LLM_PROVIDER || "auto").toLowerCase();
  let info: ProviderInfo;

  if (forced !== "ollama" && forced !== "none" && hasClaudeKey()) {
    info = { kind: "anthropic", model: CLAUDE_MODEL, label: "Claude", vision: true, hint: null };
  } else if (forced === "none") {
    info = { kind: "none", model: null, label: "Sin IA", vision: false, hint: null };
  } else {
    const local = await localModel();
    const wanted = process.env.OLLAMA_MODEL || LOCAL_PREFERENCE[0];
    if (local.model) {
      info = {
        kind: "ollama",
        model: local.model,
        label: `IA local (${local.model})`,
        vision: false,
        hint: "Modelo pequeño en tu ordenador: gratis y privado, pero más lento y menos fino que Claude. Los números y las alertas no dependen de él.",
      };
    } else {
      info = {
        kind: "none",
        model: null,
        label: "Sin IA",
        vision: false,
        hint: local.reachable
          ? `Ollama está arrancado pero falta el modelo. Ejecuta: ollama pull ${wanted}`
          : "Para conversar gratis en local instala Ollama (ollama.com) y ejecuta: ollama pull qwen3:1.7b. O pon tu ANTHROPIC_API_KEY en .env.",
      };
    }
  }
  cached = { at: Date.now(), info };
  return info;
}
