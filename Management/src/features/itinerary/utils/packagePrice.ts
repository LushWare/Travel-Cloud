export function marginForPrice(cost: number, price: number): number | null {
  if (!(cost > 0) || !(price > 0) || price < cost) return null;
  return Math.round(((price / cost) - 1) * 10000) / 100;
}
