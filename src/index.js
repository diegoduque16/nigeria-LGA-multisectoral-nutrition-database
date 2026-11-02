// LGA Multi-Sectoral Scorecard Data Reporting System — Worker entry: API router and the static app (via Assets).
import { HttpError, json, errorResponse } from './lib/util.js';
import { loadContext, checkCsrf } from './lib/auth.js';
import { run } from './lib/db.js';
import * as users from './routes/users.js';
import * as orgunits from './routes/orgunits.js';
import * as meta from './routes/metadata.js';
import * as entry from './routes/entry.js';
import * as pic from './routes/picture.js';
import * as units from './routes/units.js';
import * as pop from './routes/popimport.js';
import * as pv from './routes/pivot.js';
import * as reg from './routes/register.js';
import * as wp from './routes/worldpop.js';
import * as rem from './routes/reminders.js';

// [method, path, handler, access]  access: 'public' | 'optional' | 'session'
const ROUTES = [
  ['GET', '/api/setup', users.setupStatus, 'public'],
  ['POST', '/api/setup', users.setup, 'public'],
  ['POST', '/api/auth/login', users.login, 'public'],
  ['POST', '/api/auth/logout', users.logout, 'optional'],
  ['GET', '/api/password-links/:token', users.linkInfo, 'public'],
  ['POST', '/api/password-links/:token', users.setPassword, 'public'],
  ['GET', '/api/register/:token', reg.registrationInfo, 'public'],
  ['GET', '/api/register/:token/places', reg.registrationPlaces, 'public'],
  ['POST', '/api/register/:token', reg.submitRegistration, 'public'],
  ['GET', '/api/registration-links', reg.listLinks, 'session'],
  ['POST', '/api/registration-links', reg.createLink, 'session'],
  ['DELETE', '/api/registration-links/:id', reg.revokeLink, 'session'],
  ['GET', '/api/account-requests', reg.listRequests, 'session'],
  ['POST', '/api/account-requests/:id/approve', reg.approveRequest, 'session'],
  ['POST', '/api/account-requests/:id/reject', reg.rejectRequest, 'session'],
  ['GET', '/api/me', users.me, 'session'],
  ['POST', '/api/me/password', users.changePassword, 'session'],

  ['GET', '/api/users', users.listUsers, 'session'],
  ['POST', '/api/users', users.createUser, 'session'],
  ['PATCH', '/api/users/:id', users.updateUser, 'session'],
  ['POST', '/api/users/:id/reset-link', users.resetLink, 'session'],
  ['GET', '/api/audit', users.auditLog, 'session'],
  ['GET', '/api/tokens', users.listTokens, 'session'],
  ['POST', '/api/tokens', users.createToken, 'session'],
  ['DELETE', '/api/tokens/:id', users.revokeToken, 'session'],

  ['GET', '/api/orgunits', orgunits.listOrgUnits, 'session'],
  ['POST', '/api/orgunits/import', orgunits.importOrgUnits, 'session'],
  ['PUT', '/api/rollout', orgunits.setRollout, 'session'],
  ['GET', '/api/units', units.listUnits, 'session'],
  ['POST', '/api/units', units.createUnit, 'session'],
  ['POST', '/api/units/import', units.importUnits, 'session'],
  ['PATCH', '/api/units/:id', units.updateUnit, 'session'],
  ['GET', '/api/unit-types', units.listTypes, 'session'],
  ['POST', '/api/unit-types', units.createType, 'session'],
  ['PATCH', '/api/unit-types/:id', units.updateType, 'session'],
  ['DELETE', '/api/unit-types/:id', units.deleteType, 'session'],

  ['GET', '/api/metadata', meta.getMetadata, 'session'],
  ['POST', '/api/sectors', meta.createSector, 'session'],
  ['PATCH', '/api/sectors/:id', meta.updateSector, 'session'],
  ['DELETE', '/api/sectors/:id', meta.deleteSector, 'session'],
  ['POST', '/api/datasets', meta.createDataset, 'session'],
  ['PATCH', '/api/datasets/:id', meta.updateDataset, 'session'],
  ['DELETE', '/api/datasets/:id', meta.deleteDataset, 'session'],
  ['POST', '/api/datasets/:datasetId/indicators', meta.createIndicator, 'session'],
  ['PATCH', '/api/indicators/:id', meta.updateIndicator, 'session'],
  ['DELETE', '/api/indicators/:id', meta.deleteIndicator, 'session'],
  ['POST', '/api/datasets/:datasetId/fields', meta.createDataElement, 'session'],
  ['GET', '/api/datasets/:id/population', pop.populationTable, 'session'],
  ['POST', '/api/datasets/:id/population', pop.importPopulation, 'session'],
  ['PATCH', '/api/fields/:id', meta.updateDataElement, 'session'],
  ['GET', '/api/worldpop', wp.worldpopStatus, 'session'],
  ['GET', '/api/worldpop/table', wp.worldpopTable, 'session'],
  ['POST', '/api/worldpop/table', wp.worldpopTable, 'session'],
  ['POST', '/api/worldpop/imported', wp.worldpopImported, 'session'],

  ['GET', '/api/entry', entry.getEntry, 'session'],
  ['GET', '/api/entry/sheet', entry.entrySheet, 'session'],
  ['GET', '/api/reminders', rem.reminderList, 'session'],
  ['POST', '/api/reminders', rem.sendReminders, 'session'],
  ['PUT', '/api/entry', entry.saveEntry, 'session'],
  ['POST', '/api/entry/submit', entry.submitEntry, 'session'],
  ['POST', '/api/entry/review', entry.reviewEntry, 'session'],
  ['GET', '/api/status', entry.reportStatus, 'session'],

  ['GET', '/api/picture', pic.picture, 'session'],
  ['GET', '/api/pivot', pv.pivot, 'session'],
  ['GET', '/api/export/metadata', pic.exportMetadata, 'session'],
  ['GET', '/api/export/data', pic.exportData, 'session'],

  ['GET', '/api/health', async (req, env) => {
    const r = await env.DB.prepare('SELECT 1 AS ok').first();
    return json({ ok: !!r && r.ok === 1, time: new Date().toISOString() });
  }, 'public'],
];

const compiled = ROUTES.map(([method, path, handler, access]) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  return { method, re, keys, handler, access };
});

// API tokens may only read exports.
const TOKEN_PATHS = ['/api/export/metadata', '/api/export/data', '/api/metadata', '/api/orgunits'];

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; connect-src 'self' https://www.malariascorecard.org; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function withHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!r.headers.has(k)) r.headers.set(k, v);
  return r;
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) {
    if (env.ASSETS) return withHeaders(await env.ASSETS.fetch(request));
    return new Response('Not found', { status: 404 });
  }
  try {
    let pathMatched = false;
    for (const r of compiled) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== request.method) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const bearer = (request.headers.get('authorization') || '').startsWith('Bearer ');
      if (!bearer) checkCsrf(request);
      let ctx = null;
      if (r.access !== 'public') {
        ctx = await loadContext(request, env.DB);
        if (!ctx && r.access !== 'optional') throw new HttpError(401, 'signed_out', 'Please sign in.');
        if (ctx && ctx.apiToken && (request.method !== 'GET' || !TOKEN_PATHS.includes(path))) throw new HttpError(403, 'forbidden', 'API tokens can only download exports.');
        if (ctx) ctx.ip = request.headers.get('cf-connecting-ip') || null;
      }
      return withHeaders(await r.handler(request, env, ctx, params));
    }
    if (pathMatched) throw new HttpError(405, 'method', 'Method not allowed.');
    throw new HttpError(404, 'not_found', 'Not found.');
  } catch (e) {
    return withHeaders(errorResponse(e));
  }
}

// Daily housekeeping: expired sessions, used links, old rate-limit rows.
export async function housekeeping(env) {
  const t = Date.now();
  await run(env.DB, 'DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?', t, t - 8 * 3600000);
  await run(env.DB, 'DELETE FROM password_tokens WHERE expires_at < ?', t - 30 * 86400000);
  await run(env.DB, 'DELETE FROM rate_limits WHERE window_start < ?', t - 86400000);
}

export default {
  fetch: (request, env) => handle(request, env),
  async scheduled(event, env, execCtx) {
    execCtx.waitUntil(housekeeping(env).catch((e) => console.error('housekeeping failed', e)));
    // Look for newer GRID3 / WorldPop population releases (shown on the Population figures page).
    execCtx.waitUntil(wp.checkWorldPop(env).catch((e) => console.error('WorldPop check failed', e)));
  },
};
