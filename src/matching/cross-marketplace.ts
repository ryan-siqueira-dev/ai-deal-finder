import type { MarketplaceName } from "../marketplaces/types.js";
import { normalizeTitle } from "../utils/normalization.js";

export interface MatchCandidate {
  id: string;
  source: MarketplaceName;
  title: string;
  price: number | null;
  location: string | null;
}

export interface CrossMarketplaceMatch {
  listingAId: string;
  listingBId: string;
  confidence: number;
  reasons: string[];
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const right = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function findCrossMarketplaceMatch(a: MatchCandidate, b: MatchCandidate): CrossMarketplaceMatch | null {
  if (a.source === b.source || a.id === b.id) return null;
  let confidence = 0;
  const reasons: string[] = [];
  const titleScore = tokenSimilarity(a.title, b.title);
  if (titleScore >= 0.65) { confidence += 0.5 * titleScore; reasons.push(`Títulos semelhantes (${Math.round(titleScore * 100)}%)`); }
  if (a.price !== null && b.price !== null && Math.abs(a.price - b.price) / Math.max(a.price, b.price) <= 0.03) {
    confidence += 0.3; reasons.push("Preços iguais ou muito próximos");
  }
  if (a.location && b.location && tokenSimilarity(a.location, b.location) >= 0.5) {
    confidence += 0.2; reasons.push("Localizações semelhantes");
  }
  return confidence >= 0.7 ? { listingAId: a.id, listingBId: b.id, confidence: Math.min(1, confidence), reasons } : null;
}
