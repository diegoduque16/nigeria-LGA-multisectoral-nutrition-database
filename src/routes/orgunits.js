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
  const existing = new Map((await all(db, 'SELECT id, name, parent_id, path, closed_at FROM org_units')).map((r) => [r.id, r]));
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
      if (!ids.has(e.id) && !e.closed_at) {
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
  return upsertUnits(db, prepareUnits(extractUnits(seed)));
}

const ouOut = (o) => ({ id: o.id, name: o.name, level: o.level, parentId: o.parent_id, closed: !!o.closed_at });

// GET /api/orgunits            -> the states in the caller's scope (with LGA counts)
// GET /api/orgunits?parent=ID  -> children of an org unit
export async function listOrgUnits(request, env, ctx) {
  const url = new URL(request.url);
  const parent = url.searchParams.get('parent');
  if (parent) {
    const p = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', parent);
    if (!p) throw new HttpError(404, 'not_found', 'Organisation unit not found.');
    if (!inScope(ctx, p) && !inScope({ ou: p }, ctx.ou)) throw new HttpError(403, 'out_of_scope', 'That organisation unit is outside your area.');
    const rows = await all(env.DB, 'SELECT * FROM org_units WHERE parent_id = ? ORDER BY name', parent);
    return json({ parent: ouOut(p), children: rows.filter((r) => inScope(ctx, r) || inScope({ ou: r }, ctx.ou)).map(ouOut) });
  }
  const rows = await all(env.DB,
    `SELECT s.*, (SELECT COUNT(*) FROM org_units l WHERE l.parent_id = s.id AND l.closed_at IS NULL) AS lgas
       FROM org_units s WHERE s.level = 2 ORDER BY s.name`);
  const visible = rows.filter((r) => inScope(ctx, r) || inScope({ ou: r }, ctx.ou));
  const root = await one(env.DB, 'SELECT * FROM org_units WHERE level = 1 LIMIT 1');
  return json({ country: root ? ouOut(root) : null, states: visible.map((r) => ({ ...ouOut(r), lgas: r.lgas })) });
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
