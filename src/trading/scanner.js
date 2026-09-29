import {strategies} from './indicators.js';
import {parseTimeframes} from './timeframes.js';

const weights = {'1m': .5, '3m': .8, '5m': 1, '15m': 1.5, '30m': 2, '1h': 2.5, '2h': 2.8, '4h': 3, '1d': 4};

export function normalizeKline(row) {
  return {
    open: +(row.o ?? row.open),
    high: +(row.h ?? row.high),
    low: +(row.l ?? row.low),
    close: +(row.c ?? row.close),
    volume: +(row.baseVol ?? row.a ?? row.volume ?? 0)
  };
}

export async function scan(client, symbol, timeframes, opts = {}) {
  const selectedTimeframes = parseTimeframes(timeframes);
  const rows = {};
  let long = 0;
  let short = 0;
  for (const tf of selectedTimeframes) {
    try {
      const raw = await client.klines(symbol, tf, 200);
      const candles = (raw || []).map(normalizeKline).filter(x => x.close > 0);
      const result = strategies(candles);
      const eligible = result.out.filter(x => x.side !== 'NEUTRAL' && x.confidence >= Number(opts.tfMinConfidence ?? 60));
      const counts = {LONG: eligible.filter(x => x.side === 'LONG'), SHORT: eligible.filter(x => x.side === 'SHORT')};
      let direction = 'NEUTRAL';
      if (counts.LONG.length >= Number(opts.minAgree ?? 2) && counts.LONG.length > counts.SHORT.length) direction = 'LONG';
      if (counts.SHORT.length >= Number(opts.minAgree ?? 2) && counts.SHORT.length > counts.LONG.length) direction = 'SHORT';
      const confidence = eligible.length ? Math.round(eligible.reduce((sum, item) => sum + item.confidence, 0) / eligible.length) : 0;
      rows[tf] = {direction, confidence, strategies: eligible.map(x => x.name), atr: result.atr, rsi: result.rsi};
      const weight = weights[tf] || 1;
      if (direction === 'LONG') long += weight * confidence / 100;
      if (direction === 'SHORT') short += weight * confidence / 100;
    } catch (error) {
      rows[tf] = {direction: 'NEUTRAL', error: error.message};
    }
  }
  const direction = long > short ? 'LONG' : short > long ? 'SHORT' : 'NEUTRAL';
  const activeRows = Object.values(rows).filter(x => x.direction !== 'NEUTRAL');
  const confidence = Math.round(activeRows.reduce((sum, item) => sum + item.confidence, 0) / (activeRows.length || 1));
  return {symbol, direction, confidence, selectedTimeframes, longWeight: long, shortWeight: short, timeframes: rows, signalStrength: (long + short) ? Math.abs(long - short) / (long + short) : 0};
}
