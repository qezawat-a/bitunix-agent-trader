import {Telegraf} from 'telegraf';
import {config} from '../config.js';
import {extractPriceSymbol,isCurrentPriceQuery,renderTicker} from '../market/ticker.js';
import {parseTimeframes} from '../trading/timeframes.js';
const HELP = `Salam. Agent online ast.\n\nCommands:\n/start /help\n/status /settings\n/price [SYMBOL] /ticker [SYMBOL]\n/timeframes <intervals> (or /set timeframes <intervals>)\n/balance /signal /positions /orders /history\n/scan_on /scan_off /report_on /report_off\n/auto_trade /pause /kill_switch\n/set <key> <value>\n\nValid Bitunix intervals: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M\n\nAlias: /tset <key> <value> ham supported ast.\nChat-e adi ham be agent mire.`;
const format = value => typeof value === 'string' ? value : `\\\`\\\`\\\`json\n${JSON.stringify(value, null, 2)}\n\\\`\\\`\\\``;
export const resolveReportChatId = (store, telegramConfig) => String(store.get('telegramChatId', telegramConfig.chatId || telegramConfig.userId || '') || '');
export async function persistTelegramChatId(store, chatId) { if (chatId != null && String(chatId)) await store.set('telegramChatId', String(chatId)); }

export function startTelegram({agent, tools, store}) {
  if (!config.telegram.token) return null;
  const bot = new Telegraf(config.telegram.token);
  const allowed = ctx => !config.telegram.userId || String(ctx.from?.id) === config.telegram.userId;
  const reply = async (ctx, message) => { if (allowed(ctx)) await ctx.reply(String(message)); };
  const getReportChatId = () => resolveReportChatId(store, config.telegram);
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
  const command = (names, handler) => names.forEach(name => bot.command(name, async ctx => { if (!allowed(ctx)) return; rememberChat(ctx); try { await ctx.sendChatAction('typing'); await handler(ctx); } catch (error) { await ctx.reply(`Error: ${error.message}`); } }));
  command(['start', 'help'], ctx => reply(ctx, HELP));
  command(['status'], async ctx => reply(ctx, format(await runTool('trader_status'))));
  command(['settings'], ctx => reply(ctx, format(store.settings())));
  command(['balance'], async ctx => reply(ctx, format(await runTool('account_balance'))));
  command(['signal'], async ctx => reply(ctx, format(await runTool('market_signal'))));
  command(['positions'], async ctx => reply(ctx, format(await runTool('positions'))));
  command(['price', 'ticker'], async ctx => { const symbol = extractPriceSymbol(String(ctx.message?.text || ''), store.get('symbol')); return reply(ctx, renderTicker(await runTool('market_ticker', {symbol}))); });
  command(['timeframes', 'timeframe'], async ctx => { const raw = String(ctx.message?.text || '').trim().split(/\s+/).slice(1).join(','); if (!raw) return reply(ctx, `Current timeframes: ${parseTimeframes(store.get('timeframes')).join(',')}`); return reply(ctx, format(await runTool('set_setting', {key: 'timeframes', value: raw}))); });
  command(['orders'], async ctx => reply(ctx, format(await runTool('order_history'))));
  command(['history'], ctx => reply(ctx, format(store.recentSignals())));
  command(['scan_on'], async ctx => { await store.set('scanOn', true); await reply(ctx, 'scan_on: ok'); });
  command(['scan_off'], async ctx => { await store.set('scanOn', false); await reply(ctx, 'scan_off: ok'); });
  command(['report_on'], async ctx => { await store.set('reportOn', true); await reply(ctx, 'report_on: ok'); });
  command(['report_off'], async ctx => { await store.set('reportOn', false); await reply(ctx, 'report_off: ok'); });
  command(['auto_trade'], async ctx => { await store.set('autoTrade', true); await reply(ctx, 'auto_trade: enabled (live writes still require both safety gates)'); });
  command(['pause'], async ctx => { await store.set('autoTrade', false); await store.set('scanOn', false); await reply(ctx, 'paused'); });
  command(['kill_switch'], async ctx => reply(ctx, format(await runTool('kill_switch'))));
  command(['set', 'tset'], async ctx => { const parts = String(ctx.message?.text || '').trim().split(/\s+/).slice(1); if (parts.length < 2) return reply(ctx, 'Usage: /set <key> <value> (or /tset <key> <value>)'); const [key, ...rest] = parts; const raw = rest.join(' '); const value = raw === 'true' ? true : raw === 'false' ? false : Number.isNaN(Number(raw)) ? raw : Number(raw); return reply(ctx, format(await runTool('set_setting', {key, value}))); });
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
  void bot.launch().catch(error => console.error('[telegram launch]', error));
  return {stop: () => bot.stop('shutdown'), sendReport, getReportChatId};
}
