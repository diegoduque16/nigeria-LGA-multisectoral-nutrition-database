// Indicator dictionary: one shared definition per indicator, used by every sector that reports it.
//   code, name, definition, numerator, denominator (empty = a count), show as, source, framework reference,
//   and a suggested sector. A sector's indicator always links to one entry; the same name is the same calculation
//   everywhere, and changing an entry changes it for every sector that uses it.
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { dhisUid } from '../lib/dhis.js';
import { applyIndicatorChange } from './metadata.js';

const SHOW = ['percent', 'per1000', 'number'];
const SHOW_WORDS = { percentage: 'percent', percent: 'percent', '%': 'percent', 'per 1,000': 'per1000', 'per 1000': 'per1000', per1000: 'per1000', number: 'number', count: 'number' };
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

function requireAdmin(ctx) {
  if (!['sysadmin', 'setupadmin'].includes(ctx.role) || ctx.apiToken) throw new HttpError(403, 'forbidden', 'Only administrators can change the indicator dictionary.');
}

const defOut = (d, uses = [], sectors = {}) => ({
  id: d.id, code: d.code || '', name: d.name, definition: d.definition, numerator: d.numerator, denominator: d.denominator,
  showAs: d.show_as, source: d.source, framework: d.framework, sectorId: d.sector_id || null, sector: sectors[d.sector_id] || '',
  archived: !!d.archived_at, uses,
});

const defSchema = (partial) => {
  const req = (f) => (partial ? f.optional() : f);
  return v.object({
    code: v.string({ max: 40 }).optional(),
    name: req(v.string({ min: 1, max: 230 })),
    definition: v.string({ max: 2000 }).optional(),
    numerator: req(v.string({ min: 1, max: 230 })),
    denominator: v.string({ max: 230 }).optional(),
    showAs: v.string({ oneOf: SHOW }).optional(),
    source: v.string({ max: 300 }).optional(),
    framework: v.string({ max: 300 }).optional(),
    sector: v.string({ max: 100 }).optional(),
  });
};

async function sectorIdOf(db, name) {
  if (!clean(name)) return null;
  const s = await one(db, 'SELECT id FROM sectors WHERE lower(name) = lower(?)', clean(name));
  if (!s) throw new HttpError(422, 'invalid', `Unknown sector “${clean(name)}”.`, { field: 'sector' });
  return s.id;
}
async function checkUnique(db, { name, code }, except = '') {
  if (name && await one(db, 'SELECT id FROM indicator_defs WHERE lower(name) = lower(?) AND id != ?', clean(name), except)) {
    throw new HttpError(409, 'name_taken', `“${clean(name)}” is already in the dictionary.`, { field: 'name' });
  }
  if (code && await one(db, 'SELECT id FROM indicator_defs WHERE lower(code) = lower(?) AND id != ?', clean(code), except)) {
    throw new HttpError(409, 'code_taken', `The code ${clean(code)} is already used.`, { field: 'code' });
  }
}

async function insertDef(db, d) {
  const id = 'def_' + dhisUid().toLowerCase();
  const t = now();
  await run(db, `INSERT INTO indicator_defs (id, code, name, definition, numerator, denominator, show_as, source, framework, sector_id, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, id, clean(d.code) || null, clean(d.name), d.definition || '', clean(d.numerator), clean(d.denominator),
  d.showAs || (clean(d.denominator) ? 'percent' : 'number'), d.source || '', d.framework || '', d.sectorId || null, t, t);
  return one(db, 'SELECT * FROM indicator_defs WHERE id = ?', id);
}

// For a new sector indicator: the entry it uses. By id; else by name (the calculation must then match);
// else a new entry.
export async function definitionFor(db, ctx, body, sectorId) {
  if (body.defId) {
    const d = await one(db, 'SELECT * FROM indicator_defs WHERE id = ? AND archived_at IS NULL', body.defId);
    if (!d) throw new HttpError(422, 'invalid', 'That dictionary entry does not exist.', { field: 'defId' });
    return d;
  }
  const byName = await one(db, 'SELECT * FROM indicator_defs WHERE lower(name) = lower(?)', clean(body.name));
  if (byName) {
    if (!same(byName.numerator, body.numerator) || !same(byName.denominator, body.denominator || '')) {
      throw new HttpError(409, 'definition_conflict',
        `“${byName.name}” is already in the indicator dictionary as ${byName.numerator}${byName.denominator ? ' ÷ ' + byName.denominator : ''}. Use that definition (pick it from the dictionary), or give this indicator another name.`,
        { field: 'name', definition: defOut(byName) });
    }
    return byName;
  }
  await checkUnique(db, { code: body.code });
  const d = await insertDef(db, { ...body, sectorId });
  await audit(db, ctx, 'definition_created', 'indicator_def', d.id, { name: d.name });
  return d;
}

// Changes an entry and every sector indicator that uses it.
export async function updateDefinition(db, ctx, id, ch) {
  const d = await one(db, 'SELECT * FROM indicator_defs WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'not_found', 'Dictionary entry not found.');
  const next = {
    code: ch.code !== undefined ? clean(ch.code) || null : d.code,
    name: ch.name !== undefined ? clean(ch.name) : d.name,
    definition: ch.definition ?? d.definition, numerator: ch.numerator !== undefined ? clean(ch.numerator) : d.numerator,
    denominator: ch.denominator !== undefined ? clean(ch.denominator) : d.denominator,
    show_as: ch.showAs ?? (ch.denominator !== undefined && !clean(ch.denominator) ? 'number' : d.show_as),
    source: ch.source ?? d.source, framework: ch.framework ?? d.framework,
    sector_id: ch.sectorId !== undefined ? ch.sectorId : d.sector_id,
  };
  if (!next.name || !next.numerator) throw new HttpError(422, 'invalid', 'An indicator needs a name and a numerator.');
  await checkUnique(db, { name: next.name, code: next.code }, id);
  await run(db, `UPDATE indicator_defs SET code = ?, name = ?, definition = ?, numerator = ?, denominator = ?, show_as = ?, source = ?, framework = ?, sector_id = ?, updated_at = ? WHERE id = ?`,
    next.code, next.name, next.definition, next.numerator, next.denominator, next.show_as, next.source, next.framework, next.sector_id, now(), id);
  const linked = await all(db, 'SELECT * FROM indicators WHERE def_id = ? AND archived_at IS NULL', id);
  for (const i of linked) {
    await applyIndicatorChange(db, ctx, i, {
      name: next.name, numerator: next.numerator, denominator: next.denominator, showAs: next.show_as, source: next.source, description: next.definition,
    });
  }
  await audit(db, ctx, 'definition_updated', 'indicator_def', id, { name: next.name, indicators: linked.length });
  return linked.length;
}

async function listDefs(db) {
  const sectors = Object.fromEntries((await all(db, 'SELECT id, name FROM sectors')).map((s) => [s.id, s.name]));
  const defs = await all(db, 'SELECT * FROM indicator_defs ORDER BY archived_at IS NOT NULL, lower(COALESCE(code, \'\')), lower(name)');
  const uses = await all(db, `SELECT i.id, i.def_id, i.numerator_description, i.denominator_description, d.id AS dataset_id, d.name AS dataset, s.name AS sector
    FROM indicators i JOIN datasets d ON d.id = i.dataset_id LEFT JOIN sectors s ON s.id = i.sector_id
    WHERE i.archived_at IS NULL AND d.archived_at IS NULL AND i.def_id IS NOT NULL`);
  return defs.map((d) => defOut(d, uses.filter((u) => u.def_id === d.id).map((u) => ({
    indicatorId: u.id, datasetId: u.dataset_id, dataset: u.dataset, sector: u.sector || '',
    // Older indicators that were merged into one entry by name but count something else.
    differs: !same(u.numerator_description, d.numerator) || !same(u.denominator_description === '1' ? '' : u.denominator_description, d.denominator),
  })), sectors));
}

// GET /api/dictionary
export async function listDictionary(request, env) { return json({ definitions: await listDefs(env.DB) }); }

// POST /api/dictionary
export async function createDefinition(request, env, ctx) {
  requireAdmin(ctx);
  const b = validate(defSchema(false), await readJson(request));
  await checkUnique(env.DB, b);
  const d = await insertDef(env.DB, { ...b, sectorId: await sectorIdOf(env.DB, b.sector) });
  await audit(env.DB, ctx, 'definition_created', 'indicator_def', d.id, { name: d.name });
  return json({ id: d.id }, 201);
}

// PATCH /api/dictionary/:id
export async function patchDefinition(request, env, ctx, { id }) {
  requireAdmin(ctx);
  const b = validate(defSchema(true), await readJson(request));
  const n = await updateDefinition(env.DB, ctx, id, { ...b, sectorId: b.sector !== undefined ? await sectorIdOf(env.DB, b.sector) : undefined });
  return json({ ok: true, indicatorsUpdated: n });
}

// DELETE /api/dictionary/:id — only while no sector uses it.
export async function deleteDefinition(request, env, ctx, { id }) {
  requireAdmin(ctx);
  if (await one(env.DB, 'SELECT 1 AS x FROM indicators WHERE def_id = ? AND archived_at IS NULL LIMIT 1', id)) {
    throw new HttpError(409, 'in_use', 'A sector uses this indicator. Remove it from that sector first.');
  }
  await run(env.DB, 'DELETE FROM indicator_defs WHERE id = ?', id);
  await audit(env.DB, ctx, 'definition_deleted', 'indicator_def', id, {});
  return json({ ok: true });
}

// POST /api/dictionary/import { rows: [{ code, name, definition, numerator, denominator, showAs, source, framework, sector }], commit }
// Matches by code, else by name; adds the rest. Without commit it only checks.
export async function importDictionary(request, env, ctx) {
  requireAdmin(ctx);
  const body = await readJson(request, 2_000_000);
  if (!Array.isArray(body.rows) || !body.rows.length) throw new HttpError(422, 'invalid', 'No rows found in the file.');
  if (body.rows.length > 2000) throw new HttpError(422, 'too_many', 'Import at most 2,000 indicators at a time.');
  const commit = body.commit === true;
  const defs = await all(env.DB, 'SELECT * FROM indicator_defs');
  const byCode = new Map(defs.filter((d) => d.code).map((d) => [d.code.toLowerCase(), d]));
  const byName = new Map(defs.map((d) => [d.name.toLowerCase(), d]));
  const sectors = new Map((await all(env.DB, 'SELECT id, name FROM sectors')).map((s) => [s.name.toLowerCase(), s.id]));
  const used = new Map((await all(env.DB, 'SELECT def_id, COUNT(*) AS n FROM indicators WHERE archived_at IS NULL AND def_id IS NOT NULL GROUP BY def_id')).map((r) => [r.def_id, r.n]));
  const counts = { add: 0, update: 0, same: 0, error: 0 };
  const results = []; const seenCode = new Set(); const seenName = new Set();
  for (let i = 0; i < body.rows.length; i++) {
    const r = body.rows[i] || {};
    const row = Number(r.row) || i + 2;
    const name = clean(r.name); const code = clean(r.code);
    const err = (m) => { counts.error++; results.push({ row, name, code, status: 'error', message: m }); };
    if (!name && !code && !clean(r.numerator)) continue;
    if (!name) { err('The indicator name is empty.'); continue; }
    if (!clean(r.numerator)) { err('The numerator (what is counted) is empty.'); continue; }
    const showRaw = clean(r.showAs).toLowerCase();
    const showAs = showRaw ? SHOW_WORDS[showRaw] : (clean(r.denominator) ? 'percent' : 'number');
    if (!showAs) { err(`“Show as” must be Percentage, Per 1,000 or Number (got “${r.showAs}”).`); continue; }
    const sectorId = clean(r.sector) ? sectors.get(clean(r.sector).toLowerCase()) : null;
    if (clean(r.sector) && !sectorId) { err(`Unknown sector “${clean(r.sector)}”. Add the sector first, or leave it empty.`); continue; }
    if (code && seenCode.has(code.toLowerCase())) { err(`The code ${code} appears twice in the file.`); continue; }
    if (seenName.has(name.toLowerCase())) { err('The same indicator name appears twice in the file.'); continue; }
    if (code) seenCode.add(code.toLowerCase()); seenName.add(name.toLowerCase());
    const match = (code && byCode.get(code.toLowerCase())) || byName.get(name.toLowerCase());
    const next = { code, name, definition: clean(r.definition), numerator: clean(r.numerator), denominator: clean(r.denominator), showAs, source: clean(r.source), framework: clean(r.framework), sectorId };
    if (match) {
      const other = byName.get(name.toLowerCase());
      if (other && other.id !== match.id) { err(`“${name}” is already the name of another entry (${other.code || 'no code'}).`); continue; }
      const changed = (code && !same(code, match.code || '')) || !same(name, match.name) || !same(next.numerator, match.numerator) || !same(next.denominator, match.denominator)
        || showAs !== match.show_as || (next.definition && next.definition !== match.definition) || (next.source && next.source !== match.source)
        || (next.framework && next.framework !== match.framework) || (sectorId && sectorId !== match.sector_id);
      if (!changed) { counts.same++; results.push({ row, name, code, status: 'same' }); continue; }
      const calc = !same(next.numerator, match.numerator) || !same(next.denominator, match.denominator) || showAs !== match.show_as;
      counts.update++;
      results.push({ row, name, code, status: 'update', note: calc && used.get(match.id) ? `Changes the calculation for ${used.get(match.id)} sector indicator(s) using it.` : null });
      if (commit) {
        await updateDefinition(env.DB, ctx, match.id, {
          code: code || undefined, name, numerator: next.numerator, denominator: next.denominator, showAs,
          definition: next.definition || undefined, source: next.source || undefined, framework: next.framework || undefined, sectorId: sectorId || undefined,
        });
      }
      continue;
    }
    counts.add++;
    results.push({ row, name, code, status: 'add' });
    if (commit) await insertDef(env.DB, next);
  }
  if (commit && counts.error) throw new HttpError(422, 'import_errors', `Fix the ${counts.error} row(s) with problems first; nothing was saved.`);
  if (commit) await audit(env.DB, ctx, 'dictionary_imported', 'indicator_def', null, counts);
  return json({ committed: commit, counts, results });
}
