import { useCallback, useEffect, useRef, useState } from "react";
import ratesJson from "../data/rates.json";
import type { HomeStatus, ListingInput, ProfileExtra, SavedHome } from "../shared/broker.ts";
import { DEFAULT_PROFILE, type Offer, type Profile } from "../shared/finance.ts";

export interface Rates {
  updated: string;
  euribor: { monthlyAvg: number; month: string; daily: number; dailyDate: string; note: string };
  sources: { name: string; url: string }[];
  offers: Offer[];
}

export const RATES = ratesJson as Rates;

export const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;
export const pct = (n: number, d = 2) => `${n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
export const dateEs = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });

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

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

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
