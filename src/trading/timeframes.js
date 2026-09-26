export const BITUNIX_TIMEFRAMES = Object.freeze(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);
export const DEFAULT_TIMEFRAMES = Object.freeze(['1m', '3m', '5m', '15m']);

const aliases = new Map(BITUNIX_TIMEFRAMES.filter(value => value !== '1M').map(value => [value.toLowerCase(), value]));
aliases.set('1month', '1M');

export function normalizeTimeframe(value) {
  const raw = String(value ?? '').trim();
  if (raw === '1M') return '1M';
  return aliases.get(raw.toLowerCase()) || null;
}

export function parseTimeframes(value, fallback = DEFAULT_TIMEFRAMES) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  const cleaned = values.flatMap(item => String(item).trim().split(/[\s,]+/)).filter(Boolean);
  if (!cleaned.length) return [...fallback];
  const normalized = cleaned.map(normalizeTimeframe);
  const invalid = cleaned.filter((_, index) => !normalized[index]);
  if (invalid.length) throw new Error(`Invalid timeframe(s): ${invalid.join(', ')}. Supported: ${BITUNIX_TIMEFRAMES.join(', ')}`);
  return [...new Set(normalized)];
}

export function formatTimeframes(value, fallback = DEFAULT_TIMEFRAMES) {
  return parseTimeframes(value, fallback).join(',');
}
