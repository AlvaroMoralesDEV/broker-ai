// Tipos compartidos entre el servidor y la interfaz del chat.
import type { ListingInput, ProfileExtra } from "./broker.ts";
import type { Profile } from "./finance.ts";

export interface HomeCardData {
  listing: ListingInput;
  /** id de la vivienda si está guardada */
  savedId?: string;
}

export type ChatEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string }
  | ({ type: "home" } & HomeCardData)
  | { type: "profile"; profile: Profile; extra: ProfileExtra }
  | { type: "error"; message: string }
  | { type: "done" };

/** Un mensaje tal y como se pinta (una respuesta del agente agrupa todos sus pasos y herramientas). */
export interface DisplayMsg {
  role: "user" | "assistant";
  text: string;
  tools: string[];
  homes: HomeCardData[];
  /** imágenes adjuntadas (solo se muestra cuántas) */
  images: number;
  error?: string;
}

export interface ImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** base64 sin el prefijo data: */
  data: string;
}

export const TOOL_LABEL: Record<string, string> = {
  get_profile: "Revisando tu perfil",
  update_profile: "Actualizando tu perfil",
  max_budget: "Calculando tu presupuesto",
  analyze_purchase: "Analizando la compra",
  evaluate_listing: "Analizando el anuncio",
  save_home: "Guardando la vivienda",
  list_saved_homes: "Repasando tus viviendas",
  update_home: "Actualizando la vivienda",
  remove_home: "Borrando la vivienda",
  mortgage_offers: "Comparando hipotecas",
  web_search: "Buscando en la web",
};
