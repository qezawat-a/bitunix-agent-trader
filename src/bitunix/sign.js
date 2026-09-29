import crypto from 'node:crypto';

export function nonce() { return crypto.randomBytes(16).toString('hex'); }
export function sha256(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
export function canonicalParams(params={}) { return Object.keys(params).sort().filter(k=>params[k]!==undefined&&params[k]!==null).map(k=>`${k}${params[k]}`).join(''); }
// JSON.stringify already emits compact JSON; preserve spaces that are part of string values so this is byte-for-byte the transmitted body.
export function canonicalBody(body) { return body === undefined ? '' : JSON.stringify(body); }

// Bitunix docs: digest=SHA256(nonce+timestamp+apiKey+sortedQuery+body); sign=SHA256(digest+secretKey).
export function signRest({apiKey,secretKey,requestNonce,timestampMs,query={},body}) {
  const digest=sha256(`${requestNonce}${timestampMs}${apiKey}${canonicalParams(query)}${canonicalBody(body)}`);
  return sha256(digest+secretKey);
}
export function signWebSocket({apiKey,secretKey,requestNonce,timestampSec,params={}}) {
  const digest=sha256(`${requestNonce}${timestampSec}${apiKey}${canonicalParams(params)}`);
  return sha256(digest+secretKey);
}
