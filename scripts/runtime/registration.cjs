'use strict';
const path = require('node:path');
const { owned, presentation } = require('./model-display.cjs');
const { freeFirst } = require('./free-priority.cjs');
const { CONNECTOR } = require('./environment.cjs');
function chatModel(model) {
  return !model.tags?.some(tag => ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video'].includes(tag));
}
function mergeModels(document, catalog, localKey) {
  const current = Array.isArray(document) ? document : document?.models;
  if (!Array.isArray(current)) throw new Error('unsupported_models_format');
  const additions = freeFirst(catalog.filter(chatModel)).map(model => ({
    ...presentation(model, catalog), vendor: 'WorkBuddy AI',
    url: 'http://127.0.0.1:17781/v1/chat/completions', apiKey: localKey, useCustomProtocol: true,
    supportsToolCall: model.supportsToolCall === true, supportsImages: model.supportsImages === true,
    supportsReasoning: model.supportsReasoning === true,
    maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens,
    description: `WorkBuddy AI account model: ${model.id}. ${model.credits || ''}`,
  }));
  if (!additions.length) throw new Error('empty_chat_catalog');
  if (new Set(additions.map(m => m.id)).size !== additions.length) throw new Error('duplicate_model_labels');
  const models = [...current.filter(m => !owned(m)), ...additions];
  return Array.isArray(document) ? models : { ...document, models };
}
function mergeMcp(document, cnExe, aiExe, runtimeDirectory) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || (document.mcpServers && (typeof document.mcpServers !== 'object' || Array.isArray(document.mcpServers)))) throw new Error('unsupported_mcp_format');
  return { ...document, mcpServers: { ...document.mcpServers, [CONNECTOR]: {
    command: aiExe, args: [path.join(runtimeDirectory, 'mcp-launcher.cjs')],
    env: { ELECTRON_RUN_AS_NODE: '1', WB_CONNECTOR_CN_EXE: cnExe, WB_CONNECTOR_AI_EXE: aiExe },
  } } };
}
function removeModels(document) {
  if (Array.isArray(document)) return document.filter(model => !owned(model));
  if (Array.isArray(document?.models)) return { ...document, models: document.models.filter(model => !owned(model)) };
  throw new Error('unsupported_models_format');
}
module.exports = { chatModel, mergeModels, mergeMcp, removeModels };
