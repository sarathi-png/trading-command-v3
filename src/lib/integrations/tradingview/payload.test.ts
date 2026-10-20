import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ALERT_MAX_AGE_MS, parseTradingViewAlert } from './payload';

const NOW = 1_700_000_000_000;
const base = {
  symbol: 'BTCUSD',
  action: 'LONG',
  timeframe: '15m',
  price: 108000,
  timestamp: NOW,
};

function parsed(overrides: Record<string, unknown> = {}) {
  const result = parseTradingViewAlert({ ...base, ...overrides }, NOW);
  assert.equal(result.ok, true, result.ok ? '' : result.error);
  return result.ok ? result.alert : null;
}

function rejected(overrides: Record<string, unknown> = {}) {
  const result = parseTradingViewAlert({ ...base, ...overrides }, NOW);
  assert.equal(result.ok, false, 'payload should be rejected');
  return result.ok ? '' : result.error;
}

describe('TradingView alert validation', () => {
  it('accepts the documented payload unchanged', () => {
    const alert = parsed();
    assert.equal(alert?.symbol, 'BTCUSD');
    assert.equal(alert?.action, 'LONG');
    assert.equal(alert?.timeframe, '15m');
    assert.equal(alert?.price, 108000);
    assert.equal(alert?.entry, 108000, 'entry defaults to the alert price');
    assert.equal(alert?.stop, null);
    assert.equal(alert?.target, null);
  });

  it('accepts numeric strings from real alert templates', () => {
    const alert = parsed({ price: '108000.5', entry: '107900', stop: '107000', target: '110000' });
    assert.equal(alert?.price, 108000.5);
    assert.equal(alert?.entry, 107900);
    assert.equal(alert?.stop, 107000);
    assert.equal(alert?.target, 110000);
  });

  it('never stores a missing, zero or non-numeric price', () => {
    assert.match(rejected({ price: undefined }), /price is required/);
    assert.match(rejected({ price: '' }), /price is required/);
    assert.match(rejected({ price: 0 }), /positive number/);
    assert.match(rejected({ price: -5 }), /positive number/);
    assert.match(rejected({ price: 'abc' }), /positive number/);
    assert.match(rejected({ price: null }), /price is required/);
  });

  it('rejects an invalid optional bracket instead of silently dropping it', () => {
    assert.match(rejected({ stop: 'soon' }), /stop/);
    assert.match(rejected({ target: 0 }), /target/);
    assert.match(rejected({ entry: 'above' }), /entry/);
  });

  it('strips only a leading exchange alias from the symbol', () => {
    assert.equal(parsed({ symbol: ' binance:btcusd ' })?.symbol, 'BTCUSD');
    assert.equal(parsed({ symbol: 'ETH_USDT' })?.symbol, 'ETH_USDT');
    assert.match(rejected({ symbol: 'BTC USD' }), /symbol/);
    assert.match(rejected({ symbol: 'B' }), /symbol/);
    assert.match(rejected({ symbol: 42 }), /symbol/);
  });

  it('maps TradingView intervals to app timeframes', () => {
    assert.equal(parsed({ timeframe: undefined, interval: '60' })?.timeframe, '1H');
    assert.equal(parsed({ timeframe: '240' })?.timeframe, '4H');
    assert.equal(parsed({ timeframe: 'D' })?.timeframe, '1D');
    assert.equal(parsed({ timeframe: 'W' })?.timeframe, '1W');
    assert.equal(parsed({ timeframe: undefined, interval: '15' })?.timeframe, '15m');
    assert.equal(parsed({ timeframe: '4H' })?.timeframe, '4H');
    assert.equal(parsed({ timeframe: undefined })?.timeframe, '15m');
  });

  it('refuses an unmappable interval rather than relabelling another one', () => {
    assert.match(rejected({ timeframe: '7' }), /Unsupported timeframe/);
    assert.match(rejected({ timeframe: 'M' }), /Unsupported timeframe/);
  });

  it('normalizes action case and rejects unknown actions', () => {
    assert.equal(parsed({ action: 'short' })?.action, 'SHORT');
    assert.match(rejected({ action: 'BUY' }), /action/);
    assert.match(rejected({ action: undefined }), /action/);
  });

  it('enforces the timestamp freshness window', () => {
    assert.match(rejected({ timestamp: NOW - ALERT_MAX_AGE_MS - 1 }), /timestamp/);
    assert.match(rejected({ timestamp: NOW + ALERT_MAX_AGE_MS + 1 }), /timestamp/);
    assert.match(rejected({ timestamp: 'not-a-date' }), /timestamp/);
    assert.match(rejected({ timestamp: undefined }), /timestamp/);
    assert.equal(parsed({ timestamp: new Date(NOW).toISOString() })?.timestamp, NOW);
  });

  it('bounds strategy and message so the mobile inbox cannot be flooded', () => {
    const alert = parsed({
      strategy: `a${'b'.repeat(200)}!`,
      message: 'x'.repeat(2000),
    });
    assert.ok((alert?.strategy.length ?? 0) <= 64);
    assert.ok((alert?.message.length ?? 0) <= 500);
    assert.equal(alert?.strategy.includes('!'), false);
    assert.equal(parsed({ strategy: '   ' })?.strategy, 'external');
    assert.equal(parsed({ message: undefined })?.message, 'External TradingView alert (validated)');
  });

  it('rejects non-object bodies', () => {
    for (const body of [null, undefined, 'text', 42, [base]]) {
      const result = parseTradingViewAlert(body, NOW);
      assert.equal(result.ok, false);
    }
  });
});
