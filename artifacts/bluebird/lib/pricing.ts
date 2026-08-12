// Original (pre-discount) price derived from the discounted price, rounded
// to the nearest $100 so it reads like a real list price.
export function originalPrice(priceUsd: number, discountPct: number): number | null {
  if (!priceUsd || !discountPct || discountPct <= 0 || discountPct >= 100) return null;
  return Math.round(priceUsd / (1 - discountPct / 100) / 100) * 100;
}
