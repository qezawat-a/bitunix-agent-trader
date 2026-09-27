import test from 'node:test';
import assert from 'node:assert/strict';
import {BitunixClient, normalizeAccountBalance} from '../src/bitunix/client.js';

function response(body, ok = true, status = 200) {
  return {ok, status, statusText: ok ? 'OK' : 'Bad Gateway', text: async () => typeof body === 'string' ? body : JSON.stringify(body)};
}

test('HTTP 200 application-level Not Found is treated as an error, not an empty balance', async () => {
  let request;
  const client = new BitunixClient({restUrl: 'https://example.test', apiKey: 'key', apiSecret: 'secret', fetch: async (url, options) => { request = {url: String(url), options}; return response({code: 10001, msg: 'Not Found'}); }});
  await assert.rejects(() => client.accountBalance('USDT'), error => {
    assert.match(error.message, /Bitunix 200/);
    assert.match(error.message, /code=10001/);
    assert.match(error.message, /Not Found/);
    return true;
  });
  assert.match(request.url, /\/api\/v1\/futures\/account\?marginCoin=USDT$/);
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.body, undefined);
  assert.ok(request.options.headers['api-key']);
  assert.ok(request.options.headers.nonce);
  assert.ok(request.options.headers.timestamp);
  assert.ok(request.options.headers.sign);
});

test('official account response is parsed into real available/frozen/equity-related fields', async () => {
  const client = new BitunixClient({restUrl: 'https://example.test', apiKey: 'key', apiSecret: 'secret', fetch: async () => response({code: 0, data: [{marginCoin: 'USDT', available: '1000.25', frozen: '12', margin: '10', transfer: '988.25', positionMode: 'HEDGE', crossUnrealizedPNL: '2', isolationUnrealizedPNL: '-0.5', bonus: '0'}]})});
  assert.deepEqual(await client.accountBalance('usdt'), {
    hasData: true, marginCoin: 'USDT', available: '1000.25', frozen: '12', margin: '10', transfer: '988.25', total: null, equity: null,
    crossUnrealizedPNL: '2', isolationUnrealizedPNL: '-0.5', bonus: '0', positionMode: 'HEDGE'
  });
});

test('balance API errors are sanitized and no-data is truthful', async () => {
  const client = new BitunixClient({restUrl: 'https://example.test', apiKey: 'key', apiSecret: 'secret', fetch: async () => response({code: 10002, msg: 'bad api-key=super-secret authorization=Bearer top-secret'})});
  await assert.rejects(() => client.accountBalance('USDT'), error => { assert.match(error.message, /10002/); assert.doesNotMatch(error.message, /super-secret|top-secret/); return true; });
  assert.deepEqual(normalizeAccountBalance([], 'USDT'), {hasData: false, message: 'No USDT futures account balance data returned by Bitunix'});
  assert.deepEqual(normalizeAccountBalance({raw: 'Not Found'}, 'USDT'), {hasData: false, message: 'No USDT futures account balance data returned by Bitunix'});
});
