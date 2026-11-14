import assert from "node:assert/strict";
import { test } from "node:test";
import { pmt } from "./finance.ts";
import { compareOffers, type ReceivedOffer } from "./offers.ts";

const base = { loan: 200000, years: 30 };
const EURIBOR = 2.5;

const fija = (over: Partial<ReceivedOffer>): ReceivedOffer => ({ id: "x", bank: "Banco", type: "fija", tinPct: 2.5, bonuses: [], ...over });

test("sin vinculaciones ni comisiones, el coste son los intereses de la cuota fija", () => {
  const [c] = compareOffers([fija({})], base, EURIBOR);
  assert.equal(Math.round(c.payment), Math.round(pmt(200000, 2.5, 30)));
  assert.equal(Math.round(c.totalCost), Math.round(c.payment * 360 - 200000));
  assert.equal(c.totalCostWithoutBonuses, c.totalCost);
  assert.deepEqual(c.keep, []);
});

test("una vinculación cara no compensa y otra barata sí", () => {
  const [c] = compareOffers(
    [
      fija({
        tinPct: 2.2,
        bonuses: [
          { name: "Nómina", discountPct: 0.3, costPerYear: 0 },
          { name: "Seguro de vida", discountPct: 0.2, costPerYear: 900 },
        ],
      }),
    ],
    base,
    EURIBOR,
  );
  const [nomina, vida] = c.bonuses;
  assert.equal(nomina.worthIt, true, "gratis y baja el tipo: siempre compensa");
  assert.ok(vida.interestSaved > 0);
  assert.equal(vida.worthIt, false, "0,2 puntos sobre 200.000 € ahorran menos de 900 €/año");
  assert.deepEqual(c.keep, ["Nómina"]);
  assert.ok(c.bestTotalCost < c.totalCost, "quitar el seguro abarata la oferta");
  assert.ok(c.bestTotalCost < c.totalCostWithoutBonuses, "y quedarse con la nómina, también");
  assert.ok(c.paymentWithoutBonuses > c.payment);
});

test("comisiones y gastos suman al coste total", () => {
  const [c] = compareOffers([fija({ openingFee: 1000, otherCosts: 400 })], base, EURIBOR);
  assert.equal(c.fees, 1400);
  assert.equal(Math.round(c.totalCost - c.totalInterest), 1400);
});

test("mixta: tramo fijo y luego euríbor + diferencial", () => {
  const [c] = compareOffers([{ id: "m", bank: "Mixta", type: "mixta", tinPct: 2.0, fixedYears: 10, spreadPct: 0.6, bonuses: [] }], base, EURIBOR);
  assert.equal(Math.round(c.payment), Math.round(pmt(200000, 2.0, 30)));
  assert.ok(c.laterPayment != null && c.laterPayment > c.payment, "pasa al 3,1 %: la cuota sube");
});

test("ordena por el coste real, no por el tipo", () => {
  const barata = fija({ id: "a", bank: "Tipo bajo, seguros caros", tinPct: 2.1, bonuses: [{ name: "Seguros", discountPct: 0.6, costPerYear: 1500 }] });
  const limpia = fija({ id: "b", bank: "Sin vinculaciones", tinPct: 2.6 });
  const [first, second] = compareOffers([barata, limpia], base, EURIBOR);
  // la del tipo bajo, sin los seguros, se queda al 2,7 %: peor que la limpia al 2,6 %
  assert.equal(first.offer.bank, "Sin vinculaciones");
  assert.equal(second.keep.length, 0);
});

test("importe y plazo propios de cada oferta", () => {
  const [c] = compareOffers([fija({ loan: 150000, years: 25 })], base, EURIBOR);
  assert.equal(c.loan, 150000);
  assert.equal(c.years, 25);
});
