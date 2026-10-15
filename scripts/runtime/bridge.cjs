'use strict';
// Minimal original loopback adapter. No third-party packages or executable downloads.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { protectKey, headers, safeModels, request, ORIGIN } = require('./probe.cjs');
const { paths, CONNECTOR } = require('./environment.cjs');
const authService = require('./auth.cjs');
const { resolveModel } = require('./model-display.cjs');
const PORT = 17781;
const ownerIndex = process.argv.indexOf('--owner-pid');
const ownerPid = ownerIndex >= 0 ? Number(process.argv[ownerIndex + 1]) : undefined;
if (ownerIndex >= 0 && (!Number.isInteger(ownerPid) || ownerPid <= 0)) throw new Error('invalid_owner_pid');
const PREFIX = 'workbuddy-ai/';
const root = paths().root;
fs.mkdirSync(root, { recursive: true });
const localKey = crypto.createHmac('sha256', protectKey()).update('workbuddy-ai-connector-local-client-v1').digest('hex');
let catalog = [];
let inFlight = 0;
let totalRequests = 0;
let shuttingDown = false;
function log(event) { fs.appendFileSync(path.join(root, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n'); }
function sendJson(res, code, object) { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(object)); }
function authorize(req) {
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return supplied.length === localKey.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(localKey));
}
function chatModel(m) { return !m.tags?.some(t => ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'].includes(t)); }
async function refreshCatalog() {
  const r = await request('/v3/config', await authService.current());
  const d = JSON.parse(r.body);
  if (r.status !== 200 || d.code !== 0) throw new Error('catalog_unavailable');
  const models = safeModels(d); if (!models.length) throw new Error('empty_catalog');
  catalog = models;
  fs.writeFileSync(path.join(root, 'model-catalog.json'), JSON.stringify({ at: new Date().toISOString(), models }, null, 2));
  log({ event: 'catalog', modelCount: models.length, chatModelCount: models.filter(chatModel).length });
  return models;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', x => { size += x.length; if (size > 32 * 1024 * 1024) { reject(new Error('body_too_large')); req.destroy(); } else chunks.push(x); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('invalid_json')); } });
    req.on('error', reject);
  });
}
async function forward(body, req, res) {
  const id = crypto.randomUUID(); const started = Date.now(); const streamed = body.stream === true;
  const requestedModel = String(body.model || '');
  const model = resolveModel(requestedModel, catalog);
  if (!catalog.some(m => m.id === model && chatModel(m))) return sendJson(res, 400, { error: { message: 'Model is absent from the live chat catalog.', type: 'invalid_model' } });
  if (!Array.isArray(body.messages) || !body.messages.length) return sendJson(res, 400, { error: { message: 'messages must be a nonempty array' } });
  const outgoing = { ...body, model, stream: true };
  if (outgoing.messages[0].role !== 'system') outgoing.messages = [{ role: 'system', content: 'You are a helpful assistant.' }, ...outgoing.messages];
  const payload = Buffer.from(JSON.stringify(outgoing));
  inFlight++; totalRequests++;
  let ended = false; let responseStatus; let frameBuffer = ''; let deltaCount = 0; let toolDeltaCount = 0;
  const complete = { id: `chatcmpl-${id}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: null }] };
  function frames(chunk) {
    frameBuffer += chunk;
    let newline;
    while ((newline = frameBuffer.indexOf('\n')) >= 0) {
      const line = frameBuffer.slice(0, newline).trim(); frameBuffer = frameBuffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
      let data; try { data = JSON.parse(raw); } catch { continue; }
      if (data.usage) complete.usage = data.usage;
      for (const c of data.choices || []) {
        const d = c.delta || {}; deltaCount++;
        if (d.content) complete.choices[0].message.content += d.content;
        if (d.reasoning_content) complete.choices[0].message.reasoning_content = (complete.choices[0].message.reasoning_content || '') + d.reasoning_content;
        if (d.tool_calls) {
          const calls = complete.choices[0].message.tool_calls ||= [];
          for (const t of d.tool_calls) {
            toolDeltaCount++;
            const call = calls[t.index || 0] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (t.id) call.id = t.id; if (t.function?.name) call.function.name += t.function.name; if (t.function?.arguments) call.function.arguments += t.function.arguments;
          }
        }
        if (c.finish_reason) complete.choices[0].finish_reason = c.finish_reason;
      }
    }
  }
  function finish(outcome) {
    if (ended) return; ended = true; inFlight--;
    log({ event: 'request', requestId: id, model, upstreamStatus: responseStatus, outcome, elapsedMs: Date.now() - started, deltaCount, toolDeltaCount });
  }
  let auth; try { auth = await authService.current(); } catch { finish('auth_unavailable'); return sendJson(res, 401, { error: { message: 'WorkBuddy AI sign-in is unavailable', type: 'upstream_auth' } }); }
  const upstream = https.request(new URL('/v2/chat/completions', ORIGIN), {
    method: 'POST', headers: headers(auth, { 'Content-Length': payload.length, 'Accept': 'text/event-stream', 'X-Conversation-Request-ID': id, 'X-Root-Request-ID': id, 'X-Request-ID': crypto.randomUUID(), 'X-Client-Name': 'WorkBuddy', 'X-Client-Version': '5.7.6' }), timeout: 90000,
  }, incoming => {
    responseStatus = incoming.statusCode;
    if (responseStatus !== 200 || !String(incoming.headers['content-type']).includes('text/event-stream')) {
      let text = ''; incoming.on('data', x => { if (text.length < 8192) text += x.toString(); });
      incoming.on('end', () => { let data; try { data = JSON.parse(text); } catch {} const code = typeof data?.code === 'number' ? data.code : undefined; log({event:'upstream-error',requestId:id,model,status:responseStatus,businessCode:code}); sendJson(res, responseStatus >= 400 ? responseStatus : 502, { error: { message:'WorkBuddy AI returned an upstream error; check account permissions and quota.', code } }); finish('upstream_error'); }); return;
    }
    if (streamed) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    incoming.setEncoding('utf8');
    incoming.on('data', chunk => { frames(chunk); if (streamed && !res.destroyed && !res.write(chunk)) { incoming.pause(); res.once('drain', () => incoming.resume()); } });
    incoming.on('end', () => { if (streamed) res.end(); else sendJson(res, 200, complete); finish('completed'); });
    incoming.on('error', () => { if (!res.headersSent) sendJson(res, 502, { error: { message: 'Upstream stream interrupted' } }); else res.destroy(); finish('stream_interrupted'); });
  });
  upstream.on('timeout', () => upstream.destroy(new Error('upstream_timeout')));
  upstream.on('error', () => { if (!res.headersSent) sendJson(res, 502, { error: { message: 'Upstream connection failed' } }); else res.destroy(); finish('connection_failed'); });
  res.on('close', () => { if (!res.writableEnded) { upstream.destroy(); finish('client_disconnected'); } });
  upstream.end(payload);
}
const server = http.createServer(async (req, res) => {
  try {
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !['127.0.0.1:17781', 'localhost:17781'].includes(req.headers.host) || req.headers.origin) return sendJson(res, 403, { error: { message: 'Local native clients only' } });
    if (req.method === 'GET' && req.url === '/health') return sendJson(res, 200, { service: CONNECTOR, version: '0.2.0', ready: catalog.length > 0, modelCount: catalog.length, chatModelCount: catalog.filter(chatModel).length, inFlight, totalRequests, pid: process.pid, ownerPid });
    if (!authorize(req)) return sendJson(res, 401, { error: { message: 'Local connector authorization required' } });
    if (req.method === 'GET' && req.url === '/v1/models') return sendJson(res, 200, { object: 'list', data: catalog.filter(chatModel).map(m => ({ id: PREFIX + m.id, object: 'model', created: 0, owned_by: 'workbuddy-ai' })) });
    if (req.method === 'POST' && req.url === '/v1/chat/completions') return forward(await readBody(req), req, res);
    if (req.method === 'POST' && req.url === '/refresh-models') { await refreshCatalog(); return sendJson(res, 200, { success: true, modelCount: catalog.length }); }
    return sendJson(res, 404, { error: { message: 'Unknown route' } });
  } catch { if (!res.headersSent) sendJson(res, 500, { error: { message: 'Connector operation failed; check local sign-in and service status' } }); }
});
function stop() { if (shuttingDown) return; shuttingDown = true; log({ event: 'stopping', inFlight }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); }
async function start() {
  try { catalog = JSON.parse(fs.readFileSync(path.join(root, 'model-catalog.json'), 'utf8')).models || []; } catch {}
  if (!catalog.length) await refreshCatalog();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  log({ event: 'ready', pid: process.pid, ppid: process.ppid, ownerPid, port: PORT, mode: ownerPid ? 'desktop-owned' : process.argv.includes('--mcp') ? 'mcp' : 'standalone' });
  refreshCatalog().catch(() => log({event:'catalog_refresh_failed'}));
  if(ownerPid) {
    setInterval(() => { try { process.kill(ownerPid, 0); } catch { stop(); } }, 2000);
  }
  if (process.argv.includes('--mcp')) {
    const input = readline.createInterface({ input: process.stdin });
    input.on('line', line => { let r; try { r = JSON.parse(line); } catch { return; } if (r.id === undefined) return; let result;
      if (r.method === 'initialize') result = { protocolVersion: r.params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'workbuddy-ai-connector', version: '0.1.0' } };
      else if (r.method === 'tools/list') result = { tools: [] };
      else if (r.method === 'ping') result = {};
      else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'Method not found' } }) + '\n'); return; }
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }) + '\n');
    });
    input.on('close', stop);
  }
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
if (require.main === module) start().catch(error => { log({ event: 'startup_failed', error: error.code || error.name }); process.exit(1); });
module.exports = { chatModel, PREFIX, localKey };
