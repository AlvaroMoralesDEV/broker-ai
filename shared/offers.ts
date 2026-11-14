// Comparar las ofertas de hipoteca que te han dado los bancos (no las de mercado).
// La pregunta que responde: ¿cuál me sale más barata de verdad, contando seguros, comisiones y
// vinculaciones, y me compensa cada vinculación o es mejor no contratarla?
import { affordability, schedule, type Phase, type Profile } from "./finance.ts";

/** Importe y plazo para las ofertas que no los traen: la hipoteca máxima del usuario y su plazo. */
export function offerDefaults(p: Profile) {
  return { loan: Math.max(Math.round(affordability(p).maxLoan), 50000), years: p.years };
}

export const OFFER_TYPES = ["fija", "variable", "mixta"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/** Producto que el banco pide para rebajar el tipo (nómina, seguro de vida, hogar…). */
export interface Bonus {
  name: string;
  /** rebaja del tipo en puntos (0,25 = un cuarto de punto) */
  discountPct: number;
  /** lo que te cuesta al año contratarlo (0 si es gratis, como domiciliar la nómina) */
  costPerYear: number;
}

export interface ReceivedOffer {
  id: string;
  bank: string;
  type: OfferType;
  /** tipo con todas las bonificaciones. Fija: el TIN. Mixta: el del tramo fijo. Variable: el del primer periodo */
  tinPct: number;
  /** mixta: años a tipo fijo. Variable: meses/años antes de pasar a euríbor (normalmente 1) */
  fixedYears?: number;
  /** variable y mixta: diferencial bonificado sobre el euríbor */
  spreadPct?: number;
  /** importe y plazo que ofrece el banco; si faltan se usan los del usuario */
  loan?: number;
  years?: number;
  bonuses: Bonus[];
  openingFee?: number;
  /** tasación, gestoría u otros gastos que te cobra el banco, en euros */
  otherCosts?: number;
  /** la TAE que pone la oferta (informativa: cada banco la calcula con supuestos distintos) */
  taePct?: number;
  notes?: string;
}

export interface BonusValue {
  name: string;
  /** intereses que ahorras en todo el plazo gracias a esta vinculación */
  interestSaved: number;
  /** lo que pagas por ella en todo el plazo */
  totalCost: number;
  /** ahorro menos coste: positivo = compensa */
  net: number;
  worthIt: boolean;
}

export interface OfferComparison {
  offer: ReceivedOffer;
  loan: number;
  years: number;
  /** cuota del primer año con todas las bonificaciones */
  payment: number;
  /** cuota cuando pasa a euríbor (variable/mixta), con el euríbor actual */
  laterPayment: number | null;
  /** cuota más lo que cuestan al mes los productos vinculados */
  effectiveMonthly: number;
  totalInterest: number;
  bonusesCost: number;
  fees: number;
  /** intereses + vinculaciones + comisiones, con todas las bonificaciones */
  totalCost: number;
  /** lo mismo sin contratar ninguna vinculación */
  totalCostWithoutBonuses: number;
  paymentWithoutBonuses: number;
  bonuses: BonusValue[];
  /** la mejor forma de coger esta oferta: con las vinculaciones que compensan */
  bestTotalCost: number;
  /** vinculaciones que conviene contratar */
  keep: string[];
}

function phasesOf(o: ReceivedOffer, years: number, euriborPct: number, extraPct: number): Phase[] {
  if (o.type === "fija") return [{ years, ratePct: o.tinPct + extraPct }];
  const fixed = Math.min(Math.max(o.fixedYears ?? 1, 0), years);
  const phases: Phase[] = [];
  if (fixed > 0) phases.push({ years: fixed, ratePct: o.tinPct + extraPct });
  if (years > fixed) phases.push({ years: years - fixed, ratePct: Math.max(0, euriborPct + (o.spreadPct ?? 0) + extraPct) });
  return phases;
}

const interestWith = (o: ReceivedOffer, loan: number, years: number, euriborPct: number, extraPct: number) =>
  schedule(loan, phasesOf(o, years, euriborPct, extraPct));

/**
 * Compara ofertas. `defaults` son el importe y plazo del usuario para las ofertas que no los traen.
 * Supuestos: el euríbor se queda como hoy; las vinculaciones cuestan lo mismo cada año.
 */
export function compareOffers(offers: ReceivedOffer[], defaults: { loan: number; years: number }, euriborPct: number): OfferComparison[] {
  return offers
    .map((o): OfferComparison => {
      const loan = o.loan ?? defaults.loan;
      const years = o.years ?? defaults.years;
      const all = interestWith(o, loan, years, euriborPct, 0);
      const totalDiscount = o.bonuses.reduce((s, b) => s + b.discountPct, 0);
      const none = interestWith(o, loan, years, euriborPct, totalDiscount);
      const fees = (o.openingFee ?? 0) + (o.otherCosts ?? 0);
      const bonusesCost = o.bonuses.reduce((s, b) => s + b.costPerYear, 0) * years;

      // valor de cada vinculación: quitarla sube el tipo en su rebaja; ¿ahorra más de lo que cuesta?
      const bonuses = o.bonuses.map((b): BonusValue => {
        const without = interestWith(o, loan, years, euriborPct, b.discountPct);
        const interestSaved = without.totalInterest - all.totalInterest;
        const totalCost = b.costPerYear * years;
        return { name: b.name, interestSaved, totalCost, net: interestSaved - totalCost, worthIt: interestSaved >= totalCost };
      });

      // mejor combinación: las que compensan por separado (aproximación buena: el efecto es casi lineal)
      const kept = o.bonuses.filter((_, i) => bonuses[i].worthIt);
      const dropped = totalDiscount - kept.reduce((s, b) => s + b.discountPct, 0);
      const best = interestWith(o, loan, years, euriborPct, dropped);
      const bestTotalCost = best.totalInterest + kept.reduce((s, b) => s + b.costPerYear, 0) * years + fees;

      return {
        offer: o,
        loan,
        years,
        payment: all.firstPayment,
        laterPayment: o.type === "fija" || years <= (o.fixedYears ?? 1) ? null : all.lastPayment,
        effectiveMonthly: all.firstPayment + o.bonuses.reduce((s, b) => s + b.costPerYear, 0) / 12,
        totalInterest: all.totalInterest,
        bonusesCost,
        fees,
        totalCost: all.totalInterest + bonusesCost + fees,
        totalCostWithoutBonuses: none.totalInterest + fees,
        paymentWithoutBonuses: none.firstPayment,
        bonuses,
        bestTotalCost,
        keep: kept.map((b) => b.name),
      };
    })
    .sort((a, b) => a.bestTotalCost - b.bestTotalCost);
}
