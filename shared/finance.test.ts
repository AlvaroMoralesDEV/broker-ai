// Comprueba que el motor da los mismos números que el Excel original.
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE, affordability, analyzePurchase, bonification, fitOffer, pmt, principalFromPayment, rankOffers, schedule, type Applicant, type Offer } from "./finance.ts";
import { purchaseTax } from "./taxes.ts";

const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("cuotas de la hoja 'Hipoteca 100% + ENTRADA' (120.000 € al 2,5 %)", () => {
  near(pmt(120000, 2.5, 30), 474.1450786);
  near(pmt(120000, 2.5, 25), 538.3400809);
  near(pmt(120000, 2.5, 20), 635.8834716);
  near(pmt(120000, 2.5, 47), 361.8975016);
});

test("préstamo personal del Excel (8.500 € al 7 % a 7 años)", () => {
  near(pmt(8500, 7, 7), 128.2877798);
});

test("hoja 'Cálculo BONIFICACIONES'", () => {
  const b = bonification({ loan: 111847.16, years: 20, rateNoBonifPct: 2.5, discountPct: 0.25, bankProductsPerYear: 325, externalProductsPerYear: 175 });
  near(b.paymentNoBonif, 592.6813366);
  near(b.paymentBonif, 579.1538617);
  near(b.monthlySaving, 13.52747495);
  // Excel: (325 − 162,33) − 175 = −12,33 → signo contrario porque aquí positivo = compensa
  near(b.netPerYear, 12.32969942);
});

test("mismo escenario que el Excel: piso de 150.000 € con impuestos al 10 %", () => {
  const p = { ...DEFAULT_PROFILE, taxOverridePct: 10, ratePct: 2.5 };
  const a = analyzePurchase(p, 150000);
  near(a.loan, 120000);
  near(a.cashNeeded, 46500); // ENTRADA TOTAL del Excel
  near(a.savingsGap, 8500); // CAPITAL A SOLICITAR
  near(a.maxPayment, 787.5); // PODRÁS ENDEUDARTE HASTA
  near(a.totalMonthly, 602.4328584); // PH+PRS
  assert.equal(a.verdict, "justo");
});

test("principalFromPayment es la inversa de pmt", () => {
  near(principalFromPayment(pmt(180000, 3.1, 27), 3.1, 27), 180000, 0.001);
});

test("el cuadro de amortización termina en cero y cuadra con la cuota", () => {
  const s = schedule(200000, [{ years: 30, ratePct: 2.75 }]);
  near(s.rows.at(-1)!.balance, 0, 0.01);
  near(s.totalInterest, pmt(200000, 2.75, 30) * 360 - 200000, 0.5);
  const mixta = schedule(200000, [{ years: 5, ratePct: 2.1 }, { years: 25, ratePct: 4.2 }]);
  near(mixta.rows.at(-1)!.balance, 0, 0.01);
  assert.ok(mixta.lastPayment > mixta.firstPayment);
});

test("impuestos por comunidad", () => {
  const base = { age: 40, firstHome: false, newBuild: false };
  near(purchaseTax({ ...base, ccaa: "madrid", price: 300000 }).amount, 18000);
  near(purchaseTax({ ...base, ccaa: "cataluna", price: 700000 }).amount, 60000 + 11000);
  near(purchaseTax({ ...base, ccaa: "castilla-y-leon", price: 300000 }).amount, 20000 + 5000);
  near(purchaseTax({ ccaa: "andalucia", price: 140000, age: 28, firstHome: true, newBuild: false }).amount, 4900);
  near(purchaseTax({ ...base, ccaa: "madrid", price: 200000, newBuild: true }).amount, 23000);
});

test("el precio máximo respeta ingresos y ahorros", () => {
  const p = { ...DEFAULT_PROFILE };
  const a = affordability(p);
  const at = analyzePurchase(p, a.maxPrice);
  assert.ok(at.payment <= at.maxPayment + 1);
  assert.equal(at.savingsGap, 0);
  const over = analyzePurchase(p, a.maxPrice + 5000);
  assert.ok(over.savingsGap > 0 || over.payment > over.maxPayment);
});

test("plan de ahorro: llega a la meta cuando los ahorros cubren el desembolso", async () => {
  const { savingsPlan } = await import("./finance.ts");
  const p = { ...DEFAULT_PROFILE, taxOverridePct: 10 };
  // 150.000 € necesita 46.500 €; faltan 8.500 € → 17 meses ahorrando 500 €
  const plan = savingsPlan(p, { price: 150000, monthlySaving: 500, savingsReturnPct: 0, priceGrowthPct: 0, months: 36 });
  assert.equal(plan.monthsToGoal, 17);
  assert.equal(plan.incomeOk, true);
  assert.ok(plan.rows.at(-1)!.maxPrice > plan.rows[0].maxPrice);
  assert.equal(savingsPlan(p, { price: 100000, monthlySaving: 0, savingsReturnPct: 0, priceGrowthPct: 0, months: 12 }).monthsToGoal, 0);
});

test("amortización anticipada", async () => {
  const { earlyRepayment } = await import("./finance.ts");
  const base = { loan: 150000, ratePct: 3, years: 30, extraMonthly: 0, lumpSum: 0, lumpYear: 1 };
  const none = earlyRepayment({ ...base, mode: "plazo" });
  assert.equal(none.months, 360);
  near(none.interestSaved, 0, 0.5);
  const plazo = earlyRepayment({ ...base, extraMonthly: 200, mode: "plazo" });
  assert.ok(plazo.months < 360 && plazo.interestSaved > 0);
  const cuota = earlyRepayment({ ...base, lumpSum: 20000, lumpYear: 3, mode: "cuota" });
  assert.equal(cuota.months, 360);
  assert.ok(cuota.finalPayment < cuota.basePayment);
  // reducir plazo siempre ahorra más intereses que reducir cuota con la misma aportación
  const plazo2 = earlyRepayment({ ...base, lumpSum: 20000, lumpYear: 3, mode: "plazo" });
  assert.ok(plazo2.interestSaved > cuota.interestSaved);
  near(cuota.totalExtra, 20000);
});

// ---------- ofertas de mercado cruzadas con el usuario ----------

const FIJA: Offer = {
  id: "a-fija", bank: "A", product: "Fija", type: "fija", channel: "Oficina", tinBonif: 2.5, tinNoBonif: 3.5, tae: 3,
  maxLtv: 80, maxYears: 30, bonificaciones: [], openingFee: 0, notes: "",
};
const VARIABLE: Offer = {
  id: "b-var", bank: "B", product: "Variable", type: "variable", channel: "Oficina", tinBonif: 1.5, tinNoBonif: null, initialYears: 1, diffBonif: 0.5,
  diffNoBonif: null, tae: 4, maxLtv: 80, maxYears: 30, bonificaciones: [], openingFee: 0, notes: "",
};
const WHO: Applicant = { loan: 150000, years: 30, age: 30, ltvPct: 80, netIncome: 1800 };

test("fitOffer: requisitos que no cumple (préstamo mínimo, ingresos, financiación)", () => {
  assert.equal(fitOffer(FIJA, WHO, 3).fit, "ok");
  const minLoan = fitOffer({ ...FIJA, requirements: { minLoan: 200000 } }, WHO, 3);
  assert.equal(minLoan.fit, "no");
  assert.match(minLoan.reasons[0], /préstamo mínimo es de 200\.000 €/);
  const income = { ...FIJA, requirements: { minHouseholdIncome: 4000, minHouseholdIncomeCivilServant: 1500 } };
  assert.equal(fitOffer(income, WHO, 3).fit, "no");
  assert.equal(fitOffer(income, { ...WHO, civilServant: true }, 3).fit, "ok");
  assert.equal(fitOffer(income, { ...WHO, netIncome: null }, 3).fit, "ok", "sin datos de ingresos no se descarta");
  assert.equal(fitOffer(FIJA, { ...WHO, ltvPct: 90 }, 3).fit, "no");
  assert.equal(fitOffer({ ...FIJA, youngLtv: { ltv: 95, maxAge: 35 } }, { ...WHO, ltvPct: 90 }, 3).fit, "ok");
});

test("fitOffer: sin la nómina de la bonificación se calcula con el tipo sin bonificar", () => {
  const offer = { ...FIJA, requirements: { payrollForBonus: 2500 } };
  const r = fitOffer(offer, WHO, 3);
  assert.equal(r.fit, "sin-bonificar");
  assert.equal(r.ratePct, 3.5);
  assert.equal(r.costUnderstated, false);
  assert.ok(r.totalCost > fitOffer(FIJA, WHO, 3).totalCost);
  assert.equal(fitOffer(offer, { ...WHO, netIncome: 2600 }, 3).fit, "ok");
  // el banco no publica el tipo sin bonificar: se avisa de que saldrá más cara
  const hidden = fitOffer({ ...VARIABLE, requirements: { payrollForBonus: 2500 } }, WHO, 3);
  assert.equal(hidden.costUnderstated, true);
  assert.match(hidden.reasons[0], /más cara/);
});

test("fitOffer: el coste total incluye la apertura, y variables y mixtas llevan el escenario de euríbor", () => {
  const base = fitOffer(FIJA, WHO, 3);
  assert.equal(base.stress, null);
  assert.equal(Math.round(fitOffer({ ...FIJA, openingFee: 500 }, WHO, 3).totalCost - base.totalCost), 500);
  const v = fitOffer(VARIABLE, WHO, 3);
  assert.ok(v.stress);
  assert.ok(v.stress.plus1.payment > v.quote.laterPayment!);
  assert.ok(v.stress.plus2.payment > v.stress.plus1.payment);
  assert.ok(v.stress.plus2.totalCost > v.stress.plus1.totalCost && v.stress.plus1.totalCost > v.totalCost);
});

test("rankOffers: primero las que puede pedir, por coste total y no por cuota inicial", () => {
  const cara = { ...FIJA, id: "cara", tinBonif: 3.2 };
  const noCumple = { ...FIJA, id: "no", tinBonif: 1, requirements: { minLoan: 500000 } };
  const sinNomina = { ...FIJA, id: "sin", tinBonif: 1.2, requirements: { payrollForBonus: 5000 } };
  const ids = rankOffers([noCumple, cara, sinNomina, FIJA], WHO, 3).map((r) => r.offer.id);
  assert.deepEqual(ids, ["a-fija", "cara", "sin", "no"], "la más barata sobre el papel no sirve si no la puede pedir");
  // la variable tiene la cuota inicial más baja, pero con el euríbor al 3 % cuesta más en total que la fija
  const [first] = rankOffers([VARIABLE, FIJA], WHO, 3);
  assert.ok(fitOffer(VARIABLE, WHO, 3).quote.initialPayment < fitOffer(FIJA, WHO, 3).quote.initialPayment);
  assert.equal(first.offer.id, "a-fija");
});
