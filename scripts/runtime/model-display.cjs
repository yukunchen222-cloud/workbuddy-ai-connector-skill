'use strict';
const PREFIX = 'workbuddy-ai/';
const SUFFIX = ' · WorkBuddy AI';
const CONNECTOR = 'workbuddy-ai-connector';
const { contextSettings } = require('./context-settings.cjs');
function stripLocal(id) { return String(id || '').replace(/^custom-local:/, ''); }
function label(model, catalog) {
  let name = model.name || model.id;
  // The account catalog has two Flash routes with the same name.
  if (model.id.endsWith('-sg') && catalog.some(other => other.id !== model.id && other.name === model.name)) name += ' (SG)';
  return name + SUFFIX;
}
function owned(model) {
  const id = stripLocal(model?.id);
  return model?.connectorId === CONNECTOR || id.startsWith(PREFIX)
    || (id.endsWith(SUFFIX) && model?.url === 'http://127.0.0.1:17781/v1/chat/completions');
}
function resolveModel(requested, catalog) {
  const id = stripLocal(requested);
  if (id.startsWith(PREFIX)) return id.slice(PREFIX.length);
  return catalog.find(model => label(model, catalog) === id)?.id || id;
}
function presentation(model, catalog) {
  const name = label(model, catalog);
  const contextWindow = contextSettings(model);
  return {
    id: name, name, connectorId: CONNECTOR, workbuddyAiModelId: model.id,
    aliases: [PREFIX + model.id, 'custom-local:' + PREFIX + model.id],
    credits: model.credits, tags: model.tags || [],
    ...(contextWindow ? { contextWindow } : {}),
  };
}
module.exports = { label, owned, resolveModel, presentation };
