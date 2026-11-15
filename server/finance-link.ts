// Lado del bróker del enlace con la app de Finanzas (repositorio aparte, «finanzas»; su docs/architecture.md §7).
//
// - Con un token que crea el usuario en Finanzas, el bróker lee SOLO el objetivo de vivienda
//   (server/finance-contract.ts). Nada de saldos, movimientos ni nóminas.
// - Antes de cada turno se sincroniza: si Finanzas dice otra cosa, los ahorros del perfil pasan a ser
//   los de Finanzas (fuente «finanzas» en el histórico).
// - Finanzas manda: una cifra de ahorros que no cuadra no se guarda (savingsBlock), venga del chat, del
//   formulario o del MCP, salvo que el usuario haya pedido ignorar la app (modo «manual»).
// - Si Finanzas no responde en 1,5 s se usa lo último que se leyó y se dice de cuándo es.
import { HOUSING_SHARE_PATH, type HousingShare } from "./finance-contract.ts";
import { currentUser } from "./context.ts";
import { getDb } from "./db.ts";
import * as store from "./store.ts";

const TIMEOUT_MS = 1500;
export const financeUrl = () => (process.env.FINANCE_URL || "http://127.0.0.1:8788").replace(/\/$/, "");

export interface FinanceLink {
  linked: boolean;
  mode: "finanzas" | "manual";
  /** lo último que se leyó de Finanzas (null si nunca se pudo leer) */
  share: HousingShare | null;
  /** última lectura correcta (ISO) */
  syncedAt: string | null;
  /** por qué falló la última lectura, si falló */
  error: string | null;
}

const euros = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;
const dateEs = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

export async function getLink(): Promise<FinanceLink> {
  const db = await getDb();
  const [r] = await db.query<Record<string, unknown>>("SELECT * FROM finance_links WHERE user_id = $1", [currentUser()]);
  if (!r) return { linked: false, mode: "finanzas", share: null, syncedAt: null, error: null };
  return {
    linked: true,
    mode: r.mode as FinanceLink["mode"],
    share:
      r.saved == null
        ? null
        : {
            goal: String(r.goal),
            saved: Number(r.saved),
            target: Number(r.target),
            monthlyContribution: r.monthly == null ? null : Number(r.monthly),
            updatedAt: String(r.finance_date),
          },
    syncedAt: r.synced_at ? new Date(r.synced_at as string).toISOString() : null,
    error: (r.last_error as string | null) ?? null,
  };
}

async function token(): Promise<string | null> {
  const db = await getDb();
  const [r] = await db.query<{ token: string }>("SELECT token FROM finance_links WHERE user_id = $1", [currentUser()]);
  return r?.token ?? null;
}

/** Pide el objetivo de vivienda a Finanzas. Nunca lanza: devuelve el dato o el motivo del fallo. */
export async function fetchHousing(tok: string): Promise<{ share: HousingShare } | { error: string; revoked?: boolean }> {
  try {
    const res = await fetch(financeUrl() + HOUSING_SHARE_PATH, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401) return { error: "Finanzas no acepta el token: lo han revocado o no es correcto.", revoked: true };
    if (res.status === 404) return { error: "En Finanzas aún no hay objetivo de vivienda." };
    if (!res.ok) return { error: `Finanzas ha respondido con un error (${res.status}).` };
    const s = (await res.json()) as HousingShare;
    if (typeof s.saved !== "number" || typeof s.target !== "number" || !/^\d{4}-\d{2}-\d{2}$/.test(s.updatedAt)) return { error: "Finanzas ha devuelto algo que no entiendo." };
    return { share: s };
  } catch {
    return { error: "No consigo conectar con la app de Finanzas (¿está arrancada?)." };
  }
}

/** Conecta este usuario del bróker con Finanzas. Comprueba el token antes de guardarlo. */
export async function link(tok: string): Promise<FinanceLink> {
  const clean = tok.trim();
  if (!/^fin_[A-Za-z0-9_-]{20,}$/.test(clean)) throw new Error("Ese no parece un token de Finanzas: empieza por «fin_». Créalo en Finanzas → Configuración → Compartir con Bróker IA.");
  const got = await fetchHousing(clean);
  if ("error" in got && got.revoked) throw new Error(got.error);
  const db = await getDb();
  await db.query(
    `INSERT INTO finance_links (user_id, token, mode) VALUES ($1, $2, 'finanzas')
     ON CONFLICT (user_id) DO UPDATE SET token = EXCLUDED.token, mode = 'finanzas', last_error = NULL`,
    [currentUser(), clean],
  );
  return syncFinance();
}

export async function unlink(): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM finance_links WHERE user_id = $1", [currentUser()]);
}

/** «ignora la app de finanzas» (manual) o «vuelve a usarla» (finanzas). Al volver, se sincroniza. */
export async function setMode(mode: FinanceLink["mode"]): Promise<FinanceLink> {
  const db = await getDb();
  const done = await db.query("UPDATE finance_links SET mode = $2 WHERE user_id = $1 RETURNING user_id", [currentUser(), mode]);
  if (!done.length) throw new Error("No tienes conectada la app de Finanzas. Conéctala en «Lo que sé de ti» → «Ahorros desde Finanzas».");
  return mode === "finanzas" ? syncFinance() : getLink();
}

/**
 * Lee Finanzas y, si manda (modo «finanzas») y no coincide, pone los ahorros del perfil al día.
 * Sin enlace no hace nada: el bróker funciona como siempre.
 */
export async function syncFinance(): Promise<FinanceLink> {
  const tok = await token();
  if (!tok) return getLink();
  const db = await getDb();
  const got = await fetchHousing(tok);
  if ("error" in got) {
    await db.query("UPDATE finance_links SET last_error = $2 WHERE user_id = $1", [currentUser(), got.error]);
    return getLink();
  }
  const s = got.share;
  await db.query(
    `UPDATE finance_links SET goal = $2, saved = $3, target = $4, monthly = $5, finance_date = $6, synced_at = now(), last_error = NULL WHERE user_id = $1`,
    [currentUser(), s.goal, s.saved, s.target, s.monthlyContribution, s.updatedAt],
  );
  const link = await getLink();
  if (link.mode === "finanzas") {
    const me = await store.getProfile();
    const value = Math.round(s.saved);
    if (!me.known || me.profile.savings !== value || !(await store.givenFields()).has("savings")) {
      await store.updateProfile({ savings: value }, {}, { source: "finanzas", note: `Sincronizado con la app de Finanzas («${s.goal}», actualizado el ${s.updatedAt})` });
    }
  }
  return link;
}

/**
 * La regla «Finanzas manda». Devuelve el motivo para NO guardar unos ahorros (total o cambio), o null
 * si se pueden guardar: sin enlace, en modo manual, sin dato de Finanzas, o si la cifra coincide.
 */
export async function savingsBlock(change: { total?: number; delta?: number }): Promise<string | null> {
  const link = await getLink();
  if (!link.linked || link.mode !== "finanzas" || !link.share) return null;
  const s = link.share;
  const fromFinance = Math.round(s.saved);
  const said = change.total != null ? Math.round(change.total) : null;
  if (said != null && said === fromFinance) return null;
  const old = link.error ? ` (no he podido volver a mirar Finanzas ahora: es lo último que leí)` : "";
  const what = said != null ? `${euros(said)} no cuadra con eso` : `no cambio la cifra a mano mientras mande Finanzas`;
  return (
    `No he cambiado tus ahorros: en la app de Finanzas tienes ${euros(s.saved)} para «${s.goal}» (actualizado el ${dateEs(s.updatedAt)})${old}, y ${what}. ` +
    `Mando lo que dice Finanzas: actualiza allí el saldo o lo asignado al objetivo. Si quieres que la ignore y use lo que me digas, dime «ignora la app de finanzas».`
  );
}

/** Línea para la foto del contexto del agente. Solo la fecha de Finanzas, nunca una hora: así la foto no cambia en cada turno. */
export function contextLine(link: FinanceLink): string | null {
  if (!link.linked) return null;
  if (!link.share) return `Ahorros: el usuario ha conectado la app de Finanzas, pero aún no he podido leerla (${link.error ?? "sin datos"}).`;
  const s = link.share;
  const goal = `«${s.goal}»: ${s.saved} € de ${s.target} €${s.monthlyContribution != null ? `, aportando ${s.monthlyContribution} €/mes` : ""}, actualizado el ${s.updatedAt}`;
  if (link.mode === "manual") {
    return `Ahorros: el usuario ha pedido IGNORAR la app de Finanzas (allí tiene ${goal}); usa lo que te diga. Si pide volver a usarla, llama a set_savings_source con finanzas.`;
  }
  return `Ahorros: vienen de la app de Finanzas del usuario y MANDAN (objetivo ${goal}). Si dice otra cifra o habla de cambiar sus ahorros, dile que no cuadra con Finanzas y pregúntale; update_profile no guardará otra cifra. Solo si te pide ignorar la app, llama a set_savings_source con manual.`;
}

/** Dónde abre el navegador la web de Finanzas (enlace desde «Lo que sé de ti»). */
export const financeWebUrl = () => process.env.FINANCE_PUBLIC_URL || "http://finanzas.local";
