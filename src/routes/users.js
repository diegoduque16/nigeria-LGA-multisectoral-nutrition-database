// Sign-in, first-time setup, password links, and user administration.
import { HttpError, json, readJson, validate, v, uid, now, randomToken, sha256, EMAIL_RE } from '../lib/util.js';
import { one, all, run, audit, rateLimit } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, checkPasswordStrength,
  ROLES, ROLE_NAMES, ROLE_LEVEL, MAX_FAILED, LOCK_MS, requireRole, inScope, requireScope,
} from '../lib/auth.js';
import { loadSeedOrgUnits } from './orgunits.js';
import { pendingFor } from './register.js';

const INVITE_DAYS = 7;
const RESET_HOURS = 24;
const ip = (request) => request.headers.get('cf-connecting-ip') || 'local';

// ---------- first-time setup ----------
export async function setupStatus(request, env) {
  const u = await one(env.DB, 'SELECT COUNT(*) AS n FROM users');
  return json({ needsSetup: u.n === 0, setupKeyConfigured: !!env.SETUP_KEY });
}

// Creates the first system administrator. Needs the SETUP_KEY secret and only works while there are no users.
export async function setup(request, env) {
  await rateLimit(env.DB, 'setup:' + ip(request), 10, 3600);
  const body = validate(v.object({
    setupKey: v.string({ min: 1, max: 200 }),
    name: v.string({ min: 1, max: 120 }),
    email: v.string({ min: 3, max: 200, pattern: EMAIL_RE }),
    password: v.string({ min: 1, max: 200, trim: false }),
  }), await readJson(request));
  if (!env.SETUP_KEY) throw new HttpError(409, 'no_setup_key', 'Add a SETUP_KEY secret to the Worker before setting up.');
  if (await sha256(body.setupKey) !== await sha256(env.SETUP_KEY)) throw new HttpError(403, 'bad_setup_key', 'The setup key is not correct.');
  const count = await one(env.DB, 'SELECT COUNT(*) AS n FROM users');
  if (count.n > 0) throw new HttpError(409, 'already_setup', 'This system has already been set up.');
  checkPasswordStrength(body.password);
  await loadSeedOrgUnits(env.DB);
  const root = await one(env.DB, 'SELECT id FROM org_units WHERE level = 1 ORDER BY name LIMIT 1');
  const pw = await hashPassword(body.password);
  const id = uid('u_');
  await run(env.DB, 'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, role, ou_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    id, body.email.toLowerCase(), body.name, pw.hash, pw.salt, pw.iter, 'sysadmin', root.id, now());
  await audit(env.DB, { user: { id }, ip: ip(request) }, 'setup');
  const token = await createSession(env.DB, id, request.headers.get('user-agent'));
  return json({ ok: true }, 201, { 'set-cookie': sessionCookie(token, request) });
}

// ---------- sign in / out ----------
export async function login(request, env) {
  const body = validate(v.object({
    email: v.string({ min: 1, max: 200 }),
    password: v.string({ min: 1, max: 200, trim: false }),
  }), await readJson(request));
  const email = body.email.toLowerCase();
  await rateLimit(env.DB, 'login-ip:' + ip(request), 30, 900);
  const user = await one(env.DB, 'SELECT * FROM users WHERE email = ?', email);
  const fail = () => new HttpError(401, 'bad_login', 'Email or password is not correct.');
  if (!user) {
    // A self-registration that is not approved yet: say so, but only to someone who knows its password.
    const req = await pendingFor(env.DB, email);
    if (req && await verifyPassword(body.password, req)) {
      throw req.status === 'pending'
        ? new HttpError(403, 'pending_approval', 'Your account request is waiting for approval by an administrator. You can sign in once it is approved.')
        : new HttpError(403, 'request_rejected', `Your account request was not approved${req.decision_note ? `: ${req.decision_note}` : '.'} Contact your administrator.`);
    }
    if (!req) await hashPassword(body.password);
    throw fail();
  }
  if (user.locked_until && user.locked_until > now()) {
    const mins = Math.ceil((user.locked_until - now()) / 60000);
    throw new HttpError(423, 'locked', `Too many wrong passwords. This account is locked for ${mins} more minute${mins === 1 ? '' : 's'}.`);
  }
  if (!user.active) throw fail();
  if (!(await verifyPassword(body.password, user))) {
    const n = user.failed_logins + 1;
    await run(env.DB, 'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',
      n >= MAX_FAILED ? 0 : n, n >= MAX_FAILED ? now() + LOCK_MS : null, user.id);
    await audit(env.DB, { user: { id: user.id }, ip: ip(request) }, n >= MAX_FAILED ? 'login_locked' : 'login_failed');
    throw fail();
  }
  await run(env.DB, 'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now(), user.id);
  await audit(env.DB, { user: { id: user.id }, ip: ip(request) }, 'login');
  const token = await createSession(env.DB, user.id, request.headers.get('user-agent'));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token, request) });
}

export async function logout(request, env, ctx) {
  if (ctx && ctx.sessionId) await run(env.DB, 'DELETE FROM sessions WHERE id = ?', ctx.sessionId);
  return json({ ok: true }, 200, { 'set-cookie': clearCookie(request) });
}

export async function me(request, env, ctx) {
  const datasets = await all(env.DB, `SELECT d.id, d.name, d.frequency, d.shared, d.report_level, d.sector_id AS sectorId, s.name AS sector
    FROM datasets d LEFT JOIN sectors s ON s.id = d.sector_id WHERE d.archived_at IS NULL ORDER BY d.shared, s.name, d.name`);
  for (const d of datasets) { d.shared = !!d.shared; d.reportLevel = d.report_level === 4 ? 'UNIT' : 'LGA'; delete d.report_level; }
  const mine = ctx.datasets.length && ctx.role !== 'sysadmin' ? datasets.filter((s) => ctx.datasets.includes(s.id)) : datasets;
  return json({
    user: { ...ctx.user, roleName: ROLE_NAMES[ctx.role] },
    ou: ctx.ou,
    datasets: mine,
    dataElements: ctx.dataElements,
  });
}

export async function changePassword(request, env, ctx) {
  const body = validate(v.object({
    current: v.string({ min: 1, max: 200, trim: false }),
    password: v.string({ min: 1, max: 200, trim: false }),
  }), await readJson(request));
  const user = await one(env.DB, 'SELECT * FROM users WHERE id = ?', ctx.user.id);
  if (!(await verifyPassword(body.current, user))) throw new HttpError(403, 'bad_password', 'Your current password is not correct.');
  checkPasswordStrength(body.password);
  const pw = await hashPassword(body.password);
  await run(env.DB, 'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE id = ?', pw.hash, pw.salt, pw.iter, user.id);
  await run(env.DB, 'DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, ctx.sessionId);
  await audit(env.DB, ctx, 'password_changed');
  return json({ ok: true });
}

// ---------- password links (invite / reset) ----------
async function issueLink(db, userId, purpose) {
  const token = randomToken(32);
  const ms = purpose === 'invite' ? INVITE_DAYS * 86400000 : RESET_HOURS * 3600000;
  await run(db, 'UPDATE password_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL', now(), userId);
  await run(db, 'INSERT INTO password_tokens (id, user_id, purpose, expires_at) VALUES (?,?,?,?)', await sha256(token), userId, purpose, now() + ms);
  return { token, expiresAt: now() + ms };
}
const linkUrl = (request, token) => `${new URL(request.url).origin}/#/set-password/${token}`;

export async function linkInfo(request, env, ctx, { token }) {
  await rateLimit(env.DB, 'link:' + ip(request), 60, 900);
  const row = await one(env.DB,
    `SELECT t.purpose, t.expires_at, t.used_at, u.name, u.email FROM password_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    await sha256(token));
  if (!row || row.used_at || row.expires_at < now()) throw new HttpError(404, 'link_invalid', 'This link has expired or was already used. Ask your administrator for a new one.');
  return json({ purpose: row.purpose, name: row.name, email: row.email });
}

export async function setPassword(request, env, ctx, { token }) {
  await rateLimit(env.DB, 'link:' + ip(request), 60, 900);
  const body = validate(v.object({ password: v.string({ min: 1, max: 200, trim: false }) }), await readJson(request));
  const id = await sha256(token);
  const row = await one(env.DB, 'SELECT * FROM password_tokens WHERE id = ?', id);
  if (!row || row.used_at || row.expires_at < now()) throw new HttpError(404, 'link_invalid', 'This link has expired or was already used. Ask your administrator for a new one.');
  checkPasswordStrength(body.password);
  const pw = await hashPassword(body.password);
  await run(env.DB, 'UPDATE password_tokens SET used_at = ? WHERE id = ?', now(), id);
  await run(env.DB, 'UPDATE users SET pw_hash = ?, pw_salt = ?, pw_iter = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', pw.hash, pw.salt, pw.iter, row.user_id);
  await run(env.DB, 'DELETE FROM sessions WHERE user_id = ?', row.user_id);
  await audit(env.DB, { user: { id: row.user_id }, ip: ip(request) }, 'password_set', 'user', row.user_id, { purpose: row.purpose });
  const sessionToken = await createSession(env.DB, row.user_id, request.headers.get('user-agent'));
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(sessionToken, request) });
}

// ---------- user administration ----------
// System admins manage everyone. State officers manage LGA data-entry users in their own state,
// limited to their own data sets.
function canManage(ctx, target) {
  if (ctx.role === 'sysadmin') return true;
  if (ctx.role === 'state') return ['lga', 'unit'].includes(target.role) && inScope(ctx, target.ou);
  return false;
}

async function userOut(db, u) {
  const datasets = (await all(db, 'SELECT dataset_id FROM user_datasets WHERE user_id = ?', u.id)).map((r) => r.dataset_id);
  const dataElements = (await all(db, 'SELECT de_id FROM user_data_elements WHERE user_id = ?', u.id)).map((r) => r.de_id);
  const ou = await one(db, 'SELECT id, name, level, path FROM org_units WHERE id = ?', u.ou_id);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, roleName: ROLE_NAMES[u.role],
    ou: ou ? { id: ou.id, name: ou.name, level: ou.level, path: ou.path } : null,
    datasets, dataElements, active: !!u.active, passwordSet: !!u.pw_hash,
    locked: !!(u.locked_until && u.locked_until > now()),
    lastLoginAt: u.last_login_at, createdAt: u.created_at,
  };
}

export async function listUsers(request, env, ctx) {
  requireRole(ctx, ['sysadmin', 'state']);
  const rows = await all(env.DB,
    `SELECT u.* FROM users u JOIN org_units o ON o.id = u.ou_id
      WHERE (o.path || '/') LIKE ? ORDER BY u.name LIMIT 2000`, ctx.ou.path + '/%');
  const out = [];
  for (const u of rows) {
    if (ctx.role === 'state' && !['lga', 'unit'].includes(u.role) && u.id !== ctx.user.id) continue;
    out.push(await userOut(env.DB, u));
  }
  return json({ users: out, roles: ROLES.map((r) => ({ id: r, name: ROLE_NAMES[r], level: ROLE_LEVEL[r] })) });
}

const userSchema = (partial) => v.object({
  name: partial ? v.string({ min: 1, max: 120 }).optional() : v.string({ min: 1, max: 120 }),
  email: partial ? v.string({ min: 3, max: 200, pattern: EMAIL_RE }).optional() : v.string({ min: 3, max: 200, pattern: EMAIL_RE }),
  role: partial ? v.string({ oneOf: ROLES }).optional() : v.string({ oneOf: ROLES }),
  ouId: partial ? v.string({ min: 11, max: 11 }).optional() : v.string({ min: 11, max: 11 }),
  datasets: v.array(v.string({ min: 1, max: 40 }), { max: 50 }).optional(),
  dataElements: v.array(v.string({ min: 1, max: 40 }), { max: 500 }).optional(),
  active: v.boolean().optional(),
});

async function checkAssignment(db, ctx, role, ouId, datasets, dataElements) {
  const ou = await one(db, 'SELECT id, name, level, path FROM org_units WHERE id = ?', ouId);
  if (!ou) throw new HttpError(422, 'invalid', 'Organisation unit not found.', { field: 'ouId' });
  const lvl = ROLE_LEVEL[role];
  if (lvl && ou.level !== lvl) {
    const where = { 1: 'the country', 2: 'a state', 3: 'an LGA', 4: 'a unit (school, facility …)' }[lvl];
    throw new HttpError(422, 'invalid', `A ${ROLE_NAMES[role]} must be attached to ${where}.`, { field: 'ouId' });
  }
  requireScope(ctx, ou);
  if (datasets) {
    for (const s of datasets) {
      if (!(await one(db, 'SELECT id FROM datasets WHERE id = ?', s))) throw new HttpError(422, 'invalid', 'Unknown data set.', { field: 'datasets' });
      if (ctx.role !== 'sysadmin' && ctx.datasets.length && !ctx.datasets.includes(s)) throw new HttpError(403, 'forbidden', 'You can only assign your own data sets.');
    }
  }
  if (dataElements) {
    for (const d of dataElements) {
      const de = await one(db, 'SELECT dataset_id FROM data_elements WHERE id = ?', d);
      if (!de) throw new HttpError(422, 'invalid', 'Unknown numerator/denominator.', { field: 'dataElements' });
      if (datasets && datasets.length && !datasets.includes(de.dataset_id)) {
        throw new HttpError(422, 'invalid', 'A chosen numerator/denominator is not in the account’s data sets.', { field: 'dataElements' });
      }
    }
  }
  return ou;
}

async function setAssignments(db, userId, datasets, dataElements) {
  if (datasets) {
    await run(db, 'DELETE FROM user_datasets WHERE user_id = ?', userId);
    for (const s of datasets) await run(db, 'INSERT INTO user_datasets (user_id, dataset_id) VALUES (?, ?)', userId, s);
  }
  if (dataElements) {
    await run(db, 'DELETE FROM user_data_elements WHERE user_id = ?', userId);
    for (const d of dataElements) await run(db, 'INSERT INTO user_data_elements (user_id, de_id) VALUES (?, ?)', userId, d);
  }
}

export async function createUser(request, env, ctx) {
  requireRole(ctx, ['sysadmin', 'state']);
  const body = validate(userSchema(false), await readJson(request));
  if (ctx.role === 'state' && !['lga', 'unit'].includes(body.role)) throw new HttpError(403, 'forbidden', 'State officers can only create LGA or unit data-entry users.');
  const ou = await checkAssignment(env.DB, ctx, body.role, body.ouId, body.datasets, body.dataElements);
  let datasets = body.datasets || [];
  if (ctx.role === 'state' && !datasets.length) datasets = ctx.datasets;
  const email = body.email.toLowerCase();
  if (await one(env.DB, 'SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken', 'A user with this email already exists.');
  const id = uid('u_');
  await run(env.DB, 'INSERT INTO users (id, email, name, role, ou_id, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
    id, email, body.name, body.role, ou.id, ctx.user.id, now());
  await setAssignments(env.DB, id, datasets, body.dataElements || []);
  const link = await issueLink(env.DB, id, 'invite');
  await audit(env.DB, ctx, 'user_created', 'user', id, { email, role: body.role, ou: ou.id });
  const u = await one(env.DB, 'SELECT * FROM users WHERE id = ?', id);
  return json({ user: await userOut(env.DB, u), link: linkUrl(request, link.token), linkExpiresAt: link.expiresAt }, 201);
}

async function loadTarget(db, ctx, id) {
  const u = await one(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!u) throw new HttpError(404, 'not_found', 'User not found.');
  const ou = await one(db, 'SELECT id, path FROM org_units WHERE id = ?', u.ou_id);
  if (!canManage(ctx, { role: u.role, ou })) throw new HttpError(403, 'forbidden', 'You cannot manage this user.');
  return u;
}

export async function updateUser(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin', 'state']);
  const u = await loadTarget(env.DB, ctx, id);
  const body = validate(userSchema(true), await readJson(request));
  if (id === ctx.user.id && (body.active === false || (body.role && body.role !== u.role))) {
    throw new HttpError(409, 'self', 'You cannot deactivate yourself or change your own role.');
  }
  const role = body.role || u.role;
  if (ctx.role === 'state' && !['lga', 'unit'].includes(role)) throw new HttpError(403, 'forbidden', 'State officers can only manage LGA or unit data-entry users.');
  const ouId = body.ouId || u.ou_id;
  if (body.role || body.ouId || body.datasets || body.dataElements) await checkAssignment(env.DB, ctx, role, ouId, body.datasets, body.dataElements);
  if (body.email && body.email.toLowerCase() !== u.email) {
    if (await one(env.DB, 'SELECT id FROM users WHERE email = ?', body.email.toLowerCase())) throw new HttpError(409, 'email_taken', 'A user with this email already exists.');
  }
  await run(env.DB, 'UPDATE users SET name = ?, email = ?, role = ?, ou_id = ?, active = ? WHERE id = ?',
    body.name ?? u.name, body.email ? body.email.toLowerCase() : u.email, role, ouId,
    body.active === undefined ? u.active : body.active ? 1 : 0, id);
  await setAssignments(env.DB, id, body.datasets, body.dataElements);
  if (body.active === false) await run(env.DB, 'DELETE FROM sessions WHERE user_id = ?', id);
  await audit(env.DB, ctx, 'user_updated', 'user', id, body);
  return json({ user: await userOut(env.DB, await one(env.DB, 'SELECT * FROM users WHERE id = ?', id)) });
}

// New one-time link to set a password (also unlocks the account).
export async function resetLink(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin', 'state']);
  const u = await loadTarget(env.DB, ctx, id);
  const link = await issueLink(env.DB, id, u.pw_hash ? 'reset' : 'invite');
  await run(env.DB, 'UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', id);
  await audit(env.DB, ctx, 'reset_link', 'user', id);
  return json({ link: linkUrl(request, link.token), linkExpiresAt: link.expiresAt });
}

// ---------- audit log ----------
export async function auditLog(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const url = new URL(request.url);
  const before = Number(url.searchParams.get('before')) || now() + 1;
  const rows = await all(env.DB,
    `SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.created_at < ? ORDER BY a.created_at DESC LIMIT 200`, before);
  return json({ entries: rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) });
}

// ---------- API tokens (for automated exports) ----------
export async function listTokens(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const rows = await all(env.DB,
    `SELECT t.id, t.name, t.ou_id, o.name AS ou_name, t.created_at, t.last_used_at, t.revoked_at
       FROM api_tokens t JOIN org_units o ON o.id = t.ou_id ORDER BY t.created_at DESC`);
  return json({ tokens: rows.map((r) => ({ ...r, id: r.id.slice(0, 12) })) });
}

export async function createToken(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const body = validate(v.object({ name: v.string({ min: 1, max: 100 }), ouId: v.string({ min: 11, max: 11 }) }), await readJson(request));
  const ou = await one(env.DB, 'SELECT id, level FROM org_units WHERE id = ?', body.ouId);
  if (!ou || ou.level > 2) throw new HttpError(422, 'invalid', 'Choose the country or a state.', { field: 'ouId' });
  const token = 'lga_' + randomToken(32);
  const id = await sha256(token);
  await run(env.DB, 'INSERT INTO api_tokens (id, name, created_by, ou_id, created_at) VALUES (?,?,?,?,?)', id, body.name, ctx.user.id, ou.id, now());
  await audit(env.DB, ctx, 'token_created', 'api_token', id.slice(0, 12), { name: body.name });
  return json({ token, id: id.slice(0, 12) }, 201);
}

export async function revokeToken(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin']);
  const r = await run(env.DB, 'UPDATE api_tokens SET revoked_at = ? WHERE substr(id, 1, 12) = ? AND revoked_at IS NULL', now(), id);
  if (!r.meta.changes) throw new HttpError(404, 'not_found', 'Token not found.');
  await audit(env.DB, ctx, 'token_revoked', 'api_token', id);
  return json({ ok: true });
}
