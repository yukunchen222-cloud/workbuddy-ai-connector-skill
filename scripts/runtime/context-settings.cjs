'use strict';
const ONE_M = 1000000;
function contextSettings(model) {
  const source = model.contextWindow;
  const valid = value => Number.isSafeInteger(value) && value > 0 && (!Number.isFinite(model.maxInputTokens) || value <= model.maxInputTokens);
  const supported = Array.isArray(source?.supportedLengths) ? [...new Set(source.supportedLengths.filter(valid))] : [];
  if (!supported.length && Number(model.maxInputTokens) >= ONE_M) supported.push(ONE_M);
  if (!supported.length) return undefined;
  const originalDefault = valid(source?.defaultLength) && supported.includes(source.defaultLength) ? source.defaultLength : supported[0];
  return { ...source, supportedLengths: supported, defaultLength: supported.includes(ONE_M) ? ONE_M : originalDefault };
}
module.exports = { contextSettings, ONE_M };
