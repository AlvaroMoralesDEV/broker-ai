import assert from "node:assert/strict";
import { test } from "node:test";
import { extractAnswer, extractFacts, looksLikeListing, numbersIn, parseListingText, parseNumberEs } from "./extract.ts";

test("números en formato español", () => {
  assert.equal(parseNumberEs("42.000"), 42000);
  assert.equal(parseNumberEs("1.900,50"), 1900.5);
  assert.equal(parseNumberEs("42k"), 42000);
  assert.equal(parseNumberEs("42 mil"), 42000);
  assert.equal(parseNumberEs("1900"), 1900);
  assert.deepEqual(numbersIn("Tengo 42.000 € y cobro 1.900 en 14 pagas"), [42000, 1900, 14]);
});

test("ahorros, sueldo, pagas y contrato en una frase", () => {
  const f = extractFacts("Hola, tengo 42.000 euros ahorrados y cobro 1.900 netos en 14 pagas. Contrato indefinido.");
  assert.deepEqual(f.profile, { savings: 42000 });
  assert.deepEqual(f.extra, { netPay: 1900, pagas: 14, contractType: "indefinido" });
  assert.deepEqual(f.doubts, []);
});

test("otras formas de decirlo", () => {
  assert.equal(extractFacts("mis ahorros son 35k").profile.savings, 35000);
  assert.equal(extractFacts("Tengo ahorrados unos 28.500€").profile.savings, 28500);
  assert.equal(extractFacts("gano 2.100 al mes").extra.netPay, 2100);
  assert.equal(extractFacts("Me han subido el sueldo a 2.300").extra.netPay, 2300);
  assert.equal(extractFacts("Soy autónomo").extra.contractType, "autonomo");
  assert.equal(extractFacts("Soy funcionaria y tengo 31 años").profile.age, 31);
  assert.equal(extractFacts("Compro con mi pareja").extra.coBuyer, true);
  assert.equal(extractFacts("Voy a comprar solo").extra.coBuyer, false);
  assert.equal(extractFacts("No tengo deudas").profile.monthlyDebts, 0);
  assert.equal(extractFacts("Pago un préstamo del coche de 180 € al mes").profile.monthlyDebts, 180);
  assert.equal(extractFacts("Quiero comprar en Valencia").profile.ccaa, "valencia");
});

test("lo ambiguo no se guarda: se pregunta", () => {
  const bruto = extractFacts("Cobro 32.000 brutos al año");
  assert.equal(bruto.extra.netPay, undefined);
  assert.equal(bruto.doubts.length, 1);
  const anual = extractFacts("Mi sueldo es 28.000");
  assert.equal(anual.extra.netPay, undefined);
  assert.equal(anual.doubts.length, 1);
  // el sueldo no se confunde con los ahorros ni al revés
  const f = extractFacts("Cobro 1.800 y tengo ahorrados 50.000");
  assert.equal(f.extra.netPay, 1800);
  assert.equal(f.profile.savings, 50000);
  assert.deepEqual(extractFacts("¿Qué diferencia hay entre TIN y TAE?"), { profile: {}, extra: {}, doubts: [] });
});

const ANUNCIO = `Piso en venta en calle de la Oca, Vista Alegre, Carabanchel, Madrid
189.000 €
68 m² 2 hab. Planta 3ª exterior sin ascensor

Características básicas
68 m² construidos
2 habitaciones
1 baño
Segunda mano/para reformar
Construido en 1965
Certificado energético: consumo E
Gastos de comunidad 45 €/mes
2.779 €/m²
https://www.idealista.com/inmueble/101234567/`;

test("anuncio de Idealista pegado como texto", () => {
  assert.equal(looksLikeListing(ANUNCIO), true);
  const l = parseListingText(ANUNCIO)!;
  assert.equal(l.title, "Piso en venta en calle de la Oca, Vista Alegre, Carabanchel, Madrid");
  assert.equal(l.price, 189000);
  assert.equal(l.size, 68);
  assert.equal(l.rooms, 2);
  assert.equal(l.bathrooms, 1);
  assert.equal(l.floor, "3");
  assert.equal(l.hasLift, false);
  assert.equal(l.exterior, true);
  assert.equal(l.municipality, "Madrid");
  assert.equal(l.district, "Carabanchel");
  assert.equal(l.ccaa, "madrid");
  assert.equal(l.communityFees, 45);
  assert.equal(l.yearBuilt, 1965);
  assert.equal(l.energyRating, "E");
  assert.equal(l.url, "https://www.idealista.com/inmueble/101234567/");
  assert.ok(!("parking" in l), "lo que no dice el anuncio no se inventa");
});

test("anuncio en una sola línea", () => {
  const l = parseListingText("Mira este: Ático en Ruzafa, Valencia. 245.000 euros, 80 m2, 3 habitaciones, 2 baños, con ascensor y garaje incluido.")!;
  assert.equal(l.price, 245000);
  assert.equal(l.size, 80);
  assert.equal(l.rooms, 3);
  assert.equal(l.bathrooms, 2);
  assert.equal(l.hasLift, true);
  assert.equal(l.parking, true);
  assert.equal(l.ccaa, "valencia");
  assert.equal(l.floor, "atico");
  assert.match(l.title, /Ático en Ruzafa/);
});

test("lo que no es un anuncio no lo parece", () => {
  assert.equal(looksLikeListing("Tengo 42.000 euros ahorrados y cobro 1.900"), false);
  assert.equal(looksLikeListing("¿Puedo comprar algo de 200.000 €?"), false);
  assert.equal(looksLikeListing("Se vende piso por 150.000 €"), true);
});

test("respuestas cortas a la pregunta pendiente", () => {
  assert.equal(extractAnswer("savings", "42.000").profile.savings, 42000);
  assert.deepEqual(extractAnswer("netIncome", "1900 en 14").extra, { netPay: 1900, pagas: 14 });
  assert.equal(extractAnswer("monthlyDebts", "no, ninguna").profile.monthlyDebts, 0);
  assert.equal(extractAnswer("monthlyDebts", "250").profile.monthlyDebts, 250);
  assert.equal(extractAnswer("coBuyer", "sola").extra.coBuyer, false);
  assert.equal(extractAnswer("coBuyer", "con mi novio").extra.coBuyer, true);
  assert.equal(extractAnswer("ccaa", "Bilbao").profile.ccaa, "pais-vasco");
  assert.deepEqual(extractAnswer("targetZones", "Usera, Carabanchel y Latina").extra.targetZones, ["Usera", "Carabanchel", "Latina"]);
  assert.equal(extractAnswer("timeline", "En un año más o menos").extra.timeline, "En un año más o menos");
});

test("una respuesta sobre otro tema no se toma por la pendiente", () => {
  // se preguntó por deudas y contesta con el sueldo: no son 32.000 € de deuda al mes
  assert.deepEqual(extractAnswer("monthlyDebts", "en realidad cobro 32.000 brutos al año").profile, {});
  assert.deepEqual(extractAnswer("monthlyDebts", "40000").profile, {});
  assert.deepEqual(extractAnswer("savings", "¿y si pido el 90%?").profile, {});
  assert.deepEqual(extractAnswer("timeline", "¿qué es el euríbor?").extra, {});
});
