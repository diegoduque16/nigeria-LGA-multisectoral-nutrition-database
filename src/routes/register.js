// Self-registration with approval:
//   1. an administrator (or state officer) creates a registration link and shares it as a QR code;
//   2. people open it, fill in their details, choose where they work and a password;
//   3. an administrator approves (an account is created) or rejects the request.
import { HttpError, json, readJson, validate, v, uid, now, randomToken, EMAIL_RE } from '../lib/util.js';
import { one, all, run, audit, rateLimit } from '../lib/db.js';
import { hashPassword, checkPasswordStrength, ROLE_NAMES, ROLE_LEVEL, requireRole, inScope, requireManager, rolesManagedBy } from '../lib/auth.js';

// Roles people may ask for through a link (administrators are never self-registered).
const SELF_ROLES = ['lga', 'unit', 'state', 'viewer'];
const ip = (request) => request.headers.get('cf-connecting-ip') || 'local';

async function ouById(db, id) { return id ? one(db, 'SELECT id, name, level, path, parent_id, closed_at, sector_id FROM org_units WHERE id = ?', id) : null; }

// ---------- links (admin) ----------
const linkOut = async (db, l, request) => {
  const ou = await ouById(db, l.ou_id);
  const c = await one(db, `SELECT SUM(status = 'pending') AS pending, SUM(status = 'approved') AS approved, COUNT(*) AS total FROM account_requests WHERE link_id = ?`, l.id);
  return {
    id: l.id, name: l.name, url: `${new URL(request.url).origin}/#/register/${l.id}`,
    area: ou ? { id: ou.id, name: ou.name, level: ou.level } : null, role: l.role, datasets: JSON.parse(l.datasets || '[]'),
    sector: l.sector_id ? ((await one(db, 'SELECT name FROM sectors WHERE id = ?', l.sector_id)) || {}).name || null : null,
    maxUses: l.max_uses, uses: l.uses, expiresAt: l.expires_at, revoked: !!l.revoked_at,
    active: !l.revoked_at && l.expires_at > now() && (l.max_uses === null || l.uses < l.max_uses),
    requests: { pending: c.pending || 0, approved: c.approved || 0, total: c.total || 0 }, createdAt: l.created_at,
  };
};

export async function listLinks(request, env, ctx) {
  requireManager(ctx);
  const rows = await all(env.DB, 'SELECT l.*, o.path FROM registration_links l JOIN org_units o ON o.id = l.ou_id ORDER BY l.created_at DESC LIMIT 200');
  const out = [];
  for (const l of rows) if (inScope(ctx, l)) out.push(await linkOut(env.DB, l, request));
  return json({ links: out });
}

export async function createLink(request, env, ctx) {
  requireManager(ctx);
  const body = validate(v.object({
    name: v.string({ max: 120 }).optional(),
    ouId: v.string({ min: 11, max: 11 }),
    role: v.string({ oneOf: SELF_ROLES }).optional(),
    sectorId: v.string({ min: 1, max: 20 }).optional(),
    datasets: v.array(v.string({ min: 1, max: 20 }), { max: 50 }).optional(),
    days: v.number({ int: true, min: 1, max: 365 }).default(30),
    maxUses: v.number({ int: true, min: 1, max: 10000 }).optional(),
  }), await readJson(request));
  const ou = await ouById(env.DB, body.ouId);
  if (!ou || ou.level > 3) throw new HttpError(422, 'invalid', 'Choose the country, a state or an LGA.', { field: 'ouId' });
  if (!inScope(ctx, ou)) throw new HttpError(403, 'out_of_scope', 'That area is outside your account.');
  if (body.role && !rolesManagedBy(ctx).includes(body.role)) throw new HttpError(403, 'forbidden', 'You can invite data-entry users at your level and below.');
  for (const d of body.datasets || []) if (!(await one(env.DB, 'SELECT id FROM datasets WHERE id = ?', d))) throw new HttpError(422, 'invalid', 'Unknown data set.', { field: 'datasets' });
  if (body.sectorId && !(await one(env.DB, 'SELECT id FROM sectors WHERE id = ?', body.sectorId))) throw new HttpError(422, 'invalid', 'Unknown sector.', { field: 'sectorId' });
  // No name given: one is made from the area, the sector and the date.
  if (!body.name) {
    const sec = body.sectorId ? await one(env.DB, 'SELECT name FROM sectors WHERE id = ?', body.sectorId) : null;
    body.name = `${ou.name}${sec ? ' · ' + sec.name : ''} · ${new Date().toISOString().slice(0, 10)}`;
  }
  const id = randomToken(18);
  await run(env.DB, 'INSERT INTO registration_links (id, name, ou_id, role, sector_id, datasets, max_uses, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, body.name, ou.id, body.role || null, body.sectorId || null, JSON.stringify(body.datasets || []), body.maxUses ?? null, now() + body.days * 86400000, ctx.user.id, now());
  await audit(env.DB, ctx, 'registration_link_created', 'registration_link', id.slice(0, 8), { name: body.name, area: ou.id });
  return json({ link: await linkOut(env.DB, await one(env.DB, 'SELECT * FROM registration_links WHERE id = ?', id), request) }, 201);
}

export async function revokeLink(request, env, ctx, { id }) {
  requireManager(ctx);
  const l = await one(env.DB, 'SELECT l.*, o.path FROM registration_links l JOIN org_units o ON o.id = l.ou_id WHERE l.id = ?', id);
  if (!l || !inScope(ctx, l)) throw new HttpError(404, 'not_found', 'Link not found.');
  await run(env.DB, 'UPDATE registration_links SET revoked_at = ? WHERE id = ?', now(), id);
  await audit(env.DB, ctx, 'registration_link_revoked', 'registration_link', id.slice(0, 8));
  return json({ ok: true });
}

// ---------- public registration page ----------
async function activeLink(db, token) {
  const l = token && token.length <= 40 ? await one(db, 'SELECT * FROM registration_links WHERE id = ?', token) : null;
  if (!l || l.revoked_at || l.expires_at < now() || (l.max_uses !== null && l.uses >= l.max_uses)) {
    throw new HttpError(404, 'link_invalid', 'This registration link is no longer valid. Ask the person who shared it for a new one.');
  }
  const area = await ouById(db, l.ou_id);
  const st = area.level >= 2 ? await one(db, 'SELECT inactive FROM org_units WHERE id = ?', area.path.split('/')[2]) : null;
  if (st && st.inactive) throw new HttpError(404, 'link_invalid', 'Registration for this state has not opened yet.');
  return { link: l, area };
}
const allowedRoles = (area) => SELF_ROLES.filter((r) => ROLE_LEVEL[r] === null || ROLE_LEVEL[r] >= area.level);

// GET /api/register/:token — what the form needs.
export async function registrationInfo(request, env, ctx, { token }) {
  await rateLimit(env.DB, 'reg-info:' + ip(request), 120, 900);
  const { link, area } = await activeLink(env.DB, token);
  const datasets = await all(env.DB, `SELECT d.id, d.name, d.report_level, d.sector_id, s.name AS sector FROM datasets d LEFT JOIN sectors s ON s.id = d.sector_id
    WHERE d.archived_at IS NULL AND d.shared = 0 ORDER BY s.name, d.name`);
  const suggested = JSON.parse(link.datasets || '[]');
  const dsTypes = await all(env.DB, 'SELECT dataset_id, type_id FROM dataset_unit_types');
  return json({
    name: link.name,
    area: { id: area.id, name: area.name, level: area.level, parentId: area.parent_id },
    roles: allowedRoles(area).map((r) => ({ id: r, name: ROLE_NAMES[r], level: ROLE_LEVEL[r] })),
    role: link.role,
    sector: link.sector_id,
    sectors: (await all(env.DB, `SELECT id, name FROM sectors WHERE id IN (SELECT sector_id FROM datasets WHERE archived_at IS NULL AND shared = 0) ORDER BY sort, name`)),
    datasets: datasets.map((d) => ({ id: d.id, name: d.name, sectorId: d.sector_id, sector: d.sector || '', byUnit: d.report_level === 4, unitTypes: dsTypes.filter((x) => x.dataset_id === d.id).map((x) => x.type_id), suggested: suggested.includes(d.id) })),
  });
}

// GET /api/register/:token/places?parent=ID[&units=1] — org units inside the link's area, for the pickers.
export async function registrationPlaces(request, env, ctx, { token }) {
  await rateLimit(env.DB, 'reg-info:' + ip(request), 120, 900);
  const { area } = await activeLink(env.DB, token);
  const q = new URL(request.url).searchParams;
  const parent = await ouById(env.DB, q.get('parent') || area.id);
  if (!parent || !(parent.path + '/').startsWith(area.path + '/') ) {
    // Allow the area itself and anything below it only.
    throw new HttpError(403, 'out_of_scope', 'Outside the area of this link.');
  }
  const units = q.get('units') === '1';
  // units=1 under an LGA: every unit below it (wards and the units under them).
  const rows = await all(env.DB, `SELECT o.id, o.name, o.level, COALESCE(t.name, o.unit_type) AS unit_type, o.unit_type_id, o.sector_id, s.name AS sector, w.name AS ward
       FROM org_units o LEFT JOIN sectors s ON s.id = o.sector_id LEFT JOIN unit_types t ON t.id = o.unit_type_id
       LEFT JOIN org_units w ON w.id = o.parent_id AND o.level = 5
     WHERE ${units ? 'o.lga_id = ? AND o.level >= 4' : 'o.parent_id = ? AND o.level <= 3'} AND o.closed_at IS NULL AND o.inactive = 0 ORDER BY w.name, o.name LIMIT 5000`, parent.id);
  return json({ parent: { id: parent.id, name: parent.name, level: parent.level }, children: rows.map((r) => ({ id: r.id, name: r.name, type: r.unit_type || '', typeId: r.unit_type_id || null, ward: r.ward || '', sectorId: r.sector_id, sector: r.sector || '' })) });
}

// POST /api/register/:token — submit a request.
export async function submitRegistration(request, env, ctx, { token }) {
  await rateLimit(env.DB, 'reg-submit:' + ip(request), 8, 3600);
  const { link, area } = await activeLink(env.DB, token);
  const body = validate(v.object({
    name: v.string({ min: 2, max: 120 }),
    email: v.string({ min: 3, max: 200, pattern: EMAIL_RE }),
    phone: v.string({ max: 40 }).optional(),
    jobTitle: v.string({ max: 120 }).optional(),
    organisation: v.string({ max: 160 }).optional(),
    role: v.string({ oneOf: SELF_ROLES }),
    sectorId: v.string({ min: 1, max: 20 }),
    ouId: v.string({ min: 11, max: 11 }),
    datasets: v.array(v.string({ min: 1, max: 20 }), { max: 50 }).optional(),
    note: v.string({ max: 500 }).optional(),
    password: v.string({ min: 1, max: 200, trim: false }),
  }), await readJson(request));
  if (!allowedRoles(area).includes(body.role)) throw new HttpError(422, 'invalid', 'This role cannot be requested with this link.', { field: 'role' });
  const ou = await ouById(env.DB, body.ouId);
  if (!ou || ou.closed_at || !(ou.path + '/').startsWith(area.path + '/')) throw new HttpError(422, 'invalid', 'Choose where you work (inside the area of this link).', { field: 'ouId' });
  const ouState = ou.level >= 2 ? await one(env.DB, 'SELECT inactive FROM org_units WHERE id = ?', ou.path.split('/')[2]) : null;
  if (ouState && ouState.inactive) throw new HttpError(422, 'invalid', 'This state is not using the system yet.', { field: 'ouId' });
  if (ou.level >= 3 && ou.inactive) throw new HttpError(422, 'invalid', 'This LGA is not using the system yet.', { field: 'ouId' });
  const lvl = ROLE_LEVEL[body.role];
  if (lvl && (lvl === 4 ? ou.level < 4 : ou.level !== lvl)) {
    const where = { 2: 'a state', 3: 'an LGA', 4: 'a unit (school, facility …)' }[lvl];
    throw new HttpError(422, 'invalid', `For “${ROLE_NAMES[body.role]}” choose ${where}.`, { field: 'ouId' });
  }
  const sector = await one(env.DB, 'SELECT id, name FROM sectors WHERE id = ?', body.sectorId);
  if (!sector) throw new HttpError(422, 'invalid', 'Choose your sector.', { field: 'sectorId' });
  if (link.sector_id && link.sector_id !== sector.id) throw new HttpError(422, 'invalid', 'This link is for another sector.', { field: 'sectorId' });
  if (ou.level >= 4 && ou.sector_id !== sector.id) {
    const unitOfSector = await one(env.DB, `SELECT 1 AS x FROM dataset_unit_types x JOIN datasets d ON d.id = x.dataset_id
      WHERE d.sector_id = ? AND d.archived_at IS NULL AND x.type_id = (SELECT unit_type_id FROM org_units WHERE id = ?) LIMIT 1`, sector.id, ou.id);
    if (!unitOfSector) throw new HttpError(422, 'invalid', `${sector.name} does not report on that unit.`, { field: 'ouId' });
  }
  for (const d of body.datasets || []) {
    const ds = await one(env.DB, 'SELECT id, sector_id FROM datasets WHERE id = ? AND archived_at IS NULL', d);
    if (!ds) throw new HttpError(422, 'invalid', 'Unknown data set.', { field: 'datasets' });
    if (ds.sector_id !== sector.id) throw new HttpError(422, 'invalid', `Choose data sets of the ${sector.name} sector only.`, { field: 'datasets' });
  }
  const email = body.email.toLowerCase();
  if (await one(env.DB, 'SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists. Sign in, or ask your administrator for a new password link.');
  if (await one(env.DB, "SELECT id FROM account_requests WHERE email = ? AND status = 'pending'", email)) throw new HttpError(409, 'pending', 'A request with this email is already waiting for approval.');
  checkPasswordStrength(body.password);
  const pw = await hashPassword(body.password);
  const id = uid('rq_');
  await run(env.DB, `INSERT INTO account_requests (id, link_id, name, email, phone, job_title, organisation, role, sector_id, ou_id, datasets, note, pw_hash, pw_salt, pw_iter, ip, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, link.id, body.name, email, body.phone || null, body.jobTitle || null, body.organisation || null, body.role, sector.id, ou.id,
    JSON.stringify(body.datasets || []), body.note || null, pw.hash, pw.salt, pw.iter, ip(request), now());
  await run(env.DB, 'UPDATE registration_links SET uses = uses + 1 WHERE id = ?', link.id);
  await audit(env.DB, { user: null, ip: ip(request) }, 'account_requested', 'account_request', id, { email, role: body.role, ou: ou.id });
  return json({ ok: true }, 201);
}

// ---------- approval ----------
// Sign-ups are approved by a system administrator, or by the state / LGA administrator of that area.
const isApprover = (ctx) => ctx.role === 'sysadmin' || (!!ctx.admin && ['state', 'lga'].includes(ctx.role));
function requireApprover(ctx) { if (!isApprover(ctx)) throw new HttpError(403, 'forbidden', 'Sign-ups are approved by a system administrator or the administrator of that state or LGA.'); }
const canApprove = (ctx, r) => isApprover(ctx) && inScope(ctx, r) && (ctx.role === 'sysadmin' || rolesManagedBy(ctx).includes(r.role));
async function requestsInScope(db, ctx, status) {
  const rows = await all(db, `SELECT r.*, o.name AS ou_name, o.level AS ou_level, o.path, l.name AS link_name, u.name AS decided_by_name, s.name AS sector_name
      FROM account_requests r JOIN org_units o ON o.id = r.ou_id JOIN registration_links l ON l.id = r.link_id LEFT JOIN users u ON u.id = r.decided_by
      LEFT JOIN sectors s ON s.id = r.sector_id
     WHERE r.status = ? ORDER BY r.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 500`, status);
  return rows.filter((r) => canApprove(ctx, r));
}

export async function listRequests(request, env, ctx) {
  requireApprover(ctx);
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) throw new HttpError(422, 'invalid', 'Unknown status.');
  const rows = await requestsInScope(env.DB, ctx, status);
  const lgaNames = {};
  for (const r of rows) {
    if (r.ou_level >= 4) {
      const p = await one(env.DB, 'SELECT name FROM org_units WHERE id = (SELECT COALESCE(lga_id, parent_id) FROM org_units WHERE id = ?)', r.ou_id);
      lgaNames[r.id] = p ? p.name : '';
    }
  }
  return json({
    requests: rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, jobTitle: r.job_title, organisation: r.organisation,
      role: r.role, roleName: ROLE_NAMES[r.role], sectorId: r.sector_id, sector: r.sector_name || '', ou: { id: r.ou_id, name: r.ou_name, level: r.ou_level, path: r.path, lga: lgaNames[r.id] || null },
      datasets: JSON.parse(r.datasets || '[]'), note: r.note, link: r.link_name, createdAt: r.created_at, status: r.status,
      decidedBy: r.decided_by_name, decidedAt: r.decided_at, decisionNote: r.decision_note,
    })),
  });
}

async function loadPending(db, ctx, id) {
  const r = await one(db, 'SELECT r.*, o.path FROM account_requests r JOIN org_units o ON o.id = r.ou_id WHERE r.id = ?', id);
  if (!r || !canApprove(ctx, r)) throw new HttpError(404, 'not_found', 'Request not found.');
  if (r.status !== 'pending') throw new HttpError(409, 'decided', 'This request has already been decided.');
  return r;
}

// POST /api/account-requests/:id/approve  { role?, datasets?, dataElements? }
export async function approveRequest(request, env, ctx, { id }) {
  requireApprover(ctx);
  const r = await loadPending(env.DB, ctx, id);
  const body = validate(v.object({
    role: v.string({ oneOf: SELF_ROLES }).optional(),
    datasets: v.array(v.string({ min: 1, max: 20 }), { max: 50 }).optional(),
    dataElements: v.array(v.string({ min: 1, max: 20 }), { max: 500 }).optional(),
  }), await readJson(request));
  const role = body.role || r.role;
  if (!canApprove(ctx, { ...r, role })) throw new HttpError(403, 'forbidden', 'You can approve data-entry accounts at your level and below.');
  const ou = await ouById(env.DB, r.ou_id);
  if (ROLE_LEVEL[role] && (ROLE_LEVEL[role] === 4 ? ou.level < 4 : ou.level !== ROLE_LEVEL[role])) throw new HttpError(422, 'invalid', `“${ROLE_NAMES[role]}” does not match where this person works (${ou.name}). Reject it and ask them to register again, or keep the requested role.`);
  if (await one(env.DB, 'SELECT id FROM users WHERE email = ?', r.email)) throw new HttpError(409, 'email_taken', 'An account with this email already exists.');
  let datasets = body.datasets || JSON.parse(r.datasets || '[]');
  // Nothing ticked: give them every data set of their sector (rather than all sectors).
  if (!datasets.length && r.sector_id) datasets = (await all(env.DB, 'SELECT id FROM datasets WHERE sector_id = ? AND archived_at IS NULL AND shared = 0', r.sector_id)).map((d) => d.id);
  const userId = uid('u_');
  const t = now();
  await run(env.DB, 'INSERT INTO users (id, email, name, pw_hash, pw_salt, pw_iter, role, ou_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    userId, r.email, r.name, r.pw_hash, r.pw_salt, r.pw_iter, role, r.ou_id, ctx.user.id, t);
  for (const d of datasets) await run(env.DB, 'INSERT OR IGNORE INTO user_datasets (user_id, dataset_id) VALUES (?, ?)', userId, d);
  for (const d of body.dataElements || []) await run(env.DB, 'INSERT OR IGNORE INTO user_data_elements (user_id, de_id) VALUES (?, ?)', userId, d);
  await run(env.DB, "UPDATE account_requests SET status = 'approved', decided_by = ?, decided_at = ?, user_id = ? WHERE id = ?", ctx.user.id, t, userId, id);
  await audit(env.DB, ctx, 'account_request_approved', 'user', userId, { email: r.email, role });
  return json({ ok: true, userId });
}

// POST /api/account-requests/:id/reject  { note }
export async function rejectRequest(request, env, ctx, { id }) {
  requireApprover(ctx);
  await loadPending(env.DB, ctx, id);
  const body = validate(v.object({ note: v.string({ max: 500 }).optional() }), await readJson(request));
  await run(env.DB, "UPDATE account_requests SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ?", ctx.user.id, now(), body.note || null, id);
  await audit(env.DB, ctx, 'account_request_rejected', 'account_request', id, { note: body.note });
  return json({ ok: true });
}

// Shown at sign-in when the email + password match a request that is still waiting.
export async function pendingFor(db, email) {
  return one(db, "SELECT * FROM account_requests WHERE email = ? AND status IN ('pending', 'rejected') ORDER BY created_at DESC LIMIT 1", email);
}
