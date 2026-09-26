import pg from 'pg';
import { config } from '../config.js';

const DEFAULTS = {...config.defaults, scanOn:false, reportOn:true, autoTrade:false, killSwitch:false, symbol:config.defaults.symbol};
export class Store {
  constructor({pool=null}={}) { this.pool = pool || (config.databaseUrl ? new pg.Pool({connectionString:config.databaseUrl, ssl:{rejectUnauthorized:false}, max:3}) : null); this.state = {settings:DEFAULTS, signals:[], events:[], conversations:{}}; }
  async init() { if (!this.pool) return; await this.pool.query('CREATE TABLE IF NOT EXISTS agent_state (id text primary key, data jsonb not null, updated_at timestamptz not null default now())'); const r=await this.pool.query('SELECT data FROM agent_state WHERE id=$1',[config.storeId]); if(r.rows[0]?.data) this.state={...this.state,...r.rows[0].data,settings:{...DEFAULTS,...r.rows[0].data.settings}}; }
  async save() { if (!this.pool) return; await this.pool.query('INSERT INTO agent_state(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',[config.storeId,JSON.stringify(this.state)]); }
  get(k,d=undefined) { return this.state.settings[k] ?? d; }
  set(k,v) { this.state.settings[k]=v; return this.save(); }
  settings() { return {...this.state.settings}; }
  push(type,data) { this.state.events.push({type,data,at:Date.now()}); this.state.events=this.state.events.slice(-1000); return this.save(); }
  signal(s) { this.state.signals.push({...s,at:Date.now()}); this.state.signals=this.state.signals.slice(-500); return this.save(); }
  recentSignals(n=20) { return this.state.signals.slice(-n); }
  history(userId) { return this.state.conversations[userId] || []; }
  async setHistory(userId,h) { this.state.conversations[userId]=h.slice(-200); await this.save(); }
  async close() { if(this.pool) await this.pool.end(); }
}
