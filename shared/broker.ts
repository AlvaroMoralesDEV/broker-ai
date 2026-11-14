// Lo que el agente sabe de ti y de las viviendas que guardas, y las reglas para revisar un anuncio.
// Las reglas son código a propósito: se pueden leer, discutir y testear, y cada alerta dice por qué salta.
import type { Listing } from "./listings.ts";
import type { CCAA } from "./taxes.ts";

export const HOME_STATUSES = ["interesa", "visitar", "visitada", "oferta", "descartada"] as const;
export type HomeStatus = (typeof HOME_STATUSES)[number];

export const CONTRACT_TYPES = ["indefinido", "temporal", "autonomo", "funcionario", "otro"] as const;

/** Lo que no necesita el motor de cálculo pero sí un bróker (y el banco). */
export interface ProfileExtra {
  contractType?: (typeof CONTRACT_TYPES)[number];
  yearsInJob?: number;
  /** neto por paga y número de pagas: el motor usa el equivalente mensual (neto × pagas / 12) */
  netPay?: number;
  pagas?: number;
  coBuyer?: boolean;
  coBuyerNetPay?: number;
  coBuyerPagas?: number;
  monthlyExpenses?: number;
  familyHelp?: number;
  monthlySaving?: number;
  targetZones?: string[];
  mustHaves?: string[];
  timeline?: string;
  notes?: string;
}

/** Datos mínimos que conviene tener antes de dar un presupuesto fiable, con cómo preguntarlos. */
export const KEY_FACTS: { key: string; label: string; ask: string; question: string }[] = [
  { key: "savings", label: "Ahorros", ask: "ahorros disponibles para la compra", question: "¿Cuánto tienes ahorrado para la compra?" },
  {
    key: "netIncome",
    label: "Sueldo",
    ask: "sueldo neto por paga y número de pagas (12 o 14)",
    question: "¿Cuánto cobras neto en cada nómina y cuántas pagas tienes (12 o 14)?",
  },
  {
    key: "contractType",
    label: "Contrato",
    ask: "tipo de contrato y antigüedad",
    question: "¿Qué tipo de contrato tienes: indefinido, temporal, autónomo o funcionario?",
  },
  {
    key: "monthlyDebts",
    label: "Deudas",
    ask: "otras deudas mensuales (coche, préstamos, tarjetas)",
    question: "¿Pagas alguna deuda cada mes (coche, préstamos, tarjetas)? Si no tienes, dime «no tengo deudas».",
  },
  { key: "coBuyer", label: "Solo o en pareja", ask: "si compra solo o con otra persona, y sus ingresos", question: "¿Compras solo o con otra persona?" },
  { key: "ccaa", label: "Dónde", ask: "comunidad autónoma donde quiere comprar", question: "¿En qué ciudad o comunidad quieres comprar?" },
  { key: "targetZones", label: "Zonas", ask: "zonas que le interesan", question: "¿Qué barrios o zonas te interesan?" },
  { key: "timeline", label: "Plazo", ask: "cuándo quiere comprar", question: "¿Para cuándo te gustaría comprar?" },
];

/** Datos clave que faltan, dados los campos que el usuario ha dado alguna vez. */
export function missingKeyFacts(given: Iterable<string>) {
  const g = new Set(given);
  if (g.has("netPay")) g.add("netIncome");
  return KEY_FACTS.filter((f) => !g.has(f.key));
}

/** Anuncio de una vivienda: los campos de Listing más lo que suele venir en el texto del anuncio. */
export interface HomeListing extends Listing {
  ccaa?: CCAA | null;
  communityFees?: number | null;
  ibiYearly?: number | null;
  energyRating?: string | null;
  yearBuilt?: number | null;
}

export interface SavedHome {
  id: string;
  listing: HomeListing;
  status: HomeStatus;
  notes: string | null;
  savedVerdict: string | null;
  createdAt: string;
  updatedAt: string;
  prices: { price: number; seenAt: string }[];
}

export interface RedFlag {
  level: "alto" | "medio";
  label: string;
  why: string;
  /** el trozo del anuncio que la ha hecho saltar */
  evidence?: string;
}

/** Id estable a partir de la URL de Idealista, para no duplicar una vivienda al pegarla dos veces. */
export function homeIdFromUrl(url: string | null | undefined): string | null {
  const m = url?.match(/idealista\.com\/(?:[a-z]{2}\/)?inmueble\/(\d+)/i);
  return m ? `idealista-${m[1]}` : null;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");

interface TextRule {
  level: RedFlag["level"];
  label: string;
  why: string;
  re: RegExp;
}

const TEXT_RULES: TextRule[] = [
  {
    level: "alto",
    label: "Ocupada o sin posesión",
    why: "No podrás visitarla ni entrar a vivir, y los bancos casi nunca la financian.",
    re: /\b(ocupad[ao]s?|okupa\w*|sin posesion|no se puede visitar)\b/,
  },
  {
    level: "alto",
    label: "Nuda propiedad",
    why: "Compras la propiedad sin poder usarla mientras viva el usufructuario.",
    re: /\b(nuda propiedad|usufructo\w*)\b/,
  },
  {
    level: "alto",
    label: "Subasta o procedimiento judicial",
    why: "Cesión de remate o adjudicación: riesgo legal, sin visita y difícil de hipotecar.",
    re: /\b(subasta|cesion de remate|adjudicacion judicial|procedimiento judicial)\b/,
  },
  {
    level: "alto",
    label: "Solo una parte de la vivienda",
    why: "Se vende un porcentaje (proindiviso): no podrás usarla en exclusiva y el banco no la financia.",
    re: /\b(proindiviso|pro indiviso|\d{1,2} ?% de la (vivienda|propiedad))\b/,
  },
  {
    level: "alto",
    label: "Local o cambio de uso",
    why: "Puede no tener cédula de habitabilidad ni uso de vivienda; el banco tasará bajo o no financiará.",
    re: /\b(cambio de uso|antiguo local|local reconvertido|uso (no residencial|comercial)|sin cedula)\b/,
  },
  {
    level: "medio",
    label: "Se vende alquilada",
    why: "El inquilino puede quedarse hasta el fin del contrato: no es vivienda habitual inmediata.",
    re: /\b(alquilad[ao]|inquilin[oa]s?|con renta|rentabilidad)\b/,
  },
  {
    level: "medio",
    label: "Vivienda protegida",
    why: "Precio máximo legal, requisitos para el comprador y autorización para venderla más adelante.",
    re: /\b(vpo|vpp|proteccion oficial|vivienda protegida|precio tasado)\b/,
  },
  {
    level: "medio",
    label: "Derrama",
    why: "Hay o habrá una derrama: pregunta el importe y quién la paga.",
    re: /\bderramas?\b/,
  },
  {
    level: "medio",
    label: "Inspección técnica pendiente",
    why: "ITE/IEE desfavorable o pendiente: puede haber obras obligatorias y derramas.",
    re: /\b(ite|iee) (desfavorable|pendiente)\b/,
  },
  {
    level: "medio",
    label: "Necesita reforma",
    why: "La hipoteca no financia la reforma: presupuéstala y súmala a los ahorros que necesitas.",
    re: /\b(a reformar|para reformar|necesita reforma|reforma integral|para entrar a reformar)\b/,
  },
];

/** "no está ocupada", "sin inquilinos", "libre de ocupantes"... no son alertas. */
const NEGATED = /\b(no|sin|libre de|nunca)( (esta|ha estado|tiene|hay))? ?$/;

function snippet(text: string, index: number, length: number) {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

export function redFlags(l: HomeListing): RedFlag[] {
  const flags: RedFlag[] = [];
  const text = norm([l.title, l.description].filter(Boolean).join(". "));

  for (const rule of TEXT_RULES) {
    const re = new RegExp(rule.re.source, "g");
    for (const m of text.matchAll(re)) {
      if (NEGATED.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
      flags.push({ level: rule.level, label: rule.label, why: rule.why, evidence: snippet(text, m.index, m[0].length) });
      break;
    }
  }

  const floor = norm(l.floor ?? "");
  const floorNum = Number.parseInt(floor, 10);
  if (/sotano/.test(floor)) {
    flags.push({ level: "medio", label: "Sótano o semisótano", why: "Menos luz y ventilación, y más difícil de revender." });
  }
  if (l.hasLift === false && Number.isFinite(floorNum) && floorNum >= 3) {
    flags.push({ level: "medio", label: `Planta ${floorNum} sin ascensor`, why: "Afecta al día a día y a la reventa; pregunta si hay proyecto de instalarlo (derrama)." });
  }
  const rating = l.energyRating?.trim().toUpperCase();
  if (rating === "F" || rating === "G") {
    flags.push({ level: "medio", label: `Certificado energético ${rating}`, why: "Facturas altas de calefacción y refrigeración; algunos bancos dan mejor tipo a A-B." });
  }
  if (l.yearBuilt && l.yearBuilt < 1980) {
    flags.push({ level: "medio", label: `Edificio de ${l.yearBuilt}`, why: "Pide la ITE/IEE y las actas de la comunidad: en edificios antiguos son habituales las derramas." });
  }
  return flags;
}

/** Ingresos netos mensuales del hogar (equivalente en 12 meses) a partir de nóminas y pagas. */
export function householdMonthlyIncome(e: ProfileExtra): number | null {
  if (e.netPay == null) return null;
  const own = (e.netPay * (e.pagas ?? 12)) / 12;
  const other = e.coBuyer && e.coBuyerNetPay != null ? (e.coBuyerNetPay * (e.coBuyerPagas ?? 12)) / 12 : 0;
  return Math.round(own + other);
}

/** Lo que el agente extrae de un anuncio pegado (texto o captura). */
export interface ListingInput {
  title: string;
  price: number;
  url?: string;
  size?: number;
  rooms?: number;
  bathrooms?: number;
  floor?: string;
  hasLift?: boolean;
  exterior?: boolean;
  parking?: boolean;
  newBuild?: boolean;
  address?: string;
  district?: string;
  municipality?: string;
  province?: string;
  ccaa?: CCAA;
  description?: string;
  communityFees?: number;
  ibiYearly?: number;
  energyRating?: string;
  yearBuilt?: number;
}

export function toHomeListing(i: ListingInput, id = homeIdFromUrl(i.url) ?? "nueva"): HomeListing {
  return {
    id,
    title: i.title,
    price: Math.round(i.price),
    size: i.size ?? null,
    rooms: i.rooms ?? null,
    bathrooms: i.bathrooms ?? null,
    floor: i.floor ?? null,
    hasLift: i.hasLift ?? null,
    exterior: i.exterior ?? null,
    parking: i.parking ?? null,
    newDevelopment: i.newBuild ?? false,
    address: i.address ?? "",
    district: i.district ?? null,
    municipality: i.municipality ?? "",
    province: i.province ?? null,
    pricePerM2: i.size ? Math.round(i.price / i.size) : null,
    thumbnail: null,
    url: i.url ?? null,
    description: i.description ?? null,
    source: i.url?.includes("idealista") ? "idealista" : "manual",
    ccaa: i.ccaa ?? null,
    communityFees: i.communityFees ?? null,
    ibiYearly: i.ibiYearly ?? null,
    energyRating: i.energyRating ?? null,
    yearBuilt: i.yearBuilt ?? null,
  };
}

/** Coste mensual de tener la vivienda: hipoteca + comunidad + IBI prorrateado. */
export function monthlyOwnership(l: HomeListing, payment: number) {
  const community = l.communityFees ?? 0;
  const ibi = (l.ibiYearly ?? 0) / 12;
  return { payment, community, ibi, total: payment + community + ibi };
}

/** Primer enlace de un mensaje, sin la puntuación que lo cierra. */
export function linkIn(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return m ? m[0].replace(/[.,;:!?]+$/, "") : null;
}

/**
 * Vivienda guardada solo con su enlace: el agente no puede abrir páginas, así que hasta que el
 * usuario pegue el anuncio no tiene precio ni datos. No se analiza ni entra en las comparativas.
 */
export const isLinkOnly = (l: { price: number }): boolean => !(l.price > 0);

/** El "anuncio" de una vivienda de la que solo se conoce el enlace (precio 0 = sin datos). */
export function linkListing(url: string): ListingInput {
  const idealista = homeIdFromUrl(url)?.replace("idealista-", "");
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // enlace mal formado: se guarda igual, con un título genérico
  }
  return { title: idealista ? `Anuncio de Idealista ${idealista}` : `Anuncio en ${host || "la web"}`, price: 0, url };
}
