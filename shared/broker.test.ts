import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalListingUrl, homeIdFromUrl, householdMonthlyIncome, portalOf, redFlags, sameListingUrl, toHomeListing } from "./broker.ts";

const listing = (description: string, extra: Partial<Parameters<typeof toHomeListing>[0]> = {}) =>
  toHomeListing({ title: "Piso en venta", price: 200000, description, ...extra });

const labels = (description: string, extra = {}) => redFlags(listing(description, extra)).map((f) => f.label);

test("detecta vivienda ocupada y nuda propiedad, con el texto que lo justifica", () => {
  const flags = redFlags(listing("Oportunidad. Vivienda ocupada, no se puede visitar. Se vende la nuda propiedad."));
  assert.deepEqual(
    flags.map((f) => f.label),
    ["Ocupada o sin posesión", "Nuda propiedad"],
  );
  assert.match(flags[0].evidence ?? "", /ocupada/);
  assert.equal(flags[0].level, "alto");
});

test("no salta con negaciones", () => {
  assert.deepEqual(labels("Vivienda libre de ocupantes, no está ocupada. Sin inquilinos. Sin derramas pendientes."), []);
});

test("ignora tildes y mayúsculas", () => {
  assert.deepEqual(labels("VIVIENDA DE PROTECCIÓN OFICIAL"), ["Vivienda protegida"]);
  assert.deepEqual(labels("Antiguo local con cambio de uso"), ["Local o cambio de uso"]);
});

test("alertas por datos estructurados: tercera planta sin ascensor, certificado G y edificio antiguo", () => {
  assert.deepEqual(labels("Luminoso", { floor: "4", hasLift: false, energyRating: "g", yearBuilt: 1962 }), [
    "Planta 4 sin ascensor",
    "Certificado energético G",
    "Edificio de 1962",
  ]);
  assert.deepEqual(labels("Luminoso", { floor: "2", hasLift: false, energyRating: "C", yearBuilt: 2005 }), []);
});

test("id estable a partir de la URL de Idealista", () => {
  assert.equal(homeIdFromUrl("https://www.idealista.com/inmueble/107654321/"), "idealista-107654321");
  assert.equal(homeIdFromUrl("https://www.idealista.com/en/inmueble/107654321/?xts=1"), "idealista-107654321");
  assert.equal(homeIdFromUrl("https://www.fotocasa.es/es/comprar/vivienda/1234"), null);
  assert.equal(homeIdFromUrl(undefined), null);
});

test("ingresos mensuales del hogar a partir de nóminas y pagas", () => {
  assert.equal(householdMonthlyIncome({}), null);
  assert.equal(householdMonthlyIncome({ netPay: 1800, pagas: 14 }), 2100);
  assert.equal(householdMonthlyIncome({ netPay: 1800 }), 1800);
  // el cotitular solo cuenta si compra con alguien
  assert.equal(householdMonthlyIncome({ netPay: 1800, pagas: 14, coBuyerNetPay: 1500 }), 2100);
  assert.equal(householdMonthlyIncome({ netPay: 1800, pagas: 14, coBuyer: true, coBuyerNetPay: 1500, coBuyerPagas: 12 }), 3600);
});

test("toHomeListing calcula €/m² y marca el origen", () => {
  const l = toHomeListing({ title: "x", price: 180000, size: 60, url: "https://www.idealista.com/inmueble/1/" });
  assert.equal(l.pricePerM2, 3000);
  assert.equal(l.source, "idealista");
  assert.equal(l.id, "idealista-1");
});

test("portalOf: el portal sale del enlace", () => {
  assert.deepEqual(portalOf("https://www.idealista.com/inmueble/107654321/"), { id: "idealista", name: "Idealista" });
  assert.equal(portalOf("https://m.idealista.com/inmueble/107654321/").id, "idealista");
  assert.equal(portalOf("https://www.fotocasa.es/es/comprar/vivienda/madrid/123456/d").name, "Fotocasa");
  assert.equal(portalOf("https://www.habitaclia.com/comprar-piso-x-i123.htm").name, "Habitaclia");
  assert.equal(portalOf("https://www.pisos.com/comprar/piso-madrid-123/").name, "pisos.com");
  assert.deepEqual(portalOf("https://www.inmobiliaria-lopez.es/piso/7"), { id: "inmobiliaria-lopez.es", name: "inmobiliaria-lopez.es" });
  assert.equal(portalOf(null).name, "Sin enlace");
  assert.equal(portalOf("no es un enlace").id, "sin-enlace");
});

test("canonicalListingUrl: el mismo anuncio con otra query, www o barra final es el mismo", () => {
  const base = "https://www.fotocasa.es/es/comprar/vivienda/madrid/123456/d";
  assert.equal(canonicalListingUrl(base), "fotocasa.es/es/comprar/vivienda/madrid/123456/d");
  assert.equal(canonicalListingUrl(`${base}?from=list&multimedia=image#fotos`), canonicalListingUrl(base));
  assert.equal(canonicalListingUrl("https://fotocasa.es/es/comprar/vivienda/madrid/123456/d/"), canonicalListingUrl(base));
  assert.notEqual(canonicalListingUrl("https://www.fotocasa.es/es/comprar/vivienda/madrid/654321/d"), canonicalListingUrl(base));
  // en una web desconocida la query se conserva: puede ser lo que identifica el anuncio
  assert.notEqual(canonicalListingUrl("https://agencia.es/ficha?id=1"), canonicalListingUrl("https://agencia.es/ficha?id=2"));
  assert.equal(canonicalListingUrl(undefined), null);
  assert.ok(sameListingUrl("https://www.idealista.com/inmueble/107654321/", "https://www.idealista.com/en/inmueble/107654321/?xtmc=1"));
  assert.ok(!sameListingUrl(null, null));
});
