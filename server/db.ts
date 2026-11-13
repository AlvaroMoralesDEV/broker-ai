// Base de datos: Postgres si hay DATABASE_URL (docker compose), y si no, PGlite (Postgres embebido
// en un archivo de data/pglite). Mismo SQL en los dos casos, así `npm run dev` funciona sin Docker.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Db {
  kind: "postgres" | "pglite";
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** varias sentencias seguidas, sin parámetros (migraciones) */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));

async function postgres(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  return {
    kind: "postgres",
    query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
    exec: async (sql) => void (await pool.query(sql)),
    close: () => pool.end(),
  };
}

/** dataDir: carpeta del archivo; "memory://" para una base de datos en memoria (tests). */
async function pglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dataDir.startsWith("memory://")) mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);
  return {
    kind: "pglite",
    query: async <T>(sql: string, params?: unknown[]) => (await db.query<T>(sql, params)).rows,
    exec: async (sql) => void (await db.exec(sql)),
    close: () => db.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    await db.exec(readFileSync(MIGRATIONS + file, "utf8"));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
  }
}

export async function openDb(target = process.env.DATABASE_URL): Promise<Db> {
  const db = target?.startsWith("postgres")
    ? await postgres(target)
    : await pglite(target || fileURLToPath(new URL("../data/pglite", import.meta.url)));
  await migrate(db);
  return db;
}

let shared: Promise<Db> | null = null;
/** Conexión compartida por el servidor web y el servidor MCP. */
export const getDb = () => (shared ??= openDb());
/** Para los tests: usa otra base de datos (p. ej. openDb("memory://")). */
export const setDb = (db: Db) => void (shared = Promise.resolve(db));
