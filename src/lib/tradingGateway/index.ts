/**
 * Trading Gateway surface used by the application.
 *
 * Import from here (server-side only) instead of reaching for the individual
 * modules, so the list of private Delta capabilities the Vercel app has is
 * explicit and greppable:
 *
 *   account  → balances, transactions, fills, positions, open orders
 *   orders   → create, cancel, close position, reconcile
 *
 * Public market data (tickers, candles, order book, recent trades) is NOT here
 * and must not move here: it needs no credentials, no static IP and no
 * gateway hop. It stays in src/lib/market/delta.ts on the public endpoints.
 */
export {
  TradingGatewayError,
  gatewayConfigState,
  gatewayConfigured,
  gatewayHealth,
  gatewayRequest,
  newRequestId,
  type GatewayConfigState,
  type GatewayErrorCode,
} from "./client";

export {
  gatewayFills,
  gatewayOpenOrders,
  gatewayPositionsForUnderlying,
  gatewayWalletBalances,
  gatewayWalletTransactions,
  type RawBalanceRow,
  type RawPositionRow,
} from "./account";

export { livePositions, liveWalletBalances, type LivePosition } from "./positions";
export { baseAssetOf } from "./symbols";

export {
  gatewayCancelOrder,
  gatewayClosePosition,
  gatewayCreateOrder,
  gatewayOrderStatus,
  newClientOrderId,
  type CreateLiveOrderRequest,
  type LiveOrderResult,
  type OrderStatusResult,
} from "./orders";
