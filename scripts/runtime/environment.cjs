'use strict';
const path = require('node:path');
const PORT = 17781;
const CONNECTOR = 'workbuddy-ai-connector';
function paths(env = process.env) {
  if (!env.LOCALAPPDATA || !env.USERPROFILE) throw new Error('windows_profile_required');
  return {
    root: path.join(env.LOCALAPPDATA, 'WorkBuddyAIConnector'),
    cnHome: path.join(env.USERPROFILE, '.workbuddy'),
    cnExe: env.WB_CONNECTOR_CN_EXE,
    aiExe: env.WB_CONNECTOR_AI_EXE,
  };
}
function requireExecutables(env = process.env) {
  const p = paths(env);
  if (!p.cnExe || !p.aiExe) throw new Error('both_installation_paths_required');
  return p;
}
module.exports = { paths, requireExecutables, PORT, CONNECTOR };
