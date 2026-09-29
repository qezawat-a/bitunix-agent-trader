import {Telegraf} from 'telegraf';
import {config} from '../config.js';
import {extractPriceSymbol,isCurrentPriceQuery,renderTicker} from '../market/ticker.js';
import {parseTimeframes} from '../trading/timeframes.js';
const HELP = `Salam. Agent online ast.\n\nCommands:\n/start /help\n/status /settings\n/price [SYMBOL] /ticker [SYMBOL]\n/timeframes <intervals> (or /set timeframes <intervals>)\n/balance /signal /positions /orders /history\n/scan_on /scan_off /report_on /report_off\n/auto_trade /pause /kill_switch\n/set <key> <value>\n\nValid Bitunix intervals: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M\n\nAlias: /tset <key> <value> ham supported ast.\nChat-e adi ham be agent mire.`;
const format = value => typeof value === 'string' ? value : `\\\`\\\`\\\`json\n${JSON.stringify(value, null, 2)}\n\\\`\\\`\\\``;
export const resolveReportChatId = (store, telegramConfig) => String(store.get('telegramChatId', telegramConfig.chatId || telegramConfig.userId || '') || '');
export async function persistTelegramChatId(store, chatId) { if (chatId != null && String(chatId)) await store.set('telegramChatId', String(chatId)); }

function sanitizeTelegramError(error, token) {
  const detail = typeof error?.response?.description === 'string' ? error.response.description : error?.message;
  let message = typeof detail === 'string' ? detail : 'Unknown Telegram API error';
  if (token) message = message.split(String(token)).join('[REDACTED]');
  return message.replace(/\bbot\d{5,}:[A-Za-z0-9_-]{20,}\b/gi, '[REDACTED]').replace(/https?:\/\/\S+/gi, '[URL]').replace(/[\r\n\t]+/g, ' ').slice(0, 240);
}

export function startTelegram({agent, tools, store, telegramConfig = config.telegram, createBot = token => new Telegraf(token), logger = console}) {
  if (!telegramConfig.token) return null;
  const bot = createBot(telegramConfig.token);
  const allowed = ctx => !telegramConfig.userId || String(ctx.from?.id) === telegramConfig.userId;
  const reply = async (ctx, message) => { if (allowed(ctx)) await ctx.reply(String(message)); };
  const getReportChatId = () => resolveReportChatId(store, telegramConfig);
  const rememberChat = ctx => {
    const chatId = ctx.chat?.id;
    if (allowed(ctx) && chatId != null && String(store.get('telegramChatId', '')) !== String(chatId)) {
      void persistTelegramChatId(store, chatId).catch(error => console.error('[telegram] failed to persist chat id', error));
    }
  };
  const sendReport = async report => {
    const chatId = getReportChatId();
    if (!chatId) throw new Error('TELEGRAM_CHAT_ID is empty and no Telegram chat has been persisted; send /start to the bot first');
    return bot.telegram.sendMessage(chatId, format(report));
  };
  const runTool = async (name, args = {}) => { const selected = tools.find(item => item.name === name); if (!selected) throw new Error(`tool ${name} is unavailable`); return selected.run(args); };
  const registeredCommands = [];
  const command = (names, description, handler) => names.forEach(name => {
    bot.command(name, async ctx => { if (!allowed(ctx)) return; rememberChat(ctx); try { await ctx.sendChatAction('typing'); await handler(ctx); } catch (error) { await ctx.reply(`Error: ${error.message}`); } });
    registeredCommands.push({command: name, description});
  });
  command(['start'], 'Start the bot and show available commands', ctx => reply(ctx, HELP));
  command(['help'], 'Show help and available commands', ctx => reply(ctx, HELP));
  command(['status'], 'Show bot, scan, and safety status', async ctx => reply(ctx, format(await runTool('trader_status'))));
  command(['settings'], 'Show current bot settings', ctx => reply(ctx, format(store.settings())));
  command(['balance'], 'Show Bitunix futures account balance', async ctx => reply(ctx, format(await runTool('account_balance'))));
  command(['signal'], 'Scan selected timeframes for a market signal', async ctx => reply(ctx, format(await runTool('market_signal'))));
  command(['positions'], 'Show open Bitunix positions', async ctx => reply(ctx, format(await runTool('positions'))));
  command(['price', 'ticker'], 'Show live price for a symbol', async ctx => { const symbol = extractPriceSymbol(String(ctx.message?.text || ''), store.get('symbol')); return reply(ctx, renderTicker(await runTool('market_ticker', {symbol}))); });
  command(['timeframes', 'timeframe'], 'View or set the selected scan intervals', async ctx => { const raw = String(ctx.message?.text || '').trim().split(/\s+/).slice(1).join(','); if (!raw) return reply(ctx, `Current timeframes: ${parseTimeframes(store.get('timeframes')).join(',')}`); return reply(ctx, format(await runTool('set_setting', {key: 'timeframes', value: raw}))); });
  command(['orders'], 'Show recent Bitunix order history', async ctx => reply(ctx, format(await runTool('order_history'))));
  command(['history'], 'Show recent saved signals', ctx => reply(ctx, format(store.recentSignals())));
  command(['scan_on'], 'Enable periodic market scans', async ctx => { await store.set('scanOn', true); await reply(ctx, 'scan_on: ok'); });
  command(['scan_off'], 'Disable periodic market scans', async ctx => { await store.set('scanOn', false); await reply(ctx, 'scan_off: ok'); });
  command(['report_on'], 'Enable periodic Telegram reports', async ctx => { await store.set('reportOn', true); await reply(ctx, 'report_on: ok'); });
  command(['report_off'], 'Disable periodic Telegram reports', async ctx => { await store.set('reportOn', false); await reply(ctx, 'report_off: ok'); });
  command(['auto_trade'], 'Enable auto-trade; safety gates still apply', async ctx => { await store.set('autoTrade', true); await reply(ctx, 'auto_trade: enabled (live writes still require both safety gates)'); });
  command(['pause'], 'Pause auto-trading and market scans', async ctx => { await store.set('autoTrade', false); await store.set('scanOn', false); await reply(ctx, 'paused'); });
  command(['kill_switch'], 'Block future live orders immediately', async ctx => reply(ctx, format(await runTool('kill_switch'))));
  command(['set', 'tset'], 'Update a non-secret bot setting', async ctx => { const parts = String(ctx.message?.text || '').trim().split(/\s+/).slice(1); if (parts.length < 2) return reply(ctx, 'Usage: /set <key> <value> (or /tset <key> <value>)'); const [key, ...rest] = parts; const raw = rest.join(' '); const value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw); return reply(ctx, format(await runTool('set_setting', {key, value}))); });
  bot.on('text', async ctx => {
    if (!allowed(ctx) || String(ctx.message.text).startsWith('/')) return;
    rememberChat(ctx);
    if (isCurrentPriceQuery(ctx.message.text)) {
      try { await ctx.sendChatAction('typing'); const symbol = extractPriceSymbol(ctx.message.text, store.get('symbol')); await ctx.reply(renderTicker(await runTool('market_ticker', {symbol}))); }
      catch (error) { await ctx.reply(`Live ticker error: ${error.message}`); }
      return;
    }
    try { await ctx.sendChatAction('typing'); await ctx.reply((await agent.say(String(ctx.from.id), ctx.message.text)) || 'javabi nist'); }
    catch (error) { await ctx.reply(`AI error: ${error.message}`); }
  });
  bot.catch(error => console.error('[telegram]', error));
  const logCommandRegistrationFailure = error => logger.error('[telegram commands] failed to register menu; bot will continue. Check Telegram API connectivity and command definitions, then restart the bot:', sanitizeTelegramError(error, telegramConfig.token));
  try {
    Promise.resolve(bot.telegram.setMyCommands(registeredCommands)).catch(logCommandRegistrationFailure);
  } catch (error) {
    logCommandRegistrationFailure(error);
  }
  void bot.launch().catch(error => console.error('[telegram launch]', error));
  return {stop: () => bot.stop('shutdown'), sendReport, getReportChatId};
}
