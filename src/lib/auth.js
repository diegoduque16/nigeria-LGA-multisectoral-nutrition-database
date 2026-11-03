// Passwords, sessions, lockout, CSRF, roles and org-unit scope.
import { HttpError, b64url, b64urlDecode, randomToken, sha256, now } from './util.js';
import { one, all, run } from './db.js';

const PBKDF2_ITER = 100_000;          // Workers' maximum for PBKDF2
const SESSION_IDLE_MS = 8 * 3600000;  // signed out after 8 hours without activity
const SESSION_MAX_MS = 7 * 86400000;  // and always after 7 days
export const COOKIE = 'lga_session';
export const MAX_FAILED = 5;
export const LOCK_MS = 15 * 60000;

export const ROLES = ['sysadmin', 'setupadmin', 'state', 'lga', 'unit', 'viewer'];
export const ROLE_NAMES = {
  sysadmin: 'System administrator',
  setupadmin: 'Administrator',
  state: 'Data entry — state',
  lga: 'Data entry — LGA',
  unit: 'Data entry — school / facility',
  viewer: 'Viewer',
};
// Org-unit level each role is attached to.
export const ROLE_LEVEL = { sysadmin: 1, setupadmin: 1, state: 2, lga: 3, unit: 4, viewer: null };

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(422, 'weak_password', 'Password must be at least 10 characters.');
  if (pw.length > 200) throw new HttpError(422, 'weak_password', 'Password is too long.');
  if (/^(.)\1+$/.test(pw) || /^(password|1234567890|qwertyuiop)/i.test(pw)) throw new HttpError(422, 'weak_password', 'Please choose a less common password.');
}

export async function hashPassword(password, saltB64 = null, iter = PBKDF2_ITER) {
  const salt = saltB64 ? b64urlDecode(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return { hash: b64url(bits), salt: b64url(salt), iter };
}

export async function verifyPassword(password, user) {
  if (!user.pw_hash) return false;
  const { hash } = await hashPassword(password, user.pw_salt, user.pw_iter);
  if (hash.length !== user.pw_hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ user.pw_hash.charCodeAt(i);
  return diff === 0;
}

export async function createSession(db, userId, userAgent = '') {
  const token = randomToken(32);
  const id = await sha256(token);
  const t = now();
  await run(db, 'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, user_agent) VALUES (?,?,?,?,?,?)',
    id, userId, t, t + SESSION_MAX_MS, t, String(userAgent).slice(0, 200));
  return token;
}

const secureFlag = (request) => (new URL(request.url).protocol === 'https:' ? '; Secure' : '');
export const sessionCookie = (token, request) => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_MS / 1000}${secureFlag(request)}`;
export const clearCookie = (request) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag(request)}`;

function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

// Mutating requests need our custom header (blocks cross-site form posts) and a same-origin Origin.
export function checkCsrf(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.headers.get('x-lga') !== '1') throw new HttpError(403, 'csrf', 'Request blocked for security reasons.');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'csrf', 'Request blocked for security reasons.');
}

async function userContext(db, row) {
  const ou = await one(db, 'SELECT id, name, level, path FROM org_units WHERE id = ?', row.ou_id);
  const datasets = (await all(db, 'SELECT dataset_id FROM user_datasets WHERE user_id = ?', row.id)).map((r) => r.dataset_id);
  const dataElements = (await all(db, 'SELECT de_id FROM user_data_elements WHERE user_id = ?', row.id)).map((r) => r.de_id);
  return {
    user: { id: row.id, email: row.email, name: row.name, role: row.role },
    role: row.role,
    ou,
    datasets,      // empty list = all data sets
    dataElements,  // empty list = every numerator/denominator in those data sets
  };
}

// Returns a request context { user, role, ou, datasets, dataElements, sessionId } or null.
export async function loadContext(request, db) {
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return loadApiToken(db, auth.slice(7).trim());
  const token = readCookie(request, COOKIE);
  if (!token || token.length > 100) return null;
  const id = await sha256(token);
  const row = await one(db,
    `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.id, u.email, u.name, u.role, u.ou_id, u.active
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`, id);
  if (!row) return null;
  const t = now();
  if (row.expires_at < t || row.last_seen_at + SESSION_IDLE_MS < t || !row.active) {
    await run(db, 'DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  if (t - row.last_seen_at > 60000) await run(db, 'UPDATE sessions SET last_seen_at = ? WHERE id = ?', t, id);
  return { ...(await userContext(db, row)), sessionId: row.sid };
}

// API tokens (for scheduled exports) act as a read-only viewer scoped to one org unit.
async function loadApiToken(db, token) {
  if (!token || token.length > 100) return null;
  const id = await sha256(token);
  const row = await one(db, 'SELECT id, name, ou_id, revoked_at FROM api_tokens WHERE id = ?', id);
  if (!row || row.revoked_at) return null;
  await run(db, 'UPDATE api_tokens SET last_used_at = ? WHERE id = ?', now(), id);
  const ou = await one(db, 'SELECT id, name, level, path FROM org_units WHERE id = ?', row.ou_id);
  return { user: { id: 'token:' + row.id.slice(0, 8), name: row.name, role: 'viewer' }, role: 'viewer', ou, datasets: [], dataElements: [], apiToken: true };
}

export function requireRole(ctx, roles) {
  if (!roles.includes(ctx.role)) throw new HttpError(403, 'forbidden', 'You do not have permission to do that.');
}

// Org-unit scope: a user sees their own org unit and everything below it.
export const inScope = (ctx, ou) => !!ou && (ou.path + '/').startsWith(ctx.ou.path + '/');
export function requireScope(ctx, ou) {
  if (!inScope(ctx, ou)) throw new HttpError(403, 'out_of_scope', 'That organisation unit is outside your area.');
}
export const datasetAllowed = (ctx, id) => ctx.role === 'sysadmin' || ctx.datasets.length === 0 || ctx.datasets.includes(id);
export function requireDataset(ctx, id) {
  if (!datasetAllowed(ctx, id)) throw new HttpError(403, 'forbidden', 'You are not assigned to this data set.');
}
// Whether the account may type values into this numerator/denominator.
export const canEnterElement = (ctx, deId) => ctx.role === 'sysadmin' || ctx.dataElements.length === 0 || ctx.dataElements.includes(deId);
