// Extracción determinista: saca del texto del usuario sus datos y los campos de un anuncio pegado.
// Sirve para que el modo local (o sin IA) no dependa de que un modelo pequeño rellene bien los campos,
// y como comprobación: un número solo se acepta si aparece en lo que el usuario escribió.
import { CONTRACT_TYPES, type ListingInput, type ProfileExtra } from "./broker.ts";
import type { Profile } from "./finance.ts";
import { findCity } from "./listings.ts";
import { CCAA_LIST, type CCAA } from "./taxes.ts";

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// 42.000 | 42 000 | 1.900,50 | 42000 | 42k | 42 mil
const NUM = String.raw`\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:,\d+)?(?:\s?k\b|\s?mil\b)?`;

export function parseNumberEs(raw: string): number {
  const s = raw.trim().toLowerCase();
  const thousand = /k$|mil$/.test(s);
  const digits = s.replace(/k$|mil$/, "").trim();
  const n = /^\d{1,3}([.\s]\d{3})+(,\d+)?$/.test(digits)
    ? Number(digits.replace(/[.\s]/g, "").replace(",", "."))
    : Number(digits.replace(",", "."));
  return thousand ? n * 1000 : n;
}

/** Todos los números que aparecen en un texto, normalizados. */
export function numbersIn(text: string): number[] {
  return [...norm(text).matchAll(new RegExp(NUM, "g"))].map((m) => parseNumberEs(m[0])).filter(Number.isFinite);
}

const first = (text: string, pattern: string): RegExpMatchArray | null => text.match(new RegExp(pattern));

export interface ExtractedFacts {
  profile: Partial<Profile>;
  extra: Partial<ProfileExtra>;
  /** cosas que hay que preguntar porque el texto es ambiguo */
  doubts: string[];
  /**
   * cambio relativo de los ahorros («réstale 20.000 al ahorro» → -20000). El total lo calcula quien
   * conoce los ahorros actuales (update_profile), nunca este extractor ni un modelo.
   */
  savingsChange?: number;
}

const SAVINGS_DOWN = String.raw`\b(?:rest\w*|quit\w*|descont\w*|descuent\w*|reduc\w*|rebaj\w*|gast\w*|pagad[oa]|pague|sac\w*|menos)\b`;
// «más» cuenta, pero no «más de 20.000» (eso es una cantidad aproximada, no un aumento)
const SAVINGS_UP = String.raw`\b(?:sum\w*|anad\w*|agreg\w*|aument\w*)\b|\bmas\b(?!\s+de\b)`;

/**
 * ¿El mensaje cambia los ahorros en vez de darlos? «réstale al ahorro 20 mil», «he gastado 3.000 de los
 * ahorros», «súmale 5.000 a mis ahorros». Devuelve null si no es un cambio relativo; si lo es pero no está
 * claro cuánto o en qué sentido, devuelve la duda que hay que preguntar.
 *
 * Existe porque «réstale 20.000» contiene un número junto a «ahorro», y guardarlo como ahorros totales
 * cambia el presupuesto sin que nada falle.
 */
export function savingsChangeIn(message: string): { change: number } | { doubt: string } | null {
  const t = norm(message);
  if (!/ahorr/.test(t)) return null;
  const down = new RegExp(SAVINGS_DOWN).test(t);
  const up = new RegExp(SAVINGS_UP).test(t);
  if (!down && !up) return null;
  const amounts = numbersIn(message).filter((n) => n >= 100);
  if (down && up) return { doubt: "No sé si quieres sumar o restar a tus ahorros. ¿Cuánto tienes ahorrado ahora en total?" };
  if (amounts.length !== 1) return { doubt: "No me ha quedado claro cuánto cambian tus ahorros. ¿Cuánto tienes ahorrado ahora en total?" };
  return { change: down ? -amounts[0] : amounts[0] };
}

/** Datos de la situación del usuario que se pueden leer sin ambigüedad en su mensaje. */
export function extractFacts(message: string): ExtractedFacts {
  const t = norm(message);
  const profile: Partial<Profile> = {};
  const extra: Partial<ProfileExtra> = {};
  const doubts: string[] = [];

  // ahorros que cambian: "réstale al ahorro 20 mil" (el total lo calcula update_profile)
  const change = savingsChangeIn(message);
  // ahorros: "42.000 € ahorrados", "tengo 42k de ahorros", "mis ahorros son 42.000", "tengo 42.000 euros"
  const savings = change
    ? null
    :
    first(t, String.raw`(${NUM})\s*(?:€|euros?|eur)?\s*(?:de\s+|en\s+)?ahorr`) ??
    first(t, String.raw`ahorr\w*(?:(?!cobr|gan|sueld|nomin)\D){0,25}?(${NUM})`) ??
    first(t, String.raw`tengo\s+(?:unos\s+)?(${NUM})\s*(?:€|euros?)`);
  if (savings) {
    const v = parseNumberEs(savings[1]);
    if (v >= 500 && v <= 5_000_000) profile.savings = v;
  }

  // sueldo de la otra persona: "mi pareja cobra 1.500 en 12 pagas" (no es el sueldo del usuario)
  const partner = first(t, String.raw`\b(?:pareja|novi[oa]|mujer|marido|espos[oa]|chic[oa]|el|ella)\s+(?:cobra|gana|ingresa)\D{0,20}?(${NUM})(?:\D{0,15}?(\d{2})\s*pagas)?`);
  if (partner) {
    const v = parseNumberEs(partner[1]);
    if (v >= 300 && v <= 15000) {
      extra.coBuyer = true;
      extra.coBuyerNetPay = v;
      if (partner[2] && Number(partner[2]) >= 12 && Number(partner[2]) <= 16) extra.coBuyerPagas = Number(partner[2]);
    }
  }
  const own = partner ? t.replace(partner[0], " ") : t;

  // sueldo neto por nómina: "cobro 1.900 netos", "mi sueldo es de 1900", "gano 2.100 al mes"
  const pay = first(own,String.raw`(?:cobro|cobramos|gano|sueldo|salario|nomina|ingreso|ingresos)(?:(?!ahorr)\D){0,30}?(${NUM})([^.;\n]{0,25})`);
  if (pay) {
    const v = parseNumberEs(pay[1]);
    const after = pay[2];
    if (/brut/.test(after)) doubts.push("Has dado el sueldo en bruto: necesito el neto que te llega en cada nómina.");
    else if (/al ano|anual/.test(after) || v > 15000) doubts.push("¿Ese sueldo es anual? Dime el neto de cada nómina y cuántas pagas tienes.");
    else if (v >= 300) extra.netPay = v;
  }
  const pagas = first(own, String.raw`(\d{2})\s*pagas`);
  if (pagas && [12, 13, 14, 15, 16].includes(Number(pagas[1]))) extra.pagas = Number(pagas[1]);

  // deudas
  if (/\b(sin|no tengo|ninguna?) (otras )?(deudas?|prestamos?)\b/.test(t)) profile.monthlyDebts = 0;
  else {
    const debt = first(t, String.raw`(?:deudas?|prestamos?|coche|letra|cuota)\D{0,40}?(${NUM})\s*(?:€|euros?)?\s*(?:al mes|\/ ?mes|mensual)`);
    if (debt) profile.monthlyDebts = parseNumberEs(debt[1]);
  }

  const age = first(t, String.raw`tengo (\d{2}) anos`);
  if (age && Number(age[1]) >= 18 && Number(age[1]) <= 80) profile.age = Number(age[1]);

  const contract = first(t, String.raw`\b(indefinid[oa]|temporal|autonom[oa]|funcionari[oa])\b`);
  if (contract) extra.contractType = CONTRACT_TYPES.find((c) => contract[1].startsWith(c.slice(0, 7))) ?? "otro";

  // en un mensaje libre solo cuentan las frases claras («compro con mi pareja», «estoy soltero»)
  const buyer = buyingWith(t, "strict");
  if (buyer === "with") extra.coBuyer = true;
  else if (buyer === "alone") extra.coBuyer = false;

  const region = regionIn(message);
  if (region && /\b(comprar|busco|buscando|vivo|mudar\w*|zona)\b/.test(t)) profile.ccaa = region;

  if (change && "doubt" in change) doubts.push(change.doubt);
  return { profile, extra, doubts, ...(change && "change" in change ? { savingsChange: change.change } : {}) };
}

/** Personas con las que se puede comprar. */
const PEOPLE = String.raw`pareja|novi[oa]|mujer|marido|espos[oa]|chic[oa]|herman[oa]s?|amig[oa]s?|madre|padre|padres|familia|socio|socia`;

/** ¿La palabra que empieza en `index` está negada? «no tengo pareja», «sin pareja», «no compro solo». */
function negated(t: string, index: number): boolean {
  // hasta dos palabras entre la negación y la palabra, sin cruzar una coma: «no, solo yo» no es negación
  return /\b(no|ni|sin|nunca|tampoco)\b(?:\s+[a-z]+){0,2}\s*$/.test(t.slice(Math.max(0, index - 30), index));
}

/** Coincidencias de `pattern` en `t` separadas en afirmadas y negadas. */
function hits(t: string, pattern: string): { yes: number; no: number } {
  let yes = 0;
  let no = 0;
  for (const m of t.matchAll(new RegExp(pattern, "g"))) {
    if (negated(t, m.index)) no++;
    else yes++;
  }
  return { yes, no };
}

/**
 * ¿Compra solo o acompañado? Devuelve null si el texto no lo dice o se contradice: entonces se pregunta,
 * no se adivina. Mirar la negación es lo importante: «no tengo pareja» contiene «pareja» y significa solo.
 *
 * - "strict": frases inequívocas, para cualquier mensaje («compro con mi pareja», «estoy soltera»).
 * - "answer": además respuestas sueltas a «¿Compras solo o con otra persona?» («sola», «mi novio», «yo»).
 */
export function buyingWith(text: string, mode: "strict" | "answer"): "alone" | "with" | null {
  const t = norm(text);
  // «solo» como adverbio («solo tengo 20.000») no dice nada de con quién compra
  const SOLO = String.raw`\bsol[oa]\b(?!\s+(?:tengo|tenemos|cobro|gano|quiero|puedo|me|es|un|una|si|hay|\d))`;
  const alonePhrase = hits(t, String.raw`\b(?:compro|comprar|comprare|compraria|voy|ire|la compro|lo compro)(?: (?:la casa|el piso|la vivienda))? sol[oa]\b|\bsolter[oa]\b|\bpor mi cuenta\b|\bcon nadie\b|\bsin nadie\b`);
  const withPhrase = hits(t, String.raw`\bcon (?:mi|mis) (?:${PEOPLE})\b|\bentre (?:los|las) dos\b|\bcompramos\b|\ba medias\b`);
  // «no tengo pareja», «sin pareja»: decir que no hay otra persona es decir que compra solo
  const noPartner = hits(t, String.raw`\b(?:pareja|novi[oa]|marido|mujer|espos[oa])\b`).no;

  const alone = alonePhrase.yes + withPhrase.no + noPartner;
  const company = withPhrase.yes + alonePhrase.no;
  if (alone && !company) return "alone";
  if (company && !alone) return "with";
  if (alone && company) return null;
  if (mode === "strict") return null;

  // respuesta corta a la pregunta: valen palabras sueltas
  const soloWord = hits(t, SOLO);
  const person = hits(t, String.raw`\b(?:${PEOPLE}|los dos|las dos|junt[oa]s|otra persona|acompanad[oa])\b`);
  const looseAlone = soloWord.yes + person.no + (/^\W*(?:yo|nadie|ninguna|nada|solo yo|yo solo|yo sola|sola yo|solo yo mism[oa])\W*$/.test(t) ? 1 : 0) + (/\b(?:divorciad|separad|viud)[oa]\b/.test(t) ? 1 : 0);
  const looseWith = person.yes + soloWord.no;
  if (looseAlone && !looseWith) return "alone";
  if (looseWith && !looseAlone) return "with";
  return null;
}

/**
 * Comprobación de un sueldo que alguien (el modelo) quiere guardar como NETO POR NÓMINA, contra la
 * frase del usuario. Devuelve el motivo para no guardarlo, o null si no hay nada raro.
 *
 * Existe porque guardar un bruto o un sueldo anual como neto mensual infla el presupuesto en decenas
 * de miles de euros sin que nada falle. El prompt ya le dice a Claude que pregunte, pero una regla que
 * protege los números tiene que estar en código: si el prompt falla, esto lo para.
 */
export function payDoubt(note: string, pay: { netPay?: number; coBuyerNetPay?: number; netIncome?: number }): string | null {
  const values = [pay.netPay, pay.coBuyerNetPay, pay.netIncome].filter((v): v is number => v != null);
  if (!values.length) return null;
  const t = norm(note);
  // «brutos» sin que aparezca también el neto: "30.000 brutos". Con los dos ("1.900 netos, 28.000 brutos") se acepta.
  if (/\bbrut/.test(t) && !/\bnet[oa]s?\b|\blimpi[oa]s?\b/.test(t)) {
    return "El usuario ha dado el sueldo en BRUTO y aquí solo se guarda el neto. Pregúntale cuánto le llega neto en cada nómina y cuántas pagas tiene.";
  }
  // una nómina de más de 15.000 € netos es casi seguro un sueldo anual
  if ([pay.netPay, pay.coBuyerNetPay].some((v) => v != null && v > 15000)) {
    return "Ese importe parece un sueldo ANUAL, no una nómina. Pregúntale el neto de cada nómina y cuántas pagas tiene.";
  }
  if (/\b(al ano|anual(es)?)\b/.test(t) && !/\bpagas?\b|al mes|mensual|nomina|cada mes/.test(t)) {
    return "El usuario habla de un importe ANUAL y aquí se guarda el neto por nómina. Pregúntale el neto de cada nómina y cuántas pagas tiene.";
  }
  return null;
}

/**
 * Respuesta corta a la pregunta que se acaba de hacer ("42.000", "solo", "en Usera y Carabanchel").
 * `pending` es la clave de KEY_FACTS que se preguntó. Solo se usa con mensajes cortos.
 */
export function extractAnswer(pending: string, message: string): ExtractedFacts {
  const out: ExtractedFacts = { profile: {}, extra: {}, doubts: [] };
  const text = message.trim();
  if (!text || text.length > 160 || text.includes("?")) return out;
  const t = norm(text);
  const nums = numbersIn(text);
  const no = /^(no|nada|ningun[ao]?|cero|0)\b/.test(t);
  // si el mensaje habla claramente de otro tema, no es la respuesta a la pregunta pendiente
  const TOPIC: Record<string, RegExp> = {
    savings: /ahorr/,
    netIncome: /cobr|sueld|salari|nomina|gano|brut|pagas/,
    monthlyDebts: /deuda|prestamo|letra|cuota|tarjeta/,
  };
  const topic = pending === "coBuyerNetPay" ? "netIncome" : pending;
  if (Object.entries(TOPIC).some(([key, re]) => key !== topic && re.test(t))) return out;

  if (pending === "savings" && nums.length === 1 && nums[0] >= 500) out.profile.savings = nums[0];
  else if (pending === "netIncome" && nums.length >= 1 && nums[0] >= 300 && nums[0] <= 15000 && !/brut|anual|al ano/.test(t)) {
    out.extra.netPay = nums[0];
    const pagas = nums.slice(1).find((n) => n >= 12 && n <= 16);
    if (pagas) out.extra.pagas = pagas;
  } else if (pending === "coBuyerNetPay" && nums.length >= 1 && nums[0] >= 300 && nums[0] <= 15000 && !/brut|anual|al ano/.test(t)) {
    out.extra.coBuyerNetPay = nums[0];
    const pagas = nums.slice(1).find((n) => n >= 12 && n <= 16);
    if (pagas) out.extra.coBuyerPagas = pagas;
  } else if (pending === "monthlyDebts" && (no || (nums.length === 1 && nums[0] <= 5000))) out.profile.monthlyDebts = no ? 0 : nums[0];
  else if (pending === "coBuyer") {
    const buyer = buyingWith(text, "answer");
    if (buyer) out.extra.coBuyer = buyer === "with";
  } else if (pending === "ccaa") {
    const region = regionIn(text);
    if (region) out.profile.ccaa = region;
  } else if (pending === "targetZones" && !nums.length) {
    const zones = text
      .replace(/^(en|por|me interesan?|me gustan?|la zona de|zonas? de|barrios? de)\s+/i, "")
      .split(/,|\s+y\s+|\s+o\s+|\//)
      .map((z) => z.trim().replace(/\.$/, ""))
      .filter((z) => z.length > 1 && z.length < 40);
    if (zones.length) out.extra.targetZones = zones;
    const region = regionIn(text);
    if (region) out.profile.ccaa = region;
  } else if (pending === "timeline") out.extra.timeline = text.replace(/\.$/, "");
  return out;
}

/** Comunidad autónoma mencionada en un texto (por su nombre o por una ciudad conocida). */
export function regionIn(text: string): CCAA | null {
  const t = ` ${norm(text).replace(/[^a-z0-9]+/g, " ")} `;
  for (const [id, name] of CCAA_LIST) if (t.includes(` ${norm(name)} `)) return id;
  return findCity(text)?.ccaa ?? null;
}

const PRICE = String.raw`(\d{1,3}(?:\.\d{3})+|\d{5,8})\s*(?:€|euros?\b|eur\b)(?!\s*\/\s*m)`;

function listingPrice(t: string): number | null {
  for (const m of t.matchAll(new RegExp(PRICE, "g"))) {
    const v = parseNumberEs(m[1]);
    if (v >= 20_000 && v <= 20_000_000) return v;
  }
  return null;
}

/** ¿El mensaje es un anuncio pegado? Precio de venta y al menos otra señal de anuncio. */
export function looksLikeListing(message: string): boolean {
  const t = norm(message);
  if (listingPrice(t) == null) return false;
  return /\d\s*m(²|2|etros)|\bhab\b|habitaci|dormitori|idealista\.com|fotocasa\.es|pisos\.com|habitaclia|en venta|se vende/.test(t);
}

const HOME_WORD = /piso|chalet|casa|atico|duplex|estudio|vivienda|apartamento|adosado|loft|finca/;

/** Lee los campos de un anuncio pegado como texto (Idealista y similares). Devuelve null si no hay precio. */
export function parseListingText(message: string): ListingInput | null {
  const t = norm(message);
  const price = listingPrice(t);
  if (price == null) return null;
  const num = (pattern: string) => {
    const m = first(t, pattern);
    return m ? parseNumberEs(m[1]) : undefined;
  };

  const city = findCity(message);
  const district = city?.districts.find((d) => ` ${norm(message)} `.includes(norm(d)));
  // el título es la primera línea (o frase, si todo va seguido) que nombra un tipo de vivienda
  const title = message
    .split(/\n|\.\s|[·|]| (?=\d{2,3}\.\d{3}\s*€)/)
    .map((l) => l.replace(/^(mira|este|anuncio|:|\s)+/i, "").trim())
    .find((l) => l.length > 8 && l.length < 110 && HOME_WORD.test(norm(l)) && !/^https?:/.test(l));

  const floorNum = first(t, String.raw`planta\s*(\d{1,2})|(\d{1,2})\s*[ºªa]?\s*planta`);
  const floorWord = first(t, String.raw`\b(bajo|atico|entreplanta|semisotano|sotano)\b`);
  const energy = first(t, String.raw`(?:consumo|certificado energetico|calificacion energetica|emisiones)\s*:?\s*([a-g])\b`);
  const url = message.match(/https?:\/\/[^\s)]+/)?.[0];

  const listing: ListingInput = {
    title: title || `Vivienda${city ? ` en ${district ?? city.name}` : ""}`,
    price,
    url,
    size: num(String.raw`(\d{2,4})\s*m(?:²|2\b|etros)`),
    rooms: num(String.raw`(\d{1,2})\s*(?:hab\b|hab\.|habitaci\w+|dormitori\w+)`),
    bathrooms: num(String.raw`(\d)\s*banos?\b`),
    floor: floorNum ? (floorNum[1] ?? floorNum[2]) : floorWord?.[1],
    hasLift: /sin ascensor/.test(t) ? false : /ascensor/.test(t) ? true : undefined,
    exterior: /\bexterior\b/.test(t) ? true : /\binterior\b/.test(t) ? false : undefined,
    parking: /(garaje|plaza de garaje|parking) incluid|con (plaza de )?garaje/.test(t) ? true : undefined,
    newBuild: /obra nueva/.test(t) ? true : undefined,
    municipality: city?.name,
    district,
    ccaa: city?.ccaa ?? regionIn(message) ?? undefined,
    description: message.trim().slice(0, 6000),
    communityFees: num(String.raw`comunidad\D{0,20}?(\d{1,4})\s*(?:€|euros?)`),
    ibiYearly: num(String.raw`\bibi\b\D{0,20}?(\d{2,5})\s*(?:€|euros?)`),
    energyRating: energy?.[1].toUpperCase(),
    yearBuilt: num(String.raw`(?:construido en|ano de construccion:?|edificio de)\s*(\d{4})`),
  };
  // sin undefined: así el resultado es un objeto limpio para guardar y comparar
  return Object.fromEntries(Object.entries(listing).filter(([, v]) => v !== undefined)) as unknown as ListingInput;
}
