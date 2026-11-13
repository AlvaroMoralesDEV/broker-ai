import { findCity, idealistaSearchUrl, type Listing, type SearchParams, type SearchResult } from "../shared/listings.ts";
import { geocode, idealistaConfigured, searchIdealista } from "./idealista.ts";
import { sampleListings } from "./sample.ts";

// La API de Idealista tiene una cuota mensual pequeña: se cachea cada búsqueda 12 h.
const cache = new Map<string, { at: number; result: SearchResult }>();
const TTL = 12 * 60 * 60 * 1000;

function applyFilters(listings: Listing[], p: SearchParams): Listing[] {
  const out = listings.filter(
    (l) =>
      (!p.maxPrice || l.price <= p.maxPrice) &&
      (!p.minPrice || l.price >= p.minPrice) &&
      (!p.minRooms || (l.rooms ?? 0) >= p.minRooms) &&
      (!p.minSize || (l.size ?? 0) >= p.minSize),
  );
  const key = p.order ?? "price";
  out.sort((a, b) =>
    key === "size" ? (b.size ?? 0) - (a.size ?? 0) : key === "ratio" ? (a.pricePerM2 ?? Infinity) - (b.pricePerM2 ?? Infinity) : a.price - b.price,
  );
  return out;
}

export async function searchHomes(params: SearchParams): Promise<SearchResult> {
  const zone = params.zone.trim();
  if (!zone) throw new Error("Indica una zona (ciudad, barrio o municipio).");
  const url = idealistaSearchUrl(zone);

  if (!idealistaConfigured()) {
    const listings = applyFilters(sampleListings(params), params);
    return {
      source: "ejemplo",
      zone,
      ccaa: findCity(zone)?.ccaa ?? null,
      total: listings.length,
      listings,
      notice:
        "Viviendas de EJEMPLO (inventadas): aún no hay credenciales de la API de Idealista. Pídelas en developers.idealista.com/access-request y ponlas en el archivo .env para ver anuncios reales.",
      idealistaSearchUrl: url,
    };
  }

  const key = JSON.stringify({ ...params, zone: zone.toLowerCase() });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.result;

  const place = await geocode(zone);
  if (!place) throw new Error(`No he podido localizar "${zone}". Prueba con "barrio, ciudad" o el nombre del municipio.`);
  const { total, listings } = await searchIdealista(params, place);
  const result: SearchResult = {
    source: "idealista",
    zone: place.label,
    ccaa: place.ccaa,
    total,
    listings: applyFilters(listings, { ...params, maxPrice: undefined, minPrice: undefined }),
    notice: total > listings.length ? `Idealista tiene ${total} anuncios en la zona; se muestran los ${listings.length} primeros.` : null,
    idealistaSearchUrl: url,
  };
  cache.set(key, { at: Date.now(), result });
  return result;
}
