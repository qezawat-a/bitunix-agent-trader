import http from 'node:http';
import {config,assertConfig,canTrade} from './config.js';
import {BitunixClient} from './bitunix/client.js';
import {Store} from './storage/store.js';
import {scan} from './trading/scanner.js';
import {createAgent,loadSoul} from './agent/agent.js';
import {startTelegram} from './telegram/bot.js';
import {createReportScheduler} from './reporting/scheduler.js';
import {buildTraderReport,renderTraderReport} from './reporting/report.js';
import {normalizeSymbol,lookupLiveTicker} from './market/ticker.js';
import {parseTimeframes} from './trading/timeframes.js';

assertConfig();const store=new Store();await store.init();const client=new BitunixClient();
const tools=[
	{name:'trader_status',description:'Read current settings, selected scan timeframes, and trading safety status',parameters:{type:'object',properties:{}},run:async()=>({settings:store.settings(),timeframes:parseTimeframes(store.get('timeframes')),canTrade:canTrade(),killSwitch:store.get('killSwitch',false)})},
	{name:'market_signal',description:'Scan the configured symbol across the persisted selected timeframes using the existing multi-timeframe strategy and return each timeframe result. Do not substitute another timeframe.',parameters:{type:'object',properties:{symbol:{type:'string'},timeframes:{type:'string',description:'Optional comma-separated Bitunix intervals; omit to use persisted settings'}},required:[]},run:async({symbol,timeframes})=>{const selected=parseTimeframes(timeframes ?? store.get('timeframes'));const s=await scan(client,symbol||store.get('symbol'),selected,{minAgree:store.get('minAgreeingStrategies'),tfMinConfidence:store.get('tfMinConfidence')});await store.signal(s);return s;}},
	{name:'account_balance',description:'Read the authenticated Bitunix futures USDT account balance using the official account endpoint. Returns available, frozen, margin, transfer, equity-related PnL and position mode; never use order history.',parameters:{type:'object',properties:{marginCoin:{type:'string',description:'Margin coin, default USDT'}},required:[]},run:async({marginCoin})=>client.accountBalance(marginCoin||'USDT')},
	{name:'positions',description:'Read open positions from Bitunix',parameters:{type:'object',properties:{}},run:async()=>client.positions(store.get('symbol'))},
	{name:'order_history',description:'Read recent order history from Bitunix',parameters:{type:'object',properties:{}},run:async()=>client.orderHistory(store.get('symbol'))},
	{name:'market_ticker',description:'MANDATORY tool for current/live/exact price questions. Never use order history or memory for price. Returns live Bitunix bid, ask, last, timestamp and source.',parameters:{type:'object',properties:{symbol:{type:'string'}},required:[]},run:async({symbol})=>lookupLiveTicker(client,symbol||store.get('symbol'))},
	{name:'set_setting',description:'Update a persistent non-secret trader setting. For timeframe selection use key timeframes and comma-separated Bitunix intervals.',parameters:{type:'object',properties:{key:{type:'string'},value:{type:['string','number','boolean','array']}},required:['key','value']},run:async({key,value})=>{const forbidden=['apiKey','apiSecret','DATABASE_URL'];if(forbidden.includes(key))throw new Error('secret setting forbidden');if(['timeframe','timeframes','interval','intervals'].includes(String(key).toLowerCase())){key='timeframes';value=parseTimeframes(value);}await store.set(key,value);return store.settings()}},
{name:'kill_switch',description:'Immediately block future live writes',parameters:{type:'object',properties:{}},run:async()=>{await store.set('killSwitch',true);return {killSwitch:true}}},
{name:'place_order',description:'Place a live Bitunix order only when all deterministic gates pass',parameters:{type:'object',properties:{symbol:{type:'string'},side:{type:'string',enum:['BUY','SELL']},tradeSide:{type:'string',enum:['OPEN','CLOSE']},qty:{type:'string'},orderType:{type:'string',enum:['MARKET','LIMIT']},price:{type:'string'}},required:['symbol','side','tradeSide','qty','orderType']},run:async(body)=>{if(store.get('killSwitch'))throw new Error('KILL_SWITCH_ACTIVE');if(!canTrade())throw new Error('TRADING_NOT_ARMED');return client.placeOrder(body)}}
];
	const agent=createAgent({store,tools,soul:await loadSoul()});const tg=startTelegram({agent,tools,store});
	const reportScheduler=tg ? createReportScheduler({store,sendReport:report=>tg.sendReport(renderTraderReport(report)),buildReport:()=>buildTraderReport({store,client,canTrade,liveTrading:config.liveTrading}),log:console}) : null;
	if (reportScheduler) { console.log('[report] scheduler started',JSON.stringify({intervalSec:store.get('reportIntervalSec',30),reportOn:store.get('reportOn',true),chatId:tg.getReportChatId()||null})); void reportScheduler.start().catch(error=>console.error('[report] scheduler fatal',error)); }
	else console.warn('[report] scheduler disabled: Telegram bot is not configured');
	let lastScan=0,running=true;async function loop(){while(running){try{const now=Date.now();if(store.get('scanOn',false)&&now-lastScan>=store.get('scanIntervalSec',15)*1000){lastScan=now;try{const s=await tools[1].run({});console.log('[scan]',JSON.stringify({symbol:s.symbol,direction:s.direction,confidence:s.confidence}));}catch(e){console.error('[scan]',e.message);}}}catch(error){console.error('[runtime] loop iteration failed',error?.stack||error?.message||error);}await new Promise(r=>setTimeout(r,1000));}}void loop().catch(error=>console.error('[runtime] loop fatal',error));
	const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify({ok:true,liveTrading:config.liveTrading,armed:canTrade(),killSwitch:store.get('killSwitch',false),report:reportScheduler?.status()||{enabled:false}}));return;}res.statusCode=404;res.end(JSON.stringify({error:'not found'}));});server.listen(config.port,'0.0.0.0',()=>console.log(`[server] listening on ${config.port}`));
	process.once('SIGTERM',async()=>{running=false;await reportScheduler?.stop();tg?.stop();server.close();await store.close();process.exit(0);});
