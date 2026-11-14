import type { CCAA } from "./taxes.ts";

export interface Listing {
  id: string;
  title: string;
  price: number;
  size: number | null;
  rooms: number | null;
  bathrooms: number | null;
  floor: string | null;
  hasLift: boolean | null;
  exterior: boolean | null;
  parking: boolean | null;
  newDevelopment: boolean;
  address: string;
  district: string | null;
  municipality: string;
  province: string | null;
  pricePerM2: number | null;
  thumbnail: string | null;
  url: string | null;
  description: string | null;
  source: "idealista" | "ejemplo" | "manual";
}

export interface City {
  name: string;
  ccaa: CCAA;
  lat: number;
  lon: number;
  /** €/m² aproximado, solo para generar datos de ejemplo */
  m2: number;
  districts: string[];
}

const c = (name: string, ccaa: CCAA, lat: number, lon: number, m2: number, districts: string[]): City => ({ name, ccaa, lat, lon, m2, districts });

/** Ciudades conocidas y sus barrios: sirven para saber de qué comunidad es un anuncio pegado (impuestos). */
export const CITIES: City[] = [
  c("Madrid", "madrid", 40.4168, -3.7038, 4800, ["Carabanchel", "Vallecas", "Tetuán", "Arganzuela", "Chamberí", "Usera", "Ciudad Lineal", "Latina"]),
  c("Barcelona", "cataluna", 41.3874, 2.1686, 4600, ["Sants", "Gràcia", "Eixample", "Nou Barris", "Sant Andreu", "Horta", "Poblenou"]),
  c("Valencia", "valencia", 39.4699, -0.3763, 2900, ["Ruzafa", "Benimaclet", "Patraix", "Campanar", "El Cabanyal", "Benicalap"]),
  c("Sevilla", "andalucia", 37.3891, -5.9845, 2400, ["Triana", "Nervión", "Macarena", "Los Remedios", "Cerro-Amate"]),
  c("Zaragoza", "aragon", 41.6488, -0.8891, 1900, ["Delicias", "Actur", "Las Fuentes", "San José", "Centro"]),
  c("Málaga", "andalucia", 36.7213, -4.4214, 3300, ["Teatinos", "Carretera de Cádiz", "Centro", "El Palo", "Cruz de Humilladero"]),
  c("Murcia", "murcia", 37.9922, -1.1307, 1500, ["El Carmen", "Vistalegre", "Santa María de Gracia", "Centro"]),
  c("Palma", "baleares", 39.5696, 2.6502, 4200, ["Son Gotleu", "Santa Catalina", "Pere Garau", "El Molinar"]),
  c("Las Palmas de Gran Canaria", "canarias", 28.1235, -15.4363, 2500, ["Guanarteme", "Schamann", "Vegueta", "Ciudad Alta"]),
  c("Bilbao", "pais-vasco", 43.263, -2.935, 3400, ["Deusto", "Santutxu", "Indautxu", "Rekalde", "Basurto"]),
  c("Alicante", "valencia", 38.3452, -0.481, 2300, ["Carolinas", "San Blas", "Playa de San Juan", "Benalúa"]),
  c("Córdoba", "andalucia", 37.8882, -4.7794, 1600, ["Ciudad Jardín", "Levante", "Centro", "Fátima"]),
  c("Valladolid", "castilla-y-leon", 41.6523, -4.7245, 1700, ["Delicias", "Parquesol", "La Rondilla", "Centro"]),
  c("Vigo", "galicia", 42.2406, -8.7207, 2100, ["Teis", "Coia", "Bouzas", "Centro"]),
  c("Gijón", "asturias", 43.5322, -5.6611, 2000, ["El Llano", "La Calzada", "La Arena", "Pumarín"]),
  c("A Coruña", "galicia", 43.3623, -8.4115, 2400, ["Monte Alto", "Os Mallos", "Agra do Orzán", "Cuatro Caminos"]),
  c("Granada", "andalucia", 37.1773, -3.5986, 2100, ["Zaidín", "Chana", "Albaicín", "Ronda"]),
  c("Vitoria-Gasteiz", "pais-vasco", 42.8467, -2.6716, 2700, ["Zabalgana", "Salburua", "Lakua", "Centro"]),
  c("Oviedo", "asturias", 43.3619, -5.8494, 1800, ["La Corredoria", "Pumarín", "Ciudad Naranco", "Centro"]),
  c("Pamplona", "navarra", 42.8125, -1.6458, 2700, ["Iturrama", "Rochapea", "San Juan", "Mendillorri"]),
  c("Santander", "cantabria", 43.4623, -3.81, 2500, ["Cuatro Caminos", "El Sardinero", "Castilla-Hermida", "Cazoña"]),
  c("San Sebastián", "pais-vasco", 43.3183, -1.9812, 5800, ["Gros", "Amara", "Antiguo", "Intxaurrondo"]),
  c("Logroño", "la-rioja", 42.4627, -2.445, 1700, ["Cascajos", "El Cubo", "Centro", "Yagüe"]),
  c("Badajoz", "extremadura", 38.8794, -6.9707, 1300, ["Valdepasillas", "San Roque", "Centro"]),
  c("Toledo", "castilla-la-mancha", 39.8628, -4.0273, 1500, ["Santa María de Benquerencia", "Buenavista", "Casco Histórico"]),
  c("Albacete", "castilla-la-mancha", 38.9943, -1.8585, 1400, ["Centro", "San Pablo", "Universidad"]),
  c("Salamanca", "castilla-y-leon", 40.9701, -5.6635, 1900, ["Garrido", "Centro", "Pizarrales"]),
  c("Santa Cruz de Tenerife", "canarias", 28.4636, -16.2518, 2200, ["La Salud", "Ofra", "Centro"]),
  c("Getafe", "madrid", 40.3083, -3.7327, 3000, ["El Bercial", "Centro", "Sector III", "Las Margaritas"]),
  c("Alcalá de Henares", "madrid", 40.482, -3.3635, 2600, ["Centro", "El Val", "Ensanche", "Reyes Católicos"]),
  c("Móstoles", "madrid", 40.3223, -3.865, 2500, ["Centro", "El Soto", "Estoril", "Villafontana"]),
  c("L'Hospitalet de Llobregat", "cataluna", 41.3596, 2.0997, 3100, ["Collblanc", "Santa Eulàlia", "Bellvitge", "Centre"]),
  c("Badalona", "cataluna", 41.4469, 2.2451, 2900, ["Centre", "Llefià", "La Salut", "Gorg"]),
  c("Girona", "cataluna", 41.9794, 2.8214, 2600, ["Eixample", "Santa Eugènia", "Montilivi"]),
  c("Tarragona", "cataluna", 41.1189, 1.2445, 1900, ["Centre", "Sant Pere i Sant Pau", "Torreforta"]),
  c("Castellón de la Plana", "valencia", 39.9864, -0.0513, 1400, ["Centro", "Grao", "Sur"]),
  c("Cádiz", "andalucia", 36.5271, -6.2886, 2900, ["Centro", "Bahía Blanca", "La Laguna"]),
  c("Almería", "andalucia", 36.834, -2.4637, 1500, ["Centro", "Nueva Andalucía", "Zapillo"]),
  c("Huelva", "andalucia", 37.2614, -6.9447, 1300, ["Centro", "Isla Chica", "El Molino"]),
  c("Jaén", "andalucia", 37.7796, -3.7849, 1200, ["Centro", "Bulevar", "San Ildefonso"]),
  c("León", "castilla-y-leon", 42.5987, -5.5671, 1500, ["Centro", "El Ejido", "La Chantría"]),
  c("Burgos", "castilla-y-leon", 42.3439, -3.6969, 1900, ["Gamonal", "Centro", "G-3"]),
  c("Cáceres", "extremadura", 39.4753, -6.3724, 1300, ["Centro", "Nuevo Cáceres", "Mejostilla"]),
  c("Lleida", "cataluna", 41.6176, 0.62, 1300, ["Centre", "Cappont", "Pardinyes"]),
  c("Ceuta", "ceuta-melilla", 35.8894, -5.3213, 2200, ["Centro", "Hadú"]),
  c("Melilla", "ceuta-melilla", 35.2923, -2.9381, 1900, ["Centro", "Real"]),
];

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Busca la ciudad conocida que mejor encaja con el texto ("piso en Ruzafa, Valencia" → Valencia). */
export function findCity(zone: string): City | null {
  const z = ` ${normalize(zone)} `;
  let best: City | null = null;
  for (const city of CITIES) {
    const n = normalize(city.name);
    if (z.includes(` ${n} `) && (!best || n.length > normalize(best.name).length)) best = city;
  }
  if (best) return best;
  for (const city of CITIES) {
    if (city.districts.some((d) => z.includes(` ${normalize(d)} `))) return city;
  }
  return null;
}
