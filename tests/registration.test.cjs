'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeModels, mergeMcp, removeModels } = require('../scripts/runtime/registration.cjs');
const { resolveModel } = require('../scripts/runtime/model-display.cjs');
const { contextSettings } = require('../scripts/runtime/context-settings.cjs');
const { writeConfigurations } = require('../scripts/runtime/config-files.cjs');
const catalog = [
  { id: 'paid', name: 'Paid', credits: 'x1.2', maxInputTokens: 1000000, supportsToolCall: true },
  { id: 'free', name: 'Free', credits: 'x0.00', maxInputTokens: 1000000, contextWindow: { defaultLength: 300000, supportedLengths: [300000, 1000000] } },
  { id: 'small', name: 'Small', credits: 'x0.2', maxInputTokens: 192000 },
  { id: 'media', name: 'Image', tags: ['text-to-image'] },
];
test('installation keeps unrelated models and root metadata, sorts only connector models, excludes media', () => {
  const unrelated = { id: 'personal', url: 'http://localhost:1234', apiKey: 'fixture' };
  const original = { version: 3, customSetting: { keep: true }, models: [unrelated] };
  const result = mergeModels(original, catalog, 'local-test-key');
  assert.deepEqual(result.customSetting, original.customSetting);
  assert.equal(result.version, 3);
  assert.deepEqual(result.models[0], unrelated);
  assert.deepEqual(result.models.slice(1).map(m => m.workbuddyAiModelId), ['free', 'paid', 'small']);
  assert.equal(result.models[2].supportsToolCall, true);
  assert.equal(result.models[1].contextWindow.defaultLength, 1000000);
  assert.equal(result.models[3].contextWindow, undefined);
  assert.deepEqual(original.models, [unrelated]);
});
test('reinstall replaces only owned entries without duplication', () => {
  const first = mergeModels([], catalog, 'key-a');
  const second = mergeModels(first, catalog, 'key-b');
  assert.equal(second.length, 3);
  assert(second.every(m => m.apiKey === 'key-b'));
});
test('context options respect actual limits and original non-1M defaults', () => {
  assert.equal(contextSettings({ maxInputTokens: 192000 }), undefined);
  assert.deepEqual(contextSettings({ maxInputTokens: 1000000 }), { supportedLengths: [1000000], defaultLength: 1000000 });
  assert.deepEqual(contextSettings({ maxInputTokens: 500000, contextWindow: { supportedLengths: [200000, 500000, 1000000], defaultLength: 200000 } }), { supportedLengths: [200000, 500000], defaultLength: 200000 });
  assert.deepEqual(contextSettings({ maxInputTokens: 1000000, contextWindow: { supportedLengths: [-1, '1000000', 300000, 300000, 1000000], defaultLength: 300000 } }).supportedLengths, [300000, 1000000]);
});
test('SG and legacy labels resolve to distinct upstream model IDs', () => {
  const twins = [{ id: 'flash', name: 'Flash' }, { id: 'flash-sg', name: 'Flash' }];
  const models = mergeModels([], twins, 'fixture');
  assert.equal(resolveModel(models[0].id, twins), 'flash');
  assert.equal(resolveModel('Flash (SG) · WorkBuddy AI', twins), 'flash-sg');
  assert.equal(resolveModel('custom-local:workbuddy-ai/flash-sg', twins), 'flash-sg');
});
test('MCP merge preserves other servers and settings and uses supplied paths', () => {
  const original = { policy: 'retain', mcpServers: { personal: { command: 'personal-command' } } };
  const result = mergeMcp(original, 'C:\\Apps\\CN\\WorkBuddy.exe', 'C:\\Apps\\AI\\WorkBuddyAI.exe', 'C:\\User Data\\runtime');
  assert.equal(result.policy, 'retain');
  assert.deepEqual(result.mcpServers.personal, original.mcpServers.personal);
  assert.equal(result.mcpServers['workbuddy-ai-connector'].env.WB_CONNECTOR_CN_EXE, 'C:\\Apps\\CN\\WorkBuddy.exe');
  assert.equal(result.mcpServers['workbuddy-ai-connector'].args.length, 1);
  assert.equal(original.mcpServers['workbuddy-ai-connector'], undefined);
});
test('uninstall preserves unrelated models including a similar label on another endpoint', () => {
  const other = { id: 'Personal · WorkBuddy AI', url: 'https://example.invalid/chat', apiKey: 'fixture' };
  const installed = mergeModels({ otherSetting: 42, models: [other] }, catalog, 'fixture');
  assert.deepEqual(removeModels(installed), { otherSetting: 42, models: [other] });
});
test('reject unsupported configuration and empty catalog before producing replacements', () => {
  assert.throws(() => mergeModels({ unexpected: true }, catalog, 'fixture'), /unsupported_models_format/);
  assert.throws(() => mergeModels([], [], 'fixture'), /empty_chat_catalog/);
  assert.throws(() => mergeMcp({ mcpServers: [] }, 'cn', 'ai', 'runtime'), /unsupported_mcp_format/);
});
test('failure writing second configuration restores first byte for byte and keeps private backups', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-config-test-'));
  try {
    const first = path.join(root, 'models.json');
    const second = path.join(root, 'mcp.json');
    const original = Buffer.from('[ ]\r\n');
    fs.writeFileSync(first, original);
    fs.writeFileSync(second, '{"keep":true}\n');
    let calls = 0;
    assert.throws(() => writeConfigurations([[first, [1]], [second, { changed: true }]], path.join(root, 'backup'), (file, value) => {
      if (++calls === 2) throw new Error('fixture_second_write_failure');
      fs.writeFileSync(file, JSON.stringify(value));
    }), /fixture_second_write_failure/);
    assert.deepEqual(fs.readFileSync(first), original);
    assert.equal(fs.readFileSync(second, 'utf8'), '{"keep":true}\n');
    assert.deepEqual(fs.readFileSync(path.join(root, 'backup', 'models.json')), original);
  } finally {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
    assert(path.basename(resolved).startsWith('wb-config-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
