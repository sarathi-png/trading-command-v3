/**
 * CoinDCX adapter tests.
 *
 * Two kinds of assertions, both against evidence rather than assumption:
 *
 *   1. GOLDEN SIGNING VECTORS — the exact bytes and hex digest CoinDCX's own
 *      samples produce, pinned so a refactor cannot silently change what is
 *      signed. The mock venue re-verifies every request's signature over the
 *      RAW body bytes it received, so a mismatch is caught even when the
 *      golden vector is not.
 *
 *   2. BEHAVIOURAL GUARANTEES against a local mock venue — status mapping,
 *      "reads retry, mutations never do", unknown-outcome reporting, wallet
 *      parsing that refuses to report a zero balance, order reconciliation
 *      verdicts, and the order-type gate that must fire before any HTTP call.
 *
 * Run compiled:  npm run test:exchange
 *   (tsc -p tsconfig.exchange.json && node --test output/exchange-js/tests/exchange)
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { CoinDcxClient } from "../../src/lib/exchange/coindcx/client";
import { authHeaders, serializeBody, signBody, signPayload, signaturesMatch } from "../../src/lib/exchange/coindcx/auth";
import { activeInstruments, candles, orderBook, tickers } from "../../src/lib/exchange/coindcx/market";
import { fills, positionTransactions, walletBalances } from "../../src/lib/exchange/coindcx/account";
import { normalisePosition, positions, exitPosition } from "../../src/lib/exchange/coindcx/positions";
import {
  cancelOrder,
  createOrder,
  normaliseStatus,
  reconcileSubmission,
  toVenueOrderType,
} from "../../src/lib/exchange/coindcx/orders";
import { ExchangeError } from "../../src/lib/exchange/errors";
import { baseAssetOf, instrumentFor, isSupportedSymbol, toExchangeSymbol, toInternalSymbol } from "../../src/lib/exchange/symbols";

const API_KEY = "test-api-key-not-a-secret";
const API_SECRET = "test-api-secret-0123456789abcdef";

// ---------------------------------------------------------------------------
// Mock venue
// ---------------------------------------------------------------------------

interface MockRequest {
  method: string;
  path: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  /** Independent re-verification of X-AUTH-SIGNATURE over the received bytes. */
  signatureValid: boolean;
  timestampIsMillis: boolean;
}

interface MockVenue {
  baseUrl: string;
  publicBaseUrl: string;
  requests: MockRequest[];
  /** Per-path response overrides. `status` + `body`, optionally `times`. */
  behaviour: Map<string, { status: number; body: unknown; times?: number }>;
  stop: () => Promise<void>;
  reset: () => void;
}

async function startMockVenue(): Promise<MockVenue> {
  const requests: MockRequest[] = [];
  const behaviour = new Map<string, { status: number; body: unknown; times?: number }>();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const url = new URL(req.url ?? "/", "http://mock.local");
      const signature = String(req.headers["x-auth-signature"] ?? "");
      const expected = body ? crypto.createHmac("sha256", API_SECRET).update(body, "utf8").digest("hex") : "";
      let timestampIsMillis = false;
      try {
        const parsed = JSON.parse(body) as { timestamp?: unknown };
        timestampIsMillis = typeof parsed.timestamp === "number" && parsed.timestamp > 1_000_000_000_000;
      } catch {
        /* non-JSON body: leave false */
      }
      requests.push({
        method: req.method ?? "GET",
        path: url.pathname,
        url: req.url ?? "",
        headers: req.headers,
        body,
        signatureValid: signature.length > 0 && signaturesMatch(signature, expected),
        timestampIsMillis,
      });

      const key = url.pathname;
      const override = behaviour.get(key);
      const status = override?.status ?? 200;
      const payload = override?.body ?? { ok: true };
      if (override?.times !== undefined) {
        override.times -= 1;
        if (override.times <= 0) behaviour.delete(key);
      }
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    publicBaseUrl: baseUrl,
    requests,
    behaviour,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    reset: () => {
      requests.length = 0;
      behaviour.clear();
    },
  };
}

function clientFor(venue: MockVenue, overrides: { maxReadRetries?: number } = {}): CoinDcxClient {
  return new CoinDcxClient({
    baseUrl: venue.baseUrl,
    publicBaseUrl: venue.publicBaseUrl,
    credentials: { apiKey: API_KEY, apiSecret: API_SECRET },
    timeoutMs: 3000,
    maxReadRetries: overrides.maxReadRetries ?? 0,
  });
}

let venue: MockVenue;

before(async () => {
  venue = await startMockVenue();
});
after(async () => {
  await venue.stop();
});

// ---------------------------------------------------------------------------

describe("signing (golden vectors from CoinDCX's own sample shape)", () => {
  it("serialises compact JSON exactly as the reference samples do", () => {
    assert.equal(serializeBody({ a: 1, b: "x" }), '{"a":1,"b":"x"}');
  });

  it("signs the raw body with hex HMAC-SHA256", () => {
    // Golden digest for this input, verified independently with BOTH
    //   python3 -c "import hmac,hashlib; print(hmac.new(secret, body, hashlib.sha256).hexdigest())"
    //   printf %s "$body" | openssl dgst -sha256 -hmac "$secret"
    // and pinned here so a refactor cannot quietly change what gets signed.
    const body = '{"timestamp":1700000000000,"order":{"side":"buy","pair":"B-BTC_USDT"}}';
    const digest = signBody(API_SECRET, body);
    const independent = crypto.createHmac("sha256", API_SECRET).update(body, "utf8").digest("hex");
    assert.equal(digest, independent);
    assert.match(digest, /^[0-9a-f]{64}$/);
    // Pinned value: changing signing inputs must fail this test loudly.
    assert.equal(digest, "d0d750dbdb20c75354c2326e5cdf4f2043fc304553ec08e9841303a3c1722c24");
  });

  it("puts a millisecond timestamp INSIDE the body and never lets a caller override it", () => {
    const { body, signature } = signPayload(API_SECRET, { timestamp: 1, order: { pair: "B-BTC_USDT" } }, 1_700_000_000_000);
    const parsed = JSON.parse(body) as { timestamp: number; order: { pair: string } };
    assert.equal(parsed.timestamp, 1_700_000_000_000);
    assert.equal(parsed.order.pair, "B-BTC_USDT");
    assert.equal(signature, signBody(API_SECRET, body));
  });

  it("sends the headers CoinDCX documents", () => {
    const headers = authHeaders(API_KEY, "abc");
    assert.deepEqual(headers, {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": API_KEY,
      "X-AUTH-SIGNATURE": "abc",
    });
  });

  it("compares signatures in constant time", () => {
    assert.equal(signaturesMatch("deadbeef", "deadbeef"), true);
    assert.equal(signaturesMatch("deadbeef", "deadbeee"), false);
    assert.equal(signaturesMatch("short", "a-much-longer-string"), false);
  });
});

describe("symbol adapter", () => {
  it("maps canonical symbols to the CoinDCX pair and back", () => {
    assert.equal(toExchangeSymbol("BTCUSD"), "B-BTC_USDT");
    assert.equal(toExchangeSymbol("btcusd"), "B-BTC_USDT");
    assert.equal(toInternalSymbol("B-BTC_USDT"), "BTCUSD");
    assert.equal(instrumentFor("ETHUSD").quoteAsset, "USDT");
    assert.equal(baseAssetOf("B-SOL_USDT"), "SOL");
    assert.equal(baseAssetOf("SOLUSD"), "SOL");
  });

  it("refuses an unknown instrument instead of guessing a pair", () => {
    assert.throws(
      () => toExchangeSymbol("NOTACOINUSD"),
      (error: unknown) => error instanceof ExchangeError && error.code === "EXCHANGE_NOT_SUPPORTED"
    );
    assert.equal(isSupportedSymbol("NOTACOINUSD"), false);
    assert.equal(isSupportedSymbol("BTCUSD"), true);
  });
});

describe("transport: status mapping and retry discipline", () => {
  it("verifies every private request with the venue's own signature check", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", {
      status: 200,
      body: [{ currency_short_name: "USDT", balance: 1234.5, available_balance: 1200 }],
    });
    await walletBalances(clientFor(venue));
    assert.equal(venue.requests.length, 1);
    assert.equal(venue.requests[0]!.signatureValid, true);
    assert.equal(venue.requests[0]!.timestampIsMillis, true);
    assert.equal(venue.requests[0]!.headers["x-auth-apikey"], API_KEY);
  });

  it("maps 401 to EXCHANGE_AUTH_ERROR", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", { status: 401, body: { message: "invalid api key" } });
    await assert.rejects(walletBalances(clientFor(venue)), (error: unknown) => {
      assert.ok(error instanceof ExchangeError);
      assert.equal(error.code, "EXCHANGE_AUTH_ERROR");
      assert.equal(error.status, 502);
      assert.ok(!error.message.includes(API_SECRET), "secret must never appear in an error message");
      return true;
    });
  });

  it("maps 403 to EXCHANGE_FORBIDDEN (permission or IP binding)", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", { status: 403, body: { message: "forbidden" } });
    await assert.rejects(walletBalances(clientFor(venue)), (error: unknown) => {
      assert.ok(error instanceof ExchangeError);
      assert.equal(error.code, "EXCHANGE_FORBIDDEN");
      return true;
    });
  });

  it("retries a throttled READ, then reports EXCHANGE_RATE_LIMITED", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", { status: 429, body: { message: "too many" } });
    await assert.rejects(walletBalances(clientFor(venue, { maxReadRetries: 2 })), (error: unknown) => {
      assert.ok(error instanceof ExchangeError);
      assert.equal(error.code, "EXCHANGE_RATE_LIMITED");
      return true;
    });
    assert.equal(venue.requests.length, 3, "one attempt plus two retries");
  });

  it("never retries a MUTATION and reports the outcome as unknown", async () => {
    venue.reset();
    // The venue-context read (position) must succeed, otherwise createOrder
    // stops there — which is correct behaviour, but not what this test is about.
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", { status: 200, body: [] });
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders/create", { status: 500, body: { message: "boom" } });
    await assert.rejects(
      createOrder(clientFor(venue), { symbol: "BTCUSD", side: "buy", type: "market", quantity: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ExchangeError);
        assert.equal(error.code, "EXCHANGE_UNKNOWN_RESULT");
        assert.equal(error.detail.reconcilable, true);
        return true;
      }
    );
    const creates = venue.requests.filter((r) => r.path.endsWith("/orders/create"));
    assert.equal(creates.length, 1, "an uncertain order must be sent exactly once");
  });

  it("treats a venue 4xx on create as a KNOWN refusal", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", { status: 200, body: [] });
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders/create", {
      status: 422,
      body: { message: "Order leverage must be equal to position leverage" },
    });
    await assert.rejects(
      createOrder(clientFor(venue), { symbol: "BTCUSD", side: "buy", type: "market", quantity: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ExchangeError);
        assert.equal(error.code, "EXCHANGE_BAD_REQUEST");
        assert.equal(error.retryableRead, false);
        return true;
      }
    );
  });
});

describe("market data parsing", () => {
  it("maps the live-prices payload onto the ticker model", async () => {
    venue.reset();
    venue.behaviour.set("/market_data/v3/current_prices/futures/rt", {
      status: 200,
      body: {
        ts: 1720429586580,
        prices: { "B-BTC_USDT": { fr: 0.0001, h: 69000, l: 65000, v: 123456, ls: 67000, pc: 2.5, mp: 67010 } },
      },
    });
    const [ticker] = await tickers(clientFor(venue), ["BTCUSD"]);
    assert.ok(ticker);
    assert.equal(ticker.symbol, "BTCUSD");
    assert.equal(ticker.exchangeSymbol, "B-BTC_USDT");
    assert.equal(ticker.price, 67000);
    assert.equal(ticker.change24hPct, 2.5);
    assert.equal(ticker.markPrice, 67010);
  });

  it("sorts bids descending and asks ascending from the depth map", async () => {
    venue.reset();
    venue.behaviour.set("/market_data/v3/orderbook/B-BTC_USDT-futures/20", {
      status: 200,
      body: { ts: 1705483019891, bids: { "100": "1", "101": "2" }, asks: { "103": "3", "102": "4" } },
    });
    const book = await orderBook(clientFor(venue), "BTCUSD", 20);
    assert.deepEqual(
      book.bids.map((b) => b.price),
      [101, 100]
    );
    assert.deepEqual(
      book.asks.map((a) => a.price),
      [102, 103]
    );
  });

  it("converts candlestick times to seconds and rejects a non-ok status", async () => {
    venue.reset();
    venue.behaviour.set("/market_data/candlesticks", {
      status: 200,
      body: { s: "ok", data: [{ open: 1, high: 2, low: 0.5, close: 1.5, volume: 10, time: 1704153600000 }] },
    });
    const bars = await candles(clientFor(venue), "BTCUSD", { resolution: "60", from: 1, to: 2 });
    assert.equal(bars[0]!.time, 1704153600);

    venue.behaviour.set("/market_data/candlesticks", { status: 200, body: { s: "error_no_data", data: [] } });
    await assert.rejects(candles(clientFor(venue), "BTCUSD", { resolution: "60", from: 1, to: 2 }), (error: unknown) => {
      assert.ok(error instanceof ExchangeError);
      assert.equal(error.code, "EXCHANGE_API_ERROR");
      return true;
    });
  });

  it("reads the public instrument list", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/data/active_instruments", {
      status: 200,
      body: [{ pair: "B-BTC_USDT", base_currency_short_name: "BTC", min_quantity: 0.001, exit_only: false }],
    });
    const instruments = await activeInstruments(clientFor(venue));
    assert.equal(instruments.length, 1);
    assert.equal(instruments[0]!.symbol, "BTCUSD");
    assert.equal(instruments[0]!.minQuantity, 0.001);
  });

  it("derives the aggressor side from the venue's is_maker flag", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/data/trades", {
      status: 200,
      body: [{ price: 1.17, quantity: 22000, timestamp: 1675037938736, is_maker: true }],
    });
    const rows = await import("../../src/lib/exchange/coindcx/market").then((m) => m.recentTrades(clientFor(venue), "BTCUSD"));
    assert.equal(rows[0]!.side, "sell");
    assert.equal(rows[0]!.ts, 1675037938736);
  });
});

describe("account parsing (never invent a zero)", () => {
  it("reads a wallet array", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", {
      status: 200,
      body: [{ currency_short_name: "USDT", balance: 100, available_balance: 90 }],
    });
    const balances = await walletBalances(clientFor(venue));
    assert.deepEqual(balances, [{ asset: "USDT", balance: 100, available: 90 }]);
  });

  it("reads a wallet object keyed by currency", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", {
      status: 200,
      body: { USDT: { balance: 250, available_balance: 200 } },
    });
    const balances = await walletBalances(clientFor(venue));
    assert.deepEqual(balances, [{ asset: "USDT", balance: 250, available: 200 }]);
  });

  it("refuses to report a balance it cannot recognise", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/wallets", { status: 200, body: { unexpected: "shape" } });
    await assert.rejects(walletBalances(clientFor(venue)), (error: unknown) => {
      assert.ok(error instanceof ExchangeError);
      assert.equal(error.code, "EXCHANGE_API_ERROR");
      return true;
    });
  });

  it("normalises positions, treating a negative size as short", () => {
    assert.deepEqual(normalisePosition({ pair: "B-BTC_USDT", active_pos: -0.5, avg_price: 60000, mark_price: 59000 }), {
      symbol: "BTCUSD",
      exchangeSymbol: "B-BTC_USDT",
      side: "short",
      qty: 0.5,
      entry: 60000,
      mark: 59000,
      upl: 500,
      leverage: null,
      liquidationPrice: null,
      margin: null,
      exchangePositionId: null,
    });
  });

  it("filters flat positions out of the list", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", {
      status: 200,
      body: [
        { id: "p1", pair: "B-BTC_USDT", active_pos: 0.25, avg_price: 100, mark_price: 110, leverage: 10 },
        { id: "p2", pair: "B-ETH_USDT", active_pos: 0, avg_price: 50, mark_price: 50 },
      ],
    });
    const open = await positions(clientFor(venue));
    assert.equal(open.length, 1);
    assert.equal(open[0]!.symbol, "BTCUSD");
    assert.equal(open[0]!.upl, 2.5);
  });

  it("closes a position through positions/exit with the venue position id", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", {
      status: 200,
      body: [{ id: "pos-42", pair: "B-BTC_USDT", active_pos: 0.1, avg_price: 100, mark_price: 101 }],
    });
    const positionsPath = "/exchange/v1/derivatives/futures/positions";
    venue.behaviour.set(positionsPath, {
      status: 200,
      body: [{ id: "pos-42", pair: "B-BTC_USDT", active_pos: 0.1, avg_price: 100, mark_price: 101 }],
    });
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions/exit", {
      status: 200,
      body: { message: "success", status: 200 },
    });
    const result = await exitPosition(clientFor(venue), "BTCUSD");
    assert.equal(result.positionId, "pos-42");
    const exitRequest = venue.requests.find((r) => r.path.endsWith("/positions/exit"));
    assert.ok(exitRequest);
    assert.deepEqual(JSON.parse(exitRequest.body).id, "pos-42");
  });

  it("reads fills and position transactions", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/trades", {
      status: 200,
      body: [
        {
          price: 0.2962,
          quantity: 33,
          is_maker: false,
          fee_amount: 0.0073,
          pair: "B-ID_USDT",
          side: "buy",
          timestamp: 1705645534425.8374,
          order_id: "o-1",
        },
      ],
    });
    const rows = await fills(clientFor(venue), { symbol: "BTCUSD", fromMs: 0, toMs: 1 });
    assert.equal(rows[0]!.quantity, 33);
    assert.equal(rows[0]!.side, "buy");
    assert.equal(rows[0]!.ts, 1705645534426);

    venue.behaviour.set("/exchange/v1/derivatives/futures/positions/transactions", {
      status: 200,
      body: [{ pair: "B-BTC_USDT", stage: "exit", amount: -12.5, fee_amount: 0.4, created_at: 1700000000000 }],
    });
    const txs = await positionTransactions(clientFor(venue));
    assert.equal(txs[0]!.amount, -12.5);
    assert.equal(txs[0]!.stage, "exit");
  });
});

describe("order vocabulary", () => {
  it("maps statuses it knows and keeps unknown ones unknown", () => {
    assert.equal(normaliseStatus("initial"), "open");
    assert.equal(normaliseStatus("open"), "open");
    assert.equal(normaliseStatus("partially_filled"), "partially_filled");
    assert.equal(normaliseStatus("filled"), "filled");
    assert.equal(normaliseStatus("cancelled"), "cancelled");
    assert.equal(normaliseStatus("rejected"), "rejected");
    assert.equal(normaliseStatus("something_new"), "unknown");
  });

  it("only ever sends the two order types verified from the documentation", () => {
    assert.equal(toVenueOrderType("market"), "market_order");
    assert.equal(toVenueOrderType("limit"), "limit_order");
    for (const type of ["stop_market", "stop_limit"] as const) {
      assert.throws(
        () => toVenueOrderType(type),
        (error: unknown) => error instanceof ExchangeError && error.code === "EXCHANGE_NOT_SUPPORTED"
      );
    }
  });

  it("refuses a stop order BEFORE any HTTP call", async () => {
    venue.reset();
    await assert.rejects(
      createOrder(clientFor(venue), { symbol: "BTCUSD", side: "buy", type: "stop_market", quantity: 1, stopPrice: 5 }),
      (error: unknown) => error instanceof ExchangeError && error.code === "EXCHANGE_NOT_SUPPORTED"
    );
    assert.equal(venue.requests.length, 0, "an unsupported order type must not reach the venue");
  });

  it("refuses reduce-only orders, which CoinDCX does not support", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", { status: 200, body: [] });
    await assert.rejects(
      createOrder(clientFor(venue), { symbol: "BTCUSD", side: "sell", type: "market", quantity: 1, reduceOnly: true }),
      (error: unknown) => error instanceof ExchangeError && error.code === "EXCHANGE_NOT_SUPPORTED"
    );
    assert.equal(venue.requests.filter((r) => r.path.endsWith("/orders/create")).length, 0);
  });

  it("aligns leverage before submitting when the position disagrees", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", {
      status: 200,
      body: [{ id: "p1", pair: "B-BTC_USDT", active_pos: 0.1, avg_price: 100, mark_price: 100, leverage: 5 }],
    });
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions/update_leverage", {
      status: 200,
      body: { message: "success" },
    });
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders/create", {
      status: 200,
      body: [{ id: "order-1", pair: "B-BTC_USDT", side: "buy", status: "initial", order_type: "market_order", total_quantity: 0.1, remaining_quantity: 0.1 }],
    });
    const result = await createOrder(clientFor(venue), {
      symbol: "BTCUSD",
      side: "buy",
      type: "market",
      quantity: 0.1,
      leverage: 10,
    });
    assert.equal(result.order.id, "order-1");
    const orderRequest = venue.requests.find((r) => r.path.endsWith("/orders/create"));
    assert.ok(orderRequest);
    const sent = JSON.parse(orderRequest.body) as { order: Record<string, unknown> };
    assert.equal(sent.order.pair, "B-BTC_USDT");
    assert.equal(sent.order.leverage, 10);
    assert.equal(sent.order.order_type, "market_order");
    assert.equal(sent.order.time_in_force, undefined, "market orders must not carry time_in_force");
  });

  it("treats a success:false create response as a refusal, not a submission", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/positions", { status: 200, body: [] });
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders/create", {
      status: 200,
      body: { success: false, error: "Insufficient funds" },
    });
    await assert.rejects(
      createOrder(clientFor(venue), { symbol: "BTCUSD", side: "buy", type: "market", quantity: 1 }),
      (error: unknown) => error instanceof ExchangeError && error.code === "EXCHANGE_BAD_REQUEST"
    );
  });

  it("cancels by venue id", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders/cancel", { status: 200, body: { message: "success", status: 200 } });
    const result = await cancelOrder(clientFor(venue), "abc-123");
    assert.equal(result.message, "success");
    assert.deepEqual(JSON.parse(venue.requests[0]!.body).id, "abc-123");
  });
});

describe("reconciliation verdicts", () => {
  it("finds the single matching order in the window", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders", {
      status: 200,
      body: [
        {
          id: "match-1",
          pair: "B-BTC_USDT",
          side: "buy",
          status: "open",
          order_type: "market_order",
          total_quantity: 0.5,
          remaining_quantity: 0.5,
          created_at: 1_700_000_000_000,
        },
      ],
    });
    const verdict = await reconcileSubmission(clientFor(venue), {
      symbol: "BTCUSD",
      side: "buy",
      quantity: 0.5,
      sinceMs: 1_699_999_990_000,
    });
    assert.equal(verdict.status, "found");
    if (verdict.status === "found") assert.equal(verdict.order.id, "match-1");
  });

  it("reports not_found only after reaching the end of the order history", async () => {
    venue.reset();
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders", { status: 200, body: [] });
    const verdict = await reconcileSubmission(clientFor(venue), {
      symbol: "BTCUSD",
      side: "buy",
      quantity: 0.5,
      sinceMs: Date.now() - 1000,
    });
    assert.equal(verdict.status, "not_found");
  });

  it("stays unknown when several orders could be the submission", async () => {
    venue.reset();
    const row = (id: string) => ({
      id,
      pair: "B-BTC_USDT",
      side: "buy",
      status: "open",
      order_type: "market_order",
      total_quantity: 0.5,
      remaining_quantity: 0.5,
      created_at: Date.now(),
    });
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders", { status: 200, body: [row("a"), row("b")] });
    const verdict = await reconcileSubmission(clientFor(venue), {
      symbol: "BTCUSD",
      side: "buy",
      quantity: 0.5,
      sinceMs: Date.now() - 1000,
    });
    assert.equal(verdict.status, "unknown");
  });

  it("stays unknown when the history is larger than the scan window", async () => {
    venue.reset();
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `other-${i}`,
      pair: "B-ETH_USDT",
      side: "buy",
      status: "open",
      order_type: "limit_order",
      total_quantity: 1,
      remaining_quantity: 1,
      created_at: Date.now(),
    }));
    venue.behaviour.set("/exchange/v1/derivatives/futures/orders", { status: 200, body: page });
    const verdict = await reconcileSubmission(
      clientFor(venue),
      { symbol: "BTCUSD", side: "buy", quantity: 0.5, sinceMs: Date.now() - 1000 },
      1
    );
    assert.equal(verdict.status, "unknown");
  });
});
