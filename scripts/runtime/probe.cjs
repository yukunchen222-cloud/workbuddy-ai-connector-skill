'use strict';
// Original local integration probe. Only Node built-ins and the installed app runtime.
// Account credentials and the storage key never leave process memory or enter receipts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const ORIGIN = 'https://www.workbuddy.ai';
const AUTH_PATH = path.join(process.env.LOCALAPPDATA, 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'workbuddy-desktop-ai.info');

function protectKey() {
  const payload = JSON.parse(String(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()));
  if (payload.version !== 1 || typeof payload.atRestSecretKey !== 'string') throw new Error('unsupported_storage_key');
  return crypto.createHash('sha256').update(payload.atRestSecretKey).digest();
}
function decodeField(value, key) {
  if (typeof value === 'string') return value;
  if (!value || value.$wbEncrypted !== 1 || typeof value.envelope !== 'string') throw new Error('unsupported_credential_format');
  const e = JSON.parse(Buffer.from(value.envelope, 'base64').toString('utf8'));
  if (e.suite !== 1 || e.keyId !== crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)) throw new Error('credential_key_mismatch');
  function lp(text) { const b = Buffer.from(text); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); }
  const suite = Buffer.alloc(4); suite.writeUInt32BE(e.suite);
  const aad = Buffer.concat([Buffer.from('WB-AAD\0'), Buffer.from([1]), lp('WBEV1'), lp('sym-v1'), suite, lp(e.keyId), Buffer.from([2, 0, 0])]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64'));
  decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(e.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
function credentials(withRefresh = false) {
  const doc = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  const key = protectKey();
  const access = decodeField(doc.auth.accessToken, key);
  const refresh = withRefresh ? decodeField(doc.auth.refreshToken, key) : undefined;
  key.fill(0);
  if (!access || !doc.account.uid || !String(doc.auth.domain).includes('workbuddy.ai')) throw new Error('international_account_required');
  return { access, refresh, uid: doc.account.uid, domain: doc.auth.domain, expiresAt: doc.auth.expiresAt, refreshExpiresAt: doc.auth.refreshExpiresAt, enterpriseId: doc.account.enterpriseId };
}
function headers(auth, extra = {}) {
  return {
    'Content-Type': 'application/json', 'Accept': 'application/json',
    'Authorization': `Bearer ${auth.access}`, 'X-User-Id': auth.uid,
    'X-Domain': auth.domain, 'X-No-Enterprise-Id': '1',
    'Origin': ORIGIN, 'Referer': `${ORIGIN}/`,
    'User-Agent': 'WorkBuddy/5.7.6 WorkBuddy AI/5.7.6 CLI/5.7.6',
    'X-CodeBuddy-Request': '1', 'X-Requested-With': 'XMLHttpRequest',
    'Accept-Language': 'en-US', ...extra,
  };
}
function request(route, auth, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    const req = https.request(new URL(route, ORIGIN), {
      method: options.method || (body ? 'POST' : 'GET'), headers: headers(auth, { ...(body ? { 'Content-Length': body.length } : {}), ...options.headers }),
      timeout: options.timeout || 25000,
    }, res => {
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) res.destroy(new Error('response_too_large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('upstream_timeout')));
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
function safeModels(document) {
  const byId = new Map();
  function walk(value, depth = 0) {
    if (depth > 12 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const x of value) walk(x, depth + 1); return; }
    if (typeof value.id === 'string' && (typeof value.name === 'string' || 'maxInputTokens' in value || 'supportsToolCall' in value)) {
      const output = {};
      for (const k of ['id', 'name', 'vendor', 'modelType', 'maxInputTokens', 'maxOutputTokens', 'supportsToolCall', 'supportsImages', 'supportsReasoning', 'disabled', 'disabledReason', 'credits', 'tags', 'contextWindow']) {
        if (k in value) output[k] = value[k];
      }
      byId.set(output.id, output);
    }
    for (const [k, v] of Object.entries(value)) if (!/token|secret|auth|account|user/i.test(k)) walk(v, depth + 1);
  }
  walk(document); return [...byId.values()];
}
module.exports = { credentials, protectKey, headers, request, safeModels, ORIGIN };
