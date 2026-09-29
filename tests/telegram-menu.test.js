import test from 'node:test';
import assert from 'node:assert/strict';
import {startTelegram} from '../src/telegram/bot.js';

const EXPECTED_COMMANDS = [
  {command: 'start', description: 'Start the bot and show available commands'},
  {command: 'help', description: 'Show help and available commands'},
  {command: 'status', description: 'Show bot, scan, and safety status'},
  {command: 'settings', description: 'Show current bot settings'},
  {command: 'balance', description: 'Show Bitunix futures account balance'},
  {command: 'signal', description: 'Scan selected timeframes for a market signal'},
  {command: 'positions', description: 'Show open Bitunix positions'},
  {command: 'price', description: 'Show live price for a symbol'},
  {command: 'ticker', description: 'Show live price for a symbol'},
  {command: 'timeframes', description: 'View or set the selected scan intervals'},
  {command: 'timeframe', description: 'View or set the selected scan intervals'},
  {command: 'orders', description: 'Show recent Bitunix order history'},
  {command: 'history', description: 'Show recent saved signals'},
  {command: 'scan_on', description: 'Enable periodic market scans'},
  {command: 'scan_off', description: 'Disable periodic market scans'},
  {command: 'report_on', description: 'Enable periodic Telegram reports'},
  {command: 'report_off', description: 'Disable periodic Telegram reports'},
  {command: 'auto_trade', description: 'Enable auto-trade; safety gates still apply'},
  {command: 'pause', description: 'Pause auto-trading and market scans'},
  {command: 'kill_switch', description: 'Block future live orders immediately'},
  {command: 'set', description: 'Update a non-secret bot setting'},
  {command: 'tset', description: 'Update a non-secret bot setting'}
];

const MOCK_TOKEN = 'mock-telegram-token-do-not-use';

function makeMockBot({setMyCommands = async () => true} = {}) {
  const menuCalls = [];
  const menuButtonCalls = [];
  const commandNames = [];
  let launchCalls = 0;
  const bot = {
    telegram: {
      setMyCommands(...args) { menuCalls.push(args); return setMyCommands(...args); },
      setChatMenuButton(...args) { menuButtonCalls.push(args); return Promise.resolve(true); },
      sendMessage: async () => true
    },
    command(name) { commandNames.push(name); },
    on() {},
    catch() {},
    launch() { launchCalls += 1; return Promise.resolve(); },
    stop() {}
  };
  return {bot, menuCalls, menuButtonCalls, commandNames, get launchCalls() { return launchCalls; }};
}

function startWithMock(mock, logger = {error() {}}) {
  return startTelegram({
    agent: {say: async () => ''},
    tools: [],
    store: {get: (_key, fallback) => fallback, set: async () => {}, settings: () => ({}), recentSignals: () => []},
    telegramConfig: {token: MOCK_TOKEN, userId: '', chatId: ''},
    createBot: () => mock.bot,
    logger
  });
}

test('startup registers the full implemented slash-command list once with the default built-in menu and no Mini App', () => {
  const mock = makeMockBot();
  startWithMock(mock);

  assert.equal(mock.menuCalls.length, 1);
  assert.deepEqual(mock.menuCalls[0], [EXPECTED_COMMANDS]);
  assert.deepEqual(mock.commandNames, EXPECTED_COMMANDS.map(({command}) => command));
  assert.equal(mock.launchCalls, 1);
  assert.equal(mock.menuButtonCalls.length, 0);
  assert.equal(mock.menuCalls[0].length, 1, 'omit scope/options so Telegram uses the default scope');
  assert.ok(EXPECTED_COMMANDS.every(({description}) => description.length >= 3 && description.length <= 256));
  assert.ok(EXPECTED_COMMANDS.every(item => Object.keys(item).sort().join(',') === 'command,description'));
  assert.doesNotMatch(JSON.stringify(EXPECTED_COMMANDS), /web_app|mini.?app|https?:/i);
});

test('a failed menu registration is sanitized and does not prevent bot launch', async () => {
  const errors = [];
  const mock = makeMockBot({setMyCommands: async () => { throw new Error(`Request https://api.telegram.org/bot${MOCK_TOKEN}/setMyCommands failed`); }});
  startWithMock(mock, {error: (...args) => errors.push(args.join(' '))});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(mock.menuCalls.length, 1);
  assert.equal(mock.launchCalls, 1);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /failed to register menu; bot will continue/i);
  assert.match(errors[0], /Check Telegram API connectivity/);
  assert.doesNotMatch(errors[0], new RegExp(MOCK_TOKEN));
  assert.match(errors[0], /\[URL\]/);
});
