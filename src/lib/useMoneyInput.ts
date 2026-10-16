"use client";
import { useState } from "react";
import { useDisplayCurrency } from "./useDisplayCurrency";
/** Keep an editable display draft (including '.', '-', and trailing zeros),
 * while the owner stores canonical USD. Switching currency recomputes the view. */
export function useMoneyInput(raw: string, onRawChange: (value: string) => void) {
  const preference = useDisplayCurrency();
  const rate = preference.displayCurrency === "inr" ? preference.usdInrRate : 1;
  const [draft, setDraft] = useState<{ text: string; raw: string; rate: number } | null>(null);
  const value = draft?.raw === raw && draft.rate === rate ? draft.text : raw ? String(Number(raw) * rate) : "";
  function onChange(text: string) {
    const number = Number(text);
    const nextRaw = !text.trim() ? "" : Number.isFinite(number) ? String(number / rate) : text;
    setDraft({ text, raw: nextRaw, rate });
    onRawChange(nextRaw);
  }
  return { value, onChange };
}
