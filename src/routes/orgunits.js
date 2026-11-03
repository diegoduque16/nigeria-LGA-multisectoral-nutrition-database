// Organisation units: DHIS2 hierarchy (country / state / LGA) with the DHIS2 UIDs kept as-is.
import { HttpError, json, readJson, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { requireRole, inScope } from '../lib/auth.js';
import { UID_RE } from '../lib/dhis.js';
import seed from '../../seed/nigeria_orgunits.json' with { type: 'json' };

// Accepts DHIS2 or ALMA Export shapes:
//   { organisationUnits: [...] }  |  { organisationUnits: { organisationUnits: [...] } }  |  [...]
export function extractUnits(body) {
  let list = body;
  if (list && !Array.isArray(list)) list = list.organisationUnits;
  if (list && !Array.isArray(list)) list = list.organisationUnits;
  if (!Array.isArray(list)) throw new HttpError(422, 'invalid', 'Expected a DHIS2 organisationUnits list.');
  return list;
}

// Validates units, keeps only levels 1-3, and orders them parents-first with DHIS2-style paths.
export function prepareUnits(list) {
  const units = new Map();
  for (const o of list) {
    if (!o || typeof o !== 'object') continue;
    const level = Number(o.level);
    if (![1, 2, 3].includes(level)) continue;
    if (!UID_RE.test(o.id || '')) throw new HttpError(422, 'invalid', `“${o.name || o.id}” does not have a valid DHIS2 ID.`);
    const name = String(o.name || '').trim();
    if (!name || name.length > 230) throw new HttpError(422, 'invalid', `Org unit ${o.id} needs a name.`);
    const parentId = o.parent && o.parent.id ? o.parent.id : null;
    if (level > 1 && !parentId) throw new HttpError(422, 'invalid', `“${name}” (level ${level}) has no parent.`);
    if (units.has(o.id)) throw new HttpError(422, 'invalid', `Org unit ID ${o.id} appears twice.`);
    units.set(o.id, { id: o.id, name, level, parentId: level === 1 ? null : parentId });
  }
  const sorted = [...units.values()].sort((a, b) => a.level - b.level);
  for (const u of sorted) {
    if (u.level === 1) { u.path = '/' + u.id; continue; }
    const p = units.get(u.parentId);
    if (!p) throw new HttpError(422, 'invalid', `The parent of “${u.name}” is not in the file.`);
    if (p.level !== u.level - 1) throw new HttpError(422, 'invalid', `“${u.name}” is not one level below its parent.`);
    u.path = p.path + '/' + u.id;
  }
  if (!sorted.some((u) => u.level === 1)) throw new HttpError(422, 'invalid', 'The file has no country (level 1) org unit.');
  return sorted;
}

// Inserts new units and updates names/parents of existing ones. Units never get deleted:
// units missing from the file are marked closed so their history stays exportable.
export async function upsertUnits(db, sorted, { closeMissing = false } = {}) {
  const t = now();
  const existing = new Map((await all(db, 'SELECT id, name, level, parent_id, path, closed_at FROM org_units')).map((r) => [r.id, r]));
  let added = 0; let updated = 0; let closed = 0;
  const stmts = [];
  for (const u of sorted) {
    const e = existing.get(u.id);
    if (!e) {
      added++;
      stmts.push(db.prepare('INSERT INTO org_units (id, name, level, parent_id, path, updated_at) VALUES (?,?,?,?,?,?)').bind(u.id, u.name, u.level, u.parentId, u.path, t));
    } else if (e.name !== u.name || e.parent_id !== u.parentId || e.path !== u.path || e.closed_at) {
      updated++;
      stmts.push(db.prepare('UPDATE org_units SET name = ?, level = ?, parent_id = ?, path = ?, closed_at = NULL, updated_at = ? WHERE id = ?').bind(u.name, u.level, u.parentId, u.path, t, u.id));
    }
  }
  if (closeMissing) {
    const ids = new Set(sorted.map((u) => u.id));
    for (const e of existing.values()) {
      if (!ids.has(e.id) && !e.closed_at && e.level <= 3) {
        closed++;
        stmts.push(db.prepare('UPDATE org_units SET closed_at = ?, updated_at = ? WHERE id = ?').bind(t, t, e.id));
      }
    }
  }
  for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  return { added, updated, closed, total: sorted.length };
}

export async function loadSeedOrgUnits(db) {
  const n = await one(db, 'SELECT COUNT(*) AS n FROM org_units');
  if (n.n > 0) return null;
  const r = await upsertUnits(db, prepareUnits(extractUnits(seed)));
  await run(db, 'UPDATE org_units SET inactive = 1 WHERE level = 3');
  await defaultLgasInUse(db, (await all(db, 'SELECT id FROM org_units WHERE level = 2 AND inactive = 0')).map((x) => x.id));
  return r;
}

// LGAs in use start small: a state switched on gets its first 5 LGAs (alphabetically); the rest are ticked by hand.
export const DEFAULT_LGAS = 5;
export async function defaultLgasInUse(db, stateIds) {
  for (const id of stateIds) {
    await run(db, 'UPDATE org_units SET inactive = 1 WHERE level = 3 AND parent_id = ?', id);
    const first = await all(db, 'SELECT id FROM org_units WHERE level = 3 AND parent_id = ? AND closed_at IS NULL ORDER BY name LIMIT ?', id, DEFAULT_LGAS);
    for (const l of first) await run(db, 'UPDATE org_units SET inactive = 0 WHERE id = ?', l.id);
  }
  if (stateIds.length) await syncUnitsInUse(db);
}

const ouOut = (o) => ({ id: o.id, name: o.name, level: o.level, parentId: o.parent_id, closed: !!o.closed_at, active: !o.inactive });

// GET /api/orgunits            -> the states in the caller's scope (with LGA counts)
// GET /api/orgunits?parent=ID  -> children of an org unit
export async function listOrgUnits(request, env, ctx) {
  const url = new URL(request.url);
  const parent = url.searchParams.get('parent');
  if (url.searchParams.get('lgas') === 'all') {
    // Every LGA in the caller's area with its state (for Excel templates).
    const rows = await all(env.DB, `SELECT l.id, l.name, l.path, s.name AS state FROM org_units l JOIN org_units s ON s.id = l.parent_id
      WHERE l.level = 3 AND l.closed_at IS NULL AND l.inactive = 0 AND s.inactive = 0 ORDER BY s.name, l.name`);
    return json({ lgas: rows.filter((r) => inScope(ctx, r)).map((r) => ({ id: r.id, name: r.name, state: r.state })) });
  }
  if (parent) {
    const p = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', parent);
    if (!p) throw new HttpError(404, 'not_found', 'Organisation unit not found.');
    if (!inScope(ctx, p) && !inScope({ ou: p }, ctx.ou)) throw new HttpError(403, 'out_of_scope', 'That organisation unit is outside your area.');
    const withUnits = url.searchParams.get('units') === '1';
    // units=1 under an LGA: every unit below it (wards, and facilities / schools under their ward or the LGA).
    const rows = withUnits
      ? await all(env.DB, `SELECT o.*, t.name AS type_name, w.name AS ward_name FROM org_units o LEFT JOIN unit_types t ON t.id = o.unit_type_id
          LEFT JOIN org_units w ON w.id = o.parent_id AND o.level = 5 WHERE o.lga_id = ? AND o.level >= 4 ORDER BY ward_name, o.name`, parent)
      : await all(env.DB, 'SELECT * FROM org_units WHERE parent_id = ? AND level <= 3 ORDER BY name', parent);
    if (withUnits) {
      return json({ parent: ouOut(p), children: rows.filter((r) => !r.closed_at && (inScope(ctx, r) || inScope({ ou: r }, ctx.ou)))
        .map((r) => ({ ...ouOut(r), sectorId: r.sector_id, typeId: r.unit_type_id || null, type: r.type_name || r.unit_type || '', ward: r.ward_name || r.ward || '' })) });
    }
    return json({ parent: ouOut(p), children: rows.filter((r) => inScope(ctx, r) || inScope({ ou: r }, ctx.ou)).map(ouOut) });
  }
  const rows = await all(env.DB,
    `SELECT s.*, (SELECT COUNT(*) FROM org_units l WHERE l.parent_id = s.id AND l.closed_at IS NULL AND l.inactive = 0) AS lgas,
            (SELECT COUNT(*) FROM org_units l WHERE l.parent_id = s.id AND l.closed_at IS NULL) AS lgas_all
       FROM org_units s WHERE s.level = 2 ${url.searchParams.get('all') === '1' && ctx.role === 'sysadmin' ? '' : 'AND s.inactive = 0'} ORDER BY s.name`);
  const visible = rows.filter((r) => inScope(ctx, r) || inScope({ ou: r }, ctx.ou));
  const root = await one(env.DB, 'SELECT * FROM org_units WHERE level = 1 LIMIT 1');
  return json({ country: root ? ouOut(root) : null, states: visible.map((r) => ({ ...ouOut(r), lgas: r.lgas, lgasAll: r.lgas_all, active: !r.inactive })) });
}

// POST /api/orgunits/import  body: DHIS2 /api/organisationUnits JSON or an ALMA Export metadata file.
export async function importOrgUnits(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const url = new URL(request.url);
  const body = await readJson(request, 5_000_000);
  const sorted = prepareUnits(extractUnits(body));
  const result = await upsertUnits(env.DB, sorted, { closeMissing: url.searchParams.get('closeMissing') === 'true' });
  await audit(env.DB, ctx, 'orgunits_imported', null, null, result);
  return json(result);
}

// PUT /api/rollout  { active: [stateId, ...] } — which states take part (system administrators).
export async function setRollout(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const body = await readJson(request);
  if (!Array.isArray(body.active)) throw new HttpError(422, 'invalid', 'Send the list of active states.');
  const states = await all(env.DB, 'SELECT id, name, inactive FROM org_units WHERE level = 2');
  const ids = new Set(states.map((s) => s.id));
  for (const id of body.active) if (!ids.has(id)) throw new HttpError(422, 'invalid', 'Unknown state.');
  if (!body.active.length) throw new HttpError(422, 'invalid', 'Keep at least one state active.');
  const on = new Set(body.active);
  const changed = states.filter((s) => (s.inactive ? false : true) !== on.has(s.id));
  for (const s of changed) await run(env.DB, 'UPDATE org_units SET inactive = ?, updated_at = ? WHERE id = ?', on.has(s.id) ? 0 : 1, now(), s.id);
  // A state switched on with no LGA in use gets its first 5.
  const fresh = [];
  for (const s of changed.filter((x) => on.has(x.id))) {
    const n = await one(env.DB, 'SELECT COUNT(*) AS n FROM org_units WHERE level = 3 AND parent_id = ? AND inactive = 0 AND closed_at IS NULL', s.id);
    if (!n.n) fresh.push(s.id);
  }
  await defaultLgasInUse(env.DB, fresh);
  await audit(env.DB, ctx, 'rollout_changed', null, null, { active: body.active.length, changed: changed.map((s) => `${s.name}: ${on.has(s.id) ? 'on' : 'off'}`) });
  return json({ active: body.active.length, changed: changed.length });
}

// Units below the LGA follow their LGA: switched off with it, back on with it.
export const syncUnitsInUse = (db) => run(db, `UPDATE org_units SET inactive = COALESCE((SELECT l.inactive FROM org_units l WHERE l.id = org_units.lga_id), 0)
  WHERE level >= 4 AND lga_id IS NOT NULL`);

// PUT /api/rollout/lgas  { state, active: [lgaId, ...] } — which LGAs of a state take part (system administrators).
export async function setLgaRollout(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const body = await readJson(request);
  const st = await one(env.DB, 'SELECT id, name FROM org_units WHERE id = ? AND level = 2', body.state || '');
  if (!st) throw new HttpError(422, 'invalid', 'Unknown state.');
  if (!Array.isArray(body.active)) throw new HttpError(422, 'invalid', 'Send the list of LGAs in use.');
  const lgas = await all(env.DB, 'SELECT id, name, inactive FROM org_units WHERE parent_id = ? AND level = 3 AND closed_at IS NULL', st.id);
  const ids = new Set(lgas.map((l) => l.id));
  for (const id of body.active) if (!ids.has(id)) throw new HttpError(422, 'invalid', 'Unknown LGA for this state.');
  if (!body.active.length) throw new HttpError(422, 'invalid', 'Keep at least one LGA in use, or switch the whole state off.');
  const on = new Set(body.active);
  const changed = lgas.filter((l) => !l.inactive !== on.has(l.id));
  for (const l of changed) await run(env.DB, 'UPDATE org_units SET inactive = ?, updated_at = ? WHERE id = ?', on.has(l.id) ? 0 : 1, now(), l.id);
  if (changed.length) await syncUnitsInUse(env.DB);
  await audit(env.DB, ctx, 'rollout_lgas_changed', 'org_unit', st.id, { state: st.name, active: on.size, of: lgas.length, changed: changed.map((l) => `${l.name}: ${on.has(l.id) ? 'on' : 'off'}`) });
  return json({ active: on.size, of: lgas.length, changed: changed.length });
}
