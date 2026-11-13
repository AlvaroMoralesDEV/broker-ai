// Viviendas de EJEMPLO (inventadas) para poder usar la app sin credenciales de Idealista.
// Se generan de forma determinista a partir del nombre de la zona.
import { findCity, normalize, type Listing, type SearchParams } from "../shared/listings.ts";

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STREETS = ["Calle Mayor", "Avenida de la Constitución", "Calle del Carmen", "Calle Real", "Paseo de la Estación", "Calle San Juan", "Calle Nueva", "Avenida de Europa", "Calle del Pilar", "Plaza de España", "Calle de la Paz", "Calle Ancha"];
const KINDS = ["Piso", "Piso", "Piso", "Ático", "Dúplex", "Estudio", "Chalet adosado"];
const FLOORS = ["bajo", "1", "2", "3", "4", "5", "6"];

export function sampleListings(params: SearchParams): Listing[] {
  const city = findCity(params.zone);
  const cityName = city?.name ?? params.zone.trim();
  const base = city?.m2 ?? 1800;
  const districts = city?.districts ?? ["Centro", "Ensanche", "Zona Norte", "Zona Sur"];
  const rand = rng(normalize(cityName));
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  const out: Listing[] = [];
  for (let i = 0; i < 40; i++) {
    const kind = pick(KINDS);
    const rooms = kind === "Estudio" ? 1 : kind === "Chalet adosado" ? 3 + Math.floor(rand() * 2) : 1 + Math.floor(rand() * 4);
    const size = Math.round(kind === "Estudio" ? 30 + rand() * 15 : 38 + rooms * 18 + rand() * 30);
    const m2 = base * (0.55 + rand() * 0.9);
    const price = Math.round((size * m2) / 1000) * 1000;
    const district = pick(districts);
    const street = pick(STREETS);
    out.push({
      id: `ejemplo-${normalize(cityName).replace(/ /g, "-")}-${i}`,
      title: `${kind} en ${street}, ${district}`,
      price,
      size,
      rooms,
      bathrooms: rooms >= 3 ? 2 : 1,
      floor: kind === "Chalet adosado" ? null : pick(FLOORS),
      hasLift: rand() > 0.35,
      exterior: rand() > 0.25,
      parking: rand() > 0.7,
      newDevelopment: rand() > 0.92,
      address: `${street}, ${district}`,
      district,
      municipality: cityName,
      province: null,
      pricePerM2: Math.round(price / size),
      thumbnail: null,
      url: null,
      description: null,
      source: "ejemplo",
    });
  }
  return out;
}
