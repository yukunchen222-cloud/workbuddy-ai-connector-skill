'use strict';
function zeroCredits(value) {
  if (typeof value === 'number') return value === 0;
  return /^\s*x?\s*0+(?:\.0+)?\s*(?:x|credits)?\s*$/i.test(String(value ?? ''));
}
function freeFirst(models) { return [...models].sort((a, b) => Number(zeroCredits(b.credits)) - Number(zeroCredits(a.credits))); }
module.exports = { zeroCredits, freeFirst };
