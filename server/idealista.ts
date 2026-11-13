// Cliente de la API oficial de Idealista (https://developers.idealista.com/access-request).
// OAuth2 client_credentials → POST https://api.idealista.com/3.5/es/search (form-encoded).
// La API busca por centro + radio, así que antes se geocodifica la zona.
import { findCity, type Listing, type SearchParams } from "../shared/listings.ts";
import { CCAA_LIST, type CCAA } from "../shared/taxes.ts";
import { normalize } from "../shared/listings.ts";

const API = "https://api.idealista.com";

export const idealistaConfigured = () => Boolean(process.env.IDEALISTA_API_KEY && process.env.IDEALISTA_SECRET);

let token: { value: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  if (token && token.expires > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(
    `${encodeURIComponent(process.env.IDEALISTA_API_KEY!)}:${encodeURIComponent(process.env.IDEALISTA_SECRET!)}`,
  ).toString("base64");
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`Idealista rechazó las credenciales (HTTP ${res.status}). Revisa IDEALISTA_API_KEY e IDEALISTA_SECRET.`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  token = { value: json.access_token, expires: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return token.value;
}

export interface Place {
  lat: number;
  lon: number;
  label: string;
  ccaa: CCAA | null;
}

const geoCache = new Map<string, Place | null>();

function ccaaFromState(state: string | undefined): CCAA | null {
  if (!state) return null;
  const s = normalize(state);
  const aliases: Record<string, CCAA> = {
    "catalunya": "cataluna", "cataluna": "cataluna", "comunitat valenciana": "valencia", "comunidad valenciana": "valencia",
    "euskadi": "pais-vasco", "pais vasco": "pais-vasco", "illes balears": "baleares", "islas baleares": "baleares",
    "principado de asturias": "asturias", "asturias": "asturias", "region de murcia": "murcia", "comunidad de madrid": "madrid",
    "navarra": "navarra", "comunidad foral de navarra": "navarra", "ceuta": "ceuta-melilla", "melilla": "ceuta-melilla",
    "galicia": "galicia", "aragon": "aragon", "andalucia": "andalucia", "canarias": "canarias", "cantabria": "cantabria",
    "castilla la mancha": "castilla-la-mancha", "castilla y leon": "castilla-y-leon", "extremadura": "extremadura", "la rioja": "la-rioja",
  };
  if (aliases[s]) return aliases[s];
  return CCAA_LIST.find(([, name]) => normalize(name) === s)?.[0] ?? null;
}

/** Convierte "Ruzafa, Valencia" en coordenadas con Nominatim (OpenStreetMap); si falla, usa la lista de ciudades. */
export async function geocode(zone: string): Promise<Place | null> {
  const key = normalize(zone);
  if (geoCache.has(key)) return geoCache.get(key)!;
  let place: Place | null = null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&countrycodes=es&q=${encodeURIComponent(zone)}`;
    const res = await fetch(url, { headers: { "User-Agent": "hipoteca-searcher/0.1 (local app)", "Accept-Language": "es" }, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const [hit] = (await res.json()) as Array<{ lat: string; lon: string; display_name: string; address?: { state?: string; city?: string } }>;
      if (hit) place = { lat: Number(hit.lat), lon: Number(hit.lon), label: hit.display_name, ccaa: ccaaFromState(hit.address?.state ?? hit.address?.city) };
    }
  } catch {
    // sin red o Nominatim caído: se usa la lista local
  }
  if (!place) {
    const city = findCity(zone);
    if (city) place = { lat: city.lat, lon: city.lon, label: city.name, ccaa: city.ccaa };
  }
  geoCache.set(key, place);
  return place;
}

interface IdealistaElement {
  propertyCode: string;
  thumbnail?: string;
  price: number;
  propertyType?: string;
  size?: number;
  rooms?: number;
  bathrooms?: number;
  floor?: string;
  exterior?: boolean;
  hasLift?: boolean;
  address?: string;
  district?: string;
  neighborhood?: string;
  municipality?: string;
  province?: string;
  url?: string;
  priceByArea?: number;
  newDevelopment?: boolean;
  description?: string;
  parkingSpace?: { hasParkingSpace?: boolean };
  suggestedTexts?: { title?: string; subtitle?: string };
}

const TYPE_NAMES: Record<string, string> = { flat: "Piso", chalet: "Chalet", studio: "Estudio", penthouse: "Ático", duplex: "Dúplex", countryHouse: "Casa rural" };

function toListing(e: IdealistaElement): Listing {
  const kind = TYPE_NAMES[e.propertyType ?? ""] ?? "Vivienda";
  return {
    id: `idealista-${e.propertyCode}`,
    title: e.suggestedTexts?.title ?? `${kind} en ${e.address ?? e.neighborhood ?? e.municipality ?? ""}`.trim(),
    price: e.price,
    size: e.size ?? null,
    rooms: e.rooms ?? null,
    bathrooms: e.bathrooms ?? null,
    floor: e.floor ?? null,
    hasLift: e.hasLift ?? null,
    exterior: e.exterior ?? null,
    parking: e.parkingSpace?.hasParkingSpace ?? null,
    newDevelopment: Boolean(e.newDevelopment),
    address: e.address ?? "",
    district: e.district ?? e.neighborhood ?? null,
    municipality: e.municipality ?? "",
    province: e.province ?? null,
    pricePerM2: e.priceByArea ?? (e.size ? Math.round(e.price / e.size) : null),
    thumbnail: e.thumbnail ?? null,
    url: e.url ?? `https://www.idealista.com/inmueble/${e.propertyCode}/`,
    description: e.description ?? null,
    source: "idealista",
  };
}

export async function searchIdealista(params: SearchParams, place: Place): Promise<{ total: number; listings: Listing[] }> {
  const body = new URLSearchParams({
    country: "es",
    operation: "sale",
    propertyType: "homes",
    center: `${place.lat},${place.lon}`,
    distance: String(Math.round((params.radiusKm ?? 5) * 1000)),
    maxItems: "50",
    numPage: String(params.page ?? 1),
    locale: "es",
    order: params.order === "size" ? "size" : "price",
    sort: params.order === "size" ? "desc" : "asc",
  });
  if (params.maxPrice) body.set("maxPrice", String(Math.round(params.maxPrice)));
  if (params.minPrice) body.set("minPrice", String(Math.round(params.minPrice)));
  if (params.minSize) body.set("minSize", String(Math.round(params.minSize)));
  if (params.minRooms) body.set("bedrooms", [1, 2, 3, 4].filter((n) => n >= params.minRooms!).join(",") || "4");

  const res = await fetch(`${API}/3.5/es/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (res.status === 401) token = null;
  if (res.status === 429) throw new Error("Has agotado la cuota de peticiones de la API de Idealista (suele ser de 100 al mes).");
  if (!res.ok) throw new Error(`Idealista devolvió HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { total?: number; elementList?: IdealistaElement[] };
  return { total: json.total ?? json.elementList?.length ?? 0, listings: (json.elementList ?? []).map(toListing) };
}
