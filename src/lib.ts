import { useEffect, useRef, useState } from "react";
import ratesJson from "../data/rates.json";
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

/**
 * Perfil del usuario. La fuente de verdad es el servidor (lo actualizan el formulario, el agente y el
 * servidor MCP). El formulario envía solo los campos que cambian, agrupados cada 800 ms.
 */
export function useProfile() {
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE);
  const [known, setKnown] = useState<boolean | null>(null);
  const pending = useRef<Partial<Profile>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = () =>
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { profile: Profile; known: boolean } | null) => {
        if (!d) return;
        setProfile(d.profile);
        setKnown(d.known);
      })
      .catch(() => {});

  useEffect(() => {
    reload();
  }, []);

  const update = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    pending.current = { ...pending.current, ...patch };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const body = JSON.stringify({ profile: pending.current });
      pending.current = {};
      fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
        .then((r) => r.ok && setKnown(true))
        .catch(() => {});
    }, 800);
  };
  /** el agente ha cambiado el perfil: se pinta sin volver a enviarlo */
  const replace = (p: Profile) => {
    setProfile(p);
    setKnown(true);
  };
  return { profile, known, update, replace, reload };
}

export interface Status {
  ai: boolean;
  db: "postgres" | "pglite";
  model: string;
}

export function useStatus(): Status | null {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  return status;
}
