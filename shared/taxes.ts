// Impuestos de compra por comunidad autónoma (2026).
// Fuente principal: inmofiscal.com (revisado contra normativa a 27/10/2026), contrastado con
// hipotecanow.es y bm.consulting. Son datos ORIENTATIVOS: los tipos reducidos tienen requisitos
// (renta, empadronamiento, valor máximo...) que aquí solo se aplican de forma aproximada.

export const CCAA_LIST = [
  ["andalucia", "Andalucía"],
  ["aragon", "Aragón"],
  ["asturias", "Asturias"],
  ["baleares", "Illes Balears"],
  ["canarias", "Canarias"],
  ["cantabria", "Cantabria"],
  ["castilla-la-mancha", "Castilla-La Mancha"],
  ["castilla-y-leon", "Castilla y León"],
  ["cataluna", "Cataluña"],
  ["valencia", "Comunitat Valenciana"],
  ["extremadura", "Extremadura"],
  ["galicia", "Galicia"],
  ["la-rioja", "La Rioja"],
  ["madrid", "Comunidad de Madrid"],
  ["murcia", "Región de Murcia"],
  ["navarra", "Navarra"],
  ["pais-vasco", "País Vasco"],
  ["ceuta-melilla", "Ceuta / Melilla"],
] as const;

export type CCAA = (typeof CCAA_LIST)[number][0];
export const CCAA_IDS = CCAA_LIST.map(([id]) => id) as [CCAA, ...CCAA[]];
export const ccaaName = (id: CCAA) => CCAA_LIST.find(([k]) => k === id)?.[1] ?? id;

export interface TaxInput {
  ccaa: CCAA;
  price: number;
  age: number;
  /** vivienda habitual y primera vivienda */
  firstHome: boolean;
  newBuild: boolean;
  /** si se indica (en %), sustituye al cálculo automático */
  overridePct?: number | null;
}

export interface TaxResult {
  amount: number;
  /** tipo efectivo sobre el precio, en % */
  effectivePct: number;
  label: string;
  /** requisitos o avisos sobre el tipo aplicado */
  note: string;
  reduced: boolean;
}

type Bracket = [upTo: number, pct: number];

/** Tarifa por tramos (marginal): cada tramo tributa a su tipo. */
function marginal(price: number, brackets: Bracket[]): number {
  let tax = 0;
  let prev = 0;
  for (const [upTo, pct] of brackets) {
    if (price <= prev) break;
    tax += ((Math.min(price, upTo) - prev) * pct) / 100;
    prev = upTo;
  }
  return tax;
}

/** Tipo único según el tramo en el que cae el valor total. */
function byTotal(price: number, brackets: Bracket[]): number {
  const pct = brackets.find(([upTo]) => price <= upTo)?.[1] ?? brackets[brackets.length - 1][1];
  return (price * pct) / 100;
}

const INF = Number.POSITIVE_INFINITY;

interface Rule {
  general: (price: number) => number;
  generalLabel: string;
  /** devuelve el impuesto reducido si aplica, o null */
  reduced?: (i: TaxInput) => { amount: number; label: string; note: string } | null;
}

const flat = (pct: number) => (price: number) => (price * pct) / 100;

const RULES: Record<CCAA, Rule> = {
  andalucia: {
    general: flat(7),
    generalLabel: "ITP 7 %",
    reduced: (i) => {
      if (!i.firstHome || i.price > 150_000) return null;
      if (i.age < 35) return { amount: i.price * 0.035, label: "ITP joven 3,5 %", note: "Menores de 35, vivienda habitual hasta 150.000 €." };
      return { amount: i.price * 0.06, label: "ITP 6 %", note: "Vivienda habitual hasta 150.000 €." };
    },
  },
  aragon: {
    general: (p) => byTotal(p, [[400_000, 8], [450_000, 8.5], [500_000, 9], [750_000, 9.5], [INF, 10]]),
    generalLabel: "ITP 8-10 % según valor",
    reduced: (i) =>
      i.firstHome && i.age < 35 && i.price <= 100_000
        ? { amount: i.price * 0.08 * 0.875, label: "ITP 8 % con bonificación joven 12,5 %", note: "Menores de 35, valor hasta 100.000 €." }
        : null,
  },
  asturias: {
    general: (p) => byTotal(p, [[300_000, 8], [500_000, 9], [INF, 10]]),
    generalLabel: "ITP 8-10 % según valor",
    reduced: (i) =>
      i.firstHome && i.age <= 35
        ? { amount: marginal(i.price, [[150_000, 4], [INF, 6]]), label: "ITP joven 4 % (6 % sobre el exceso de 150.000 €)", note: "Hasta 35 años, vivienda habitual." }
        : null,
  },
  baleares: {
    general: (p) => marginal(p, [[400_000, 8], [600_000, 9], [1_000_000, 10], [2_000_000, 12], [INF, 13]]),
    generalLabel: "ITP 8-13 % por tramos",
    reduced: (i) =>
      i.firstHome && i.price <= 270_000
        ? { amount: i.price * 0.04, label: "ITP 4 % primera vivienda habitual", note: "Hay límites de valor por isla y otros requisitos; los menores de 36 pueden optar al 2 %." }
        : null,
  },
  canarias: {
    general: flat(6.5),
    generalLabel: "ITP 6,5 %",
    reduced: (i) => {
      if (!i.firstHome) return null;
      const base = i.price <= 200_000 ? 5 : 6.5;
      if (i.age < 40) return { amount: i.price * (base / 100) * 0.8, label: `ITP ${base} % con bonificación joven 20 %`, note: "Menores de 40 años; con límites de renta." };
      if (base === 5) return { amount: i.price * 0.05, label: "ITP 5 %", note: "Vivienda habitual hasta 200.000 €." };
      return null;
    },
  },
  cantabria: {
    general: flat(9),
    generalLabel: "ITP 9 %",
    reduced: (i) => {
      if (!i.firstHome) return null;
      if (i.age < 40) return { amount: i.price * 0.04, label: "ITP joven 4 %", note: "Menores de 40 años, vivienda habitual." };
      return { amount: marginal(i.price, [[300_000, 7], [INF, 9]]), label: "ITP 7 % hasta 300.000 € (9 % el exceso)", note: "Vivienda habitual." };
    },
  },
  "castilla-la-mancha": {
    general: flat(9),
    generalLabel: "ITP 9 %",
    reduced: (i) => {
      if (!i.firstHome || i.price > 240_000) return null;
      if (i.age < 36) return { amount: i.price * 0.03, label: "ITP joven 3 %", note: "Menores de 36, primera vivienda hasta 240.000 € y la hipoteca debe superar el 50 % del valor." };
      return { amount: i.price * 0.06, label: "ITP 6 %", note: "Primera vivienda hasta 240.000 €." };
    },
  },
  "castilla-y-leon": {
    general: (p) => marginal(p, [[250_000, 8], [INF, 10]]),
    generalLabel: "ITP 8 % (10 % sobre el exceso de 250.000 €)",
    reduced: (i) =>
      i.firstHome && i.age < 36
        ? { amount: i.price * 0.04, label: "ITP joven 4 %", note: "Menores de 36, primera vivienda; hay límite de renta." }
        : null,
  },
  cataluna: {
    general: (p) => marginal(p, [[600_000, 10], [900_000, 11], [1_500_000, 12], [INF, 13]]),
    generalLabel: "ITP 10-13 % por tramos",
    reduced: (i) =>
      i.firstHome && i.age <= 35
        ? { amount: i.price * 0.05, label: "ITP joven 5 %", note: "Hasta 35 años y base imponible de IRPF de hasta 36.000 €." }
        : null,
  },
  valencia: {
    general: (p) => (p > 1_000_000 ? p * 0.11 : p * 0.09),
    generalLabel: "ITP 9 % (desde 1/6/2026)",
    reduced: (i) =>
      i.firstHome && i.age < 35
        ? { amount: i.price * (i.price <= 180_000 ? 0.06 : 0.08), label: `ITP joven ${i.price <= 180_000 ? 6 : 8} %`, note: "Menores de 35, primera vivienda (6 % hasta 180.000 €, 8 % por encima); hay límite de renta." }
        : null,
  },
  extremadura: {
    general: (p) => marginal(p, [[360_000, 8], [600_000, 10], [INF, 11]]),
    generalLabel: "ITP 8-11 % por tramos",
    reduced: (i) => {
      if (!i.firstHome) return null;
      if (i.age < 36) return { amount: i.price * 0.04, label: "ITP joven 4 %", note: "Jóvenes, con límites de renta." };
      if (i.price <= 200_000) return { amount: i.price * 0.07, label: "ITP 7 %", note: "Vivienda habitual hasta 200.000 €." };
      return null;
    },
  },
  galicia: {
    general: flat(8),
    generalLabel: "ITP 8 %",
    reduced: (i) => {
      if (!i.firstHome) return null;
      if (i.age < 36) return { amount: i.price * 0.03, label: "ITP joven 3 %", note: "Menores de 36, vivienda habitual." };
      if (i.price <= 240_000) return { amount: i.price * 0.07, label: "ITP 7 %", note: "Vivienda habitual hasta 240.000 €." };
      return null;
    },
  },
  "la-rioja": {
    general: flat(7),
    generalLabel: "ITP 7 %",
    reduced: (i) =>
      i.firstHome && i.age < 40
        ? { amount: i.price * 0.04, label: "ITP joven 4 %", note: "Menores de 40, primera vivienda (3 % en municipios pequeños)." }
        : null,
  },
  madrid: {
    general: flat(6),
    generalLabel: "ITP 6 %",
    reduced: (i) =>
      i.firstHome && i.price <= 250_000
        ? { amount: i.price * 0.06 * 0.9, label: "ITP 6 % con bonificación del 10 %", note: "Vivienda habitual hasta 250.000 €." }
        : null,
  },
  murcia: {
    general: flat(7.75),
    generalLabel: "ITP 7,75 %",
    reduced: (i) =>
      i.firstHome && i.age <= 35
        ? { amount: i.price * 0.03, label: "ITP joven 3 %", note: "Jóvenes, vivienda habitual; con límites de valor y de renta." }
        : null,
  },
  navarra: { general: flat(6), generalLabel: "ITP 6 %" },
  "pais-vasco": {
    general: flat(4),
    generalLabel: "ITP 4 %",
    reduced: () => null,
  },
  "ceuta-melilla": { general: flat(3), generalLabel: "ITP 6 % con bonificación del 50 %" },
};

/** IVA 10 % + AJD. El AJD varía entre el 0,5 % y el 1,5 % según la comunidad: usamos 1,5 % (prudente). */
const NEW_BUILD_PCT = 11.5;

export function purchaseTax(i: TaxInput): TaxResult {
  const done = (amount: number, label: string, note: string, reduced: boolean): TaxResult => ({
    amount,
    effectivePct: i.price > 0 ? (amount / i.price) * 100 : 0,
    label,
    note,
    reduced,
  });

  if (i.overridePct != null && Number.isFinite(i.overridePct)) {
    return done((i.price * i.overridePct) / 100, `Tipo manual ${i.overridePct} %`, "Has fijado el tipo a mano.", false);
  }
  if (i.newBuild) {
    const note =
      i.ccaa === "canarias"
        ? "En Canarias se paga IGIC en lugar de IVA; revisa el tipo y ponlo a mano."
        : "Obra nueva: IVA 10 % + AJD (0,5-1,5 % según comunidad; aquí 1,5 %).";
    return done((i.price * NEW_BUILD_PCT) / 100, "IVA 10 % + AJD 1,5 %", note, false);
  }
  const rule = RULES[i.ccaa];
  const general = rule.general(i.price);
  const red = rule.reduced?.(i) ?? null;
  if (red && red.amount < general) return done(red.amount, red.label, red.note, true);
  const note =
    i.ccaa === "pais-vasco" ? "2,5 % si es vivienda habitual de hasta 120 m². Cada territorio foral tiene su norma." : "";
  return done(general, rule.generalLabel, note, false);
}
