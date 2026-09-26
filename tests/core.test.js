import test from 'node:test';
import assert from 'node:assert/strict';
import {signRest,signWebSocket} from '../src/bitunix/sign.js';
import {ema,rsi,strategies} from '../src/trading/indicators.js';
import {BitunixClient} from '../src/bitunix/client.js';

test('Bitunix REST signature is deterministic',()=>assert.equal(signRest({apiKey:'a',secretKey:'s',requestNonce:'n',timestampMs:1}),signRest({apiKey:'a',secretKey:'s',requestNonce:'n',timestampMs:1})));
test('Bitunix websocket signature uses supplied seconds timestamp',()=>assert.match(signWebSocket({apiKey:'a',secretKey:'s',requestNonce:'n',timestampSec:1}),/^[a-f0-9]{64}$/));
test('indicator functions return finite values',()=>{const a=Array.from({length:60},(_,i)=>100+i*.2);assert.ok(ema(a,9)>0);assert.ok(rsi(a)>50);assert.ok(strategies(a.map(close=>({open:close,high:close+1,low:close-1,close}))).out.length>=6);});
test('client blocks live writes until both gates are enabled',async()=>{const c=new BitunixClient({fetch:async()=>{throw new Error('should not call');}});await assert.rejects(()=>c.placeOrder({symbol:'BTCUSDT'}),/TRADING_NOT_ARMED/);});
