import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {BitunixClient} from '../src/bitunix/client.js';
import {canonicalBody, signWebSocket} from '../src/bitunix/sign.js';
import {normalizeKline} from '../src/trading/scanner.js';

const REST_URL = 'https://example.test';
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';

function response(body, ok = true, status = 200) {
  return {ok, status, statusText: ok ? 'OK' : 'Bad Gateway', text: async () => typeof body === 'string' ? body : JSON.stringify(body)};
}

function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }

test('REST signature uses ASCII-sorted raw query fields and the exact compact JSON body on the wire', async () => {
  let captured;
  const client = new BitunixClient({restUrl: REST_URL, apiKey: API_KEY, apiSecret: API_SECRET, fetch: async (url, options) => {
    captured = {url: String(url), options};
    return response({code: 0, data: {ok: true}, msg: 'Success'});
  }});
  const query = {z: '2', a: 'A B', omit: null};
  const body = {note: 'value with spaces', nested: {label: 'pair X'} };
  assert.deepEqual(await client.request('/signature-fixture', {method: 'POST', query, body, auth: true}), {ok: true});
  assert.equal(captured.options.body, JSON.stringify(body));
  assert.equal(canonicalBody(body), captured.options.body);
  assert.equal(new URL(captured.url).searchParams.get('a'), 'A B');
  assert.match(captured.options.headers.nonce, /^[a-f0-9]{32}$/);
  assert.match(captured.options.headers.timestamp, /^\d{13}$/);
  const queryString = 'aA Bz2';
  const digest = sha256(`${captured.options.headers.nonce}${captured.options.headers.timestamp}${API_KEY}${queryString}${captured.options.body}`);
  assert.equal(captured.options.headers.sign, sha256(`${digest}${API_SECRET}`));
  assert.equal(captured.options.headers['Content-Type'], 'application/json');
  assert.equal(captured.options.headers.language, 'en-US');
});

test('public-market, account, position, and order read wrappers match documented routes, params, auth, and responses', async () => {
  const fixtures = new Map([
    ['/api/v1/futures/market/tickers', [{symbol: 'BTCUSDT', markPrice: '60000', lastPrice: '60001', last: '60001'}]],
    ['/api/v1/futures/market/depth', {asks: [['60002', '1.2']], bids: [['60000', '0.8']]}],
    ['/api/v1/futures/market/kline', [{open: '60000', high: '60001', low: '59999', close: '60000.5', quoteVol: '1', baseVol: '0.25', time: 1770000000000, type: 'LAST_PRICE'}]],
    ['/api/v1/futures/market/trading_pairs', [{symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', minTradeVolume: '0.0001', basePrecision: 4, quotePrecision: 1, symbolStatus: 'OPEN', isApiSupported: true}]],
    ['/api/v1/futures/market/funding_rate', [{symbol: 'BTCUSDT', markPrice: '60000', fundingRate: '0.0005', fundingInterval: 8, nextFundingTime: '1770710400000'}]],
    ['/api/v1/futures/account', [{marginCoin: 'USDT', available: '1000', frozen: '0', margin: '10', transfer: '1000', positionMode: 'HEDGE', crossUnrealizedPNL: '2', isolationUnrealizedPNL: '0', bonus: '0'}]],
    ['/api/v1/futures/account/get_leverage_margin_mode', {symbol: 'BTCUSDT', marginCoin: 'USDT', leverage: 10, marginMode: 'ISOLATION'}],
    ['/api/v1/futures/position/get_pending_positions', [{positionId: 'p-1', symbol: 'BTCUSDT', qty: '0.25', side: 'LONG', marginMode: 'ISOLATION', positionMode: 'HEDGE', leverage: 10, unrealizedPNL: '1.2', avgOpenPrice: '59000'}]],
    ['/api/v1/futures/position/get_history_positions', {positionList: [{positionId: 'p-2', symbol: 'BTCUSDT', maxQty: '0.5', entryPrice: '58000', closePrice: '59000', side: 'LONG', marginMode: 'CROSS', positionMode: 'HEDGE', leverage: 5, realizedPNL: '5'}], total: 1}],
    ['/api/v1/futures/trade/get_pending_orders', {orderList: [{orderId: 'o-1', symbol: 'BTCUSDT', qty: '0.01', price: '60000', side: 'BUY', orderType: 'LIMIT', effect: 'GTC', status: 'NEW', reduceOnly: false}], total: 1}],
    ['/api/v1/futures/trade/get_history_orders', {orderList: [{orderId: 'o-2', symbol: 'BTCUSDT', qty: '0.01', tradeQty: '0.01', side: 'BUY', orderType: 'MARKET', status: 'FILLED'}], total: 1}]
  ]);
  const captured = [];
  const client = new BitunixClient({restUrl: REST_URL, apiKey: API_KEY, apiSecret: API_SECRET, fetch: async (url, options) => {
    const parsed = new URL(url);
    captured.push({url: parsed, options});
    assert.ok(fixtures.has(parsed.pathname), `unexpected route ${parsed.pathname}`);
    return response({code: 0, data: fixtures.get(parsed.pathname), msg: 'Success'});
  }});

  assert.deepEqual(await client.tickers('BTCUSDT'), fixtures.get('/api/v1/futures/market/tickers'));
  assert.deepEqual(await client.depth('BTCUSDT'), fixtures.get('/api/v1/futures/market/depth'));
  assert.deepEqual(await client.klines('BTCUSDT', '15m'), fixtures.get('/api/v1/futures/market/kline'));
  assert.deepEqual(await client.tradingPairs(), fixtures.get('/api/v1/futures/market/trading_pairs'));
  assert.deepEqual(await client.fundingRate('BTCUSDT'), fixtures.get('/api/v1/futures/market/funding_rate'));
  assert.deepEqual(await client.account('usdt'), fixtures.get('/api/v1/futures/account'));
  assert.deepEqual(await client.accountBalance('usdt'), {
    hasData: true, marginCoin: 'USDT', available: '1000', frozen: '0', margin: '10', transfer: '1000', total: null, equity: null,
    crossUnrealizedPNL: '2', isolationUnrealizedPNL: '0', bonus: '0', positionMode: 'HEDGE'
  });
  assert.deepEqual(await client.leverageAndMarginMode('BTCUSDT'), fixtures.get('/api/v1/futures/account/get_leverage_margin_mode'));
  assert.deepEqual(await client.positions('BTCUSDT'), fixtures.get('/api/v1/futures/position/get_pending_positions'));
  assert.deepEqual(await client.positionHistory('BTCUSDT'), fixtures.get('/api/v1/futures/position/get_history_positions'));
  assert.deepEqual(await client.pendingOrders('BTCUSDT'), fixtures.get('/api/v1/futures/trade/get_pending_orders'));
  assert.deepEqual(await client.orderHistory('BTCUSDT'), fixtures.get('/api/v1/futures/trade/get_history_orders'));

  const expected = [
    ['/api/v1/futures/market/tickers', {symbols: 'BTCUSDT'}, false],
    ['/api/v1/futures/market/depth', {symbol: 'BTCUSDT', limit: '5'}, false],
    ['/api/v1/futures/market/kline', {symbol: 'BTCUSDT', interval: '15m', limit: '200'}, false],
    ['/api/v1/futures/market/trading_pairs', {}, false],
    ['/api/v1/futures/market/funding_rate', {symbol: 'BTCUSDT'}, false],
    ['/api/v1/futures/account', {marginCoin: 'USDT'}, true],
    ['/api/v1/futures/account', {marginCoin: 'USDT'}, true],
    ['/api/v1/futures/account/get_leverage_margin_mode', {symbol: 'BTCUSDT', marginCoin: 'USDT'}, true],
    ['/api/v1/futures/position/get_pending_positions', {symbol: 'BTCUSDT'}, true],
    ['/api/v1/futures/position/get_history_positions', {symbol: 'BTCUSDT'}, true],
    ['/api/v1/futures/trade/get_pending_orders', {symbol: 'BTCUSDT'}, true],
    ['/api/v1/futures/trade/get_history_orders', {symbol: 'BTCUSDT'}, true]
  ];
  assert.equal(captured.length, expected.length);
  for (const [index, [path, params, auth]] of expected.entries()) {
    const request = captured[index];
    assert.equal(request.url.pathname, path);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.body, undefined);
    assert.deepEqual(Object.fromEntries(request.url.searchParams), params);
    assert.equal(Boolean(request.options.headers['api-key']), auth);
    assert.equal(Boolean(request.options.headers.sign), auth);
  }
});

test('documented K-line baseVol is normalized as base-coin volume', () => {
  assert.deepEqual(normalizeKline({open: '60000', high: '60001', low: '59999', close: '60000.5', quoteVol: '1.1', baseVol: '0.25', time: 1770000000000}), {
    open: 60000, high: 60001, low: 59999, close: 60000.5, volume: 0.25
  });
});

test('application code parsing accepts documented success envelopes and fails closed on nonzero or missing codes', async () => {
  const client = new BitunixClient({restUrl: REST_URL, fetch: async () => response({code: '0', data: 'ok', msg: 'Success'})});
  assert.equal(await client.request('/fixture'), 'ok');
  const applicationError = new BitunixClient({restUrl: REST_URL, fetch: async () => response({code: 20009, data: null, msg: 'Position exists'})});
  await assert.rejects(() => applicationError.request('/fixture'), /code=20009.*Position exists/);
  const malformed = new BitunixClient({restUrl: REST_URL, fetch: async () => response({msg: 'Success without the documented code field'})});
  await assert.rejects(() => malformed.request('/fixture'), /code=missing\/invalid/);
});

test('WebSocket login signing uses seconds and the documented double-SHA256 input', () => {
  const input = {apiKey: 'mock-key', secretKey: 'mock-secret', requestNonce: 'nonce-32-char-mock-value-123456', timestampSec: 1770000000};
  const expected = sha256(`${sha256(`${input.requestNonce}${input.timestampSec}${input.apiKey}`)}${input.secretKey}`);
  assert.equal(signWebSocket(input), expected);
});

test('write wrappers send documented POST routes and payload shapes only through a fake fetch', () => {
  const clientUrl = new URL('../src/bitunix/client.js', import.meta.url).href;
  const script = `
process.env.LIVE_TRADING='1';
process.env.ARM_TRADING='1';
process.env.BITUNIX_API_KEY='test-api-key';
process.env.BITUNIX_API_SECRET='test-api-secret';
const {BitunixClient}=await import(${JSON.stringify(clientUrl)});
const requests=[];
const response=(body)=>({ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify(body)});
const client=new BitunixClient({restUrl:'https://example.test',fetch:async(url,options)=>{
  const parsed=new URL(url);
  if(parsed.origin!=='https://example.test') throw new Error('network access forbidden in test');
  requests.push({path:parsed.pathname,method:options.method,body:options.body===undefined?null:JSON.parse(options.body),auth:Boolean(options.headers['api-key']&&options.headers.nonce&&options.headers.timestamp&&options.headers.sign)});
  const data=parsed.pathname==='/api/v1/futures/trade/cancel_orders'
    ? {successList:[{orderId:'o-1'}],failureList:[{orderId:'o-2',errorMsg:'Order status error',errorCode:10013}]}
    : parsed.pathname==='/api/v1/futures/trade/close_all_position' ? ''
    : parsed.pathname==='/api/v1/futures/trade/flash_close_position' ? {positionId:'p-1'}
    : parsed.pathname.includes('/tpsl/') ? {orderId:'tp-1'}
    : {orderId:'o-1',clientId:'client-1'};
  return response({code:0,data,msg:'Success'});
}});
const results=[];
results.push(await client.placeOrder({symbol:'BTCUSDT',side:'BUY',tradeSide:'OPEN',qty:'0.01',orderType:'LIMIT',price:'60000',clientId:'id with space'}));
results.push(await client.cancelOrder({symbol:'BTCUSDT',orderList:[{orderId:'o-1'}]}));
results.push(await client.cancelAllOrders({symbol:'BTCUSDT'}));
results.push(await client.closeAllPosition({symbol:'BTCUSDT'}));
results.push(await client.flashClosePosition({positionId:'p-1'}));
results.push(await client.changeLeverage({marginCoin:'USDT',symbol:'BTCUSDT',leverage:3}));
results.push(await client.changeMarginMode({marginCoin:'USDT',symbol:'BTCUSDT',marginMode:'ISOLATED'}));
results.push(await client.changePositionMode({positionMode:'HEDGE'}));
results.push(await client.placePositionTpsl({symbol:'BTCUSDT',positionId:'p-1',tpPrice:'65000',tpStopType:'MARK_PRICE',slPrice:'55000',slStopType:'MARK_PRICE'}));
results.push(await client.modifyPositionTpsl({symbol:'BTCUSDT',positionId:'p-1',tpPrice:'64000',tpStopType:'LAST_PRICE'}));
results.push(await client.cancelTpsl({symbol:'BTCUSDT',orderId:'tp-1'}));
const beforeInvalid=requests.length;
let missingLimitPrice=''; let missingCloseId='';
try { await client.placeOrder({symbol:'BTCUSDT',side:'BUY',tradeSide:'OPEN',qty:'0.01',orderType:'LIMIT'}); } catch (error) { missingLimitPrice=error.message; }
try { await client.placeOrder({symbol:'BTCUSDT',side:'SELL',tradeSide:'CLOSE',qty:'0.01',orderType:'MARKET'}); } catch (error) { missingCloseId=error.message; }
console.log(JSON.stringify({requests,results,beforeInvalid,missingLimitPrice,missingCloseId}));
`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {...process.env, LIVE_TRADING: '0', ARM_TRADING: '0'}
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const result = JSON.parse(child.stdout.trim());
  const expectedPaths = [
    '/api/v1/futures/trade/place_order',
    '/api/v1/futures/trade/cancel_orders',
    '/api/v1/futures/trade/cancel_all_orders',
    '/api/v1/futures/trade/close_all_position',
    '/api/v1/futures/trade/flash_close_position',
    '/api/v1/futures/account/change_leverage',
    '/api/v1/futures/account/change_margin_mode',
    '/api/v1/futures/account/change_position_mode',
    '/api/v1/futures/tpsl/position/place_order',
    '/api/v1/futures/tpsl/position/modify_order',
    '/api/v1/futures/tpsl/cancel_order'
  ];
  assert.deepEqual(result.requests.map(request => request.path), expectedPaths);
  assert.ok(result.requests.every(request => request.method === 'POST' && request.auth));
  assert.equal(result.requests[0].body.qty, '0.01');
  assert.equal(result.requests[0].body.price, '60000');
  assert.equal(result.requests[0].body.effect, 'GTC');
  assert.equal(result.requests[0].body.clientId, 'id with space');
  assert.deepEqual(result.requests[1].body, {symbol: 'BTCUSDT', orderList: [{orderId: 'o-1'}]});
  assert.deepEqual(result.requests[5].body, {marginCoin: 'USDT', symbol: 'BTCUSDT', leverage: 3});
  assert.deepEqual(result.requests[6].body, {marginCoin: 'USDT', symbol: 'BTCUSDT', marginMode: 'ISOLATION'});
  assert.deepEqual(result.requests[7].body, {positionMode: 'HEDGE'});
  assert.deepEqual(result.requests[8].body, {symbol: 'BTCUSDT', positionId: 'p-1', tpPrice: '65000', tpStopType: 'MARK_PRICE', slPrice: '55000', slStopType: 'MARK_PRICE'});
  assert.deepEqual(result.results[1], {successList: [{orderId: 'o-1'}], failureList: [{orderId: 'o-2', errorMsg: 'Order status error', errorCode: 10013}]});
  assert.equal(result.beforeInvalid, expectedPaths.length);
  assert.match(result.missingLimitPrice, /LIMIT orders require price/);
  assert.match(result.missingCloseId, /positionId is required/);
});
