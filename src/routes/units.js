// Sector units: org units below an LGA (level 4) that belong to one sector — schools, health facilities,
// water points, markets ... Added one by one or imported from Excel; each gets a DHIS2-style ID
// (or keeps an existing DHIS2 ID when the row has one).
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { inScope } from '../lib/auth.js';
import { dhisUid, UID_RE } from '../lib/dhis.js';

const MAX_IMPORT = 5000;      // rows checked per request
const MAX_COMMIT = 400;       // rows saved per request (the app sends bigger files in parts)

// Sectors this account may manage units for: admins all; others the sectors of their data sets (all if none assigned).
async function manageableSectors(db, ctx) {
  const sectors = await all(db, 'SELECT id, name FROM sectors ORDER BY sort, name');
  if (ctx.role === 'sysadmin' || !ctx.datasets.length) return sectors;
  const mine = new Set((await all(db, `SELECT DISTINCT sector_id FROM datasets WHERE id IN (${ctx.datasets.map(() => '?').join(',')})`, ...ctx.datasets)).map((r) => r.sector_id));
  return sectors.filter((s) => mine.has(s.id));
}
function requireManager(ctx) {
  if (!['sysadmin', 'setupadmin', 'state'].includes(ctx.role) || ctx.apiToken) {
    throw new HttpError(403, 'forbidden', 'Only administrators and state officers can manage sector units.');
  }
}
async function checkSector(db, ctx, sectorId) {
  const ok = (await manageableSectors(db, ctx)).find((s) => s.id === sectorId);
  if (!ok) throw new HttpError(403, 'forbidden', 'You cannot manage units for this sector.');
  return ok;
}

const unitOut = (u) => ({
  id: u.id, name: u.name, type: u.unit_type || '', code: u.code || '', ward: u.ward || '', sectorId: u.sector_id,
  lgaId: u.parent_id, lgaName: u.lga_name, stateId: u.state_id, stateName: u.state_name, closed: !!u.closed_at,
});

// GET /api/units?sector=&state=&lga=
export async function listUnits(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const sectors = await manageableSectors(env.DB, ctx);
  const sector = q.get('sector') || (sectors[0] || {}).id;
  const where = ['u.level = 4'];
  const args = [];
  if (sector) { where.push('u.sector_id = ?'); args.push(sector); }
  const scopeId = q.get('lga') || q.get('state') || ctx.ou.id;
  const scope = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', scopeId);
  if (!scope || !inScope(ctx, scope)) throw new HttpError(403, 'out_of_scope', 'That area is outside your account.');
  where.push('u.path LIKE ?'); args.push(scope.path + '/%');
  const rows = await all(env.DB,
    `SELECT u.*, l.name AS lga_name, s.id AS state_id, s.name AS state_name
       FROM org_units u JOIN org_units l ON l.id = u.parent_id JOIN org_units s ON s.id = l.parent_id
      WHERE ${where.join(' AND ')} ORDER BY s.name, l.name, u.name LIMIT 20000`, ...args);
  const types = await all(env.DB, 'SELECT DISTINCT unit_type FROM org_units WHERE level = 4 AND sector_id = ? AND unit_type IS NOT NULL ORDER BY unit_type', sector || '');
  return json({ sectors, sector, units: rows.map(unitOut), types: types.map((t) => t.unit_type) });
}

async function idFree(db, id) {
  for (const t of ['org_units', 'sectors', 'datasets', 'data_elements', 'indicators']) {
    if (await one(db, `SELECT id FROM ${t} WHERE id = ?`, id)) return false;
  }
  return true;
}

async function loadLga(db, ctx, id) {
  const lga = await one(db, 'SELECT * FROM org_units WHERE id = ? AND level = 3', id);
  if (!lga) throw new HttpError(422, 'invalid', 'Choose an LGA.', { field: 'lgaId' });
  if (!inScope(ctx, lga)) throw new HttpError(403, 'out_of_scope', 'That LGA is outside your area.');
  return lga;
}

const unitSchema = (partial) => v.object({
  sectorId: partial ? v.string({ min: 1, max: 20 }).optional() : v.string({ min: 1, max: 20 }),
  lgaId: partial ? v.string({ min: 11, max: 11 }).optional() : v.string({ min: 11, max: 11 }),
  name: partial ? v.string({ min: 1, max: 230 }).optional() : v.string({ min: 1, max: 230 }),
  type: v.string({ max: 60 }).optional(),
  code: v.string({ max: 50 }).optional(),
  ward: v.string({ max: 120 }).optional(),
  id: partial ? v.string({ max: 0 }).optional() : v.string({ pattern: UID_RE }).optional(),
  closed: v.boolean().optional(),
});

// POST /api/units  { sectorId, lgaId, name, type?, code?, id? }
export async function createUnit(request, env, ctx) {
  requireManager(ctx);
  const body = validate(unitSchema(false), await readJson(request));
  await checkSector(env.DB, ctx, body.sectorId);
  const lga = await loadLga(env.DB, ctx, body.lgaId);
  const dup = await one(env.DB, 'SELECT id FROM org_units WHERE parent_id = ? AND sector_id = ? AND lower(name) = lower(?)', lga.id, body.sectorId, body.name);
  if (dup) throw new HttpError(409, 'duplicate', 'This LGA already has a unit with that name for this sector.');
  let id = body.id;
  if (id && !(await idFree(env.DB, id))) throw new HttpError(409, 'id_taken', `The ID ${id} is already used.`, { field: 'id' });
  if (!id) do { id = dhisUid(); } while (!(await idFree(env.DB, id)));
  await run(env.DB, `INSERT INTO org_units (id, name, level, parent_id, path, sector_id, unit_type, code, ward, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, body.name, 4, lga.id, lga.path + '/' + id, body.sectorId, body.type || null, body.code || null, body.ward || null, ctx.user.id, now());
  await audit(env.DB, ctx, 'unit_created', 'org_unit', id, { name: body.name, lga: lga.id });
  return json({ id }, 201);
}

// PATCH /api/units/:id  { name?, type?, code?, lgaId?, closed? }
export async function updateUnit(request, env, ctx, { id }) {
  requireManager(ctx);
  const u = await one(env.DB, 'SELECT * FROM org_units WHERE id = ? AND level = 4', id);
  if (!u) throw new HttpError(404, 'not_found', 'Unit not found.');
  if (!inScope(ctx, u)) throw new HttpError(403, 'out_of_scope', 'That unit is outside your area.');
  await checkSector(env.DB, ctx, u.sector_id);
  const body = validate(unitSchema(true), await readJson(request));
  const lga = body.lgaId ? await loadLga(env.DB, ctx, body.lgaId) : await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', u.parent_id);
  await run(env.DB, 'UPDATE org_units SET name = ?, unit_type = ?, code = ?, ward = ?, parent_id = ?, path = ?, closed_at = ?, updated_at = ? WHERE id = ?',
    body.name ?? u.name, body.type ?? u.unit_type, body.code ?? u.code, body.ward ?? u.ward, lga.id, lga.path + '/' + id,
    body.closed === undefined ? u.closed_at : body.closed ? now() : null, now(), id);
  await audit(env.DB, ctx, 'unit_updated', 'org_unit', id, body);
  return json({ ok: true });
}

// ---------- Excel import ----------
// Names are matched loosely: case, extra spaces, the DHIS2 two-letter prefix ("ab ") and "State"/"LGA" are ignored.
export function looseName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/^[a-z]{2} (?=\S)/, (m, off, str) => (/ (state|lga)$/.test(str) ? '' : m))
    .replace(/ (state|lga|local government area)$/, '').replace(/[^a-z0-9]/g, '');
}

// POST /api/units/import  { sectorId, commit: bool, rows: [{ state, lga, lgaId, name, type, code, id }] }
// Without commit it only checks the rows and reports what would happen.
export async function importUnits(request, env, ctx) {
  requireManager(ctx);
  const body = await readJson(request, 4_000_000);
  const sectorId = validate(v.object({ sectorId: v.string({ min: 1, max: 20 }) }), body).sectorId;
  await checkSector(env.DB, ctx, sectorId);
  if (!Array.isArray(body.rows)) throw new HttpError(422, 'invalid', 'No rows found in the file.');
  if (body.rows.length > MAX_IMPORT) throw new HttpError(422, 'too_many', `Import at most ${MAX_IMPORT} rows at a time.`);
  const commit = body.commit === true;

  const lgas = (await all(env.DB, `SELECT l.id, l.name, l.path, s.id AS state_id, s.name AS state_name
      FROM org_units l JOIN org_units s ON s.id = l.parent_id WHERE l.level = 3`)).filter((l) => inScope(ctx, l));
  const byId = new Map(lgas.map((l) => [l.id, l]));
  const byName = new Map();
  for (const l of lgas) {
    const k = looseName(l.state_name) + '|' + looseName(l.name);
    byName.set(k, l);
    const kl = 'lga|' + looseName(l.name);
    byName.set(kl, byName.has(kl) ? 'ambiguous' : l);
  }
  const existing = await all(env.DB, 'SELECT id, name, parent_id, unit_type, code, ward FROM org_units WHERE level = 4 AND sector_id = ?', sectorId);
  const exKey = new Map(existing.map((e) => [e.parent_id + '|' + looseName(e.name), e]));
  const exId = new Map(existing.map((e) => [e.id, e]));
  // Every ID already in use, loaded once (keeps the number of database queries small for big imports).
  const usedIds = new Set();
  for (const t of ['org_units', 'sectors', 'datasets', 'data_elements', 'indicators']) for (const r of await all(env.DB, `SELECT id FROM ${t}`)) usedIds.add(r.id);
  for (const r of await all(env.DB, 'SELECT group_id, reporting_rate_id FROM datasets')) { usedIds.add(r.group_id); usedIds.add(r.reporting_rate_id); }
  const seen = new Set();
  const results = [];
  const counts = { add: 0, update: 0, same: 0, error: 0 };
  const stmts = [];
  const t = now();

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] || {};
    const rowNo = Number(r.row) || i + 2;
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
    const type = String(r.type ?? '').trim().slice(0, 60) || null;
    const code = String(r.code ?? '').trim().slice(0, 50) || null;
    const ward = String(r.ward ?? '').trim().slice(0, 120) || null;
    const wantId = String(r.id ?? '').trim();
    const err = (msg) => { counts.error++; results.push({ row: rowNo, name, status: 'error', message: msg }); };
    if (!name && !r.lga && !r.lgaId) continue; // blank line
    if (!name) { err('Name is empty.'); continue; }
    if (name.length > 230) { err('Name is too long.'); continue; }
    let lga = null;
    const lgaId = String(r.lgaId ?? '').trim();
    if (lgaId) {
      lga = byId.get(lgaId);
      if (!lga) { err(`LGA ID ${lgaId} is not an LGA in your area.`); continue; }
    } else {
      lga = r.state ? byName.get(looseName(r.state) + '|' + looseName(r.lga)) : byName.get('lga|' + looseName(r.lga));
      if (lga === 'ambiguous') { err(`More than one LGA is called “${r.lga}”. Add the state or the LGA ID.`); continue; }
      if (!lga) { err(`LGA “${r.lga || ''}”${r.state ? ` in “${r.state}”` : ''} was not found in your area. Use the names or IDs from the “LGAs” sheet.`); continue; }
    }
    if (wantId && !UID_RE.test(wantId)) { err(`“${wantId}” is not a valid DHIS2 ID (11 letters/digits, starting with a letter).`); continue; }
    const key = lga.id + '|' + looseName(name);
    if (seen.has(key) && !wantId) { err('Duplicate of an earlier row (same name in the same LGA).'); continue; }
    seen.add(key);
    // With a DHIS2 ID, match only on the ID (two facilities may share a name in one LGA); otherwise on name + LGA.
    const match = wantId ? exId.get(wantId) : exKey.get(key);
    if (match) {
      const changed = match.name !== name || (type && type !== match.unit_type) || (code && code !== match.code) || (ward && ward !== match.ward) || match.parent_id !== lga.id;
      if (!changed) { counts.same++; results.push({ row: rowNo, name, status: 'same', id: match.id, lga: lga.name }); continue; }
      counts.update++;
      results.push({ row: rowNo, name, status: 'update', id: match.id, lga: lga.name });
      if (commit) {
        stmts.push(env.DB.prepare('UPDATE org_units SET name = ?, unit_type = COALESCE(?, unit_type), code = COALESCE(?, code), ward = COALESCE(?, ward), parent_id = ?, path = ?, closed_at = NULL, updated_at = ? WHERE id = ?')
          .bind(name, type, code, ward, lga.id, lga.path + '/' + match.id, t, match.id));
      }
      continue;
    }
    let id = wantId;
    if (id && usedIds.has(id)) { err(`The ID ${id} is already used by something else.`); continue; }
    if (!id) do { id = dhisUid(); } while (usedIds.has(id));
    usedIds.add(id);
    counts.add++;
    results.push({ row: rowNo, name, status: 'add', id: commit ? id : null, lga: lga.name, state: lga.state_name });
    if (commit) {
      stmts.push(env.DB.prepare('INSERT INTO org_units (id, name, level, parent_id, path, sector_id, unit_type, code, ward, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, name, 4, lga.id, lga.path + '/' + id, sectorId, type, code, ward, ctx.user.id, t));
    }
  }
  if (commit && body.rows.length > MAX_COMMIT) throw new HttpError(422, 'too_many', `Save at most ${MAX_COMMIT} rows per request.`);
  if (commit) {
    if (counts.error) throw new HttpError(422, 'import_errors', `Fix the ${counts.error} row(s) with problems first; nothing was imported.`, { counts, results: results.filter((r) => r.status === 'error').slice(0, 500) });
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    await audit(env.DB, ctx, 'units_imported', 'sector', sectorId, counts);
  }
  return json({ committed: commit, counts, results });
}
