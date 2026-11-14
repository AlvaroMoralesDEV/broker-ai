// Respuestas del bróker escritas por código (no por un modelo): veredicto de un anuncio, cambios de
// perfil, presupuesto, comparativa y ofertas. En modo local o sin IA son la respuesta; son instantáneas
// y sus cifras salen del motor de cálculo.
import { monthlyOwnership, redFlags, type HomeListing, type RedFlag, type SavedHome } from "../shared/broker.ts";
import { affordability, analyzePurchase, quoteOffer, type Profile } from "../shared/finance.ts";
import { compareOffers, offerDefaults, type ReceivedOffer } from "../shared/offers.ts";
import { ccaaName } from "../shared/taxes.ts";
import type { StoredProfile } from "./store.ts";
import { loadRates } from "./tools.ts";

const pct = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
export const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES", { useGrouping: "always" })} €`;

const VERDICT = { ok: "✅ **Te encaja**", justo: "🟡 **Va justa**", no: "❌ **Fuera de tu presupuesto ahora mismo**" } as const;

const profileFor = (p: Profile, l: HomeListing): Profile => ({ ...p, ccaa: l.ccaa ?? p.ccaa, newBuild: l.newDevelopment || p.newBuild });

const FLAG_QUESTION: Record<string, string> = {
  "Ocupada o sin posesión": "¿Quién vive ahora en la vivienda y cuándo se entrega libre?",
  "Nuda propiedad": "¿Qué edad tiene el usufructuario y qué gastos asume cada parte?",
  "Subasta o procedimiento judicial": "¿En qué fase está el procedimiento y qué cargas tiene la vivienda?",
  "Solo una parte de la vivienda": "¿Qué porcentaje se vende y quién tiene el resto?",
  "Local o cambio de uso": "¿Tiene cédula de habitabilidad y consta como vivienda en el catastro y el registro?",
  "Se vende alquilada": "¿Hasta cuándo dura el contrato del inquilino y qué renta paga?",
  "Vivienda protegida": "¿Qué régimen de protección tiene, hasta cuándo y cuál es el precio máximo legal?",
  Derrama: "¿De cuánto es la derrama, cuánto queda por pagar y quién la asume?",
  "Inspección técnica pendiente": "¿Cuál fue el resultado de la última ITE y qué obras hay pendientes?",
  "Necesita reforma": "¿Qué hay que reformar exactamente? ¿Instalación eléctrica y fontanería son originales?",
  "Sótano o semisótano": "¿Ha tenido problemas de humedades?",
};

export function listingQuestions(l: HomeListing, flags: RedFlag[]): string[] {
  const q = flags.map((f) => FLAG_QUESTION[f.label] ?? (f.label.includes("sin ascensor") ? "¿Hay proyecto o acuerdo para instalar ascensor?" : null)).filter((x): x is string => !!x);
  const missing = [l.communityFees == null && "gastos de comunidad", l.ibiYearly == null && "IBI anual"].filter(Boolean);
  if (missing.length) q.push(`¿Cuánto se paga de ${missing.join(" y de ")}?`);
  if (!flags.some((f) => f.label === "Derrama")) q.push("¿Hay derramas aprobadas o previstas?");
  q.push("¿Cuánto tiempo lleva en venta y qué margen de negociación hay?");
  return q.slice(0, 4);
}

export function listingSummary(me: StoredProfile, l: HomeListing): string {
  const a = analyzePurchase(profileFor(me.profile, l), l.price);
  const own = monthlyOwnership(l, a.payment);
  const flags = redFlags(l);
  const lines = [
    `${VERDICT[a.verdict]} · ${l.title}, **${eur(l.price)}**${l.pricePerM2 ? ` (${eur(l.pricePerM2)}/m²)` : ""}`,
    "",
    `- **Ahorros que necesitas:** ${eur(a.cashNeeded)} (entrada ${eur(a.downPayment)} + impuestos ${eur(a.tax.amount)} + gastos ${eur(a.otherCosts)}). ${
      a.savingsGap > 0 ? `Te faltan **${eur(a.savingsGap)}**.` : `Te sobrarían ${eur(a.savingsLeft)}.`
    }`,
    `- **Cuota:** ${eur(a.payment)}/mes al ${pct(a.ratePct)} a ${a.years} años, un ${a.effortPct.toFixed(0)} % de tus ingresos (tu máximo recomendado son ${eur(a.maxPayment)}/mes).`,
  ];
  if (own.community || own.ibi) lines.push(`- **Coste real al mes:** ${eur(own.total)} contando comunidad${own.ibi ? " e IBI" : ""}.`);
  lines.push(`- **Impuestos:** ${a.tax.label} en ${ccaaName(l.ccaa ?? me.profile.ccaa)}.`);
  // en «justa» el motivo añade información (el préstamo personal); en los demás casos repetiría lo de arriba
  if (a.verdict === "justo") for (const r of a.reasons) lines.push(`- ${r}`);

  if (flags.length) {
    lines.push("", "**Alertas del anuncio**");
    for (const f of flags) lines.push(`- ${f.level === "alto" ? "⚠️ " : ""}**${f.label}:** ${f.why}`);
  }
  const absent = [
    l.size == null && "superficie",
    l.floor == null && "planta",
    l.hasLift == null && "si tiene ascensor",
    l.communityFees == null && "comunidad",
    l.ibiYearly == null && "IBI",
  ].filter(Boolean);
  if (absent.length) lines.push("", `**No lo dice el anuncio:** ${absent.join(", ")}.`);
  lines.push("", "**Pregunta a la agencia**", ...listingQuestions(l, flags).map((q) => `- ${q}`));
  if (!me.known) lines.push("", "Ojo: aún no me has dado tus datos, así que he usado un perfil de ejemplo. Dime tus ahorros y tu sueldo y lo recalculo.");
  return lines.join("\n");
}

const FIELD_LABEL: Record<string, (v: unknown) => string> = {
  savings: (v) => `ahorros ${eur(v as number)}`,
  netPay: (v) => `sueldo neto ${eur(v as number)} por paga`,
  pagas: (v) => `${v} pagas`,
  monthlyDebts: (v) => (v === 0 ? "sin deudas" : `deudas ${eur(v as number)}/mes`),
  age: (v) => `${v} años`,
  contractType: (v) => `contrato ${v}`,
  coBuyer: (v) => (v ? "compras con otra persona" : "compras solo"),
  coBuyerNetPay: (v) => `sueldo neto de la otra persona ${eur(v as number)} por paga`,
  coBuyerPagas: (v) => `${v} pagas la otra persona`,
  ccaa: (v) => `compra en ${ccaaName(v as Profile["ccaa"])}`,
  targetZones: (v) => `zonas: ${(v as string[]).join(", ")}`,
  timeline: (v) => `plazo: ${v}`,
};

export function budgetLine(p: Profile): string {
  const b = affordability(p);
  if (b.maxPrice <= 0) return "Con estos datos todavía no llegas a un presupuesto de compra.";
  return `Tu presupuesto máximo es **${eur(b.maxPrice)}** (cuota de hasta ${eur(b.maxPayment)}/mes). Te ${
    b.limiting === "ahorros" ? `limitan los **ahorros**: por ingresos llegarías a ${eur(b.priceByIncome)}` : `limitan los **ingresos**: por ahorros llegarías a ${eur(b.priceBySavings)}`
  }.`;
}

export function factsSummary(before: StoredProfile, after: StoredProfile & { changed: string[] }, homes: SavedHome[], doubts: string[]): string {
  const values = { ...after.profile, ...after.extra } as Record<string, unknown>;
  const noted = after.changed.filter((f) => FIELD_LABEL[f]).map((f) => FIELD_LABEL[f](values[f]));
  const lines: string[] = [];
  if (noted.length) lines.push(`Apuntado: ${noted.join(", ")}.`);
  if (after.changed.includes("netIncome") && after.extra.netPay) {
    const both = after.extra.coBuyer && after.extra.coBuyerNetPay ? ", sumando los dos sueldos" : "";
    lines.push(`Eso son **${eur(after.profile.netIncome)} netos al mes** de media para el banco${both}.`);
  }
  const moneyChanged = after.changed.some((f) => ["savings", "netIncome", "monthlyDebts", "age", "ccaa"].includes(f));
  if (moneyChanged) {
    lines.push("", budgetLine(after.profile));
    const was = before.known ? affordability(before.profile).maxPrice : null;
    const now = affordability(after.profile).maxPrice;
    if (was != null && was !== now) lines.push(`Antes era ${eur(was)}: ${now > was ? "sube" : "baja"} ${eur(Math.abs(now - was))}.`);
    const moved = homes
      .map((h) => ({ h, was: analyzePurchase(profileFor(before.profile, h.listing), h.listing.price).verdict, now: analyzePurchase(profileFor(after.profile, h.listing), h.listing.price).verdict }))
      .filter((x) => x.was !== x.now);
    if (moved.length) {
      lines.push("", "**Cambia en tus viviendas guardadas**");
      for (const m of moved) lines.push(`- ${m.h.listing.title} (${eur(m.h.listing.price)}): ${VERDICT[m.now]}`);
    }
  }
  for (const d of doubts) lines.push("", d);
  return lines.join("\n");
}

export function homesSummary(me: StoredProfile, homes: SavedHome[]): string {
  if (!homes.length) return "Aún no tienes viviendas guardadas. Pégame el texto de un anuncio y, si te gusta, la guardamos.";
  const rows = homes
    .map((h) => ({ h, a: analyzePurchase(profileFor(me.profile, h.listing), h.listing.price), flags: redFlags(h.listing) }))
    .sort((x, y) => x.h.listing.price - y.h.listing.price);
  const lines = [`Tienes **${homes.length}** ${homes.length === 1 ? "vivienda guardada" : "viviendas guardadas"}, recalculadas con tu situación de hoy:`, ""];
  for (const { h, a, flags } of rows) {
    lines.push(
      `- ${VERDICT[a.verdict]} · **${h.listing.title}** · ${eur(h.listing.price)}${h.listing.pricePerM2 ? ` (${eur(h.listing.pricePerM2)}/m²)` : ""} · cuota ${eur(a.payment)}/mes · ${
        a.savingsGap > 0 ? `faltan ${eur(a.savingsGap)}` : `sobran ${eur(a.savingsLeft)}`
      }${flags.length ? ` · alertas: ${flags.map((f) => f.label).join(", ")}` : ""}`,
    );
  }
  const fits = rows.filter((r) => r.a.verdict !== "no");
  if (fits.length > 1) {
    const best = [...fits].sort((x, y) => x.flags.length - y.flags.length || (x.h.listing.pricePerM2 ?? Infinity) - (y.h.listing.pricePerM2 ?? Infinity))[0];
    lines.push("", `Por números, la mejor colocada es **${best.h.listing.title}**: entra en tu presupuesto, con menos alertas y mejor precio por m².`);
  }
  return lines.join("\n");
}

export function offersSummary(me: StoredProfile, type?: "fija" | "variable" | "mixta"): string {
  const rates = loadRates();
  const p = me.profile;
  const loan = Math.round((affordability(p).maxPrice * p.ltvPct) / 100);
  if (!me.known || loan <= 0) return "Antes de comparar hipotecas necesito tus ahorros y tu sueldo para saber qué importe pedirías.";
  const quoted = rates.offers
    .filter((o) => !type || o.type === type)
    .map((o) => ({ o, q: quoteOffer(o, loan, p.years, rates.euribor.monthlyAvg, p.age) }))
    .sort((x, y) => x.q.initialPayment - y.q.initialPayment)
    .slice(0, 4);
  const lines = [`Para una hipoteca de **${eur(loan)}** a ${p.years} años (tu máximo), las cuotas más bajas${type ? ` en ${type}` : ""} según los datos del ${rates.updated}:`, ""];
  for (const { o, q } of quoted) {
    lines.push(`- **${o.bank}** · ${o.product} (${o.type}): ${eur(q.initialPayment)}/mes, TIN ${pct(o.tinBonif)} con bonificaciones${o.tae != null ? `, TAE ${pct(o.tae)}` : ""}`);
  }
  lines.push("", `Euríbor de ${rates.euribor.month}: ${pct(rates.euribor.monthlyAvg)}. Son puntos de partida para negociar: la oferta real depende de tu perfil y exige bonificaciones (nómina, seguros).`);
  return lines.join("\n");
}

/** Comparativa de las ofertas que le han dado los bancos al usuario. */
export function bankOffersSummary(me: StoredProfile, offers: ReceivedOffer[]): string {
  if (!offers.length) {
    return "Aún no me has pasado ninguna oferta de banco. Apúntalas en **Ofertas de bancos** (menú de la izquierda): banco, tipo, TIN y cada vinculación con lo que te cuesta al año. Con dos o más te digo cuál sale más barata de verdad.";
  }
  const rates = loadRates();
  const ranked = compareOffers(offers, offerDefaults(me.profile), rates.euribor.monthlyAvg);
  const lines = [
    offers.length === 1 ? "Con la oferta que tengo apuntada:" : `He comparado tus **${offers.length} ofertas** por lo que te cuestan de verdad en todo el plazo:`,
    "",
  ];
  ranked.forEach((c, i) => {
    const keepAll = c.keep.length === c.offer.bonuses.length;
    const advice = !c.offer.bonuses.length
      ? "sin vinculaciones"
      : keepAll
        ? "te compensan todas sus vinculaciones"
        : c.keep.length
          ? `contrata solo: ${c.keep.join(", ")}`
          : "no te compensa ninguna vinculación";
    lines.push(
      `- ${i === 0 && ranked.length > 1 ? "🏆 " : ""}**${c.offer.bank}** (${c.offer.type}, ${pct(c.offer.tinPct)}): cuota ${eur(c.payment)}/mes${
        c.laterPayment ? `, luego ${eur(c.laterPayment)}` : ""
      } · coste total ${eur(c.bestTotalCost)} · ${advice}`,
    );
    for (const b of c.bonuses.filter((x) => !x.worthIt)) {
      lines.push(`  - ${b.name}: ahorras ${eur(b.interestSaved)} en intereses pero pagas ${eur(b.totalCost)}. No compensa.`);
    }
  });
  if (ranked.length > 1) {
    const diff = ranked.at(-1)!.bestTotalCost - ranked[0].bestTotalCost;
    lines.push("", `La más barata es **${ranked[0].offer.bank}**: ${eur(diff)} menos que la más cara en todo el plazo.`);
  }
  lines.push("", `_Supuestos: euríbor constante en ${pct(rates.euribor.monthlyAvg)} y seguros con el mismo precio cada año. Usa esto para negociar: enseña a cada banco la mejor oferta._`);
  return lines.join("\n");
}

/** Mini glosario para que un modelo pequeño no se invente las definiciones. */
export const GLOSSARY = `TIN: tipo de interés nominal, el interés puro del préstamo.
TAE: tasa anual equivalente; incluye el TIN más comisiones y gastos obligatorios. Sirve para comparar ofertas.
Euríbor: índice de referencia de las hipotecas variables y mixtas; la cuota se revisa cada 6 o 12 meses.
Hipoteca fija: misma cuota siempre. Variable: euríbor + diferencial. Mixta: unos años fija y luego variable.
Financiación (LTV): parte del precio que presta el banco; lo normal es el 80 %, el resto es la entrada.
ITP: impuesto de transmisiones patrimoniales, lo paga quien compra segunda mano; depende de la comunidad autónoma.
IVA + AJD: lo que se paga en obra nueva (10 % de IVA más actos jurídicos documentados).
Bonificaciones: rebajas del tipo a cambio de domiciliar nómina o contratar seguros con el banco.
Arras: señal que se paga al reservar (suele ser el 10 %); si te echas atrás, la pierdes.
FEIN: oferta vinculante que el banco entrega ANTES de firmar, cuando aprueba la hipoteca; la ley da al menos 10 días para estudiarla antes de ir a la notaría.
Tasación: valoración oficial de la vivienda; el banco presta sobre el menor entre tasación y precio.
Endeudamiento: los bancos piden que todas tus cuotas no pasen del 30-40 % de tus ingresos netos.`;
