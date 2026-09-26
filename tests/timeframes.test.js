import test from 'node:test';
import assert from 'node:assert/strict';
import {scan} from '../src/trading/scanner.js';
import {BITUNIX_TIMEFRAMES, DEFAULT_TIMEFRAMES, parseTimeframes, normalizeTimeframe} from '../src/trading/timeframes.js';

function candles() {
  return Array.from({length: 60}, (_, i) => { const close = 100 + i * 0.2; return {open: close, high: close + 1, low: close - 1, close, volume: 10}; });
}

test('timeframe parser accepts documented Bitunix values, removes duplicates, and canonicalizes input', () => {
  assert.deepEqual(parseTimeframes('1m, 5M, 1h, 1month'), ['1m', '5m', '1h', '1M']);
  assert.equal(normalizeTimeframe('1M'), '1M');
  assert.deepEqual(parseTimeframes(''), [...DEFAULT_TIMEFRAMES]);
  assert.deepEqual(BITUNIX_TIMEFRAMES, ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
});

test('invalid timeframe values are rejected before any market-data request', async () => {
  let requests = 0;
  await assert.rejects(() => scan({klines: async () => { requests += 1; return candles(); }}, 'BTCUSDT', ['1m', '2minutes']), /Invalid timeframe/);
  assert.equal(requests, 0);
});

test('selected timeframe reaches Bitunix kline requests and is recorded in signal', async () => {
  const requests = [];
  const result = await scan({klines: async (symbol, interval, limit) => { requests.push({symbol, interval, limit}); return candles(); }}, 'RAREUSDT', ['5m', '1h'], {minAgree: 2, tfMinConfidence: 0});
  assert.deepEqual(requests.map(item => item.interval), ['5m', '1h']);
  assert.deepEqual(result.selectedTimeframes, ['5m', '1h']);
  assert.deepEqual(Object.keys(result.timeframes), ['5m', '1h']);
  assert.equal(requests.every(item => item.limit === 200), true);
});
