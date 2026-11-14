// Acceso a datos. Todo está separado por usuario: cada consulta filtra por currentUser().
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PROFILE, type Profile } from "../shared/finance.ts";
import { homeIdFromUrl, type HomeListing, type HomeStatus, type ProfileExtra, type SavedHome } from "../shared/broker.ts";
import type { ReceivedOffer } from "../shared/offers.ts";
import { currentUser } from "./context.ts";
import { getDb } from "./db.ts";

export type Source = "chat" | "form" | "mcp";

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------------------------------------------------------------- usuarios

export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export async function listUsers(): Promise<User[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string; created_at: Date }>("SELECT id, name, created_at FROM users ORDER BY created_at");
  return rows.map((r) => ({ id: r.id, name: r.name, createdAt: iso(r.created_at) }));
}

export async function userExists(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query("SELECT 1 FROM users WHERE id = $1", [id])).length > 0;
}

export async function createUser(name: string): Promise<User> {
  const db = await getDb();
  const id = `u-${randomUUID().slice(0, 8)}`;
  await db.query("INSERT INTO users (id, name) VALUES ($1, $2)", [id, name.trim().slice(0, 40) || "Sin nombre"]);
  return (await listUsers()).find((u) => u.id === id)!;
}

export async function renameUser(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.query("UPDATE users SET name = $2 WHERE id = $1", [id, name.trim().slice(0, 40) || "Sin nombre"]);
}

/** Borra el usuario y todos sus datos (perfil, histórico, conversaciones, viviendas, ofertas). */
export async function deleteUser(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM users WHERE id = $1", [id]);
}

// ---------------------------------------------------------------- perfil

export interface StoredProfile {
  profile: Profile;
  extra: ProfileExtra;
  /** false hasta que el usuario da algún dato */
  known: boolean;
  updatedAt: string | null;
}

export interface ProfileFact {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  note: string | null;
  source: Source;
  at: string;
}

export async function getProfile(): Promise<StoredProfile> {
  const db = await getDb();
  const [row] = await db.query<{ data: Profile; extra: ProfileExtra; updated_at: Date }>(
    "SELECT data, extra, updated_at FROM profile WHERE user_id = $1",
    [currentUser()],
  );
  if (!row) return { profile: { ...DEFAULT_PROFILE }, extra: {}, known: false, updatedAt: null };
  return { profile: { ...DEFAULT_PROFILE, ...row.data }, extra: row.extra ?? {}, known: true, updatedAt: iso(row.updated_at) };
}

/** Aplica cambios al perfil y apunta cada campo que cambia en profile_facts. */
export async function updateProfile(
  patch: Partial<Profile>,
  extraPatch: Partial<ProfileExtra>,
  meta: { source: Source; note?: string; conversationId?: string },
): Promise<StoredProfile & { changed: string[] }> {
  const db = await getDb();
  const user = currentUser();
  const current = await getProfile();
  const profile = { ...current.profile, ...patch };
  const extra = { ...current.extra, ...extraPatch };

  // Un dato cuenta como "dado" la primera vez que el usuario lo dice, aunque coincida con el valor
  // por defecto del motor (p. ej. "no tengo deudas" = 0).
  const given = await givenFields();
  const changes: [string, unknown, unknown][] = [];
  for (const [k, v] of Object.entries(patch)) {
    const before = current.profile[k as keyof Profile];
    if (!given.has(k) || !same(before, v)) changes.push([k, given.has(k) ? before : null, v]);
  }
  for (const [k, v] of Object.entries(extraPatch)) {
    const before = current.extra[k as keyof ProfileExtra];
    if (!same(before, v)) changes.push([k, before ?? null, v]);
  }
  if (current.known && changes.length === 0) return { ...current, changed: [] };

  await db.query(
    `INSERT INTO profile (user_id, data, extra, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, extra = EXCLUDED.extra, updated_at = now()`,
    [user, JSON.stringify(profile), JSON.stringify(extra)],
  );
  for (const [field, oldValue, newValue] of changes) {
    await db.query(
      "INSERT INTO profile_facts (user_id, field, old_value, new_value, note, source, conversation_id) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)",
      [user, field, JSON.stringify(oldValue ?? null), JSON.stringify(newValue ?? null), meta.note ?? null, meta.source, meta.conversationId ?? null],
    );
  }
  return { ...(await getProfile()), changed: changes.map(([f]) => f) };
}

export async function profileHistory(limit = 30): Promise<ProfileFact[]> {
  const db = await getDb();
  const rows = await db.query<{ field: string; old_value: unknown; new_value: unknown; note: string | null; source: Source; created_at: Date }>(
    "SELECT field, old_value, new_value, note, source, created_at FROM profile_facts WHERE user_id = $1 ORDER BY id DESC LIMIT $2",
    [currentUser(), limit],
  );
  return rows.map((r) => ({ field: r.field, oldValue: r.old_value, newValue: r.new_value, note: r.note, source: r.source, at: iso(r.created_at) }));
}

/** Campos que el usuario ha dado alguna vez (por chat, formulario o MCP). */
export async function givenFields(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.query<{ field: string }>("SELECT DISTINCT field FROM profile_facts WHERE user_id = $1", [currentUser()]);
  return new Set(rows.map((r) => r.field));
}

// ---------------------------------------------------------------- conversaciones

export type StoredMessage = Anthropic.Beta.BetaUserMessageParam | Anthropic.Beta.BetaAssistantMessageParam;

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export async function createConversation(title: string): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db.query("INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)", [id, currentUser(), title.slice(0, 80) || "Conversación"]);
  return id;
}

export async function conversationExists(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query("SELECT 1 FROM conversations WHERE id = $1 AND user_id = $2", [id, currentUser()])).length > 0;
}

export async function listConversations(limit = 50): Promise<ConversationSummary[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; title: string; created_at: Date; updated_at: Date }>(
    "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2",
    [currentUser(), limit],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) }));
}

/** Historial exacto que se reenvía a la API (los mensajes nunca se editan: solo se añaden). */
export async function getMessages(conversationId: string): Promise<StoredMessage[]> {
  const db = await getDb();
  const rows = await db.query<{ role: "user" | "assistant"; content: StoredMessage["content"] }>(
    `SELECT m.role, m.content FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = $1 AND c.user_id = $2 ORDER BY m.id`,
    [conversationId, currentUser()],
  );
  return rows.map((r) => ({ role: r.role, content: r.content }) as StoredMessage);
}

export async function appendMessage(conversationId: string, message: StoredMessage): Promise<void> {
  const db = await getDb();
  const user = currentUser();
  // solo se escribe en conversaciones del usuario actual
  await db.query(
    `INSERT INTO messages (conversation_id, role, content)
     SELECT $1, $2, $3::jsonb WHERE EXISTS (SELECT 1 FROM conversations WHERE id = $1 AND user_id = $4)`,
    [conversationId, message.role, JSON.stringify(message.content), user],
  );
  await db.query("UPDATE conversations SET updated_at = now() WHERE id = $1 AND user_id = $2", [conversationId, user]);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.query("DELETE FROM conversations WHERE id = $1 AND user_id = $2", [id, currentUser()]);
}

// ---------------------------------------------------------------- viviendas

interface HomeRow {
  id: string;
  listing: HomeListing;
  status: HomeStatus;
  notes: string | null;
  saved_verdict: string | null;
  created_at: Date;
  updated_at: Date;
  prices: { price: number; seen_at: string }[] | null;
}

const HOME_SELECT = `
  SELECT h.id, h.listing, h.status, h.notes, h.saved_verdict, h.created_at, h.updated_at,
         (SELECT json_agg(json_build_object('price', p.price, 'seen_at', p.seen_at) ORDER BY p.seen_at)
            FROM home_prices p WHERE p.user_id = h.user_id AND p.home_id = h.id) AS prices
    FROM homes h
   WHERE h.user_id = $1`;

const toHome = (r: HomeRow): SavedHome => ({
  id: r.id,
  listing: { ...r.listing, id: r.id },
  status: r.status,
  notes: r.notes,
  savedVerdict: r.saved_verdict,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
  prices: (r.prices ?? []).map((p) => ({ price: p.price, seenAt: iso(p.seen_at) })),
});

export async function listHomes(opts: { includeDiscarded?: boolean } = {}): Promise<SavedHome[]> {
  const db = await getDb();
  const filter = opts.includeDiscarded ? "" : "AND h.status <> 'descartada'";
  return (await db.query<HomeRow>(`${HOME_SELECT} ${filter} ORDER BY h.updated_at DESC`, [currentUser()])).map(toHome);
}

export async function getHome(id: string): Promise<SavedHome | null> {
  const db = await getDb();
  const [row] = await db.query<HomeRow>(`${HOME_SELECT} AND h.id = $2`, [currentUser(), id]);
  return row ? toHome(row) : null;
}

/**
 * Guarda una vivienda. Si ya existe (misma URL de Idealista o mismo id) la actualiza y, si el precio ha
 * cambiado, lo apunta en el histórico de precios.
 */
export async function saveHome(
  listing: HomeListing,
  opts: { status?: HomeStatus; notes?: string; verdict?: string } = {},
): Promise<{ home: SavedHome; created: boolean; previousPrice: number | null }> {
  const db = await getDb();
  const user = currentUser();
  const id = homeIdFromUrl(listing.url) ?? (listing.id && (await getHome(listing.id)) ? listing.id : `manual-${randomUUID().slice(0, 8)}`);
  const existing = await getHome(id);
  const data = { ...existing?.listing, ...listing, id };
  const price = Math.round(listing.price);

  if (existing) {
    await db.query(
      `UPDATE homes SET title = $3, price = $4, listing = $5::jsonb, status = COALESCE($6, status),
              notes = COALESCE($7, notes), updated_at = now() WHERE user_id = $1 AND id = $2`,
      [user, id, data.title, price, JSON.stringify(data), opts.status ?? null, opts.notes ?? null],
    );
  } else {
    await db.query(
      "INSERT INTO homes (user_id, id, title, price, listing, status, notes, saved_verdict) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)",
      [user, id, data.title, price, JSON.stringify(data), opts.status ?? "interesa", opts.notes ?? null, opts.verdict ?? null],
    );
  }
  const previousPrice = existing ? existing.listing.price : null;
  if (!existing || previousPrice !== price) await db.query("INSERT INTO home_prices (user_id, home_id, price) VALUES ($1, $2, $3)", [user, id, price]);
  return { home: (await getHome(id))!, created: !existing, previousPrice: previousPrice !== price ? previousPrice : null };
}

export async function updateHome(id: string, patch: { status?: HomeStatus; notes?: string; price?: number }): Promise<SavedHome | null> {
  const home = await getHome(id);
  if (!home) return null;
  if (patch.price != null && Math.round(patch.price) !== home.listing.price) {
    return (await saveHome({ ...home.listing, price: patch.price }, { status: patch.status, notes: patch.notes })).home;
  }
  const db = await getDb();
  await db.query(
    "UPDATE homes SET status = COALESCE($3, status), notes = COALESCE($4, notes), updated_at = now() WHERE user_id = $1 AND id = $2",
    [currentUser(), id, patch.status ?? null, patch.notes ?? null],
  );
  return getHome(id);
}

export async function removeHome(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query("DELETE FROM homes WHERE user_id = $1 AND id = $2 RETURNING id", [currentUser(), id])).length > 0;
}

// ---------------------------------------------------------------- ofertas de bancos

export async function listOffers(): Promise<ReceivedOffer[]> {
  const db = await getDb();
  const rows = await db.query<{ id: string; offer: ReceivedOffer }>("SELECT id, offer FROM bank_offers WHERE user_id = $1 ORDER BY created_at", [
    currentUser(),
  ]);
  return rows.map((r) => ({ ...r.offer, id: r.id }));
}

/** Guarda una oferta; con id de una existente, la sustituye. */
export async function saveOffer(offer: Omit<ReceivedOffer, "id"> & { id?: string }): Promise<{ offer: ReceivedOffer; created: boolean }> {
  const db = await getDb();
  const user = currentUser();
  const existing = offer.id ? (await db.query("SELECT 1 FROM bank_offers WHERE user_id = $1 AND id = $2", [user, offer.id])).length > 0 : false;
  const id = existing ? offer.id! : `oferta-${randomUUID().slice(0, 8)}`;
  const data: ReceivedOffer = { ...offer, id };
  await db.query(
    `INSERT INTO bank_offers (user_id, id, bank, offer) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, id) DO UPDATE SET bank = EXCLUDED.bank, offer = EXCLUDED.offer, updated_at = now()`,
    [user, id, data.bank, JSON.stringify(data)],
  );
  return { offer: data, created: !existing };
}

export async function removeOffer(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query("DELETE FROM bank_offers WHERE user_id = $1 AND id = $2 RETURNING id", [currentUser(), id])).length > 0;
}
