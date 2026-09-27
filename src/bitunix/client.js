import { config, canTrade } from '../config.js';
import { nonce, signRest } from './sign.js';

function firstBalanceRow(raw) {
  if (Array.isArray(raw)) return raw[0] || null;
  if (Array.isArray(raw?.data)) return raw.data[0] || null;
  return raw && typeof raw === 'object' ? raw : null;
}

export function normalizeAccountBalance(raw, marginCoin = 'USDT') {
  const row = firstBalanceRow(raw);
  const fields = ['marginCoin', 'available', 'frozen', 'margin', 'transfer', 'crossUnrealizedPNL', 'isolationUnrealizedPNL', 'bonus', 'positionMode'];
  if (!row || !fields.some(field => row[field] !== undefined)) return {hasData: false, message: `No ${String(marginCoin).toUpperCase()} futures account balance data returned by Bitunix`};
  return {
    hasData: true,
    marginCoin: row.marginCoin || String(marginCoin).toUpperCase(),
    available: row.available ?? null,
    frozen: row.frozen ?? null,
    margin: row.margin ?? null,
    transfer: row.transfer ?? null,
    total: row.total ?? row.equity ?? null,
    equity: row.equity ?? row.total ?? null,
    crossUnrealizedPNL: row.crossUnrealizedPNL ?? null,
    isolationUnrealizedPNL: row.isolationUnrealizedPNL ?? null,
    bonus: row.bonus ?? null,
    positionMode: row.positionMode ?? null
  };
}

export class BitunixClient {
  constructor(opts={}) { this.cfg = {...config.bitunix, ...opts}; this.fetch = opts.fetch || globalThis.fetch; }
  async request(path, {method='GET', query={}, body, auth=false, write=false, signal}={}) {
    if (write && !canTrade()) throw new Error('TRADING_NOT_ARMED: set LIVE_TRADING=1 and ARM_TRADING=1 after verification');
    const url = new URL(path, this.cfg.restUrl);
    for (const [k,v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers = {'Content-Type':'application/json','language':'en-US'};
    if (auth) {
      const ts = Date.now(), n = nonce();
      headers['api-key'] = this.cfg.apiKey; headers.nonce = n; headers.timestamp = String(ts);
      headers.sign = signRest({apiKey:this.cfg.apiKey, secretKey:this.cfg.apiSecret, requestNonce:n, timestampMs:ts, query, body});
    }
    const res = await this.fetch(url, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal});
    const text = await res.text(); let data; try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
    if (!res.ok || (data && data.code !== undefined && Number(data.code) !== 0)) {
      const detail = data?.msg || data?.message || data?.error?.message || text || res.statusText;
      const safe = String(detail).replace(/[\r\n]+/g, ' ').replace(/authorization\s*[:=]\s*bearer\s+\S+/gi, 'authorization [redacted]').replace(/(api[-_ ]?key|bearer)\s*[:=]?\s*\S+/gi, '$1 [redacted]');
      throw new Error(`Bitunix ${res.status} ${path} code=${data?.code ?? 'http'}: ${safe}`);
    }
    return data?.data ?? data;
  }
  tickers(symbol) { return this.request('/api/v1/futures/market/tickers', {query: symbol ? {symbols: symbol} : {}}); }
  ticker(symbol) { return this.tickers(symbol); }
  depth(symbol, limit=20) { return this.request('/api/v1/futures/market/depth', {query:{symbol,limit}}); }
  klines(symbol, interval, limit=200) { return this.request('/api/v1/futures/market/kline', {query:{symbol,interval,limit}}); }
  tradingPairs() { return this.request('/api/v1/futures/market/trading_pairs'); }
  fundingRate(symbol) { return this.request('/api/v1/futures/market/funding_rate', {query:{symbol}}); }
  account(marginCoin = 'USDT') { return this.request('/api/v1/futures/account', {query:{marginCoin: String(marginCoin).toUpperCase()}, auth:true}); }
  async accountBalance(marginCoin = 'USDT') { return normalizeAccountBalance(await this.account(marginCoin), marginCoin); }
  leverageAndMarginMode(symbol) { return this.request('/api/v1/futures/account/get_leverage_and_margin_mode', {query:{symbol}, auth:true}); }
  positions(symbol) { return this.request('/api/v1/futures/position/get_pending_positions', {query:{symbol}, auth:true}); }
  positionHistory(symbol) { return this.request('/api/v1/futures/position/get_history_positions', {query:{symbol}, auth:true}); }
  pendingOrders(symbol) { return this.request('/api/v1/futures/trade/get_pending_orders', {query:{symbol}, auth:true}); }
  orderHistory(symbol) { return this.request('/api/v1/futures/trade/get_history_orders', {query:{symbol}, auth:true}); }
  placeOrder(body) { return this.request('/api/v1/futures/trade/place_order', {method:'POST', body, auth:true, write:true}); }
  cancelOrder(body) { return this.request('/api/v1/futures/trade/cancel_orders', {method:'POST', body, auth:true, write:true}); }
  cancelAllOrders(body) { return this.request('/api/v1/futures/trade/cancel_all_orders', {method:'POST', body, auth:true, write:true}); }
  closeAllPosition(body) { return this.request('/api/v1/futures/trade/close_all_position', {method:'POST', body, auth:true, write:true}); }
  flashClosePosition(body) { return this.request('/api/v1/futures/trade/flash_close_position', {method:'POST', body, auth:true, write:true}); }
  changeLeverage(body) { return this.request('/api/v1/futures/account/change_leverage', {method:'POST', body, auth:true, write:true}); }
  changeMarginMode(body) { return this.request('/api/v1/futures/account/change_margin_mode', {method:'POST', body, auth:true, write:true}); }
  changePositionMode(body) { return this.request('/api/v1/futures/account/change_position_mode', {method:'POST', body, auth:true, write:true}); }
  placePositionTpsl(body) { return this.request('/api/v1/futures/tp_sl/place_position_tp_sl_order', {method:'POST', body, auth:true, write:true}); }
  modifyPositionTpsl(body) { return this.request('/api/v1/futures/tp_sl/modify_position_tp_sl_order', {method:'POST', body, auth:true, write:true}); }
  cancelTpsl(body) { return this.request('/api/v1/futures/tp_sl/cancel_tp_sl_order', {method:'POST', body, auth:true, write:true}); }
}
