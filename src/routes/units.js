// Units below the LGA: the child org units of each LGA that a sector reports on.
//   Wards (type "Ward") sit at DHIS2 level 4 under their LGA and always keep their real DHIS2 ID.
//   Other units (health facilities, schools, water points …) sit under their ward (level 5) or directly under the
//   LGA (level 4). Each has a unit type; each reporting schedule chooses which types report.
// Units are added one by one or imported (Excel, a DHIS2 / ALMA org-unit file, or the scorecard platform); each
// gets a DHIS2-style ID or keeps an existing DHIS2 ID.
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { inScope } from '../lib/auth.js';
import { dhisUid, UID_RE } from '../lib/dhis.js';
import { WARD_TYPE } from '../lib/units.js';
import { syncUnitsInUse } from './orgunits.js';

const MAX_IMPORT = 5000;      // rows checked per request
const MAX_COMMIT = 400;       // rows saved per request (the app sends bigger files in parts)

// Sectors this account may see (kept for older clients): admins all; others the sectors of their data sets.
async function manageableSectors(db, ctx) {
  const sectors = await all(db, 'SELECT id, name FROM sectors ORDER BY sort, name');
  if (ctx.role === 'sysadmin' || !ctx.datasets.length) return sectors;
  const mine = new Set((await all(db, `SELECT DISTINCT sector_id FROM datasets WHERE id IN (${ctx.datasets.map(() => '?').join(',')})`, ...ctx.datasets)).map((r) => r.sector_id));
  return sectors.filter((s) => mine.has(s.id));
}
function requireManager(ctx) {
  if (!['sysadmin', 'setupadmin', 'national', 'state'].includes(ctx.role) || ctx.apiToken) {
    throw new HttpError(403, 'forbidden', 'Only administrators and state officers can manage units below the LGA.');
  }
}
function requireAdmin(ctx) {
  if (!['sysadmin', 'setupadmin'].includes(ctx.role) || ctx.apiToken) throw new HttpError(403, 'forbidden', 'Only administrators can manage unit types.');
}

const unitOut = (u) => ({
  id: u.id, name: u.name, level: u.level, typeId: u.unit_type_id || null, type: u.type_name || u.unit_type || '', isWard: u.unit_type_id === WARD_TYPE,
  code: u.code || '', codeLabel: u.code_label || '', latitude: u.latitude ?? null, longitude: u.longitude ?? null, ward: u.ward_name || u.ward || '', wardId: u.ward_id || null, sectorId: u.sector_id,
  lgaId: u.lga_id || u.parent_id, lgaName: u.lga_name, stateId: u.state_id, stateName: u.state_name, closed: !!u.closed_at,
});

// ---------- unit types ----------
async function typeList(db) {
  const types = await all(db, `SELECT t.*, (SELECT COUNT(*) FROM org_units o WHERE o.unit_type_id = t.id AND o.closed_at IS NULL) AS units
    FROM unit_types t ORDER BY t.is_ward DESC, t.sort, t.name`);
  const uses = await all(db, 'SELECT x.type_id, d.id, d.name FROM dataset_unit_types x JOIN datasets d ON d.id = x.dataset_id WHERE d.archived_at IS NULL ORDER BY d.name');
  return types.map((t) => ({ id: t.id, name: t.name, isWard: !!t.is_ward, codeLabel: t.code_label || '', units: t.units, datasets: uses.filter((u) => u.type_id === t.id).map((u) => ({ id: u.id, name: u.name })) }));
}

// GET /api/unit-types
export async function listTypes(request, env) { return json({ types: await typeList(env.DB) }); }

const typeName = v.object({ name: v.string({ min: 2, max: 60 }), codeLabel: v.string({ max: 60 }).optional() });
async function nameFree(db, name, except = '') {
  if (await one(db, 'SELECT id FROM unit_types WHERE lower(name) = lower(?) AND id != ?', name.trim(), except)) throw new HttpError(409, 'name_taken', 'A unit type with this name already exists.');
}
// POST /api/unit-types { name }
export async function createType(request, env, ctx) {
  requireAdmin(ctx);
  const { name, codeLabel } = validate(typeName, await readJson(request));
  await nameFree(env.DB, name);
  const id = 'ut_' + dhisUid().toLowerCase();
  await run(env.DB, 'INSERT INTO unit_types (id, name, is_ward, sort, code_label, created_at) VALUES (?,?,0,10,?,?)', id, name.trim(), (codeLabel || '').trim() || null, now());
  await audit(env.DB, ctx, 'unit_type_created', 'unit_type', id, { name });
  await syncUnitsInUse(env.DB);
  return json({ id }, 201);
}
// PATCH /api/unit-types/:id { name }
export async function updateType(request, env, ctx, { id }) {
  requireAdmin(ctx);
  const { name, codeLabel } = validate(typeName, await readJson(request));
  if (!(await one(env.DB, 'SELECT id FROM unit_types WHERE id = ?', id))) throw new HttpError(404, 'not_found', 'Unit type not found.');
  if (id === WARD_TYPE && name.trim() !== 'Ward') throw new HttpError(422, 'invalid', 'Wards are built in.');
  await nameFree(env.DB, name, id);
  await run(env.DB, 'UPDATE unit_types SET name = ?, code_label = ? WHERE id = ?', name.trim(), codeLabel === undefined ? null : codeLabel.trim() || null, id);
  await run(env.DB, 'UPDATE org_units SET unit_type = ? WHERE unit_type_id = ?', name.trim(), id);
  await audit(env.DB, ctx, 'unit_type_updated', 'unit_type', id, { name });
  return json({ ok: true });
}
// DELETE /api/unit-types/:id — only while no unit and no schedule uses it.
export async function deleteType(request, env, ctx, { id }) {
  requireAdmin(ctx);
  if (id === WARD_TYPE) throw new HttpError(422, 'invalid', 'Wards are built in.');
  if (await one(env.DB, 'SELECT 1 AS x FROM org_units WHERE unit_type_id = ? LIMIT 1', id)) throw new HttpError(409, 'in_use', 'Units of this type exist. Change their type or close them first.');
  if (await one(env.DB, 'SELECT 1 AS x FROM dataset_unit_types WHERE type_id = ? LIMIT 1', id)) throw new HttpError(409, 'in_use', 'A report uses this type.');
  await run(env.DB, 'DELETE FROM unit_types WHERE id = ?', id);
  await audit(env.DB, ctx, 'unit_type_deleted', 'unit_type', id, {});
  return json({ ok: true });
}

// The unit type for a request: an id, a name (found or created), or — for older clients — "<Sector> unit".
async function resolveType(db, { typeId, type, sectorId }, create = true) {
  if (typeId) {
    const t = await one(db, 'SELECT * FROM unit_types WHERE id = ?', typeId);
    if (!t) throw new HttpError(422, 'invalid', 'Unknown unit type.', { field: 'typeId' });
    return t;
  }
  let name = String(type || '').trim();
  if (!name && sectorId) {
    const s = await one(db, 'SELECT name FROM sectors WHERE id = ?', sectorId);
    if (!s) throw new HttpError(422, 'invalid', 'Unknown sector.', { field: 'sectorId' });
    name = s.name + ' unit';
  }
  if (!name) throw new HttpError(422, 'invalid', 'Choose the unit type (ward, health facility, school …).', { field: 'typeId' });
  const found = await one(db, 'SELECT * FROM unit_types WHERE lower(name) = lower(?)', name);
  if (found || !create) return found;
  const id = 'ut_' + dhisUid().toLowerCase();
  await run(db, 'INSERT INTO unit_types (id, name, is_ward, sort, created_at) VALUES (?,?,0,10,?)', id, name.slice(0, 60), now());
  return one(db, 'SELECT * FROM unit_types WHERE id = ?', id);
}

// ---------- units ----------
const UNIT_SELECT = `SELECT u.*, t.name AS type_name, l.name AS lga_name, s.id AS state_id, s.name AS state_name,
       CASE WHEN u.level = 5 THEN w.id END AS ward_id, CASE WHEN u.level = 5 THEN w.name END AS ward_name
  FROM org_units u
  JOIN org_units l ON l.id = COALESCE(u.lga_id, u.parent_id) JOIN org_units s ON s.id = l.parent_id
  LEFT JOIN unit_types t ON t.id = u.unit_type_id
  LEFT JOIN org_units w ON w.id = u.parent_id`;

// GET /api/units?type=&sector=&state=&lga=
export async function listUnits(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const sectors = await manageableSectors(env.DB, ctx);
  const type = q.get('type') || '';
  const sector = q.get('sector') || '';
  const where = ['u.level >= 4']; const args = [];
  if (type) { where.push('u.unit_type_id = ?'); args.push(type); } else if (sector) { where.push('u.sector_id = ?'); args.push(sector); }
  const scopeId = q.get('lga') || q.get('state') || ctx.ou.id;
  const scope = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', scopeId);
  if (!scope || !inScope(ctx, scope)) throw new HttpError(403, 'out_of_scope', 'That area is outside your account.');
  where.push('u.path LIKE ?'); args.push(scope.path + '/%');
  const rows = await all(env.DB, `${UNIT_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.name, l.name, ward_name, u.name LIMIT 20000`, ...args);
  return json({ sectors, sector: sector || (sectors[0] || {}).id, type, types: await typeList(env.DB), units: rows.map(unitOut) });
}

async function idFree(db, id) {
  for (const t of ['org_units', 'sectors', 'datasets', 'data_elements', 'indicators']) {
    if (await one(db, `SELECT id FROM ${t} WHERE id = ?`, id)) return false;
  }
  return !(await one(db, 'SELECT id FROM datasets WHERE group_id = ? OR reporting_rate_id = ?', id, id));
}

async function loadLga(db, ctx, id) {
  const lga = await one(db, 'SELECT * FROM org_units WHERE id = ? AND level = 3', id);
  if (!lga) throw new HttpError(422, 'invalid', 'Choose an LGA.', { field: 'lgaId' });
  if (!inScope(ctx, lga)) throw new HttpError(403, 'out_of_scope', 'That LGA is outside your area.');
  return lga;
}
async function loadWard(db, lga, wardId) {
  const w = await one(db, 'SELECT * FROM org_units WHERE id = ? AND level = 4 AND unit_type_id = ?', wardId, WARD_TYPE);
  if (!w || w.parent_id !== lga.id) throw new HttpError(422, 'invalid', 'That ward is not in this LGA.', { field: 'wardId' });
  return w;
}

const unitSchema = (partial) => v.object({
  typeId: v.string({ max: 40 }).optional(),
  type: v.string({ max: 60 }).optional(),
  sectorId: v.string({ min: 1, max: 20 }).optional(),
  lgaId: partial ? v.string({ min: 11, max: 11 }).optional() : v.string({ min: 11, max: 11 }),
  wardId: v.string({ max: 11 }).optional(),
  name: partial ? v.string({ min: 1, max: 230 }).optional() : v.string({ min: 1, max: 230 }),
  code: v.string({ max: 50 }).optional(),
  ward: v.string({ max: 120 }).optional(),
  latitude: partial ? v.number({ min: -90, max: 90 }).nullable() : v.number({ min: -90, max: 90 }).optional(),
  longitude: partial ? v.number({ min: -180, max: 180 }).nullable() : v.number({ min: -180, max: 180 }).optional(),
  force: v.boolean().optional(),
  id: partial ? v.string({ max: 0 }).optional() : v.string({ pattern: UID_RE }).optional(),
  closed: v.boolean().optional(),
});

// Nigeria's bounding box (with a margin): coordinates outside it are almost always swapped or mistyped.
function checkCoords(lat, lon) {
  if ((lat === undefined || lat === null) !== (lon === undefined || lon === null)) return 'Give both latitude and longitude, or neither.';
  if (lat === undefined || lat === null) return null;
  if (!(lat >= 3.5 && lat <= 14.5 && lon >= 2.5 && lon <= 15)) return `Coordinates ${lat}, ${lon} are outside Nigeria — latitude and longitude may be swapped.`;
  return null;
}
function metres(a, b) {
  const R = 6371000; const r = (x) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat); const dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Names that differ only in a short last word (School A / School B, Ward 1 / Ward 2, LEA Primary School I / II)
// are different places, not duplicates.
function numbered(rawA, rawB) {
  const ta = String(rawA).toLowerCase().trim().split(/\s+/); const tb = String(rawB).toLowerCase().trim().split(/\s+/);
  if (ta.length !== tb.length || ta.length < 2) return false;
  const la = ta[ta.length - 1]; const lb = tb[tb.length - 1];
  return la !== lb && la.length <= 4 && lb.length <= 4 && ta.slice(0, -1).join(' ') === tb.slice(0, -1).join(' ');
}
function similar(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2 || a.length < 6) return false;
  let d = 0; for (let i = 0, j = 0; i < a.length || j < b.length;) { if (a[i] === b[j]) { i++; j++; continue; } d++; if (d > 2) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return true;
}
// Possible duplicates of a unit among the LGA's units: a similar name (any type), the same code in the same type,
// or within 50 m.
function duplicatesOf(cand, units) {
  const key = looseName(cand.name);
  const out = [];
  for (const u of units) {
    if (u.id === cand.id || u.closed_at) continue;
    const why = [];
    if (cand.code && u.code && u.unit_type_id === cand.typeId && u.code.toLowerCase() === cand.code.toLowerCase()) why.push('same code');
    if (!numbered(u.name, cand.name) && similar(looseName(u.name), key)) why.push('similar name');
    if (cand.lat !== null && cand.lat !== undefined && u.latitude !== null && u.latitude !== undefined && metres({ lat: cand.lat, lon: cand.lon }, { lat: u.latitude, lon: u.longitude }) < 50) why.push('within 50 m');
    if (why.length) out.push({ id: u.id, name: u.name, why: why.join(', ') });
  }
  return out;
}

// POST /api/units  { typeId | type | sectorId, lgaId, wardId?, name, code?, id? }
export async function createUnit(request, env, ctx) {
  requireManager(ctx);
  const body = validate(unitSchema(false), await readJson(request));
  const lga = await loadLga(env.DB, ctx, body.lgaId);
  const t = await resolveType(env.DB, body);
  const isWard = t.id === WARD_TYPE;
  if (isWard && !body.id) throw new HttpError(422, 'invalid', 'A ward keeps its real DHIS2 ID: paste it (11 letters and digits).', { field: 'id' });
  if (isWard && body.wardId) throw new HttpError(422, 'invalid', 'A ward sits directly under its LGA.', { field: 'wardId' });
  const ward = !isWard && body.wardId ? await loadWard(env.DB, lga, body.wardId) : null;
  const coordErr = checkCoords(body.latitude, body.longitude);
  if (coordErr) throw new HttpError(422, 'invalid', coordErr, { field: 'latitude' });
  const dup = await one(env.DB, 'SELECT id FROM org_units WHERE lga_id = ? AND unit_type_id = ? AND lower(name) = lower(?) AND closed_at IS NULL', lga.id, t.id, body.name);
  if (dup) throw new HttpError(409, 'duplicate', `This LGA already has a ${t.name.toLowerCase()} with that name.`);
  if (!body.force) {
    const near = duplicatesOf({ name: body.name, code: body.code, typeId: t.id, lat: body.latitude, lon: body.longitude },
      await all(env.DB, 'SELECT id, name, code, unit_type_id, latitude, longitude, closed_at FROM org_units WHERE lga_id = ? AND level >= 4', lga.id));
    if (near.length) throw new HttpError(409, 'possible_duplicate', `This may already be listed: ${near.map((n) => `${n.name} (${n.why})`).join('; ')}. Add it anyway?`, { duplicates: near });
  }
  let id = body.id;
  if (id && !(await idFree(env.DB, id))) throw new HttpError(409, 'id_taken', `The ID ${id} is already used.`, { field: 'id' });
  if (!id) do { id = dhisUid(); } while (!(await idFree(env.DB, id)));
  const parent = ward || lga;
  await run(env.DB, `INSERT INTO org_units (id, name, level, parent_id, path, sector_id, unit_type, unit_type_id, lga_id, code, ward, latitude, longitude, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, body.name, ward ? 5 : 4, parent.id, parent.path + '/' + id, body.sectorId || null, t.name, t.id, lga.id, body.code || null, ward ? null : body.ward || null, body.latitude ?? null, body.longitude ?? null, ctx.user.id, now());
  await audit(env.DB, ctx, 'unit_created', 'org_unit', id, { name: body.name, lga: lga.id, type: t.name });
  return json({ id }, 201);
}

// PATCH /api/units/:id  { name?, typeId?, code?, wardId? ('' = directly under the LGA), lgaId?, closed? }
export async function updateUnit(request, env, ctx, { id }) {
  requireManager(ctx);
  const u = await one(env.DB, 'SELECT * FROM org_units WHERE id = ? AND level >= 4', id);
  if (!u) throw new HttpError(404, 'not_found', 'Unit not found.');
  if (!inScope(ctx, u)) throw new HttpError(403, 'out_of_scope', 'That unit is outside your area.');
  const body = validate(unitSchema(true), await readJson(request));
  const isWard = u.unit_type_id === WARD_TYPE;
  let typeId = u.unit_type_id; let typeText = u.unit_type;
  if (body.typeId || body.type) {
    const t = await resolveType(env.DB, body);
    if ((t.id === WARD_TYPE) !== isWard) throw new HttpError(422, 'invalid', isWard ? 'A ward stays a ward.' : 'To add a ward, add it as a new unit with its DHIS2 ID.', { field: 'typeId' });
    typeId = t.id; typeText = t.name;
  }
  const lga = body.lgaId ? await loadLga(env.DB, ctx, body.lgaId) : await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', u.lga_id || u.parent_id);
  let parent = lga;
  if (isWard) {
    if (lga.id !== (u.lga_id || u.parent_id) && await one(env.DB, 'SELECT 1 AS x FROM org_units WHERE parent_id = ? LIMIT 1', id)) {
      throw new HttpError(409, 'has_units', 'Units sit under this ward; it cannot move to another LGA.');
    }
  } else if (body.wardId !== undefined) {
    parent = body.wardId ? await loadWard(env.DB, lga, body.wardId) : lga;
  } else if (u.level === 5 && lga.id === (u.lga_id || u.parent_id)) {
    parent = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', u.parent_id);
  }
  const lat = body.latitude !== undefined ? body.latitude : u.latitude; const lon = body.longitude !== undefined ? body.longitude : u.longitude;
  if (body.latitude !== undefined || body.longitude !== undefined) { const ce = checkCoords(lat, lon); if (ce) throw new HttpError(422, 'invalid', ce, { field: 'latitude' }); }
  await run(env.DB, 'UPDATE org_units SET name = ?, unit_type = ?, unit_type_id = ?, code = ?, ward = ?, parent_id = ?, lga_id = ?, level = ?, path = ?, latitude = ?, longitude = ?, closed_at = ?, updated_at = ? WHERE id = ?',
    body.name ?? u.name, typeText, typeId, body.code ?? u.code, parent.level === 4 ? null : body.ward ?? u.ward, parent.id, lga.id, parent.level + 1, parent.path + '/' + id,
    lat ?? null, lon ?? null, body.closed === undefined ? u.closed_at : body.closed ? now() : null, now(), id);
  await audit(env.DB, ctx, 'unit_updated', 'org_unit', id, body);
  return json({ ok: true });
}

// ---------- import ----------
// Names are matched loosely: case, extra spaces, the DHIS2 two-letter prefix ("ab ") and "State"/"LGA" are ignored.
export function looseName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
    .replace(/^[a-z]{2} (?=\S)/, (m, off, str) => (/ (state|lga)$/.test(str) ? '' : m))
    .replace(/ (state|lga|local government area|ward)$/, '').replace(/[^a-z0-9]/g, '');
}

// POST /api/units/import  { typeId? | sectorId?, commit, rows: [{ state, lga, lgaId, ward, wardId, name, type, code, id }] }
// Each row's type (a name; "Ward" for wards) or the default type. Wards need their DHIS2 ID; other units go under the
// ward named in the row when it exists (wards first: rows of wards in the same file count). Without commit it only
// checks the rows and reports what would happen.
export async function importUnits(request, env, ctx) {
  requireManager(ctx);
  const body = await readJson(request, 4_000_000);
  if (!Array.isArray(body.rows)) throw new HttpError(422, 'invalid', 'No rows found in the file.');
  if (body.rows.length > MAX_IMPORT) throw new HttpError(422, 'too_many', `Import at most ${MAX_IMPORT} rows at a time.`);
  const commit = body.commit === true;
  if (commit && body.rows.length > MAX_COMMIT) throw new HttpError(422, 'too_many', `Save at most ${MAX_COMMIT} rows per request.`);
  const defaultType = body.typeId || body.sectorId ? await resolveType(env.DB, { typeId: body.typeId, sectorId: body.sectorId }, true) : null;
  const types = await all(env.DB, 'SELECT * FROM unit_types');
  const typeByName = new Map(types.map((t) => [t.name.toLowerCase(), t]));
  const newTypes = new Map(); // lower name -> { id, name }

  const lgas = (await all(env.DB, `SELECT l.id, l.name, l.path, s.id AS state_id, s.name AS state_name
      FROM org_units l JOIN org_units s ON s.id = l.parent_id WHERE l.level = 3 AND s.inactive = 0`)).filter((l) => inScope(ctx, l));
  const byId = new Map(lgas.map((l) => [l.id, l]));
  const byName = new Map();
  for (const l of lgas) {
    byName.set(looseName(l.state_name) + '|' + looseName(l.name), l);
    const kl = 'lga|' + looseName(l.name);
    byName.set(kl, byName.has(kl) ? 'ambiguous' : l);
  }
  // Resolve LGAs first so only their units are loaded.
  const rowLga = body.rows.map((r) => {
    r = r || {};
    const lgaId = String(r.lgaId ?? '').trim();
    if (lgaId) return byId.get(lgaId) || null;
    return r.state ? byName.get(looseName(r.state) + '|' + looseName(r.lga)) || null : byName.get('lga|' + looseName(r.lga)) || null;
  });
  const lgaIds = [...new Set(rowLga.filter((l) => l && l !== 'ambiguous').map((l) => l.id))];
  const existing = [];
  for (let i = 0; i < lgaIds.length; i += 90) {
    const part = lgaIds.slice(i, i + 90);
    existing.push(...await all(env.DB, `SELECT id, name, level, parent_id, lga_id, path, unit_type_id, code, ward, latitude, longitude, closed_at FROM org_units WHERE level >= 4 AND lga_id IN (${part.map(() => '?').join(',')})`, ...part));
  }
  const byLga = new Map(); for (const e of existing) { if (!byLga.has(e.lga_id)) byLga.set(e.lga_id, []); byLga.get(e.lga_id).push(e); }
  // A unit's own-system code (e.g. a school code) identifies it within its type, wherever it is.
  const exCode = new Map();
  for (const r of await all(env.DB, "SELECT id, name, level, parent_id, lga_id, path, unit_type_id, code, ward, latitude, longitude, closed_at FROM org_units WHERE level >= 4 AND code IS NOT NULL AND code != ''")) exCode.set(r.unit_type_id + '|' + r.code.toLowerCase(), r);
  const exId = new Map(existing.map((e) => [e.id, e]));
  const exKey = new Map(existing.map((e) => [e.lga_id + '|' + e.unit_type_id + '|' + looseName(e.name), e]));
  const wardsById = new Map(existing.filter((e) => e.unit_type_id === WARD_TYPE).map((e) => [e.id, e]));
  const wardsByKey = new Map(existing.filter((e) => e.unit_type_id === WARD_TYPE).map((e) => [e.lga_id + '|' + looseName(e.name), e]));
  const usedIds = new Set();
  for (const t of ['org_units', 'sectors', 'datasets', 'data_elements', 'indicators']) for (const r of await all(env.DB, `SELECT id FROM ${t}`)) usedIds.add(r.id);
  for (const r of await all(env.DB, 'SELECT group_id, reporting_rate_id FROM datasets')) { usedIds.add(r.group_id); usedIds.add(r.reporting_rate_id); }

  const seen = new Set();
  const results = [];
  const counts = { add: 0, update: 0, same: 0, error: 0, wards: 0 };
  const wardStmts = []; const unitStmts = [];
  const t0 = now();
  const typeOf = (name) => {
    const k = name.toLowerCase();
    if (typeByName.has(k)) return typeByName.get(k);
    if (/^wards?$/.test(k)) return typeByName.get('ward');
    if (!newTypes.has(k)) newTypes.set(k, { id: 'ut_' + dhisUid().toLowerCase(), name: name.slice(0, 60), is_new: true });
    return newTypes.get(k);
  };

  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] || {};
    const rowNo = Number(r.row) || i + 2;
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim();
    const code = String(r.code ?? '').trim().slice(0, 50) || null;
    const wardText = String(r.ward ?? '').trim().slice(0, 120) || null;
    const wardId = String(r.wardId ?? '').trim();
    const wantId = String(r.id ?? '').trim();
    const num = (x) => { const t = String(x ?? '').trim().replace(',', '.'); return t === '' ? null : Number(t); };
    const lat = num(r.latitude); const lon = num(r.longitude);
    const err = (msg) => { counts.error++; results.push({ row: rowNo, name, status: 'error', message: msg }); };
    if (!name && !r.lga && !r.lgaId) continue; // blank line
    if (!name) { err('Name is empty.'); continue; }
    if (name.length > 230) { err('Name is too long.'); continue; }
    const lga = rowLga[i];
    if (lga === 'ambiguous') { err(`More than one LGA is called “${r.lga}”. Add the state or the LGA ID.`); continue; }
    if (!lga) { err(r.lgaId ? `LGA ID ${r.lgaId} is not an LGA in your area.` : `LGA “${r.lga || ''}”${r.state ? ` in “${r.state}”` : ''} was not found in your area. Use the names or IDs from the “LGAs” sheet.`); continue; }
    const typeText = String(r.type ?? '').trim();
    const t = typeText ? typeOf(typeText) : defaultType;
    if (!t) { err('Say the unit type (e.g. Health facility, Primary school, Ward).'); continue; }
    const isWard = t.id === WARD_TYPE;
    if (wantId && !UID_RE.test(wantId)) { err(`“${wantId}” is not a valid DHIS2 ID (11 letters/digits, starting with a letter).`); continue; }
    if (isWard && !wantId) { err('Wards keep their official ID: add it in the ID column (or use “Load wards & health facilities”).'); continue; }
    if ((lat !== null && !Number.isFinite(lat)) || (lon !== null && !Number.isFinite(lon))) { err('Latitude and longitude must be numbers, e.g. 10.31 and 9.84.'); continue; }
    const ce = checkCoords(lat, lon); if (ce) { err(ce); continue; }
    const key = lga.id + '|' + t.id + '|' + looseName(name);
    if (seen.has(key) && !wantId) { err('Duplicate of an earlier row (same name and type in the same LGA).'); continue; }
    seen.add(key);

    // Where it sits: a ward directly under the LGA; another unit under its ward when the ward is known.
    let parent = lga; let note = null;
    if (!isWard && (wardId || wardText)) {
      const w = wardId ? wardsById.get(wardId) : wardsByKey.get(lga.id + '|' + looseName(wardText));
      if (w && w.lga_id === lga.id) parent = w;
      else if (wardId) { err(`Ward ID ${wardId} is not a ward of ${lga.name}. Load the wards first.`); continue; }
      else note = `Ward “${wardText}” is not loaded yet: kept as a label; the unit sits directly under the LGA.`;
    }
    const level = parent.id === lga.id ? 4 : 5;
    const path = parent.path + '/';
    // With a DHIS2 ID, match only on the ID (two facilities may share a name); otherwise on LGA + type + name.
    const match = wantId ? exId.get(wantId) : (code && exCode.get(t.id + '|' + code.toLowerCase())) || exKey.get(key);
    const dups = duplicatesOf({ id: match && match.id, name, code, typeId: t.id, lat, lon }, byLga.get(lga.id) || []).filter((d) => !match || d.id !== match.id);
    if (dups.length) note = [note, `Possible duplicate of ${dups.map((d) => `${d.name} (${d.why})`).join('; ')}`].filter(Boolean).join(' ');
    if (match) {
      if (wantId && match.lga_id && match.lga_id !== lga.id && isWard && existing.some((e) => e.parent_id === match.id)) { err('This ward has units under it and cannot move to another LGA.'); continue; }
      const changed = match.name !== name || match.unit_type_id !== t.id || (code && code !== match.code) || match.parent_id !== parent.id || match.closed_at
        || (!isWard && level === 4 && wardText && wardText !== match.ward) || (lat !== null && (lat !== match.latitude || lon !== match.longitude));
      if (!changed) { counts.same++; results.push({ row: rowNo, name, status: 'same', id: match.id, lga: lga.name, note }); continue; }
      counts.update++;
      results.push({ row: rowNo, name, status: 'update', id: match.id, lga: lga.name, note });
      if (commit) {
        (isWard ? wardStmts : unitStmts).push(env.DB.prepare(`UPDATE org_units SET name = ?, unit_type = ?, unit_type_id = ?, code = COALESCE(?, code), ward = ?, parent_id = ?, lga_id = ?, level = ?, path = ?, latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), closed_at = NULL, updated_at = ? WHERE id = ?`)
          .bind(name, t.name, t.id, code, level === 4 && !isWard ? wardText : null, parent.id, lga.id, level, path + match.id, lat, lon, t0, match.id));
      }
      if (isWard) { const w = { ...match, name, lga_id: lga.id, path: lga.path + '/' + match.id }; wardsById.set(match.id, w); wardsByKey.set(lga.id + '|' + looseName(name), w); }
      continue;
    }
    let id = wantId;
    if (id && usedIds.has(id)) { err(`The ID ${id} is already used by something else.`); continue; }
    if (!id) do { id = dhisUid(); } while (usedIds.has(id));
    usedIds.add(id);
    counts.add++; if (isWard) counts.wards++;
    results.push({ row: rowNo, name, status: 'add', id: commit ? id : null, lga: lga.name, state: lga.state_name, type: t.name, note });
    if (isWard) { const w = { id, name, lga_id: lga.id, path: lga.path + '/' + id, unit_type_id: WARD_TYPE }; wardsById.set(id, w); wardsByKey.set(lga.id + '|' + looseName(name), w); }
    if (commit) {
      (isWard ? wardStmts : unitStmts).push(env.DB.prepare('INSERT INTO org_units (id, name, level, parent_id, path, sector_id, unit_type, unit_type_id, lga_id, code, ward, latitude, longitude, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, name, level, parent.id, path + id, body.sectorId || null, t.name, t.id, lga.id, code, level === 4 && !isWard ? wardText : null, lat, lon, ctx.user.id, t0));
    }
  }
  const newTypeList = [...newTypes.values()].filter((t) => results.some((r) => r.type === t.name || r.status !== 'error'));
  if (commit) {
    if (counts.error) throw new HttpError(422, 'import_errors', `Fix the ${counts.error} row(s) with problems first; nothing was imported.`, { counts, results: results.filter((r) => r.status === 'error').slice(0, 500) });
    const typeStmts = [...newTypes.values()].map((t) => env.DB.prepare('INSERT OR IGNORE INTO unit_types (id, name, is_ward, sort, created_at) VALUES (?,?,0,10,?)').bind(t.id, t.name, t0));
    const stmts = [...typeStmts, ...wardStmts, ...unitStmts];
    for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
    await audit(env.DB, ctx, 'units_imported', 'org_unit', null, counts);
  }
  if (commit) await syncUnitsInUse(env.DB);
  return json({ committed: commit, counts: { ...counts, possibleDuplicates: results.filter((x) => x.note && /Possible duplicate/.test(x.note)).length }, results, newTypes: newTypeList.map((t) => t.name) });
}
