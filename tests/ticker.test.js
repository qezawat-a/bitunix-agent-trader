import test from 'node:test';
import assert from 'node:assert/strict';
import {BitunixClient} from '../src/bitunix/client.js';
import {extractPriceSymbol, isCurrentPriceQuery, lookupLiveTicker, normalizeSymbol, renderTicker} from '../src/market/ticker.js';

function response(body, ok = true, status = 200) {
  return {ok, status, statusText: ok ? 'OK' : 'Bad Gateway', text: async () => JSON.stringify(body)};
}

test('Bitunix ticker uses the public market tickers endpoint and returns live bid/ask/last', async () => {
  const requested = [];
  const client = new BitunixClient({restUrl: 'https://example.test', fetch: async url => { const current = String(url); requested.push(current); if (current.includes('/tickers')) return response({code: 0, data: [{symbol: 'RAREUSDT', lastPrice: '0.02307'}]}); return response({code: 0, data: {asks: [['0.02309', '100']], bids: [['0.02304', '120']]}}); }});
  const ticker = await lookupLiveTicker(client, 'rare-usdt');
  assert.match(requested.find(url => url.includes('/tickers')), /\/api\/v1\/futures\/market\/tickers\?symbols=RAREUSDT$/);
  assert.match(requested.find(url => url.includes('/depth')), /\/api\/v1\/futures\/market\/depth\?symbol=RAREUSDT&limit=5$/);
  assert.deepEqual({symbol: ticker.symbol, bid: ticker.bid, ask: ticker.ask, last: ticker.last}, {symbol: 'RAREUSDT', bid: '0.02304', ask: '0.02309', last: '0.02307'});
  assert.equal(ticker.source, 'Bitunix REST /api/v1/futures/market/tickers + /depth');
  assert.ok(ticker.fetchedAt);
  assert.match(renderTicker(ticker), /Last: 0\.02307/);
});

test('price symbol normalization extracts RAREUSDT and price questions are recognized', () => {
  assert.equal(normalizeSymbol(' rare-usdt '), 'RAREUSDT');
  assert.equal(extractPriceSymbol('What is the current price of RAREUSDT?'), 'RAREUSDT');
  assert.equal(extractPriceSymbol('قیمت RAREUSDT چنده؟'), 'RAREUSDT');
  assert.equal(isCurrentPriceQuery('what is the live ticker for RAREUSDT'), true);
});

test('ticker API failures expose sanitized real error and never fabricate a price', async () => {
  await assert.rejects(
    () => lookupLiveTicker({tickers: async () => { throw new Error('Bitunix 503 upstream unavailable api-key=super-secret'); }}, 'RAREUSDT'),
    error => { assert.match(error.message, /RAREUSDT/); assert.match(error.message, /503 upstream unavailable/); assert.doesNotMatch(error.message, /super-secret/); return true; }
  );
  await assert.rejects(() => lookupLiveTicker({tickers: async () => []}, 'RAREUSDT'), /no ticker data for RAREUSDT/);
});

test('live price lookup never reads historical orders or guesses from stale fills', async () => {
  let tickerCalls = 0;
  const client = {
    tickers: async symbol => { tickerCalls += 1; assert.equal(symbol, 'RAREUSDT'); return [{symbol, last: '0.09999'}]; },
    get orderHistory() { throw new Error('historical orders must not be read for current price'); }
  };
  const result = await lookupLiveTicker(client, 'RAREUSDT');
  assert.equal(tickerCalls, 1);
  assert.equal(result.last, '0.09999');
  assert.notEqual(result.last, '0.02304');
});
