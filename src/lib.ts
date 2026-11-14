import { useCallback, useEffect, useRef, useState } from "react";
import ratesJson from "../data/rates.json";
import type { HomeStatus, ListingInput, ProfileExtra, SavedHome } from "../shared/broker.ts";
import { DEFAULT_PROFILE, type Offer, type Profile } from "../shared/finance.ts";
import type { ReceivedOffer } from "../shared/offers.ts";

export interface Rates {
  updated: string;
  euribor: { monthlyAvg: number; month: string; daily: number; dailyDate: string; note: string };
  sources: { name: string; url: string }[];
  offers: Offer[];
}

/** Copia incluida al compilar; refreshRates() la sustituye por la del servidor (data/rates.json de hoy). */
export const RATES = ratesJson as Rates;

export async function refreshRates(): Promise<void> {
  try {
    const r = await fetch("/api/rates");
    if (r.ok) Object.assign(RATES, (await r.json()) as Rates);
  } catch {
    // sin servidor se usan los tipos con los que se compiló la web
  }
}

export const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;
export const pct = (n: number, d = 2) => `${n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
export const dateEs = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------------------------------------------------------------- usuario de esta pestaña

function storageGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(store: Storage, key: string, value: string) {
  try {
    store.setItem(key, value);
  } catch {
    // sin almacenamiento: el usuario dura lo que la página
  }
}

/**
 * Usuario de esta pestaña: ?u= en la URL, si no el de esta pestaña (sessionStorage), si no el último
 * usado (localStorage). Así puedes tener a dos personas abiertas a la vez, una en cada pestaña.
 */
export const USER: string = (() => {
  const u =
    new URLSearchParams(location.search).get("u") || storageGet(sessionStorage, "hs.user") || storageGet(localStorage, "hs.user") || "default";
  storageSet(sessionStorage, "hs.user", u);
  storageSet(localStorage, "hs.user", u);
  return u;
})();

/** Cambia de usuario en esta pestaña y recarga para empezar limpio. */
export function switchUser(id: string) {
  storageSet(sessionStorage, "hs.user", id);
  storageSet(localStorage, "hs.user", id);
  const url = new URL(location.href);
  url.searchParams.delete("u");
  url.searchParams.delete("c");
  location.href = url.toString();
}

/** Añade el usuario a cada llamada a /api. Si el usuario ya no existe, vuelve al principal. */
export function installUserHeader() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (!url.startsWith("/api")) return original(input, init);
    const headers = new Headers(init.headers);
    headers.set("X-Broker-User", USER);
    const res = await original(input, { ...init, headers });
    if (res.headers.get("X-Unknown-User") && USER !== "default") switchUser("default");
    return res;
  };
}

export interface User {
  id: string;
  name: string;
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const reload = useCallback(
    () =>
      fetch("/api/users")
        .then((r) => (r.ok ? r.json() : []))
        .then(setUsers)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const create = async (name: string) => {
    const r = await fetch("/api/users", json("POST", { name }));
    if (r.ok) switchUser(((await r.json()) as User).id);
  };
  const rename = async (id: string, name: string) => {
    await fetch(`/api/users/${id}`, json("PATCH", { name }));
    reload();
  };
  const remove = async (id: string) => {
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (id === USER) switchUser("default");
    else reload();
  };
  return { users, current: users.find((u) => u.id === USER) ?? null, create, rename, remove };
}

/** Ofertas que le han dado los bancos a este usuario. */
export function useOffers() {
  const [offers, setOffers] = useState<ReceivedOffer[]>([]);
  const reload = useCallback(
    () =>
      fetch("/api/offers")
        .then((r) => (r.ok ? r.json() : []))
        .then(setOffers)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const save = async (offer: Omit<ReceivedOffer, "id"> & { id?: string }) => {
    const r = await fetch("/api/offers", json("POST", offer));
    if (r.ok) await reload();
    return r.ok;
  };
  const remove = async (id: string) => {
    await fetch(`/api/offers/${encodeURIComponent(id)}`, { method: "DELETE" });
    setOffers((list) => list.filter((o) => o.id !== id));
  };
  return { offers, reload, save, remove };
}
export type OffersStore = ReturnType<typeof useOffers>;

/** useState que se guarda en localStorage. */
export function useStored<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const parsed = JSON.parse(raw);
        const init = typeof initial === "function" ? (initial as () => T)() : initial;
        return init && typeof init === "object" && !Array.isArray(init) ? { ...init, ...parsed } : parsed;
      }
    } catch {
      // almacenamiento no disponible: se usa el valor inicial
    }
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // sin almacenamiento
    }
  }, [key, value]);
  return [value, setValue] as const;
}


export interface ProfileState {
  profile: Profile;
  extra: ProfileExtra;
  /** null mientras carga; false si el usuario aún no ha dado ningún dato */
  known: boolean | null;
  /** claves de KEY_FACTS que aún no ha dado */
  missing: string[];
}

/**
 * Perfil del usuario. La fuente de verdad es el servidor (lo actualizan el formulario, el agente y el
 * servidor MCP). El formulario envía solo los campos que cambian, agrupados cada 800 ms.
 */
export function useProfile() {
  const [state, setState] = useState<ProfileState>({ profile: DEFAULT_PROFILE, extra: {}, known: null, missing: [] });
  const pending = useRef<Partial<Profile>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(
    () =>
      fetch("/api/profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: (Omit<ProfileState, "missing"> & { facts: { missing: string[] } }) | null) => {
          if (d) setState({ profile: d.profile, extra: d.extra, known: d.known, missing: d.facts.missing });
        })
        .catch(() => {}),
    [],
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const update = (patch: Partial<Profile>) => {
    setState((s) => ({ ...s, profile: { ...s.profile, ...patch } }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const body = { profile: pending.current };
      pending.current = {};
      fetch("/api/profile", json("PATCH", body)).then(reload).catch(() => {});
    }, 800);
  };
  return { ...state, update, reload };
}

/** Viviendas guardadas: las usan el chat (tarjetas), el panel lateral y «Mis viviendas». */
export function useHomes() {
  const [homes, setHomes] = useState<SavedHome[]>([]);
  const reload = useCallback(
    () =>
      fetch("/api/homes?all=1")
        .then((r) => (r.ok ? r.json() : []))
        .then(setHomes)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const save = async (listing: ListingInput) => {
    const r = await fetch("/api/homes", json("POST", { listing }));
    if (r.ok) await reload();
    return r.ok;
  };
  const patch = async (id: string, body: { status?: HomeStatus; notes?: string }) => {
    const r = await fetch(`/api/homes/${encodeURIComponent(id)}`, json("PATCH", body));
    if (r.ok) {
      const updated: SavedHome = await r.json();
      setHomes((list) => list.map((h) => (h.id === id ? updated : h)));
    }
  };
  const remove = async (id: string) => {
    await fetch(`/api/homes/${encodeURIComponent(id)}`, { method: "DELETE" });
    setHomes((list) => list.filter((h) => h.id !== id));
  };
  return { homes, reload, save, patch, remove };
}
export type HomesStore = ReturnType<typeof useHomes>;

export interface Provider {
  kind: "anthropic" | "ollama" | "none";
  model: string | null;
  label: string;
  vision: boolean;
  hint: string | null;
}

export interface Status {
  db: "postgres" | "pglite";
  provider: Provider;
}

export function useStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then(setStatus)
        .catch(() => setStatus(null));
    load();
    // por si arrancas Ollama o cambias la clave con la página abierta
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);
  return status;
}
