/** Browser-only display preference. Server calculations always retain USD. */
export interface DisplayCurrency { displayCurrency: "usd" | "inr"; usdInrRate: number }
const USD: DisplayCurrency = { displayCurrency: "usd", usdInrRate: 1 };
let preference = USD;
const listeners = new Set<() => void>();
export function currentDisplayCurrency(): DisplayCurrency {
  return typeof window === "undefined" ? USD : preference;
}
export function setDisplayCurrency(next: DisplayCurrency) {
  if (typeof window === "undefined") return;
  if (next.displayCurrency === preference.displayCurrency && next.usdInrRate === preference.usdInrRate) return;
  const validRate = next.usdInrRate > 0 && Number.isFinite(next.usdInrRate);
  preference = validRate ? { ...next } : USD;
  listeners.forEach(listener => listener());
}
export function subscribeCurrency(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function displayRate(p = currentDisplayCurrency()): number { return p.displayCurrency === "inr" ? p.usdInrRate : 1; }
export function currencySymbol(p = currentDisplayCurrency()): string { return p.displayCurrency === "inr" ? "₹" : "$"; }
