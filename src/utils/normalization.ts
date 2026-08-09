const DIACRITICS = /[\u0300-\u036f]/g;

export function parseBRLPrice(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (!value) return null;
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(",")) normalized = cleaned.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, "");

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  const kept = new URLSearchParams();
  for (const [key, item] of url.searchParams) {
    if (!["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].includes(key)) {
      kept.append(key, item);
    }
  }
  url.search = kept.toString();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function normalizeMileage(value: string | number | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/\s/g, "");
  const match = normalized.match(/([\d.,]+)/);
  if (!match?.[1]) return null;
  let numberText = match[1];
  if (numberText.includes(",") && numberText.includes(".")) numberText = numberText.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(numberText)) numberText = numberText.replace(/\./g, "");
  else numberText = numberText.replace(",", ".");
  let parsed = Number(numberText);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 1000 && /^[\d.,]+(?:mil|k)(?:km)?$/.test(normalized)) parsed *= 1000;
  return Math.round(parsed);
}

export function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
}
