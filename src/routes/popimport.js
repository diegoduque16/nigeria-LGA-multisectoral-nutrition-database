// Official population figures (NPC / NBS projections …) imported from Excel into the shared yearly
// "Population & denominators" data set: one row per LGA, one column per number.
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, audit, getSetting, setSetting } from '../lib/db.js';
import { inScope } from '../lib/auth.js';
import { YEAR_RE } from '../lib/dhis.js';
import { looseName } from './units.js';
import { recalc } from '../lib/popcalc.js';

const MAX_ROWS = 800;     // checked per request (all 774 LGAs fit)
const MAX_COMMIT = 60;    // LGAs saved per request; the app sends the file in parts

async function loadShared(db, ctx, id) {
  if (!['sysadmin', 'setupadmin'].includes(ctx.role) || ctx.apiToken) throw new HttpError(403, 'forbidden', 'Only administrators can import population figures.');
  const ds = await one(db, 'SELECT * FROM datasets WHERE id = ?', id);
  if (!ds || !ds.shared) throw new HttpError(404, 'not_found', 'Population & denominators data set not found.');
  return ds;
}

// GET /api/datasets/:id/population?year=2026 — current figures for every LGA in scope (for the template).
export async function populationTable(request, env, ctx, { id }) {
  const ds = await loadShared(env.DB, ctx, id);
  const year = new URL(request.url).searchParams.get('year') || '';
  if (!YEAR_RE.test(year)) throw new HttpError(422, 'invalid', 'Choose a year.', { field: 'year' });
  // The template lists the imported figures only; calculated ones follow Total population.
  const fields = await all(env.DB, 'SELECT id, name FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL AND calc_base IS NULL ORDER BY sort, name', ds.id);
  const lgas = (await all(env.DB, `SELECT l.id, l.name, l.path, s.name AS state FROM org_units l JOIN org_units s ON s.id = l.parent_id
      WHERE l.level = 3 AND l.closed_at IS NULL AND s.inactive = 0 ORDER BY s.name, l.name`)).filter((l) => inScope(ctx, l));
  const vals = await all(env.DB, `SELECT de_id, ou_id, value FROM data_values WHERE period = ? AND de_id IN (SELECT id FROM data_elements WHERE dataset_id = ?)`, year, ds.id);
  const byKey = new Map(vals.map((x) => [x.ou_id + '|' + x.de_id, x.value]));
  const source = await getSetting(env.DB, `popsource:${ds.id}:${year}`);
  return json({
    year, fields, source: source ? JSON.parse(source) : null,
    lgas: lgas.map((l) => ({ id: l.id, name: l.name, state: l.state, values: Object.fromEntries(fields.map((f) => [f.id, byKey.get(l.id + '|' + f.id) ?? null])) })),
  });
}

// Ward names compared loosely: no state prefix ("be "), no word "ward", Roman numerals as written, letters and digits only.
export function wardKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[a-z]{2} (?=\S)/, '')
    .replace(/\(.*?\)/g, ' ').replace(/\bs\/\s*gari/g, 'sabon gari').replace(/\bward\b/g, ' ').replace(/[^a-z0-9]/g, '');
}
function close(a, b) {
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 5) return false;
  if (a[a.length - 1] !== b[b.length - 1]) return false; // Nasarawa A is not Nasarawa B, nor Ogbor 1 Ogbor 2
  const max = a.length >= 9 ? 2 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return false;
    prev = cur;
  }
  return prev[b.length] <= max;
}
// The ward of an LGA a row names (ward, plus other names separated by commas): exact first, then one close spelling.
function findWard(list, row) {
  const keys = [row.ward, ...String(row.wardAlt || '').split(/[,;]/)].map(wardKey).filter(Boolean);
  for (const k of keys) { const hit = list.filter((w) => w.key === k); if (hit.length === 1) return hit[0]; }
  // Ward names that repeat their LGA's name (Sabon Gari Taura in Taura).
  for (const k of keys) { const hit = list.filter((w) => w.short && w.short === k); if (hit.length === 1) return hit[0]; }
  for (const k of keys) { const hit = list.filter((w) => close(k, w.key) || (w.short && close(k, w.short))); if (hit.length === 1) return hit[0]; }
  return null;
}

// POST /api/datasets/:id/population  { year, source, commit, rows: [{ row, state, lga, lgaId | wardId, ward?, wardAlt?, values: { fieldId: value } }] }
// A row with a ward name (and its LGA) is matched to a ward loaded in the app by name.
// A row with wardId is a ward's figure; wards not loaded in the app yet are skipped (not an error).
export async function importPopulation(request, env, ctx, { id }) {
  const ds = await loadShared(env.DB, ctx, id);
  const body = await readJson(request, 3_000_000);
  const { year, source } = validate(v.object({ year: v.string({ pattern: YEAR_RE }), source: v.string({ max: 200 }).optional() }), body);
  if (Number(year) < 2000 || Number(year) > new Date().getUTCFullYear() + 10) throw new HttpError(422, 'invalid', 'Choose a year between 2000 and ten years from now.', { field: 'year' });
  const commit = body.commit === true;
  if (commit && !source) throw new HttpError(422, 'invalid', 'Say where the figures come from (e.g. “NPC 2026 projections”).', { field: 'source' });
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(422, 'invalid', 'No rows found in the file.');
  if (body.rows.length > (commit ? MAX_COMMIT : MAX_ROWS)) throw new HttpError(422, 'too_many', 'Too many rows in one request.');

  const fields = new Map((await all(env.DB, 'SELECT * FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL', ds.id)).map((f) => [f.id, f]));
  // Every LGA in scope, also in states not taking part yet: their figures are ready when a state is switched on.
  const lgas = (await all(env.DB, `SELECT l.id, l.name, l.path, s.name AS state_name FROM org_units l JOIN org_units s ON s.id = l.parent_id WHERE l.level = 3`)).filter((l) => inScope(ctx, l));
  const byId = new Map(lgas.map((l) => [l.id, l]));
  const wardIds = [...new Set(body.rows.map((r) => r && r.wardId).filter(Boolean).map(String))];
  const wards = new Map();
  for (let i = 0; i < wardIds.length; i += 90) {
    const part = wardIds.slice(i, i + 90);
    for (const w of await all(env.DB, `SELECT w.id, w.name, w.path, l.name AS state_name FROM org_units w JOIN org_units l ON l.id = w.parent_id
        WHERE w.unit_type_id = 'ut_ward' AND w.id IN (${part.map(() => '?').join(',')})`, ...part)) if (inScope(ctx, w)) wards.set(w.id, w);
  }
  const byName = new Map();
  for (const l of lgas) {
    byName.set(looseName(l.state_name) + '|' + looseName(l.name), l);
    const k = 'lga|' + looseName(l.name); byName.set(k, byName.has(k) ? 'ambiguous' : l);
  }
  const existing = new Map((await all(env.DB, `SELECT de_id, ou_id, value FROM data_values WHERE period = ? AND de_id IN (SELECT id FROM data_elements WHERE dataset_id = ?)`, year, ds.id))
    .map((x) => [x.ou_id + '|' + x.de_id, x.value]));

  // Wards named by their LGA and name (e.g. a file summed from GRID3 ward boundaries).
  const byLgaWards = new Map();
  const namedLgas = [...new Set(body.rows.filter((r) => r && r.ward && !r.wardId && r.lgaId).map((r) => String(r.lgaId).trim()))];
  for (let i = 0; i < namedLgas.length; i += 90) {
    const part = namedLgas.slice(i, i + 90);
    for (const w of await all(env.DB, `SELECT w.id, w.name, w.path, w.parent_id, l.name AS state_name FROM org_units w JOIN org_units l ON l.id = w.parent_id
        WHERE w.unit_type_id = 'ut_ward' AND w.closed_at IS NULL AND w.parent_id IN (${part.map(() => '?').join(',')})`, ...part)) {
      if (!inScope(ctx, w)) continue;
      if (!byLgaWards.has(w.parent_id)) byLgaWards.set(w.parent_id, []);
      const key = wardKey(w.name); const lgaKey = wardKey(w.state_name).replace(/lga$/, '');
      const short = lgaKey.length >= 3 && key !== lgaKey && (key.startsWith(lgaKey) || key.endsWith(lgaKey)) ? key.replace(lgaKey, '') : '';
      byLgaWards.get(w.parent_id).push({ ...w, key, short });
    }
  }
  const results = []; const counts = { lgas: 0, values: 0, changed: 0, error: 0 };
  const writes = []; const seen = new Set();
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] || {};
    const rowNo = Number(r.row) || i + 2;
    const err = (m) => { counts.error++; results.push({ row: rowNo, lga: r.lga || r.lgaId || '', status: 'error', message: m }); };
    if (r.ward && !r.wardId && r.lgaId) {
      const list = byLgaWards.get(String(r.lgaId).trim());
      const skip = (m) => { counts.skipped = (counts.skipped || 0) + 1; results.push({ row: rowNo, lga: `${r.ward} (${r.lga || r.lgaId})`, status: 'skipped', message: m }); };
      if (!list) { skip('This LGA’s wards are not loaded in the app yet.'); continue; }
      const w = findWard(list, r);
      if (!w) { skip('No ward of this name in the LGA.'); continue; }
      if (seen.has(w.id)) { skip(`Matched ${w.name}, which another row already filled.`); continue; }
      r.__ou = w;
    } else if (r.wardId) {
      const w = wards.get(String(r.wardId).trim());
      if (!w) { counts.skipped = (counts.skipped || 0) + 1; results.push({ row: rowNo, lga: r.ward || r.wardId, status: 'skipped', message: 'Ward not loaded in the app yet.' }); continue; }
      r.__ou = w;
    }
    let lga = r.__ou ? r.__ou : r.lgaId ? byId.get(String(r.lgaId).trim()) : (r.state ? byName.get(looseName(r.state) + '|' + looseName(r.lga)) : byName.get('lga|' + looseName(r.lga)));
    if (lga === 'ambiguous') { err(`More than one LGA is called “${r.lga}”. Keep the State or LGA ID column.`); continue; }
    if (!lga) { err(r.lgaId ? `LGA ID ${r.lgaId} is not an LGA in your area.` : `LGA “${r.lga || ''}” was not found. Keep the LGA ID column from the template.`); continue; }
    if (seen.has(lga.id)) { err(`${lga.name} appears more than once.`); continue; }
    seen.add(lga.id);
    const vals = r.values && typeof r.values === 'object' ? r.values : {};
    let bad = null; let n = 0; let changed = 0;
    for (const [fid, raw] of Object.entries(vals)) {
      const f = fields.get(fid);
      if (!f) { bad = 'Unknown column.'; break; }
      if (f.calc_base) continue; // calculated from Total population, not imported
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;
      const num = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]/g, ''));
      if (!Number.isFinite(num) || num < 0) { bad = `“${f.name}” must be a number of 0 or more (got “${raw}”).`; break; }
      const val = f.value_type === 'INTEGER' ? Math.round(num) : num;
      if (f.max_value !== null && val > f.max_value) { bad = `“${f.name}” must be at most ${f.max_value}.`; break; }
      n++;
      if (existing.get(lga.id + '|' + fid) !== val) changed++;
      writes.push([fid, lga.id, val]);
    }
    if (bad) { err(bad); continue; }
    if (!n) { results.push({ row: rowNo, lga: lga.name, status: 'empty' }); continue; }
    if (r.__ou) counts.wards = (counts.wards || 0) + 1; else counts.lgas++;
    counts.values += n; counts.changed += changed;
    results.push({ row: rowNo, lga: lga.name, state: lga.state_name, status: changed ? 'changed' : 'same', values: n });
  }
  if (commit) {
    if (counts.error) throw new HttpError(422, 'import_errors', `Fix the ${counts.error} row(s) with problems first; nothing was saved.`, { counts, results: results.filter((x) => x.status === 'error') });
    const t = now();
    const stmts = [];
    // Multi-row upserts keep the number of database statements small (D1 allows 100 bound values per statement).
    for (let i = 0; i < writes.length; i += 16) {
      const part = writes.slice(i, i + 16);
      stmts.push(env.DB.prepare(`INSERT INTO data_values (de_id, ou_id, period, value, updated_by, updated_at) VALUES ${part.map(() => '(?,?,?,?,?,?)').join(',')}
        ON CONFLICT(de_id, ou_id, period) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(...part.flatMap(([fid, ou, val]) => [fid, ou, year, val, ctx.user.id, t])));
    }
    // Official figures count as accepted reports for the year.
    const ous = [...new Set(writes.map((w) => w[1]))];
    for (let i = 0; i < ous.length; i += 10) {
      const part = ous.slice(i, i + 10);
      stmts.push(env.DB.prepare(`INSERT INTO reports (dataset_id, ou_id, period, status, updated_by, updated_at, submitted_by, submitted_at, reviewed_by, reviewed_at, review_comment)
        VALUES ${part.map(() => "(?,?,?,'accepted',?,?,?,?,?,?,?)").join(',')}
        ON CONFLICT(dataset_id, ou_id, period) DO UPDATE SET status = 'accepted', updated_by = excluded.updated_by, updated_at = excluded.updated_at,
          reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, review_comment = excluded.review_comment`)
        .bind(...part.flatMap((ou) => [ds.id, ou, year, ctx.user.id, t, ctx.user.id, t, ctx.user.id, t, `Imported: ${source}`])));
    }
    for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
    await recalc(env.DB, ds.id, { ouIds: ous, period: year, userId: ctx.user.id });
    await setSetting(env.DB, `popsource:${ds.id}:${year}`, JSON.stringify({ source, by: ctx.user.name, at: t }));
    await audit(env.DB, ctx, 'population_imported', 'dataset', ds.id, { year, source, lgas: counts.lgas, values: counts.values });
  }
  return json({ committed: commit, counts, results });
}
