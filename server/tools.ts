// Herramientas compartidas por el asistente de la web (Claude API) y por el servidor MCP.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { DEFAULT_PROFILE, affordability, analyzePurchase, maxTermYears, quoteOffer, type Offer, type Profile } from "../shared/finance.ts";
import type { Listing, SearchResult } from "../shared/listings.ts";
import { CCAA_IDS, ccaaName } from "../shared/taxes.ts";
import { searchHomes } from "./search.ts";

export interface RatesFile {
  updated: string;
  euribor: { monthlyAvg: number; month: string; daily: number; dailyDate: string; note: string };
  sources: { name: string; url: string }[];
  offers: Offer[];
}

const DATA = new URL("../data/", import.meta.url);

export const loadRates = (): RatesFile => JSON.parse(readFileSync(new URL("rates.json", DATA), "utf8"));

/** Perfil guardado por la web (data/profile.json); si no existe, el de ejemplo. */
export function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(readFileSync(new URL("profile.json", DATA), "utf8")) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

const profileOverride = z
  .object({
    age: z.number().int().min(18).max(80),
    netIncome: z.number().min(0).describe("Ingresos netos mensuales del hogar, en euros"),
    monthlyDebts: z.number().min(0).describe("Cuotas mensuales de otras deudas"),
    savings: z.number().min(0).describe("Ahorros disponibles para la compra"),
    ccaa: z.enum(CCAA_IDS).describe("Comunidad autónoma donde se compra"),
    firstHome: z.boolean().describe("Primera vivienda habitual"),
    newBuild: z.boolean().describe("Obra nueva (IVA) en lugar de segunda mano (ITP)"),
  })
  .partial()
  .describe("Cambios puntuales sobre el perfil guardado del usuario. Omítelo para usar su perfil tal cual.");

const mortgage = {
  ratePct: z.number().min(0).max(15).optional().describe("TIN anual en %. Por defecto, el del perfil."),
  years: z.number().int().min(1).max(40).optional().describe("Plazo en años. Por defecto, el del perfil."),
  ltvPct: z.number().min(0).max(100).optional().describe("% del precio que financia el banco (80 habitual, 90-95 para jóvenes)."),
};

const r0 = (n: number) => Math.round(n);

export interface ToolContext {
  profile: Profile;
  /** se llama con el resultado completo de cada búsqueda (para pintarlo en la web) */
  onListings?: (result: SearchResult, analyzed: AnalyzedListing[]) => void;
}

export interface AnalyzedListing extends Listing {
  payment: number;
  cashNeeded: number;
  savingsGap: number;
  verdict: "ok" | "justo" | "no";
}

export function analyzeListings(profile: Profile, listings: Listing[]): AnalyzedListing[] {
  return listings.map((l) => {
    const a = analyzePurchase({ ...profile, newBuild: l.newDevelopment || profile.newBuild }, l.price);
    return { ...l, payment: a.payment, cashNeeded: a.cashNeeded, savingsGap: a.savingsGap, verdict: a.verdict };
  });
}

const withProfile = (ctx: ToolContext, o?: Partial<Profile>): Profile => ({ ...ctx.profile, ...(o ?? {}) });

function summary(a: ReturnType<typeof analyzePurchase>) {
  return {
    precio: a.price,
    hipoteca: r0(a.loan),
    entrada: r0(a.downPayment),
    impuestos: { importe: r0(a.tax.amount), tipo: a.tax.label, nota: a.tax.note },
    otros_gastos: r0(a.otherCosts),
    ahorros_necesarios: r0(a.cashNeeded),
    ahorros_que_faltan: r0(a.savingsGap),
    cuota_mensual: r0(a.payment),
    cuota_prestamo_personal_si_falta_entrada: r0(a.personalLoanPayment),
    cuota_maxima_recomendada: r0(a.maxPayment),
    esfuerzo_pct_ingresos: Number(a.effortPct.toFixed(1)),
    intereses_totales: r0(a.totalInterest),
    tin_pct: a.ratePct,
    plazo_anos: a.years,
    veredicto: a.verdict,
    motivos: a.reasons,
  };
}

export const TOOLS = {
  get_profile: {
    description:
      "Devuelve el perfil financiero guardado del usuario (edad, ingresos, ahorros, comunidad, condiciones de hipoteca) y su presupuesto máximo de compra.",
    schema: z.object({}),
    run: async (_input: Record<string, never>, ctx: ToolContext) => {
      const p = ctx.profile;
      const a = affordability(p);
      return {
        perfil: { ...p, comunidad: ccaaName(p.ccaa), plazo_maximo_por_edad: maxTermYears(p.age) },
        presupuesto: { precio_maximo: a.maxPrice, cuota_maxima: r0(a.maxPayment), hipoteca_maxima: r0(a.maxLoan), limitado_por: a.limiting },
      };
    },
  },

  max_budget: {
    description:
      "Calcula el precio máximo de vivienda que el usuario puede permitirse según ingresos (ratio de endeudamiento) y ahorros (entrada + impuestos + gastos). Permite probar otros tipos, plazos, % de financiación o cambios en el perfil.",
    schema: z.object({ ...mortgage, profile: profileOverride.optional() }),
    run: async (input: { ratePct?: number; years?: number; ltvPct?: number; profile?: Partial<Profile> }, ctx: ToolContext) => {
      const p = withProfile(ctx, input.profile);
      const a = affordability(p, input);
      return {
        precio_maximo: a.maxPrice,
        precio_maximo_por_ingresos: r0(a.priceByIncome),
        precio_maximo_por_ahorros: r0(a.priceBySavings),
        limitado_por: a.limiting,
        cuota_maxima: r0(a.maxPayment),
        hipoteca_maxima: r0(a.maxLoan),
        detalle_al_precio_maximo: a.maxPrice > 0 ? summary(analyzePurchase(p, a.maxPrice, input)) : null,
      };
    },
  },

  analyze_purchase: {
    description:
      "Analiza la compra de una vivienda de un precio concreto: hipoteca, entrada, impuestos de la comunidad, gastos, ahorros necesarios, cuota mensual, esfuerzo sobre ingresos y veredicto (ok / justo / no).",
    schema: z.object({ price: z.number().min(1000).describe("Precio de la vivienda en euros"), ...mortgage, profile: profileOverride.optional() }),
    run: async (input: { price: number; ratePct?: number; years?: number; ltvPct?: number; profile?: Partial<Profile> }, ctx: ToolContext) =>
      summary(analyzePurchase(withProfile(ctx, input.profile), input.price, input)),
  },

  search_homes: {
    description:
      "Busca viviendas en venta en una zona de España (API de Idealista; si no hay credenciales devuelve viviendas de EJEMPLO inventadas, y lo indica en 'fuente'). Cada resultado incluye la cuota estimada, los ahorros necesarios y si encaja con el perfil del usuario. Si no se indica precio máximo se usa el presupuesto máximo del usuario.",
    schema: z.object({
      zone: z.string().min(2).describe("Ciudad, barrio o municipio, p. ej. 'Ruzafa, Valencia'"),
      maxPrice: z.number().optional().describe("Precio máximo en euros. Si se omite, el presupuesto máximo del usuario."),
      minPrice: z.number().optional(),
      minRooms: z.number().int().min(0).max(4).optional().describe("Habitaciones mínimas"),
      minSize: z.number().optional().describe("Superficie mínima en m²"),
      radiusKm: z.number().min(0.5).max(50).optional().describe("Radio de búsqueda alrededor de la zona (por defecto 5 km)"),
      includeOverBudget: z.boolean().optional().describe("true para no limitar por el presupuesto del usuario"),
      profile: profileOverride.optional(),
    }),
    run: async (
      input: { zone: string; maxPrice?: number; minPrice?: number; minRooms?: number; minSize?: number; radiusKm?: number; includeOverBudget?: boolean; profile?: Partial<Profile> },
      ctx: ToolContext,
    ) => {
      const p = withProfile(ctx, input.profile);
      const budget = affordability(p).maxPrice;
      const maxPrice = input.maxPrice ?? (input.includeOverBudget ? undefined : budget);
      const result = await searchHomes({ ...input, maxPrice });
      // los impuestos dependen de la comunidad de la vivienda, no de la del perfil
      const analyzed = analyzeListings(result.ccaa ? { ...p, ccaa: result.ccaa } : p, result.listings);
      ctx.onListings?.(result, analyzed);
      return {
        fuente: result.source === "idealista" ? "Idealista (anuncios reales)" : "EJEMPLO: viviendas inventadas, no son anuncios reales",
        aviso: result.notice,
        zona: result.zone,
        presupuesto_maximo_usuario: budget,
        precio_maximo_aplicado: maxPrice ?? null,
        total: result.total,
        viviendas: analyzed.slice(0, 20).map((l) => ({
          titulo: l.title,
          precio: l.price,
          m2: l.size,
          habitaciones: l.rooms,
          eur_m2: l.pricePerM2,
          zona: [l.district, l.municipality].filter(Boolean).join(", "),
          ascensor: l.hasLift,
          cuota_mensual: r0(l.payment),
          ahorros_necesarios: r0(l.cashNeeded),
          ahorros_que_faltan: r0(l.savingsGap),
          veredicto: l.verdict,
          url: l.url,
        })),
      };
    },
  },

  mortgage_offers: {
    description:
      "Lista las ofertas de hipotecas de los bancos españoles (fijas, variables y mixtas) con su TIN, TAE, bonificaciones y la cuota que le quedaría al usuario. Incluye el euríbor actual y la fecha de actualización de los datos.",
    schema: z.object({
      type: z.enum(["fija", "variable", "mixta"]).optional(),
      loan: z.number().min(1000).optional().describe("Importe de la hipoteca. Por defecto, la hipoteca máxima del usuario."),
      years: z.number().int().min(1).max(40).optional(),
    }),
    run: async (input: { type?: "fija" | "variable" | "mixta"; loan?: number; years?: number }, ctx: ToolContext) => {
      const rates = loadRates();
      const p = ctx.profile;
      const loan = input.loan ?? Math.round((affordability(p).maxPrice * p.ltvPct) / 100);
      const years = input.years ?? p.years;
      return {
        datos_actualizados: rates.updated,
        euribor: rates.euribor,
        hipoteca: loan,
        plazo_anos: years,
        ofertas: rates.offers
          .filter((o) => !input.type || o.type === input.type)
          .map((o) => {
            const q = quoteOffer(o, loan, years, rates.euribor.monthlyAvg, p.age);
            return {
              banco: o.bank,
              producto: o.product,
              tipo: o.type,
              tin_bonificado_pct: o.tinBonif,
              tin_sin_bonificar_pct: o.tinNoBonif,
              anos_tipo_inicial: o.initialYears ?? null,
              diferencial_sobre_euribor: o.diffBonif ?? null,
              tae_pct: o.tae,
              financiacion_maxima_pct: q.ltvAvailable,
              plazo_aplicado_anos: q.years,
              cuota_inicial: r0(q.initialPayment),
              cuota_despues_con_euribor_actual: q.laterPayment != null ? r0(q.laterPayment) : null,
              cuota_sin_bonificar: q.noBonifPayment != null ? r0(q.noBonifPayment) : null,
              intereses_totales: r0(q.totalInterest),
              bonificaciones: o.bonificaciones,
              comision_apertura: o.openingFee,
              notas: o.notes,
            };
          }),
        fuentes: rates.sources,
      };
    },
  },
} as const;

export type ToolName = keyof typeof TOOLS;
