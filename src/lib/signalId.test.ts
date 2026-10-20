import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deterministicUuid, tradingViewSignalId } from './signalId';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const alert = {
  strategy: 'breakout',
  symbol: 'BTCUSD',
  action: 'LONG',
  timestamp: 1_700_000_000_000,
};

describe('deterministic signal ids', () => {
  it('produces a canonical version-5 UUID', async () => {
    assert.match(await tradingViewSignalId(alert), UUID_V5);
    assert.match(await deterministicUuid('anything'), UUID_V5);
  });

  it('is stable across calls and processes', async () => {
    const first = await tradingViewSignalId(alert);
    const second = await tradingViewSignalId({ ...alert });
    assert.equal(first, second);
    // Golden value: changing the derivation would silently re-open duplicates.
    assert.equal(first, '6f8485ee-5604-5342-9269-d80bcce157ed');
  });

  it('separates every field that makes an alert distinct', async () => {
    const base = await tradingViewSignalId(alert);
    const variants = [
      { ...alert, strategy: 'mean-reversion' },
      { ...alert, symbol: 'ETHUSD' },
      { ...alert, action: 'SHORT' },
      { ...alert, timestamp: alert.timestamp + 1 },
    ];
    const ids = await Promise.all(variants.map((variant) => tradingViewSignalId(variant)));
    assert.equal(new Set([base, ...ids]).size, 5);
  });
});
