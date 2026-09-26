import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportScheduler, normalizeIntervalSeconds} from '../src/reporting/scheduler.js';
import {resolveReportChatId, persistTelegramChatId} from '../src/telegram/bot.js';
import {buildTraderReport, renderTraderReport} from '../src/reporting/report.js';

function fakeStore(settings = {}) {
  const state = {reportOn: true, reportIntervalSec: 1, ...settings};
  const events = [];
  return {
    get: (key, fallback) => state[key] ?? fallback,
    set: async (key, value) => { state[key] = value; },
    push: async (type, data) => { events.push({type, data}); },
    settings: () => ({symbol: state.symbol || 'BTCUSDT', timeframes: state.timeframes || ['1m', '3m'], leverage: 3, marginMode: 'ISOLATED', positionMode: 'HEDGE'}),
    recentSignals: n => (state.signals || []).slice(-n),
    events,
    state
  };
}

test('report interval is normalized and invalid values cannot create a dead timer', () => {
  assert.equal(normalizeIntervalSeconds('5'), 5);
  assert.equal(normalizeIntervalSeconds(0), 30);
  assert.equal(normalizeIntervalSeconds('not-a-number', 7), 7);
});

test('scheduler sends periodic reports using current persisted interval', async () => {
  const store = fakeStore({reportIntervalSec: 2});
  const sent = [];
  let waits = 0;
  const scheduler = createReportScheduler({
    store,
    buildReport: async () => ({ok: true}),
    sendReport: async report => { sent.push(report); },
    sleepFn: async () => {
      waits += 1;
      if (waits === 1) store.state.reportIntervalSec = 1;
      else { store.state.reportOn = false; queueMicrotask(() => scheduler.stop()); }
    },
    log: {error: () => {}}
  });
  await scheduler.start();
  assert.equal(sent.length, 1);
  assert.equal(scheduler.status().lastSuccessAt !== null, true);
  assert.equal(scheduler.status().failures, 0);
  assert.equal(store.state.reportIntervalSec, 1);
});

test('failed Telegram send is visible and scheduler remains usable', async () => {
  const store = fakeStore();
  const errors = [];
  let attempts = 0;
  const scheduler = createReportScheduler({
    store,
    buildReport: async () => ({ok: true}),
    sendReport: async () => { attempts += 1; if (attempts === 1) throw new Error('Telegram 403'); },
    log: {error: (...args) => errors.push(args.join(' '))}
  });
  assert.equal(await scheduler.runOnce(), false);
  assert.equal(scheduler.status().failures, 1);
  assert.match(errors[0], /Telegram 403/);
  assert.equal(store.events[0].type, 'report_failed');
  assert.equal(await scheduler.runOnce(), true);
  assert.equal(scheduler.status().lastSuccessAt !== null, true);
  assert.equal(store.events[1].type, 'report_sent');
});

test('configured and persisted Telegram chat IDs are selected in the correct order', async () => {
  const store = fakeStore();
  assert.equal(resolveReportChatId(store, {chatId: 'configured-chat', userId: 'allowed-user'}), 'configured-chat');
  await persistTelegramChatId(store, '-100123');
  assert.equal(resolveReportChatId(store, {chatId: 'configured-chat', userId: 'allowed-user'}), '-100123');
});

test('rendered report contains truthful current signal confidence and open-position PnL', async () => {
  const store = fakeStore({symbol: 'BTCUSDT', autoTrade: true, scanOn: true, killSwitch: false});
  store.state.timeframes = ['5m', '1h'];
  store.state.signals = [{symbol: 'BTCUSDT', direction: 'LONG', confidence: 84, selectedTimeframes: ['5m', '1h'], timeframes: { '5m': {direction: 'LONG', confidence: 84}, '1h': {direction: 'NEUTRAL', confidence: 0} }, at: '2026-09-26T18:00:00.000Z'}];
  const report = await buildTraderReport({
    store,
    client: {positions: async () => [{symbol: 'BTCUSDT', side: 'LONG', qty: '0.01', entryPrice: '60000', markPrice: '60125', unrealizedPNL: '1.25'}]},
    canTrade: () => false,
    liveTrading: false,
    now: () => '2026-09-26T18:01:00.000Z'
  });
  const text = renderTraderReport(report);
  assert.match(text, /BTCUSDT: LONG \| confidence=84%/);
  assert.match(text, /timeframes=5m,1h/);
  assert.match(text, /Trading: blocked/);
  assert.match(text, /PnL=\+1\.25 \(unrealizedPNL\)/);
  assert.doesNotMatch(text, /No open position/);
});

test('rendered report clearly states no signal and no open position without fake values', async () => {
  const store = fakeStore({symbol: 'ETHUSDT'});
  const report = await buildTraderReport({
    store,
    client: {positions: async () => []},
    canTrade: () => false,
    liveTrading: false,
    now: () => '2026-09-26T18:02:00.000Z'
  });
  const text = renderTraderReport(report);
  assert.match(text, /No signal recorded yet/);
  assert.match(text, /No open position\. PnL: not applicable\./);
  assert.doesNotMatch(text, /confidence=\d+%/);
  assert.doesNotMatch(text, /PnL=\+?\d/);
});
