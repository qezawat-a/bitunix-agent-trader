import {parseTimeframes} from '../trading/timeframes.js';

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function listFromPositions(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.list)) return value.list;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.positions)) return value.positions;
  if (Array.isArray(value?.positionList)) return value.positionList;
  return value && typeof value === 'object' ? [value] : [];
}

function positionSize(position) {
  for (const key of ['positionSize', 'size', 'qty', 'quantity', 'holdVol', 'volume']) {
    const value = asNumber(position?.[key]);
    if (value !== null) return Math.abs(value);
  }
  return null;
}

function positionPnl(position) {
  for (const key of ['unrealizedPNL', 'unrealizedPnl', 'unrealizedProfit', 'positionPnl', 'pnl', 'profit']) {
    const value = asNumber(position?.[key]);
    if (value !== null) return {value, field: key};
  }
  return null;
}

function firstDefined(position, keys) {
  return keys.map(key => position?.[key]).find(value => value !== undefined && value !== null && value !== '');
}

export function extractOpenPositions(raw) {
  return listFromPositions(raw).filter(position => {
    const size = positionSize(position);
    return size !== null && size > 0;
  }).map(position => ({
    symbol: firstDefined(position, ['symbol', 'instId']) || null,
    side: firstDefined(position, ['side', 'positionSide', 'holdSide']) || null,
    size: positionSize(position),
    entryPrice: firstDefined(position, ['entryPrice', 'avgOpenPrice', 'openPrice']) || null,
    markPrice: firstDefined(position, ['markPrice', 'mark']) || null,
    pnl: positionPnl(position)
  }));
}

export async function buildTraderReport({store, client, canTrade, liveTrading = false, now = () => new Date().toISOString()}) {
  const settings = store.settings();
  const latestSignal = store.recentSignals(1)[0] || null;
  const rawPositions = await client.positions(settings.symbol);
  return {
    generatedAt: now(),
    status: {
      bot: 'online',
      trading: canTrade() ? 'armed' : 'blocked',
      liveTrading: Boolean(liveTrading),
      killSwitch: Boolean(store.get('killSwitch', false)),
      autoTrade: Boolean(store.get('autoTrade', false)),
      scanOn: Boolean(store.get('scanOn', false)),
      reportOn: Boolean(store.get('reportOn', true)),
      symbol: settings.symbol,
      leverage: settings.leverage,
      marginMode: settings.marginMode,
      positionMode: settings.positionMode,
      timeframes: parseTimeframes(settings.timeframes)
    },
    signal: latestSignal ? {
      symbol: latestSignal.symbol || settings.symbol,
      direction: latestSignal.direction || 'NEUTRAL',
      confidence: asNumber(latestSignal.confidence),
      timeframes: latestSignal.selectedTimeframes || Object.keys(latestSignal.timeframes || {}),
      timeframeResults: latestSignal.timeframes || {},
      recordedAt: latestSignal.at || null
    } : null,
    positions: extractOpenPositions(rawPositions)
  };
}

function confidenceText(value) {
  return value === null || value === undefined ? 'unavailable' : `${value}%`;
}

function pnlText(pnl) {
  if (!pnl) return 'unavailable (exchange response has no PnL field)';
  return `${pnl.value >= 0 ? '+' : ''}${pnl.value} (${pnl.field})`;
}

export function renderTraderReport(report) {
  const status = report.status;
  const signal = report.signal;
  const lines = [
    'Bitunix Trader Report',
    `Generated: ${report.generatedAt}`,
    '',
    'Bot / trading status:',
    `- Bot: ${status.bot}`,
    `- Trading: ${status.trading} | liveTrading=${status.liveTrading} | killSwitch=${status.killSwitch}`,
    `- autoTrade=${status.autoTrade} | scanOn=${status.scanOn} | reportOn=${status.reportOn}`,
    `- Symbol: ${status.symbol} | timeframes=${(status.timeframes || []).join(',') || 'unavailable'} | leverage=${status.leverage} | margin=${status.marginMode} | positionMode=${status.positionMode}`,
    '',
    'Current signal:'
  ];
  if (signal) {
    lines.push(`- ${signal.symbol}: ${signal.direction} | confidence=${confidenceText(signal.confidence)} | timeframes=${signal.timeframes.join(',') || 'unavailable'}${signal.recordedAt ? ` | recorded=${signal.recordedAt}` : ''}`);
  } else {
    lines.push('- No signal recorded yet.');
  }
  lines.push('', 'Open position / PnL:');
  if (!report.positions.length) {
    lines.push('- No open position. PnL: not applicable.');
  } else {
    for (const position of report.positions) {
      lines.push(`- ${position.symbol || status.symbol}: side=${position.side || 'unknown'} | size=${position.size} | entry=${position.entryPrice ?? 'unavailable'} | mark=${position.markPrice ?? 'unavailable'} | PnL=${pnlText(position.pnl)}`);
    }
  }
  return lines.join('\n');
}
