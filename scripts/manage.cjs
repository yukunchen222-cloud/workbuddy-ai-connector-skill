'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { requireExecutables, CONNECTOR } = require('./runtime/environment.cjs');
const { chatModel, mergeModels, mergeMcp, removeModels } = require('./runtime/registration.cjs');
const { owned } = require('./runtime/model-display.cjs');
const { writeJson, writeConfigurations } = require('./runtime/config-files.cjs');
const action = process.argv[2] || 'check';
async function main() {
  if (!['check', 'install', 'remove'].includes(action)) throw new Error('unsupported_action');
  const p = requireExecutables();
  const modelsFile = path.join(p.cnHome, 'models.json');
  const mcpFile = path.join(p.cnHome, 'mcp.json');
  const read = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  const rawModels = read(modelsFile, []);
  const rawMcp = read(mcpFile, { mcpServers: {} });
  const backup = path.join(p.root, 'backups', Date.now() + '-' + crypto.randomUUID());
  if (action === 'remove') {
    const models = removeModels(rawModels);
    const mcp = { ...rawMcp, mcpServers: { ...rawMcp.mcpServers } };
    delete mcp.mcpServers[CONNECTOR];
    writeConfigurations([[modelsFile, models], [mcpFile, mcp]], backup);
    console.log(JSON.stringify({ action, success: true, otherConfigurationPreserved: true, runtimeFilesRetained: true, nextStep: 'Close and reopen WorkBuddy normally to finish service cleanup.' }));
    return;
  }
  const { protectKey, request, safeModels } = require('./runtime/probe.cjs');
  const auth = require('./runtime/auth.cjs');
  const response = await request('/v3/config', await auth.current());
  const document = JSON.parse(response.body);
  if (response.status !== 200 || document?.code !== 0) throw new Error('catalog_unavailable');
  const catalog = safeModels(document);
  const chats = catalog.filter(chatModel);
  if (!chats.length) throw new Error('empty_chat_catalog');
  const native = require(path.join(path.dirname(p.cnExe), 'resources', 'app.asar', 'main', 'credential-protection.js'));
  native.init_credential_protection();
  const modelKey = protectKey();
  const localKey = crypto.createHmac('sha256', modelKey).update('workbuddy-ai-connector-local-client-v1').digest('hex');
  native.configureCredentialProtection({ policy: 'files', symmetricKey: { key: modelKey, keyId: crypto.createHash('sha256').update(modelKey).digest('hex').slice(0, 16) } });
  modelKey.fill(0);
  const codec = native.createModelsJsonCredentialCodec(() => { throw new Error('native_model_key_encryption_unavailable'); });
  try {
    const decoded = codec.decode(rawModels).value;
    const merged = mergeModels(decoded, catalog, localKey);
    const encodedResult = codec.encode(merged);
    const encoded = Array.isArray(encodedResult) ? encodedResult : encodedResult.value;
    const encodedModels = Array.isArray(encoded) ? encoded : encoded?.models;
    if (!Array.isArray(encodedModels) || encodedModels.filter(owned).some(m => typeof m.apiKey === 'string')) throw new Error('refusing_plaintext_local_key');
    const roundTrip = codec.decode(encoded).value;
    const decodedModels = Array.isArray(roundTrip) ? roundTrip : roundTrip?.models;
    if (!Array.isArray(decodedModels) || decodedModels.filter(owned).some(m => m.apiKey !== localKey)) throw new Error('model_key_roundtrip_failed');
    const models = Array.isArray(merged) ? merged : merged.models;
    const defaults1M = models.filter(m => owned(m) && m.contextWindow?.defaultLength === 1000000).length;
    if (action === 'install') {
      const runtime = path.join(p.root, 'runtime');
      fs.mkdirSync(runtime, { recursive: true });
      for (const entry of fs.readdirSync(path.join(__dirname, 'runtime'), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.cjs')) throw new Error('unexpected_runtime_entry');
        fs.copyFileSync(path.join(__dirname, 'runtime', entry.name), path.join(runtime, entry.name));
      }
      writeJson(path.join(p.root, 'model-catalog.json'), { at: new Date().toISOString(), source: '/v3/config', models: catalog });
      writeConfigurations([[modelsFile, encoded], [mcpFile, mergeMcp(rawMcp, p.cnExe, p.aiExe, runtime)]], backup);
    }
    console.log(JSON.stringify({ action, success: true, modelCount: catalog.length, chatModelCount: chats.length, modelsDefaultingTo1M: defaults1M, mediaModelsNotRegistered: catalog.length - chats.length, configurationWritten: action === 'install', modelCalls: 0, persistedAccountCredentials: false, localKeyRoundtripPassed: true }));
  } finally { codec.dispose(); }
}
main().catch(error => {
  const message = /^[a-z][a-z_]+$/.test(error.message || '') ? error.message : (error.code || error.name || 'operation_failed');
  console.error(JSON.stringify({ action, success: false, error: message }));
  process.exitCode = 1;
});
