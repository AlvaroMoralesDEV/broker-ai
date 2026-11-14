// Motor de cálculo. Reproduce las fórmulas del Excel original (hojas "Hipoteca 100% + ENTRADA",
// "Cálculo BONIFICACIONES" y "SIGO DE ALQUILER O COMPRO") y las amplía.
import { purchaseTax, type CCAA, type TaxResult } from "./taxes.ts";

export interface Profile {
  age: number;
  /** ingresos netos mensuales del hogar que puedes justificar */
  netIncome: number;
  /** cuotas mensuales de otras deudas */
  monthlyDebts: number;
  savings: number;
  ccaa: CCAA;
  firstHome: boolean;
  newBuild: boolean;
  /** % del precio que financia el banco */
  ltvPct: number;
  /** TIN anual en % */
  ratePct: number;
  years: number;
  /** % máximo de los ingresos destinado a deudas (los bancos usan 30-40 %) */
  debtRatioPct: number;
  /** notaría, registro, gestoría y tasación, en % del precio (el Excel usa 1 %) */
  otherCostsPct: number;
  /** tipo impositivo manual en %, o null para calcularlo por comunidad */
  taxOverridePct: number | null;
  /** préstamo personal para cubrir la entrada que falte */
  personalLoanRatePct: number;
  personalLoanYears: number;
}

export const DEFAULT_PROFILE: Profile = {
  age: 28,
  netIncome: 2250,
  monthlyDebts: 0,
  savings: 38000,
  ccaa: "madrid",
  firstHome: true,
  newBuild: false,
  ltvPct: 80,
  ratePct: 2.75,
  years: 30,
  debtRatioPct: 35,
  otherCostsPct: 1,
  taxOverridePct: null,
  personalLoanRatePct: 7,
  personalLoanYears: 7,
};

/** Plazo máximo habitual: 30 años y terminar de pagar antes de los 75. */
export const maxTermYears = (age: number) => Math.max(5, Math.min(30, 75 - age));

/** Cuota mensual (sistema francés). Equivale a -PMT(tin/12, años*12, capital) de Excel. */
export function pmt(principal: number, ratePct: number, years: number): number {
  const n = Math.round(years * 12);
  if (principal <= 0 || n <= 0) return 0;
  const r = ratePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

/** Capital que se puede pedir para una cuota dada (inversa de pmt). */
export function principalFromPayment(payment: number, ratePct: number, years: number): number {
  const n = Math.round(years * 12);
  if (payment <= 0 || n <= 0) return 0;
  const r = ratePct / 100 / 12;
  if (r === 0) return payment * n;
  return (payment * (1 - Math.pow(1 + r, -n))) / r;
}

export interface Phase {
  years: number;
  ratePct: number;
}

export interface YearRow {
  year: number;
  payment: number;
  interest: number;
  principal: number;
  balance: number;
}

export interface Schedule {
  rows: YearRow[];
  firstPayment: number;
  lastPayment: number;
  totalInterest: number;
  totalPaid: number;
}

/** Cuadro de amortización anual. Admite varios tramos de tipo (variable / mixta). */
export function schedule(principal: number, phases: Phase[]): Schedule {
  const rows: YearRow[] = [];
  let balance = principal;
  let totalInterest = 0;
  let firstPayment = 0;
  let lastPayment = 0;
  let year = 0;
  let remainingYears = phases.reduce((s, p) => s + p.years, 0);
  for (const phase of phases) {
    const payment = pmt(balance, phase.ratePct, remainingYears);
    if (!firstPayment) firstPayment = payment;
    lastPayment = payment;
    const r = phase.ratePct / 100 / 12;
    for (let y = 0; y < phase.years; y++) {
      let interest = 0;
      let paidPrincipal = 0;
      for (let m = 0; m < 12; m++) {
        const i = balance * r;
        const p = Math.min(balance, payment - i);
        interest += i;
        paidPrincipal += p;
        balance -= p;
      }
      year++;
      totalInterest += interest;
      rows.push({ year, payment, interest, principal: paidPrincipal, balance: Math.max(0, balance) });
    }
    remainingYears -= phase.years;
  }
  return { rows, firstPayment, lastPayment, totalInterest, totalPaid: principal + totalInterest };
}

export type Verdict = "ok" | "justo" | "no";

export interface PurchaseAnalysis {
  price: number;
  loan: number;
  downPayment: number;
  tax: TaxResult;
  otherCosts: number;
  /** entrada + impuestos + gastos */
  cashNeeded: number;
  /** ahorros que faltan (0 si llegas) */
  savingsGap: number;
  savingsLeft: number;
  payment: number;
  /** cuota del préstamo personal para cubrir lo que falta de entrada */
  personalLoanPayment: number;
  totalMonthly: number;
  maxPayment: number;
  /** (cuotas + deudas) / ingresos, en % */
  effortPct: number;
  totalInterest: number;
  years: number;
  ratePct: number;
  ltvPct: number;
  verdict: Verdict;
  reasons: string[];
}

export type Overrides = Partial<Pick<Profile, "ratePct" | "years" | "ltvPct">>;

export const maxPaymentFor = (p: Profile) => Math.max(0, (p.netIncome * p.debtRatioPct) / 100 - p.monthlyDebts);

function upfront(p: Profile, price: number, ltvPct: number) {
  const loan = (price * ltvPct) / 100;
  const tax = purchaseTax({
    ccaa: p.ccaa,
    price,
    age: p.age,
    firstHome: p.firstHome,
    newBuild: p.newBuild,
    overridePct: p.taxOverridePct,
  });
  const otherCosts = (price * p.otherCostsPct) / 100;
  return { loan, tax, otherCosts, cashNeeded: price - loan + tax.amount + otherCosts };
}

const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;

/** ¿Me puedo permitir una vivienda de este precio? */
export function analyzePurchase(profile: Profile, price: number, o: Overrides = {}): PurchaseAnalysis {
  const ratePct = o.ratePct ?? profile.ratePct;
  const years = o.years ?? profile.years;
  const ltvPct = o.ltvPct ?? profile.ltvPct;
  const { loan, tax, otherCosts, cashNeeded } = upfront(profile, price, ltvPct);

  const savingsGap = Math.max(0, cashNeeded - profile.savings);
  const savingsLeft = Math.max(0, profile.savings - cashNeeded);
  const payment = pmt(loan, ratePct, years);
  const personalLoanPayment = pmt(savingsGap, profile.personalLoanRatePct, profile.personalLoanYears);
  const totalMonthly = payment + personalLoanPayment;
  const maxPayment = maxPaymentFor(profile);
  const effortPct = profile.netIncome > 0 ? ((totalMonthly + profile.monthlyDebts) / profile.netIncome) * 100 : 0;
  const totalInterest = payment * Math.round(years * 12) - loan;

  const reasons: string[] = [];
  let verdict: Verdict = "ok";
  if (payment > maxPayment + 0.5) {
    verdict = "no";
    reasons.push(`La cuota (${eur(payment)}) supera tu máximo de ${eur(maxPayment)}/mes (${profile.debtRatioPct} % de tus ingresos).`);
  }
  if (savingsGap > 0) {
    if (verdict !== "no" && totalMonthly <= maxPayment + 0.5) {
      verdict = "justo";
      reasons.push(
        `Te faltan ${eur(savingsGap)} de ahorros. Con un préstamo personal (${eur(personalLoanPayment)}/mes) seguirías dentro del ${profile.debtRatioPct} %, pero el banco lo contará como deuda.`,
      );
    } else {
      verdict = "no";
      reasons.push(`Te faltan ${eur(savingsGap)} de ahorros para entrada, impuestos y gastos (${eur(cashNeeded)}).`);
    }
  }
  if (verdict === "ok") {
    reasons.push(`Cuota de ${eur(payment)} (${effortPct.toFixed(0)} % de tus ingresos) y te sobran ${eur(savingsLeft)} de ahorros.`);
    if (savingsLeft < 3 * (payment + profile.monthlyDebts)) {
      verdict = "justo";
      reasons.push("Te quedarías con menos de 3 meses de cuotas como colchón.");
    }
  }
  if (years > maxTermYears(profile.age)) {
    reasons.push(`Ojo: con ${profile.age} años el plazo máximo habitual es de ${maxTermYears(profile.age)} años.`);
  }

  return {
    price, loan, downPayment: price - loan, tax, otherCosts, cashNeeded, savingsGap, savingsLeft,
    payment, personalLoanPayment, totalMonthly, maxPayment, effortPct, totalInterest,
    years, ratePct, ltvPct, verdict, reasons,
  };
}

export interface Affordability {
  maxPayment: number;
  maxLoan: number;
  /** precio máximo que aguantan tus ingresos */
  priceByIncome: number;
  /** precio máximo que cubren tus ahorros (entrada + impuestos + gastos) */
  priceBySavings: number;
  maxPrice: number;
  limiting: "ingresos" | "ahorros";
}

/** Precio máximo de vivienda según ingresos y ahorros. */
export function affordability(profile: Profile, o: Overrides = {}): Affordability {
  const ratePct = o.ratePct ?? profile.ratePct;
  const years = o.years ?? profile.years;
  const ltvPct = o.ltvPct ?? profile.ltvPct;
  const maxPayment = maxPaymentFor(profile);
  const maxLoan = principalFromPayment(maxPayment, ratePct, years);
  const priceByIncome = ltvPct > 0 ? maxLoan / (ltvPct / 100) : 0;

  // Mayor precio cuyo desembolso inicial cabe en los ahorros. Se recorre en pasos de 1.000 €
  // porque los tipos reducidos tienen "escalones" (el impuesto no es monótono con el precio).
  let priceBySavings = 0;
  for (let price = 1000; price <= 3_000_000; price += 1000) {
    if (upfront(profile, price, ltvPct).cashNeeded <= profile.savings) priceBySavings = price;
    else if (price > priceBySavings + 150_000) break;
  }

  const maxPrice = Math.floor(Math.min(priceByIncome, priceBySavings) / 1000) * 1000;
  return {
    maxPayment, maxLoan, priceByIncome, priceBySavings, maxPrice,
    limiting: priceByIncome <= priceBySavings ? "ingresos" : "ahorros",
  };
}

// ---------- Ofertas de bancos ----------

export interface Offer {
  id: string;
  bank: string;
  product: string;
  type: "fija" | "variable" | "mixta";
  channel: string;
  /** fija: TIN bonificado. variable/mixta: tipo del periodo inicial */
  tinBonif: number;
  tinNoBonif: number | null;
  initialYears?: number;
  diffBonif?: number;
  diffNoBonif?: number | null;
  tae: number | null;
  maxLtv: number;
  youngLtv?: { ltv: number; maxAge: number };
  maxYears: number;
  bonificaciones: string[];
  openingFee: number | null;
  /** condiciones que se pueden comprobar con los datos del usuario (ver offerFit) */
  requirements?: OfferRequirements;
  notes: string;
}

/**
 * Requisitos de una oferta de mercado que se pueden cruzar con el perfil. Todos son opcionales y salen
 * de la letra pequeña del banco: al actualizar data/rates.json hay que revisarlos igual que el TIN.
 */
export interface OfferRequirements {
  /** importe mínimo del préstamo */
  minLoan?: number;
  /** ingresos netos mensuales del hogar que exige el banco para concederla */
  minHouseholdIncome?: number;
  /** el mismo mínimo cuando el titular es funcionario, si el banco lo rebaja */
  minHouseholdIncomeCivilServant?: number;
  /** nómina mínima para tener el tipo bonificado: sin ella se aplica el tipo sin bonificar */
  payrollForBonus?: number;
}

export interface OfferQuote {
  years: number;
  initialPayment: number;
  /** cuota tras el periodo inicial (variable / mixta), con el euríbor actual */
  laterPayment: number | null;
  totalInterest: number;
  /** cuota si no cumples las bonificaciones (null si no se publica) */
  noBonifPayment: number | null;
  ltvAvailable: number;
}

export function quoteOffer(offer: Offer, loan: number, years: number, euriborPct: number, age: number): OfferQuote {
  const y = Math.max(1, Math.min(years, offer.maxYears));
  const ltvAvailable = offer.youngLtv && age <= offer.youngLtv.maxAge ? offer.youngLtv.ltv : offer.maxLtv;
  if (offer.type === "fija") {
    const s = schedule(loan, [{ years: y, ratePct: offer.tinBonif }]);
    return {
      years: y,
      initialPayment: s.firstPayment,
      laterPayment: null,
      totalInterest: s.totalInterest,
      noBonifPayment: offer.tinNoBonif != null ? pmt(loan, offer.tinNoBonif, y) : null,
      ltvAvailable,
    };
  }
  const init = Math.min(offer.initialYears ?? 1, y);
  const phases: Phase[] = [{ years: init, ratePct: offer.tinBonif }];
  if (y > init) phases.push({ years: y - init, ratePct: euriborPct + (offer.diffBonif ?? 0) });
  const s = schedule(loan, phases);
  return {
    years: y,
    initialPayment: s.firstPayment,
    laterPayment: y > init ? s.lastPayment : null,
    totalInterest: s.totalInterest,
    noBonifPayment: null,
    ltvAvailable,
  };
}

// ---------- Qué oferta de mercado le conviene a este usuario ----------

/** Quien pide la hipoteca, con lo justo para saber si una oferta es para él. */
export interface Applicant {
  loan: number;
  years: number;
  age: number;
  /** % de financiación que necesita */
  ltvPct: number;
  /** ingresos netos mensuales del hogar; null si aún no los ha dado (entonces no se comprueban) */
  netIncome: number | null;
  civilServant?: boolean;
}

/** ok: puede pedirla tal cual · sin-bonificar: puede, pero no llega a la nómina del tipo bonificado · no: no cumple */
export type OfferFit = "ok" | "sin-bonificar" | "no";

export interface EuriborScenario {
  /** cuota cuando acaba el periodo inicial */
  payment: number;
  totalCost: number;
}

export interface RankedOffer {
  offer: Offer;
  fit: OfferFit;
  /** por qué no encaja o qué condición no cumple, en frases para el usuario */
  reasons: string[];
  /** cuota, plazo e intereses con el tipo que de verdad le aplicarían */
  quote: OfferQuote;
  /** tipo del periodo inicial que se ha usado en el cálculo */
  ratePct: number;
  /** true si no cumple la bonificación y el banco no publica el tipo sin bonificar: el coste real será mayor */
  costUnderstated: boolean;
  /** intereses de todo el plazo + comisión de apertura. No incluye el precio de los seguros vinculados */
  totalCost: number;
  /** variable y mixta: qué pasa si el euríbor sube 1 o 2 puntos. null en las fijas */
  stress: { plus1: EuriborScenario; plus2: EuriborScenario } | null;
}

const money = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;

/** Comprueba una oferta contra quien la pide y la calcula con el tipo que le aplicarían. */
export function fitOffer(offer: Offer, who: Applicant, euriborPct: number): RankedOffer {
  const req = offer.requirements ?? {};
  const reasons: string[] = [];
  let fit: OfferFit = "ok";

  const ltvAvailable = offer.youngLtv && who.age <= offer.youngLtv.maxAge ? offer.youngLtv.ltv : offer.maxLtv;
  if (who.ltvPct > ltvAvailable) {
    fit = "no";
    reasons.push(`Financia hasta el ${ltvAvailable} % y tú necesitas el ${who.ltvPct} %.`);
  }
  if (req.minLoan != null && who.loan < req.minLoan) {
    fit = "no";
    reasons.push(`El préstamo mínimo es de ${money(req.minLoan)} y tú pedirías ${money(who.loan)}.`);
  }
  const minIncome = who.civilServant && req.minHouseholdIncomeCivilServant != null ? req.minHouseholdIncomeCivilServant : req.minHouseholdIncome;
  if (minIncome != null && who.netIncome != null && who.netIncome < minIncome) {
    fit = "no";
    reasons.push(`Exige ingresos netos del hogar de ${money(minIncome)}/mes y los tuyos son ${money(who.netIncome)}.`);
  }

  // No llega a la nómina de la bonificación: se calcula con el tipo sin bonificar (si el banco lo publica).
  let priced = offer;
  let costUnderstated = false;
  if (req.payrollForBonus != null && who.netIncome != null && who.netIncome < req.payrollForBonus) {
    const excluded = fit === "no";
    if (fit === "ok") fit = "sin-bonificar";
    const published = offer.type === "fija" ? offer.tinNoBonif != null : offer.tinNoBonif != null || offer.diffNoBonif != null;
    costUnderstated = !published;
    priced = { ...offer, tinBonif: offer.tinNoBonif ?? offer.tinBonif, diffBonif: offer.diffNoBonif ?? offer.diffBonif };
    if (excluded) reasons.push(`Además pide una nómina de ${money(req.payrollForBonus)} para el tipo bonificado.`);
    else reasons.push(
      `Pide una nómina de ${money(req.payrollForBonus)} para el tipo bonificado y tus ingresos son ${money(who.netIncome)}/mes: ${
        published ? "está calculada con el tipo sin bonificar" : "el banco no publica cuánto sube sin ella, así que te saldrá más cara que esta cifra"
      }.`,
    );
  }

  const fee = offer.openingFee ?? 0;
  const quote = quoteOffer(priced, who.loan, who.years, euriborPct, who.age);
  const scenario = (extra: number): EuriborScenario => {
    const q = quoteOffer(priced, who.loan, who.years, euriborPct + extra, who.age);
    return { payment: q.laterPayment ?? q.initialPayment, totalCost: q.totalInterest + fee };
  };
  return {
    offer,
    fit,
    reasons,
    quote,
    ratePct: priced.tinBonif,
    costUnderstated,
    totalCost: quote.totalInterest + fee,
    stress: offer.type === "fija" || quote.laterPayment == null ? null : { plus1: scenario(1), plus2: scenario(2) },
  };
}

const FIT_ORDER: Record<OfferFit, number> = { ok: 0, "sin-bonificar": 1, no: 2 };

/**
 * Ofertas ordenadas para este usuario: primero las que puede pedir, luego las que pagaría sin bonificar y
 * al final las que no cumple; dentro de cada grupo, por coste total (no por la cuota inicial, que en una
 * variable o mixta solo vale para los primeros años).
 */
export function rankOffers(offers: Offer[], who: Applicant, euriborPct: number): RankedOffer[] {
  return offers
    .map((o) => fitOffer(o, who, euriborPct))
    .sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit] || Number(a.costUnderstated) - Number(b.costUnderstated) || a.totalCost - b.totalCost);
}

// ---------- Bonificaciones ----------

export interface BonificationInput {
  loan: number;
  years: number;
  rateNoBonifPct: number;
  /** rebaja total del tipo por cumplir las vinculaciones, en puntos */
  discountPct: number;
  /** coste anual de los productos del banco (seguros, etc.) */
  bankProductsPerYear: number;
  /** lo que te costarían por tu cuenta */
  externalProductsPerYear: number;
}

export interface BonificationResult {
  paymentNoBonif: number;
  paymentBonif: number;
  monthlySaving: number;
  /** sobrecoste anual por contratar con el banco */
  extraCostPerYear: number;
  /** ahorro en cuota al año menos sobrecoste: positivo = compensa bonificar */
  netPerYear: number;
  netTotal: number;
  worthIt: boolean;
}

export function bonification(i: BonificationInput): BonificationResult {
  const paymentNoBonif = pmt(i.loan, i.rateNoBonifPct, i.years);
  const paymentBonif = pmt(i.loan, i.rateNoBonifPct - i.discountPct, i.years);
  const monthlySaving = paymentNoBonif - paymentBonif;
  const extraCostPerYear = i.bankProductsPerYear - i.externalProductsPerYear;
  const netPerYear = monthlySaving * 12 - extraCostPerYear;
  return {
    paymentNoBonif, paymentBonif, monthlySaving, extraCostPerYear, netPerYear,
    netTotal: netPerYear * i.years,
    worthIt: netPerYear > 0,
  };
}

// ---------- Alquilar o comprar ----------

export interface RentVsBuyInput {
  price: number;
  rent: number;
  /** subida anual del alquiler, % */
  rentGrowthPct: number;
  /** revalorización anual de la vivienda, % */
  homeGrowthPct: number;
  /** rentabilidad anual de invertir los ahorros, % */
  investReturnPct: number;
  /** IBI, comunidad, seguro y mantenimiento, % anual del precio */
  ownerCostsPct: number;
  horizonYears: number;
}

export interface RentVsBuyRow {
  year: number;
  buyWealth: number;
  rentWealth: number;
  rent: number;
}

export interface RentVsBuyResult {
  rows: RentVsBuyRow[];
  /** primer año en que comprar deja más patrimonio que alquilar (null si no ocurre) */
  breakEvenYear: number | null;
  initialCash: number;
  payment: number;
}

/**
 * Compara patrimonio: quien compra acumula vivienda (valor − deuda); quien alquila invierte
 * el dinero de la entrada. Cada mes, quien paga menos invierte la diferencia.
 */
export function rentVsBuy(profile: Profile, i: RentVsBuyInput): RentVsBuyResult {
  const a = analyzePurchase(profile, i.price);
  const r = profile.ratePct / 100 / 12;
  const inv = Math.pow(1 + i.investReturnPct / 100, 1 / 12) - 1;
  let balance = a.loan;
  let homeValue = i.price;
  let rent = i.rent;
  let ownerCosts = (i.price * i.ownerCostsPct) / 100 / 12;
  let rentPortfolio = a.cashNeeded;
  let buyPortfolio = 0;
  const rows: RentVsBuyRow[] = [];
  let breakEvenYear: number | null = null;

  for (let year = 1; year <= i.horizonYears; year++) {
    for (let m = 0; m < 12; m++) {
      const paying = balance > 0.01;
      const interest = balance * r;
      const payment = paying ? Math.min(a.payment, balance + interest) : 0;
      balance = Math.max(0, balance - (payment - interest));
      const buyCost = payment + ownerCosts;
      rentPortfolio = rentPortfolio * (1 + inv) + Math.max(0, buyCost - rent);
      buyPortfolio = buyPortfolio * (1 + inv) + Math.max(0, rent - buyCost);
    }
    homeValue *= 1 + i.homeGrowthPct / 100;
    const row = { year, buyWealth: homeValue - balance + buyPortfolio, rentWealth: rentPortfolio, rent };
    rows.push(row);
    if (breakEvenYear === null && row.buyWealth >= row.rentWealth) breakEvenYear = year;
    rent *= 1 + i.rentGrowthPct / 100;
    ownerCosts *= 1 + i.rentGrowthPct / 100;
  }
  return { rows, breakEvenYear, initialCash: a.cashNeeded, payment: a.payment };
}

// ---------- Plan de ahorro: ¿cuándo podré comprar? ----------

export interface SavingsPlanInput {
  price: number;
  /** lo que ahorras cada mes */
  monthlySaving: number;
  /** rentabilidad anual de los ahorros (cuenta remunerada, depósito…), % */
  savingsReturnPct: number;
  /** subida anual esperada del precio de la vivienda, % */
  priceGrowthPct: number;
  /** meses a simular */
  months: number;
}

export interface SavingsPlanRow {
  month: number;
  savings: number;
  /** precio de la vivienda objetivo en ese mes */
  price: number;
  /** entrada + impuestos + gastos para ese precio */
  needed: number;
  /** precio máximo que podrías comprar ese mes */
  maxPrice: number;
}

export interface SavingsPlanResult {
  rows: SavingsPlanRow[];
  /** primer mes en que los ahorros cubren la compra (0 = ya; null = no se alcanza en el periodo) */
  monthsToGoal: number | null;
  /** ¿la cuota cabe en tus ingresos? Si no, ahorrar más no basta */
  incomeOk: boolean;
}

export function savingsPlan(profile: Profile, i: SavingsPlanInput): SavingsPlanResult {
  const r = Math.pow(1 + i.savingsReturnPct / 100, 1 / 12) - 1;
  const g = Math.pow(1 + i.priceGrowthPct / 100, 1 / 12) - 1;
  const rows: SavingsPlanRow[] = [];
  let savings = profile.savings;
  let price = i.price;
  let monthsToGoal: number | null = null;
  for (let month = 0; month <= i.months; month++) {
    if (month > 0) {
      savings = savings * (1 + r) + i.monthlySaving;
      price *= 1 + g;
    }
    // la edad cuenta para los tipos reducidos de jóvenes y para el plazo máximo
    const p = { ...profile, savings, age: profile.age + Math.floor(month / 12) };
    const needed = upfront(p, price, p.ltvPct).cashNeeded;
    if (monthsToGoal === null && savings >= needed) monthsToGoal = month;
    rows.push({ month, savings, price, needed, maxPrice: month % 3 === 0 || month === i.months ? affordability(p).maxPrice : NaN });
  }
  // rellena los meses intermedios con el último valor calculado (el cálculo es costoso)
  let last = rows[0].maxPrice;
  for (const row of rows) {
    if (Number.isNaN(row.maxPrice)) row.maxPrice = last;
    else last = row.maxPrice;
  }
  const incomeOk = pmt((i.price * profile.ltvPct) / 100, profile.ratePct, profile.years) <= maxPaymentFor(profile) + 0.5;
  return { rows, monthsToGoal, incomeOk };
}

// ---------- Amortización anticipada ----------

export interface EarlyRepaymentInput {
  loan: number;
  ratePct: number;
  years: number;
  /** aportación extra cada mes */
  extraMonthly: number;
  /** aportación única */
  lumpSum: number;
  /** año en que haces la aportación única (1 = durante el primer año) */
  lumpYear: number;
  /** "plazo": mantienes la cuota y acabas antes. "cuota": mantienes el plazo y baja la cuota */
  mode: "plazo" | "cuota";
}

export interface EarlyRepaymentResult {
  basePayment: number;
  baseInterest: number;
  /** meses hasta terminar de pagar */
  months: number;
  monthsSaved: number;
  interest: number;
  interestSaved: number;
  /** cuota al final (solo cambia en modo "cuota") */
  finalPayment: number;
  totalExtra: number;
  /** deuda pendiente al final de cada año, con y sin amortizar */
  balance: number[];
  baseBalance: number[];
}

export function earlyRepayment(i: EarlyRepaymentInput): EarlyRepaymentResult {
  const n = Math.round(i.years * 12);
  const r = i.ratePct / 100 / 12;
  const basePayment = pmt(i.loan, i.ratePct, i.years);
  const base = schedule(i.loan, [{ years: i.years, ratePct: i.ratePct }]);
  const lumpMonth = Math.max(1, Math.round((i.lumpYear - 1) * 12) + 1);

  let balance = i.loan;
  let payment = basePayment;
  let interest = 0;
  let totalExtra = 0;
  let months = 0;
  const yearly: number[] = [];
  for (let m = 1; m <= n && balance > 0.005; m++) {
    const int = balance * r;
    interest += int;
    balance -= Math.min(balance, payment - int);
    const extra = Math.min(balance, i.extraMonthly + (m === lumpMonth ? i.lumpSum : 0));
    if (extra > 0) {
      balance -= extra;
      totalExtra += extra;
      if (i.mode === "cuota" && m < n) payment = pmt(balance, i.ratePct, (n - m) / 12);
    }
    months = m;
    if (m % 12 === 0) yearly.push(Math.max(0, balance));
  }
  while (yearly.length < i.years) yearly.push(0);

  return {
    basePayment,
    baseInterest: base.totalInterest,
    months,
    monthsSaved: n - months,
    interest,
    interestSaved: base.totalInterest - interest,
    finalPayment: i.mode === "cuota" ? payment : basePayment,
    totalExtra,
    balance: yearly,
    baseBalance: base.rows.map((x) => x.balance),
  };
}
