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

/** Perfil del usuario: se guarda en el navegador y se copia al servidor (para el servidor MCP). */
export function useProfile() {
  const [profile, setProfile] = useStored<Profile>("hs.profile", DEFAULT_PROFILE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) }).catch(() => {});
    }, 800);
  }, [profile]);
  const update = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));
  return [profile, update] as const;
}

export interface Status {
  idealista: boolean;
  ai: boolean;
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
