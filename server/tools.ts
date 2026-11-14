// Herramientas del agente bróker. Las usan el asistente de la web (Claude API) y el servidor MCP.
// Regla: los números salen siempre de aquí (shared/finance.ts), nunca de la cabeza del modelo.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { affordability, analyzePurchase, maxTermYears, quoteOffer, type Offer, type Profile } from "../shared/finance.ts";
import {
  CONTRACT_TYPES,
  HOME_STATUSES,
  KEY_FACTS,
  homeIdFromUrl,
  householdMonthlyIncome,
  monthlyOwnership,
  redFlags,
  toHomeListing,
  type HomeListing,
  type ListingInput,
  type ProfileExtra,
  type SavedHome,
} from "../shared/broker.ts";
import { OFFER_TYPES, compareOffers, offerDefaults, type ReceivedOffer } from "../shared/offers.ts";
import { CCAA_IDS, ccaaName } from "../shared/taxes.ts";
import * as store from "./store.ts";

export interface RatesFile {
  updated: string;
  euribor: { monthlyAvg: number; month: string; daily: number; dailyDate: string; note: string };
  sources: { name: string; url: string }[];
  offers: Offer[];
}

export const loadRates = (): RatesFile => JSON.parse(readFileSync(new URL("../data/rates.json", import.meta.url), "utf8"));

/** Eventos para la interfaz: tarjetas de viviendas y perfil actualizado. */
export type ToolEvent = { type: "home"; listing: ListingInput; savedId?: string } | { type: "profile"; profile: Profile; extra: ProfileExtra };

export interface ToolContext {
  /** perfil vigente; update_profile lo sustituye para que el resto del turno use el nuevo */
  me: store.StoredProfile;
  source: store.Source;
  conversationId?: string;
  emit?: (e: ToolEvent) => void;
}

export async function makeContext(source: store.Source, conversationId?: string, emit?: (e: ToolEvent) => void): Promise<ToolContext> {
  return { me: await store.getProfile(), source, conversationId, emit };
}

const r0 = (n: number) => Math.round(n);

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
  .describe("Escenario hipotético sobre el perfil (no se guarda). Omítelo para usar el perfil tal cual.");

const mortgage = {
  ratePct: z.number().min(0).max(15).optional().describe("TIN anual en %. Por defecto, el del perfil."),
  years: z.number().int().min(1).max(40).optional().describe("Plazo en años. Por defecto, el del perfil."),
  ltvPct: z.number().min(0).max(100).optional().describe("% del precio que financia el banco (80 habitual, 90-95 para jóvenes)."),
};

const listingSchema = z.object({
  title: z.string().min(1).describe("Título corto, p. ej. 'Piso de 3 habitaciones en Ruzafa'"),
  price: z.number().min(1000).describe("Precio de venta en euros"),
  url: z.string().optional().describe("URL del anuncio si aparece"),
  size: z.number().positive().optional().describe("Superficie construida en m²"),
  rooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  floor: z.string().optional().describe("Planta: 'bajo', '1', '4', 'ático', 'semisótano'…"),
  hasLift: z.boolean().optional(),
  exterior: z.boolean().optional(),
  parking: z.boolean().optional().describe("Garaje incluido en el precio"),
  newBuild: z.boolean().optional().describe("Obra nueva (paga IVA en vez de ITP)"),
  address: z.string().optional(),
  district: z.string().optional().describe("Barrio o distrito"),
  municipality: z.string().optional().describe("Municipio"),
  province: z.string().optional(),
  ccaa: z.enum(CCAA_IDS).optional().describe("Comunidad autónoma de la vivienda (decide los impuestos). Dedúcela del municipio."),
  description: z.string().max(6000).optional().describe("Texto del anuncio tal cual (sirve para detectar alertas: ocupada, nuda propiedad, derrama…)"),
  communityFees: z.number().min(0).optional().describe("Gastos de comunidad al mes"),
  ibiYearly: z.number().min(0).optional().describe("IBI al año"),
  energyRating: z.string().max(2).optional().describe("Letra del certificado energético (A-G)"),
  yearBuilt: z.number().int().min(1700).max(2100).optional(),
});

function summary(a: ReturnType<typeof analyzePurchase>) {
  return {
    precio: a.price,
    hipoteca: r0(a.loan),
    entrada: r0(a.downPayment),
    impuestos: { importe: r0(a.tax.amount), tipo: a.tax.label, nota: a.tax.note },
    otros_gastos: r0(a.otherCosts),
    ahorros_necesarios: r0(a.cashNeeded),
    ahorros_que_faltan: r0(a.savingsGap),
    ahorros_que_te_quedan: r0(a.savingsLeft),
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

/** Perfil con el que se analiza una vivienda: impuestos de su comunidad y obra nueva si lo es. */
const profileFor = (p: Profile, l: HomeListing): Profile => ({ ...p, ccaa: l.ccaa ?? p.ccaa, newBuild: l.newDevelopment || p.newBuild });

function evaluate(p: Profile, l: HomeListing) {
  const a = analyzePurchase(profileFor(p, l), l.price);
  const own = monthlyOwnership(l, a.payment);
  return {
    analysis: a,
    flags: redFlags(l),
    ownership: {
      cuota_hipoteca: r0(own.payment),
      comunidad: r0(own.community),
      ibi_mensual: r0(own.ibi),
      total_mensual: r0(own.total),
      nota: l.communityFees == null || l.ibiYearly == null ? "Faltan comunidad o IBI en el anuncio: pregúntalos." : null,
    },
  };
}

function homeLine(p: Profile, h: SavedHome) {
  const { analysis: a, flags } = evaluate(p, h.listing);
  const first = h.prices[0]?.price;
  return {
    id: h.id,
    titulo: h.listing.title,
    zona: [h.listing.district, h.listing.municipality].filter(Boolean).join(", "),
    precio: h.listing.price,
    precio_inicial: first != null && first !== h.listing.price ? first : null,
    m2: h.listing.size,
    eur_m2: h.listing.pricePerM2,
    estado: h.status,
    notas: h.notes,
    veredicto: a.verdict,
    veredicto_al_guardarla: h.savedVerdict,
    cuota_mensual: r0(a.payment),
    ahorros_necesarios: r0(a.cashNeeded),
    ahorros_que_faltan: r0(a.savingsGap),
    alertas: flags.map((f) => `${f.level === "alto" ? "⚠️ " : ""}${f.label}`),
    url: h.listing.url,
  };
}

function budgetOf(p: Profile) {
  const a = affordability(p);
  return { precio_maximo: a.maxPrice, cuota_maxima: r0(a.maxPayment), hipoteca_maxima: r0(a.maxLoan), limitado_por: a.limiting };
}

/** Datos clave que el usuario aún no ha dado nunca (los del motor siempre tienen un valor por defecto). */
async function missingFacts(): Promise<string[]> {
  const given = await store.givenFields();
  if (given.has("netPay")) given.add("netIncome");
  return KEY_FACTS.filter((f) => !given.has(f.key)).map((f) => f.ask);
}

export const TOOLS = {
  get_profile: {
    description:
      "Devuelve lo que sabes del usuario: perfil financiero, datos de bróker (contrato, pagas, cotitular, zonas, plazos), su presupuesto máximo, los datos clave que aún faltan y los últimos cambios que te contó (con fecha).",
    schema: z.object({}),
    run: async (_input: Record<string, never>, ctx: ToolContext) => {
      const { profile: p, extra, known } = ctx.me;
      return {
        perfil_guardado: known,
        perfil: { ...p, comunidad: ccaaName(p.ccaa), plazo_maximo_por_edad: maxTermYears(p.age) },
        datos_broker: extra,
        presupuesto: budgetOf(p),
        datos_que_faltan: await missingFacts(),
        ultimos_cambios: (await store.profileHistory(12)).map((f) => ({ campo: f.field, antes: f.oldValue, ahora: f.newValue, lo_que_dijo: f.note, fecha: f.at.slice(0, 10) })),
      };
    },
  },

  update_profile: {
    description:
      "Guarda en el perfil lo que el usuario te cuenta de su situación (ahorros, sueldo, contrato, deudas, cotitular, zonas…). Llámala en cuanto te dé un dato nuevo o corrija uno. Si da el sueldo por nómina, pasa netPay y pagas: el equivalente mensual se calcula aquí. Devuelve el presupuesto antes y después y cómo cambia el veredicto de sus viviendas guardadas.",
    schema: z.object({
      note: z.string().max(500).describe("Lo que ha dicho el usuario, con sus palabras (queda en el histórico)"),
      age: z.number().int().min(18).max(80).optional(),
      savings: z.number().min(0).optional().describe("Ahorros disponibles para la compra"),
      netIncome: z.number().min(0).optional().describe("Ingresos netos mensuales del hogar. Solo si no tienes netPay/pagas."),
      monthlyDebts: z.number().min(0).optional(),
      ccaa: z.enum(CCAA_IDS).optional(),
      firstHome: z.boolean().optional(),
      newBuild: z.boolean().optional(),
      ltvPct: z.number().min(0).max(100).optional(),
      ratePct: z.number().min(0).max(15).optional(),
      years: z.number().int().min(5).max(40).optional(),
      netPay: z.number().min(0).optional().describe("Neto de cada nómina del usuario"),
      pagas: z.number().int().min(12).max(16).optional().describe("Número de pagas al año (12 o 14)"),
      contractType: z.enum(CONTRACT_TYPES).optional(),
      yearsInJob: z.number().min(0).max(60).optional(),
      coBuyer: z.boolean().optional().describe("Compra con otra persona"),
      coBuyerNetPay: z.number().min(0).optional(),
      coBuyerPagas: z.number().int().min(12).max(16).optional(),
      monthlyExpenses: z.number().min(0).optional().describe("Gastos fijos al mes sin contar vivienda"),
      familyHelp: z.number().min(0).optional().describe("Ayuda familiar ya incluida o no en ahorros: indícalo en note"),
      monthlySaving: z.number().min(0).optional().describe("Lo que ahorra al mes"),
      targetZones: z.array(z.string()).optional(),
      mustHaves: z.array(z.string()).optional(),
      timeline: z.string().optional(),
      notes: z.string().max(1000).optional().describe("Otros datos relevantes para el banco"),
    }),
    run: async (input: Record<string, unknown> & { note: string }, ctx: ToolContext) => {
      const { note, ...fields } = input;
      const profileKeys = ["age", "savings", "netIncome", "monthlyDebts", "ccaa", "firstHome", "newBuild", "ltvPct", "ratePct", "years"] as const;
      const patch: Partial<Profile> = {};
      const extraPatch: Partial<ProfileExtra> = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === undefined) continue;
        if ((profileKeys as readonly string[]).includes(k)) (patch as Record<string, unknown>)[k] = v;
        else (extraPatch as Record<string, unknown>)[k] = v;
      }
      const income = householdMonthlyIncome({ ...ctx.me.extra, ...extraPatch });
      if (patch.netIncome == null && income != null) patch.netIncome = income;
      const age = patch.age ?? ctx.me.profile.age;
      const years = patch.years ?? ctx.me.profile.years;
      if (years > maxTermYears(age)) patch.years = maxTermYears(age);

      const before = ctx.me;
      const after = await store.updateProfile(patch, extraPatch, { source: ctx.source, note, conversationId: ctx.conversationId });
      ctx.me = after;
      if (after.changed.length) ctx.emit?.({ type: "profile", profile: after.profile, extra: after.extra });

      const homes = await store.listHomes();
      return {
        campos_cambiados: after.changed,
        ingresos_netos_mensuales: after.profile.netIncome,
        presupuesto_antes: before.known ? budgetOf(before.profile) : null,
        presupuesto_ahora: budgetOf(after.profile),
        viviendas_guardadas: homes.map((h) => {
          const was = analyzePurchase(profileFor(before.profile, h.listing), h.listing.price).verdict;
          const now = analyzePurchase(profileFor(after.profile, h.listing), h.listing.price).verdict;
          return { id: h.id, titulo: h.listing.title, precio: h.listing.price, veredicto_antes: was, veredicto_ahora: now };
        }),
        datos_que_faltan: await missingFacts(),
      };
    },
  },

  max_budget: {
    description:
      "Calcula el precio máximo de vivienda que el usuario puede permitirse según ingresos (ratio de endeudamiento) y ahorros (entrada + impuestos + gastos). Permite probar otros tipos, plazos, % de financiación o escenarios hipotéticos sin guardarlos.",
    schema: z.object({ ...mortgage, profile: profileOverride.optional() }),
    run: async (input: { ratePct?: number; years?: number; ltvPct?: number; profile?: Partial<Profile> }, ctx: ToolContext) => {
      const p = { ...ctx.me.profile, ...input.profile };
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
      "Analiza la compra a un precio concreto (sin anuncio): hipoteca, entrada, impuestos de la comunidad, gastos, ahorros necesarios, cuota, esfuerzo y veredicto (ok / justo / no). Para un anuncio concreto usa evaluate_listing.",
    schema: z.object({ price: z.number().min(1000).describe("Precio de la vivienda en euros"), ...mortgage, profile: profileOverride.optional() }),
    run: async (input: { price: number; ratePct?: number; years?: number; ltvPct?: number; profile?: Partial<Profile> }, ctx: ToolContext) =>
      summary(analyzePurchase({ ...ctx.me.profile, ...input.profile }, input.price, input)),
  },

  evaluate_listing: {
    description:
      "Evalúa un anuncio que el usuario ha pegado (texto o captura de Idealista u otro portal). Extrae tú los datos del anuncio y pásalos; incluye el texto de la descripción en 'description'. Devuelve si puede comprarla, el coste real (impuestos, gastos, cuota, comunidad, IBI), €/m², alertas detectadas con su motivo y si ya la tiene guardada. No la guarda: para eso, save_home.",
    schema: listingSchema,
    run: async (input: ListingInput, ctx: ToolContext) => {
      const l = toHomeListing(input);
      const { analysis, flags, ownership } = evaluate(ctx.me.profile, l);
      const savedId = homeIdFromUrl(l.url);
      const saved = savedId ? await store.getHome(savedId) : null;
      ctx.emit?.({ type: "home", listing: input, savedId: saved?.id });
      return {
        vivienda: { titulo: l.title, precio: l.price, m2: l.size, eur_m2: l.pricePerM2, comunidad_autonoma: ccaaName(l.ccaa ?? ctx.me.profile.ccaa) },
        compra: summary(analysis),
        coste_mensual_de_tenerla: ownership,
        alertas: flags,
        ya_guardada: saved ? { id: saved.id, estado: saved.status, precio_cuando_la_guardaste: saved.prices[0]?.price ?? null } : null,
        aviso_perfil: ctx.me.known ? null : "El usuario aún no ha dado sus datos: el análisis usa un perfil de ejemplo. Díselo y pregúntale sus ahorros e ingresos.",
      };
    },
  },

  save_home: {
    description:
      "Guarda una vivienda en la lista del usuario (o la actualiza si ya estaba: misma URL de Idealista). Pásale los mismos datos del anuncio que a evaluate_listing. Si el precio ha cambiado, queda en el histórico. Úsala cuando el usuario diga que quiere guardarla, visitarla o seguirla.",
    schema: listingSchema.extend({
      status: z.enum(HOME_STATUSES).optional().describe("interesa (por defecto), visitar, visitada, oferta, descartada"),
      notes: z.string().max(2000).optional().describe("Notas del usuario sobre la vivienda"),
    }),
    run: async (input: ListingInput & { status?: (typeof HOME_STATUSES)[number]; notes?: string }, ctx: ToolContext) => {
      const { status, notes, ...listingInput } = input;
      const l = toHomeListing(listingInput);
      const { analysis } = evaluate(ctx.me.profile, l);
      const { home, created, previousPrice } = await store.saveHome(l, { status, notes, verdict: analysis.verdict });
      ctx.emit?.({ type: "home", listing: listingInput, savedId: home.id });
      return {
        id: home.id,
        nueva: created,
        precio_anterior: previousPrice,
        estado: home.status,
        veredicto: analysis.verdict,
        total_guardadas: (await store.listHomes()).length,
      };
    },
  },

  list_saved_homes: {
    description:
      "Lista las viviendas guardadas recalculadas con el perfil ACTUAL del usuario (veredicto, cuota, ahorros que faltan, alertas, estado, notas y cambios de precio). Úsala para comparar o cuando cambie su situación.",
    schema: z.object({ includeDiscarded: z.boolean().optional().describe("true para incluir las descartadas") }),
    run: async (input: { includeDiscarded?: boolean }, ctx: ToolContext) => {
      const homes = await store.listHomes(input);
      return { total: homes.length, presupuesto_actual: budgetOf(ctx.me.profile), viviendas: homes.map((h) => homeLine(ctx.me.profile, h)) };
    },
  },

  update_home: {
    description: "Cambia el estado (interesa, visitar, visitada, oferta, descartada), las notas o el precio de una vivienda guardada. Usa el id de list_saved_homes.",
    schema: z.object({
      id: z.string(),
      status: z.enum(HOME_STATUSES).optional(),
      notes: z.string().max(2000).optional().describe("Sustituye las notas anteriores: incluye lo que quieras conservar"),
      price: z.number().min(1000).optional().describe("Nuevo precio si ha bajado o subido"),
    }),
    run: async (input: { id: string; status?: (typeof HOME_STATUSES)[number]; notes?: string; price?: number }, ctx: ToolContext) => {
      const home = await store.updateHome(input.id, input);
      if (!home) throw new Error(`No hay ninguna vivienda guardada con id ${input.id}. Usa list_saved_homes para ver los ids.`);
      return homeLine(ctx.me.profile, home);
    },
  },

  remove_home: {
    description: "Borra una vivienda guardada. Si el usuario solo la descarta, mejor update_home con status 'descartada' (así queda el histórico).",
    schema: z.object({ id: z.string() }),
    run: async (input: { id: string }) => ({ borrada: await store.removeHome(input.id) }),
  },

  mortgage_offers: {
    description:
      "Lista ofertas de hipotecas de bancos españoles (fijas, variables y mixtas) con TIN, TAE, bonificaciones y la cuota que le quedaría al usuario. Incluye el euríbor y la fecha de los datos.",
    schema: z.object({
      type: z.enum(["fija", "variable", "mixta"]).optional(),
      loan: z.number().min(1000).optional().describe("Importe de la hipoteca. Por defecto, la hipoteca máxima del usuario."),
      years: z.number().int().min(1).max(40).optional(),
    }),
    run: async (input: { type?: "fija" | "variable" | "mixta"; loan?: number; years?: number }, ctx: ToolContext) => {
      const rates = loadRates();
      const p = ctx.me.profile;
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

  save_bank_offer: {
    description:
      "Guarda una oferta de hipoteca que le ha dado un banco al usuario (de su texto, una captura o una FEIN/FIPRE). Extrae: banco, tipo, TIN bonificado, años fijos y diferencial si es mixta/variable, importe y plazo si aparecen, comisiones, y CADA bonificación con su rebaja en puntos y su coste anual (nómina = 0 €; seguros: pregunta el precio si no viene). Para corregir una oferta guardada, pasa su id.",
    schema: z.object({
      id: z.string().optional().describe("id de una oferta guardada para sustituirla"),
      bank: z.string().min(1),
      type: z.enum(OFFER_TYPES),
      tinPct: z.number().min(0).max(15).describe("TIN con todas las bonificaciones (en mixta, el del tramo fijo)"),
      fixedYears: z.number().min(0).max(40).optional().describe("Mixta: años a tipo fijo. Variable: años antes de pasar a euríbor (normalmente 1)"),
      spreadPct: z.number().min(-1).max(5).optional().describe("Variable/mixta: diferencial bonificado sobre el euríbor"),
      loan: z.number().min(1000).optional().describe("Importe que ofrece el banco"),
      years: z.number().int().min(1).max(40).optional(),
      bonuses: z
        .array(
          z.object({
            name: z.string().min(1).describe("Nómina, seguro de vida, seguro de hogar, tarjeta, plan de pensiones…"),
            discountPct: z.number().min(0).max(3).describe("Rebaja del tipo en puntos"),
            costPerYear: z.number().min(0).describe("Coste anual para el usuario (0 si es gratis)"),
          }),
        )
        .default([]),
      openingFee: z.number().min(0).optional().describe("Comisión de apertura en euros"),
      otherCosts: z.number().min(0).optional().describe("Tasación u otros gastos que cobra el banco, en euros"),
      taePct: z.number().min(0).max(20).optional(),
      notes: z.string().max(1000).optional(),
    }),
    run: async (input: Omit<ReceivedOffer, "id"> & { id?: string }, ctx: ToolContext) => {
      const { offer, created } = await store.saveOffer(input);
      const all = await store.listOffers();
      const [best] = compareOffers(all, offerDefaults(ctx.me.profile), loadRates().euribor.monthlyAvg);
      return { id: offer.id, nueva: created, total_ofertas: all.length, mas_barata_ahora: best ? best.offer.bank : null };
    },
  },

  compare_bank_offers: {
    description:
      "Compara las ofertas de hipoteca que el usuario ha recibido de los bancos (guardadas con save_bank_offer): cuota, coste real en todo el plazo con seguros y comisiones, si compensa cada vinculación y cuál sale más barata. Úsala siempre que pregunte qué oferta elegir.",
    schema: z.object({
      loan: z.number().min(1000).optional().describe("Importe para las ofertas que no lo traen. Por defecto, la hipoteca máxima del usuario."),
      years: z.number().int().min(1).max(40).optional(),
    }),
    run: async (input: { loan?: number; years?: number }, ctx: ToolContext) => {
      const offers = await store.listOffers();
      if (!offers.length) return { ofertas: [], aviso: "No hay ofertas guardadas. Pídele que te pegue las condiciones que le han dado los bancos." };
      const defaults = { ...offerDefaults(ctx.me.profile), ...input };
      const rates = loadRates();
      const ranked = compareOffers(offers, defaults, rates.euribor.monthlyAvg);
      return {
        supuestos: `Euríbor constante en ${rates.euribor.monthlyAvg} % (${rates.euribor.month}); vinculaciones con el mismo coste cada año.`,
        ofertas: ranked.map((c, i) => ({
          posicion: i + 1,
          id: c.offer.id,
          banco: c.offer.bank,
          tipo: c.offer.type,
          hipoteca: c.loan,
          plazo_anos: c.years,
          cuota: r0(c.payment),
          cuota_tras_tramo_fijo: c.laterPayment != null ? r0(c.laterPayment) : null,
          cuota_mas_vinculaciones_al_mes: r0(c.effectiveMonthly),
          coste_total_con_todo: r0(c.totalCost),
          coste_total_sin_vinculaciones: r0(c.totalCostWithoutBonuses),
          coste_total_eligiendo_bien: r0(c.bestTotalCost),
          contratar_solo: c.keep,
          vinculaciones: c.bonuses.map((b) => ({ nombre: b.name, ahorro_intereses: r0(b.interestSaved), coste: r0(b.totalCost), compensa: b.worthIt })),
          comisiones: r0(c.fees),
          tae_declarada: c.offer.taePct ?? null,
        })),
        diferencia_entre_la_mejor_y_la_peor: ranked.length > 1 ? r0(ranked.at(-1)!.bestTotalCost - ranked[0].bestTotalCost) : 0,
      };
    },
  },

  remove_bank_offer: {
    description: "Borra una oferta de banco guardada (por id, de compare_bank_offers).",
    schema: z.object({ id: z.string() }),
    run: async (input: { id: string }) => ({ borrada: await store.removeOffer(input.id) }),
  },
} as const;

export type ToolName = keyof typeof TOOLS;

/** Ejecuta una herramienta validando la entrada. Lanza un Error con un mensaje legible si algo falla. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = TOOLS[name as ToolName];
  if (!tool) throw new Error(`Herramienta desconocida: ${name}`);
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) throw new Error(`Parámetros no válidos: ${parsed.error.message}`);
  return (tool.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
}
