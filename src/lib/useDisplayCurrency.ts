"use client";
import { useSyncExternalStore } from "react";
import { currentDisplayCurrency, subscribeCurrency } from "./displayCurrency";
const SERVER = { displayCurrency: "usd" as const, usdInrRate: 1 };
/** Subscribe even in leaf components that otherwise only listen to quotes. */
export function useDisplayCurrency() {
  return useSyncExternalStore(subscribeCurrency, currentDisplayCurrency, () => SERVER);
}
