'use strict';
// Reuses the signed-in account and refreshes in memory. No account-token cache file.
const { credentials, request } = require('./probe.cjs');
let memory; let pending; let refreshStatus;
function expiry(auth) {
  let value = Number(auth.expiresAt);
  if (value > 0) return value < 1e12 ? value * 1000 : value;
  try { return Number(JSON.parse(Buffer.from(auth.access.split('.')[1], 'base64url')).exp) * 1000; } catch { return 0; }
}
async function current(force = false) {
  const desktop = credentials(true);
  const selected = memory?.uid === desktop.uid && expiry(memory) > expiry(desktop) ? memory : desktop;
  if (!force && expiry(selected) > Date.now() + 120000) return selected;
  pending ||= (async () => {
    const r = await request('/v2/plugin/auth/token/refresh', selected, { method: 'POST', headers: { 'X-Refresh-Token': selected.refresh, 'X-Auth-Refresh-Source': 'workbuddy' } });
    let d; try { d = JSON.parse(r.body); } catch {}
    if (r.status !== 200 || d?.code !== 0 || typeof d.data?.accessToken !== 'string') throw new Error('international_sign_in_refresh_failed');
    const result = d.data;
    memory = { ...selected, access: result.accessToken, refresh: result.refreshToken || selected.refresh, expiresAt: result.expiresIn ? Date.now() + Number(result.expiresIn) * 1000 : undefined, domain: typeof result.domain === 'string' && result.domain.includes('workbuddy.ai') ? result.domain : selected.domain };
    refreshStatus = { at: new Date().toISOString(), success: true, receivedRefreshToken: Boolean(result.refreshToken), refreshTokenChanged: Boolean(result.refreshToken && result.refreshToken !== selected.refresh), secondsUntilExpiry: Math.floor((expiry(memory) - Date.now()) / 1000), persistedAccountCredentials: false };
    return memory;
  })().finally(() => { pending = undefined; });
  return pending;
}
module.exports = { current, expiry, refreshStatus: () => refreshStatus };
