/**
 * Symbol helpers for exchange symbols.
 *
 * "BTCUSD" → base asset "BTC". Delta's positions endpoint takes the BASE asset
 * (`underlying_asset_symbol=BTC`), not the contract symbol; passing "BTCUSD"
 * answers 404. This mirrors the regex the application has always used.
 */
export function baseAssetOf(symbol: string): string {
  return symbol.toUpperCase().replace(/(USDT|USDC|USD|PERP)$/i, "");
}
