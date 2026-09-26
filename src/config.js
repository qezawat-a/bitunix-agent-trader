import 'dotenv/config';

const bool = (v, d=false) => v == null ? d : ['1','true','yes','on'].includes(String(v).toLowerCase());
const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;

export const config = Object.freeze({
  port: num(process.env.PORT, 8787),
  databaseUrl: process.env.DATABASE_URL || '',
  storeId: process.env.STORE_ID || 'bitunix-main',
  bitunix: { apiKey: process.env.BITUNIX_API_KEY || '', apiSecret: process.env.BITUNIX_API_SECRET || '', restUrl: process.env.BITUNIX_REST_URL || 'https://fapi.bitunix.com', publicWs: process.env.BITUNIX_WS_PUBLIC || 'wss://fapi.bitunix.com/public/', privateWs: process.env.BITUNIX_WS_PRIVATE || 'wss://fapi.bitunix.com/private/' },
  telegram: { token: process.env.TELEGRAM_BOT_TOKEN || '', userId: String(process.env.TELEGRAM_USER_ID || ''), chatId: String(process.env.TELEGRAM_CHAT_ID || '') },
  ai: { provider: process.env.AI_PROVIDER || 'AUTO', thinkingLevel: process.env.THINKING_LEVEL || 'mid', maxToolRounds: num(process.env.AGENT_MAX_TOOL_ROUNDS, 8), autonomousSec: num(process.env.AGENT_AUTONOMOUS_SEC, 15), autoCompact: bool(process.env.AUTO_COMPACT, true), compactAfterTurns: num(process.env.AUTO_COMPACT_AFTER_TURNS, 40) },
  liveTrading: bool(process.env.LIVE_TRADING),
  armTrading: bool(process.env.ARM_TRADING),
  defaults: { symbol: process.env.DEFAULT_SYMBOL || 'BTCUSDT', leverage: num(process.env.DEFAULT_LEVERAGE, 3), marginMode: process.env.DEFAULT_MARGIN_MODE || 'ISOLATED', positionMode: process.env.DEFAULT_POSITION_MODE || 'HEDGE', marginAmountPct: num(process.env.DEFAULT_MARGIN_AMOUNT_PCT, 1), minConfidence: num(process.env.DEFAULT_MIN_CONFIDENCE, 80), tfMinConfidence: num(process.env.DEFAULT_TF_MIN_CONFIDENCE, 60), minAgreeingStrategies: num(process.env.DEFAULT_MIN_AGREEING_STRATEGIES, 2), signalConfirmScans: num(process.env.DEFAULT_SIGNAL_CONFIRM_SCANS, 1), cooldownMinutes: num(process.env.DEFAULT_COOLDOWN_MINUTES, 5), scanIntervalSec: num(process.env.DEFAULT_SCAN_INTERVAL_SEC, 15), guardIntervalSec: num(process.env.DEFAULT_GUARD_INTERVAL_SEC, 15), midManageIntervalSec: num(process.env.DEFAULT_MID_MANAGE_INTERVAL_SEC, 15), reportIntervalSec: num(process.env.DEFAULT_REPORT_INTERVAL_SEC, 30), reversalEnabled: bool(process.env.DEFAULT_REVERSAL_ENABLED, true), reversalConfidence: num(process.env.DEFAULT_REVERSAL_CONFIDENCE, 85), breakevenThresholdRoi: num(process.env.DEFAULT_BREAKEVEN_THRESHOLD_ROI, 20), trailingTriggerRoi: num(process.env.DEFAULT_TRAILING_TRIGGER_ROI, 25), liquidationDistance: num(process.env.DEFAULT_LIQUIDATION_DISTANCE, 0.60) }
});

export function assertConfig({allowUnarmed=true}={}) {
  if (!config.databaseUrl) console.warn('[config] DATABASE_URL is empty; file fallback is not included in live deployment');
  if (!allowUnarmed && (!config.bitunix.apiKey || !config.bitunix.apiSecret)) throw new Error('Bitunix credentials are missing');
  if (config.liveTrading && !config.armTrading) console.warn('[risk] LIVE_TRADING=1 but ARM_TRADING=0; writes remain blocked');
}

export function canTrade() { return config.liveTrading && config.armTrading && Boolean(config.bitunix.apiKey && config.bitunix.apiSecret); }
