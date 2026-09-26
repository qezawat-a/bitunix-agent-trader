import fs from 'node:fs/promises';
import {config} from '../config.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = Math.max(5_000, Number(process.env.AI_REQUEST_TIMEOUT_MS || 45_000));
const firstEnv = (...names) => names.map(name => process.env[name]).find(value => value && String(value).trim());
const cleanBaseUrl = value => String(value).trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try { return await fetch(url, {...options, signal: options.signal || controller.signal}); }
  catch (error) {
    if (error?.name === 'AbortError') throw new Error(`AI request timed out after ${REQUEST_TIMEOUT_MS}ms (${url})`);
    throw new Error(`AI network request failed (${url}): ${error?.message || error}`);
  } finally { clearTimeout(timer); }
}

async function chooseModel(baseUrl, key, configuredModel) {
  if (configuredModel && configuredModel.toUpperCase() !== 'AUTO') return configuredModel;
  try {
    const response = await fetchWithTimeout(`${cleanBaseUrl(baseUrl)}/models`, {headers: {authorization: `Bearer ${key}`}});
    if (response.ok) {
      const ids = ((await response.json()).data || []).map(item => item.id).filter(Boolean);
      return ids.find(id => /gpt-4o-mini|gpt-4\.1-mini|qwen|llama|mistral/i.test(id)) || ids[0] || DEFAULT_MODEL;
    }
  } catch { /* Some compatible providers do not expose /models. */ }
  return DEFAULT_MODEL;
}

async function callOpenAICompatible(messages, tools = []) {
  const key = firstEnv('OPENAI_COMPATIBLE_KEY', 'OPENAI_API_KEY');
  const baseUrl = firstEnv('OPENAI_COMPATIBLE_URL', 'OPENAI_BASE_URL', 'BASE_URL') || 'https://api.openai.com/v1';
  const configuredModel = firstEnv('OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBALE_MODEL', 'OPENAI_MODEL', 'AI_MODEL') || 'AUTO';
  if (!key) throw new Error('OPENAI key is empty: set OPENAI_COMPATIBLE_KEY (or OPENAI_API_KEY)');
  const model = await chooseModel(baseUrl, key, configuredModel);
  const response = await fetchWithTimeout(`${cleanBaseUrl(baseUrl)}/chat/completions`, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Bearer ${key}`}, body: JSON.stringify({model, messages, ...(tools.length ? {tools} : {}), temperature: 0.2})});
  const raw = await response.text();
  let payload; try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`OpenAI-compatible ${response.status} (${model}): ${payload?.error?.message || payload?.message || raw || response.statusText}`);
  const message = payload?.choices?.[0]?.message;
  if (!message) throw new Error(`OpenAI-compatible response has no choices (model ${model})`);
  return message;
}

export async function askLLM(messages, tools = []) {
  const provider = String(config.ai.provider || 'AUTO').toUpperCase();
  if (!['AUTO', 'OPENAI', 'OPENAI_COMPATIBLE'].includes(provider)) throw new Error(`Unsupported AI_PROVIDER=${provider}; use AUTO or OPENAI_COMPATIBLE`);
  return callOpenAICompatible(messages, tools);
}

export async function loadSoul() { return `${await fs.readFile(new URL('../../soul/SOUL.md', import.meta.url), 'utf8')}\n${await fs.readFile(new URL('../../soul/STYLE.md', import.meta.url), 'utf8')}`; }

export function createAgent({store, tools, soul}) {
  const histories = new Map();
  return {async say(userId, text) {
    const history = histories.get(userId) || [{role: 'system', content: `You are a careful autonomous Bitunix futures AI agent. Think step-by-step internally, but answer concisely in Finglish unless user asks otherwise. Never invent API fields. Never place/cancel/close a live order without using the exact tool and satisfying policy gates. Explain uncertainty.\n${soul}`}];
    history.push({role: 'user', content: text});
    for (let round = 0; round < config.ai.maxToolRounds; round++) {
      const message = await askLLM(history, tools.map(t => ({type: 'function', function: {name: t.name, description: t.description, parameters: t.parameters}})));
      history.push(message);
      if (!message.tool_calls?.length) { histories.set(userId, history.slice(-200)); await store.setHistory(userId, history); return message.content || ''; }
      for (const call of message.tool_calls) {
        const tool = tools.find(item => item.name === call.function.name);
        let output;
        try { output = tool ? await tool.run(JSON.parse(call.function.arguments || '{}')) : {error: 'unknown tool'}; }
        catch (error) { output = {error: error.message}; }
        history.push({role: 'tool', tool_call_id: call.id, content: JSON.stringify(output)});
      }
    }
    throw new Error('agent max tool rounds reached');
  }};
}

export const _internal = {cleanBaseUrl, chooseModel};
