import type { ListingDetails } from "../marketplaces/types.js";
import { normalizeTitle } from "../utils/normalization.js";
import type { ListingCategory } from "./types.js";

export function detectCategory(listing: ListingDetails, configured?: ListingCategory): ListingCategory {
  if (configured && configured !== "generic") return configured;
  const text = normalizeTitle(`${listing.title} ${listing.description ?? ""}`);
  if (/\b(notebook|laptop|macbook|ultrabook)\b/.test(text)) return "notebook";
  if (/\b(rtx|gtx|radeon rx|geforce|placa de video|gpu)\b/.test(text)) return "gpu";
  if (/\b(carro|veiculo|km|automatico|manual|flex|diesel)\b/.test(text) && /\b(19\d{2}|20\d{2})\b/.test(text)) return "vehicle";
  if (/\b(tv|televisao|smartphone|celular|console|camera)\b/.test(text)) return "electronics";
  return configured ?? "generic";
}
