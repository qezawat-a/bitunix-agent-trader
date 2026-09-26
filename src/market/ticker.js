export function normalizeSymbol(value, fallback = 'BTCUSDT') {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s/_-]/g, '');
  return normalized || fallback;
}

function tickerList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.list)) return raw.list;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.tickers)) return raw.tickers;
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

function field(item, names) {
  return names.map(name => item?.[name]).find(value => value !== undefined && value !== null && value !== '');
}

export function extractTicker(raw, symbol) {
  const target = normalizeSymbol(symbol);
  const item = tickerList(raw).find(candidate => normalizeSymbol(field(candidate, ['symbol', 'instId', 'instrumentId', 'pair'])) === target);
  if (!item) return null;
  const last = field(item, ['lastPrice', 'last', 'lastPr', 'close', 'price']);
  const bid = field(item, ['bidPrice', 'bid', 'bidPr']);
  const ask = field(item, ['askPrice', 'ask', 'askPr']);
  if (last === undefined && bid === undefined && ask === undefined) return null;
  return {
    symbol: normalizeSymbol(field(item, ['symbol', 'instId', 'instrumentId', 'pair']) || target),
    bid: bid ?? null,
    ask: ask ?? null,
    last: last ?? null,
    source: 'Bitunix REST /api/v1/futures/market/tickers',
    fetchedAt: new Date().toISOString()
  };
}

export function extractTopOfBook(raw) {
  const asks = Array.isArray(raw?.asks) ? raw.asks : [];
  const bids = Array.isArray(raw?.bids) ? raw.bids : [];
  return {ask: asks[0]?.[0] ?? null, bid: bids[0]?.[0] ?? null};
}

export async function lookupLiveTicker(client, symbol) {
  const target = normalizeSymbol(symbol);
  try {
    const ticker = extractTicker(await client.tickers(target), target);
    if (!ticker) throw new Error(`Bitunix returned no ticker data for ${target}`);
    let book = {ask: null, bid: null};
    let depthError = null;
    try { book = extractTopOfBook(await client.depth(target, 5)); }
    catch (error) { depthError = String(error?.message || error).replace(/[\r\n]+/g, ' ').replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 [redacted]'); }
    return {...ticker, bid: book.bid ?? ticker.bid, ask: book.ask ?? ticker.ask, depthError, source: 'Bitunix REST /api/v1/futures/market/tickers + /depth'};
  } catch (error) {
    const message = String(error?.message || error).replace(/[\r\n]+/g, ' ').replace(/(api[-_ ]?key|authorization|bearer)\s*[:=]?\s*\S+/gi, '$1 [redacted]');
    throw new Error(`Live ticker lookup failed for ${target}: ${message}`);
  }
}

export function renderTicker(ticker) {
  return [
    'Live Bitunix price',
    `- Symbol: ${ticker.symbol}`,
    `- Bid: ${ticker.bid ?? 'unavailable'}`,
    `- Ask: ${ticker.ask ?? 'unavailable'}`,
    `- Last: ${ticker.last ?? 'unavailable'}`,
    `- Timestamp: ${ticker.fetchedAt}`,
    `- Source: ${ticker.source}`,
    ...(ticker.depthError ? [`- Bid/ask depth error: ${ticker.depthError}`] : [])
  ].join('\n');
}

export function extractPriceSymbol(text, fallback = 'BTCUSDT') {
  const explicit = String(text || '').match(/\b([A-Z0-9]{2,}(?:USDT|USDC|USD))\b/i);
  return normalizeSymbol(explicit?.[1] || fallback, fallback);
}

export function isCurrentPriceQuery(text) {
  return /(?:\b(?:current|live|latest|exact|now)\b[^\n]{0,40}\b(?:price|ticker|quote)\b|\b(?:price|ticker|quote)\b[^\n]{0,40}\b(?:current|live|latest|now)\b|\bprice\b|\bticker\b|قیمت|цена)/i.test(String(text || ''));
}
