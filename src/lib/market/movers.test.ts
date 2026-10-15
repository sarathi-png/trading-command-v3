import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rankMovers, assessMover } from "./movers";
import type { Ticker, Candle } from "../types";
const now = 1729000000000;
const ticker = (symbol: string, change: number): Ticker => ({
  symbol,
  price: 100,
  change24hPct: change,
  volume24hUsd: 100000,
  ts: now,
  source: "demo",
  markPrice: null,
  fundingRate: null,
  openInterest: null,
  high24h: null,
  low24h: null,
  bid: null,
  ask: null,
});
describe("market mover ranking is not a trade instruction", () => {
  it("ranks positive and negative moves separately and caps each at ten", () => {
    const list = Array.from({ length: 30 }, (_, i) => ticker(`C${i}`, i - 15));
    const rank = rankMovers(list, now);
    assert.equal(rank.gainers.length, 10);
    assert.equal(rank.losers.length, 10);
    assert.equal(rank.gainers[0].change24hPct, 14);
    assert.equal(rank.losers[0].change24hPct, -15);
  });
  it("does not pad a small demo universe or invent opposite-side movers", () => {
    const rank = rankMovers([ticker("BTC", 2), ticker("ETH", 3)], now);
    assert.equal(rank.gainers.length, 2);
    assert.equal(rank.losers.length, 0);
  });
  it("excludes missing changes, stale records, invalid prices and zero volume", () => {
    const list = [
      { ...ticker("A", 2), change24hAvailable: false },
      { ...ticker("B", -2), ts: now - 130000 },
      { ...ticker("C", 2), price: NaN },
      { ...ticker("D", 2), volume24hUsd: 0 },
      { ...ticker("E", 2), stale: true },
      ticker("OK", 2),
    ];
    const rank = rankMovers(list, now);
    assert.equal(rank.excluded, 5);
    assert.equal(rank.gainers[0].symbol, "OK");
  });
  it("deduplicates symbols and uses stable alphabetical ties", () => {
    const rank = rankMovers(
      [ticker("Z", 2), ticker("A", 2), ticker("A", 2)],
      now,
    );
    assert.deepEqual(
      rank.gainers.map((t) => t.symbol),
      ["A", "Z"],
    );
  });
  it("waits when candles are missing, irrespective of 24h gain", () => {
    assert.equal(assessMover("BTCUSD", [], now).stance, "WAIT");
  });
  it("never analyzes a still-forming candle as closed evidence", () => {
    const candles: Candle[] = Array.from({ length: 250 }, (_, i) => ({
      time: Math.floor(now / 1000) - 249 * 300 + i * 300,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
    }));
    assert.match(
      assessMover("BTCUSD", candles, now).reasons.join(" "),
      /Insufficient/,
    );
  });
  it("waits on stale closed-candle evidence", () => {
    const candles: Candle[] = Array.from({ length: 260 }, (_, i) => ({
      time: Math.floor(now / 1000) - 300000 + i * 300,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 100,
    }));
    assert.match(
      assessMover("BTCUSD", candles, now).reasons.join(" "),
      /stale/,
    );
  });
  it("qualifies a synthetic rising trend only when both chart views and confirmations agree", () => {
    const candles: Candle[] = Array.from({length:500}, (_,i) => ({time:172800+i*300,open:100+i*0.4,close:100+(i+1)*0.4,high:100+(i+1)*0.4+0.1,low:100+i*0.4-0.1,volume:10}));
    const result=assessMover('BTCUSD',candles,(candles.at(-1)!.time+300)*1000);
    assert.equal(result.stance,'BUY-SIDE CANDIDATE');
    assert.ok(result.stop!==null&&result.stop<result.entry!);
    const descending=candles.map(c=>({...c,open:500-c.open,close:500-c.close,high:500-c.low,low:500-c.high}));
    const down=assessMover('BTCUSD',descending,(candles.at(-1)!.time+300)*1000);
    assert.equal(down.stance,'SELL-SIDE CANDIDATE');
    assert.ok(down.stop!==null&&down.stop>down.entry!);
  });

});
