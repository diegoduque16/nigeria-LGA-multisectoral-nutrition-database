// Simple setup: data sets (name + reporting frequency) and indicators (name, numerator, denominator, source).
// The numerator and denominator become the fields LGAs fill in ("data elements"); the same name
// in one data set is the same field, so a shared denominator is entered once.
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { requireRole } from '../lib/auth.js';
import { dhisUid, UID_RE, parseExpression, FREQUENCIES, FREQUENCY_NAMES } from '../lib/dhis.js';

const idField = v.string({ pattern: UID_RE }).optional();
const TYPE = { number: 'bWuNrMHEoZ0', percent: 'hmSnCXmLYwt', per1000: 'k7XnYhQ0P2w' };
const SHOW_AS = Object.fromEntries(Object.entries(TYPE).map(([k, id]) => [id, k]));

function requireSetupAdmin(ctx, datasetId) {
  if (ctx.role === 'sysadmin') return;
  if (ctx.role === 'setupadmin' && (ctx.datasets.length === 0 || datasetId === null || ctx.datasets.includes(datasetId))) return;
  throw new HttpError(403, 'forbidden', 'Only an administrator of this data set can change its setup.');
}

async function idFree(db, id) {
  for (const t of ['sectors', 'datasets', 'data_elements', 'indicators', 'org_units']) {
    if (await one(db, `SELECT id FROM ${t} WHERE id = ?`, id)) return false;
  }
  return !(await one(db, 'SELECT id FROM datasets WHERE group_id = ? OR reporting_rate_id = ?', id, id));
}
async function pickId(db, wanted, avoid = []) {
  if (wanted) {
    if (avoid.includes(wanted) || !(await idFree(db, wanted))) throw new HttpError(409, 'id_taken', `The ID ${wanted} is already used.`, { field: 'id' });
    return wanted;
  }
  for (;;) { const id = dhisUid(); if (!avoid.includes(id) && await idFree(db, id)) return id; }
}

async function loadDataset(db, id) {
  const s = await one(db, 'SELECT * FROM datasets WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'not_found', 'Data set not found.');
  return s;
}

const deOut = (d) => ({
  id: d.id, datasetId: d.dataset_id, name: d.name, valueType: d.value_type,
  min: d.min_value, max: d.max_value, sort: d.sort, archived: !!d.archived_at, prorate: d.prorate !== 0,
});

function deIdOf(expr) {
  const m = /^#\{([A-Za-z][A-Za-z0-9]{10})\}$/.exec(String(expr).trim());
  return m ? m[1] : null;
}

function indOut(i, deNames, sectorNames = {}) {
  const numId = deIdOf(i.numerator); const denId = deIdOf(i.denominator);
  return {
    id: i.id, datasetId: i.dataset_id, sectorId: i.sector_id, sector: sectorNames[i.sector_id] || '', name: i.name, shortName: i.short_name, source: i.source,
    numerator: numId ? deNames[numId] || '' : i.numerator_description,
    denominator: i.denominator.trim() === '1' ? '' : denId ? deNames[denId] || '' : i.denominator_description,
    numeratorId: numId, denominatorId: denId,
    numeratorExpression: i.numerator, denominatorExpression: i.denominator,
    showAs: SHOW_AS[i.type_id] || 'number', typeId: i.type_id,
    decimals: i.decimals, sort: i.sort, version: i.version, archived: !!i.archived_at,
  };
}

// ---------- read ----------
export async function getMetadata(request, env, ctx) {
  const sectors = await all(env.DB, 'SELECT * FROM sectors ORDER BY sort, name');
  const datasets = await all(env.DB, 'SELECT * FROM datasets ORDER BY shared DESC, name');
  const des = await all(env.DB, 'SELECT * FROM data_elements ORDER BY dataset_id, sort, name');
  const inds = await all(env.DB, 'SELECT * FROM indicators ORDER BY dataset_id, sort, name');
  const names = Object.fromEntries(des.map((d) => [d.id, d.name]));
  const sectorNames = Object.fromEntries(sectors.map((s) => [s.id, s.name]));
  return json({
    frequencies: Object.entries(FREQUENCY_NAMES).map(([id, name]) => ({ id, name })),
    showAs: [{ id: 'percent', name: 'Percentage' }, { id: 'per1000', name: 'Per 1,000' }, { id: 'number', name: 'Number' }],
    sectors: sectors.map((s) => ({ id: s.id, name: s.name, indicators: inds.filter((i) => i.sector_id === s.id && !i.archived_at).length })),
    datasets: datasets.map((s) => ({
      id: s.id, name: s.name, sectorId: s.sector_id, sector: sectorNames[s.sector_id] || '', shared: !!s.shared, reportLevel: s.report_level === 4 ? 'UNIT' : 'LGA', frequency: s.frequency, frequencyName: FREQUENCY_NAMES[s.frequency], dueDay: s.due_day,
      groupId: s.group_id, reportingRateId: s.reporting_rate_id, archived: !!s.archived_at,
      dataElements: des.filter((d) => d.dataset_id === s.id).map(deOut),
      indicators: inds.filter((i) => i.dataset_id === s.id).map((i) => indOut(i, names, sectorNames)),
    })),
  });
}

// ---------- sectors ----------
// Finds a sector by name (case-insensitive) or creates it.
async function sectorFor(db, name) {
  const clean = name.replace(/\s+/g, ' ').trim();
  const e = await one(db, 'SELECT id FROM sectors WHERE lower(name) = lower(?)', clean);
  if (e) return e.id;
  const id = await pickId(db);
  await run(db, 'INSERT INTO sectors (id, name, created_at) VALUES (?,?,?)', id, clean, now());
  return id;
}

// POST /api/sectors { name } — add a sector (Health, Education, Agriculture, WASH …).
export async function createSector(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const body = validate(v.object({ name: v.string({ min: 2, max: 100 }) }), await readJson(request));
  if (await one(env.DB, 'SELECT id FROM sectors WHERE lower(name) = lower(?)', body.name)) throw new HttpError(409, 'name_taken', 'This sector already exists.');
  const id = await sectorFor(env.DB, body.name);
  await audit(env.DB, ctx, 'sector_created', 'sector', id, { name: body.name });
  return json({ id }, 201);
}

// DELETE /api/sectors/:id — only while nothing uses it.
export async function deleteSector(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin']);
  const s = await one(env.DB, 'SELECT * FROM sectors WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'not_found', 'Sector not found.');
  for (const [table, what] of [['datasets', 'data sets'], ['indicators', 'indicators'], ['org_units', 'org units']]) {
    if (await one(env.DB, `SELECT 1 AS x FROM ${table} WHERE sector_id = ? LIMIT 1`, id)) throw new HttpError(409, 'in_use', `This sector still has ${what}. Remove or move them first.`);
  }
  await run(env.DB, 'DELETE FROM sectors WHERE id = ?', id);
  await audit(env.DB, ctx, 'sector_deleted', 'sector', id, { name: s.name });
  return json({ ok: true });
}

// DELETE /api/datasets/:id — remove a form completely (e.g. a test), only while nothing was reported on it.
// A form with reports is archived instead, so its data stays.
export async function deleteDataset(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin']);
  const ds = await one(env.DB, 'SELECT * FROM datasets WHERE id = ?', id);
  if (!ds) throw new HttpError(404, 'not_found', 'Form not found.');
  if (ds.shared) throw new HttpError(409, 'shared', 'The population figures cannot be deleted.');
  if (await one(env.DB, 'SELECT 1 AS x FROM reports WHERE dataset_id = ? LIMIT 1', id)
    || await one(env.DB, 'SELECT 1 AS x FROM data_values v JOIN data_elements de ON de.id = v.de_id WHERE de.dataset_id = ? LIMIT 1', id)) {
    throw new HttpError(409, 'has_reports', 'Reports were already entered on this form, so it cannot be deleted. Archive it instead: it disappears from data entry and its data is kept.');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM indicator_history WHERE indicator_id IN (SELECT id FROM indicators WHERE dataset_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM indicators WHERE dataset_id = ?').bind(id),
    env.DB.prepare('DELETE FROM user_data_elements WHERE de_id IN (SELECT id FROM data_elements WHERE dataset_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM data_value_history WHERE de_id IN (SELECT id FROM data_elements WHERE dataset_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM data_elements WHERE dataset_id = ?').bind(id),
    env.DB.prepare('DELETE FROM user_datasets WHERE dataset_id = ?').bind(id),
    env.DB.prepare('DELETE FROM datasets WHERE id = ?').bind(id),
  ]);
  await audit(env.DB, ctx, 'dataset_deleted', 'dataset', id, { name: ds.name });
  return json({ ok: true });
}

export async function updateSector(request, env, ctx, { id }) {
  requireRole(ctx, ['sysadmin']);
  const s = await one(env.DB, 'SELECT * FROM sectors WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'not_found', 'Sector not found.');
  const body = validate(v.object({ name: v.string({ min: 1, max: 100 }).optional(), sort: v.number({ int: true, min: 0, max: 1000 }).optional() }), await readJson(request));
  if (body.name && body.name.toLowerCase() !== s.name.toLowerCase() && await one(env.DB, 'SELECT id FROM sectors WHERE lower(name) = lower(?)', body.name)) {
    throw new HttpError(409, 'name_taken', 'A sector with this name already exists.');
  }
  await run(env.DB, 'UPDATE sectors SET name = ?, sort = ? WHERE id = ?', body.name ?? s.name, body.sort ?? s.sort, id);
  await audit(env.DB, ctx, 'sector_updated', 'sector', id, body);
  return json({ ok: true });
}

// ---------- data sets ----------
export async function createDataset(request, env, ctx) {
  requireRole(ctx, ['sysadmin']);
  const body = validate(v.object({
    name: v.string({ min: 1, max: 100 }),
    sector: v.string({ min: 1, max: 100 }).optional(),
    shared: v.boolean().default(false),
    reportLevel: v.string({ oneOf: ['LGA', 'UNIT'] }).default('LGA'),
    frequency: v.string({ oneOf: Object.keys(FREQUENCIES) }).default('MONTHLY'),
    dueDay: v.number({ min: 1, max: 28, int: true }).default(15),
    id: idField, groupId: idField, reportingRateId: idField,
  }), await readJson(request));
  if (body.shared) { body.frequency = 'YEARLY'; body.reportLevel = 'LGA'; }
  else if (!body.sector) throw new HttpError(422, 'invalid', 'Choose the sector this data set belongs to.', { field: 'sector' });
  const sectorId = body.sector ? await sectorFor(env.DB, body.sector) : null;
  if (await one(env.DB, 'SELECT id FROM datasets WHERE name = ?', body.name)) throw new HttpError(409, 'name_taken', 'A data set with this name already exists.');
  const id = await pickId(env.DB, body.id);
  const groupId = await pickId(env.DB, body.groupId, [id]);
  const rrId = await pickId(env.DB, body.reportingRateId, [id, groupId]);
  await run(env.DB, 'INSERT INTO datasets (id, name, sector_id, shared, report_level, frequency, group_id, reporting_rate_id, due_day, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, body.name, sectorId, body.shared ? 1 : 0, body.reportLevel === 'UNIT' ? 4 : 3, body.frequency, groupId, rrId, body.dueDay, now());
  await audit(env.DB, ctx, 'dataset_created', 'dataset', id, { name: body.name, frequency: body.frequency });
  return json({ id, groupId, reportingRateId: rrId }, 201);
}

export async function updateDataset(request, env, ctx, { id }) {
  const s = await loadDataset(env.DB, id);
  requireSetupAdmin(ctx, id);
  const body = validate(v.object({
    name: v.string({ min: 1, max: 100 }).optional(),
    sector: v.string({ min: 1, max: 100 }).optional(),
    reportLevel: v.string({ oneOf: ['LGA', 'UNIT'] }).optional(),
    frequency: v.string({ oneOf: Object.keys(FREQUENCIES) }).optional(),
    dueDay: v.number({ min: 1, max: 28, int: true }).optional(),
    archived: v.boolean().optional(),
  }), await readJson(request));
  if (s.shared && body.frequency && body.frequency !== 'YEARLY') throw new HttpError(422, 'invalid', 'The shared denominators data set is yearly.', { field: 'frequency' });
  const sectorId = body.sector ? await sectorFor(env.DB, body.sector) : s.sector_id;
  const level = body.reportLevel ? (body.reportLevel === 'UNIT' ? 4 : 3) : s.report_level;
  if (s.shared && level === 4) throw new HttpError(422, 'invalid', 'Population figures are entered per LGA.');
  // A form with no (or a removed) sector may always be given one; otherwise sector and who reports are fixed once reports exist.
  const sectorKnown = s.sector_id && await one(env.DB, 'SELECT id FROM sectors WHERE id = ?', s.sector_id);
  if ((level !== s.report_level || (sectorKnown && sectorId !== s.sector_id)) && await one(env.DB, 'SELECT 1 AS x FROM reports WHERE dataset_id = ? LIMIT 1', id)) {
    throw new HttpError(409, 'has_reports', 'Reports already exist for this data set, so who reports it (and its sector) can no longer change. Create a new data set instead.');
  }
  if (body.archived !== undefined && ctx.role !== 'sysadmin') throw new HttpError(403, 'forbidden', 'Only a system administrator can archive a data set.');
  if (body.name && body.name !== s.name && await one(env.DB, 'SELECT id FROM datasets WHERE name = ?', body.name)) throw new HttpError(409, 'name_taken', 'A data set with this name already exists.');
  if (body.frequency && body.frequency !== s.frequency && await one(env.DB, 'SELECT 1 AS x FROM reports WHERE dataset_id = ? LIMIT 1', id)) {
    throw new HttpError(409, 'has_reports', 'Reports already exist for this data set, so its frequency can no longer change. Create a new data set instead.');
  }
  await run(env.DB, 'UPDATE datasets SET name = ?, sector_id = ?, report_level = ?, frequency = ?, due_day = ?, archived_at = ? WHERE id = ?',
    body.name ?? s.name, sectorId, level, body.frequency ?? s.frequency, body.dueDay ?? s.due_day,
    body.archived === undefined ? s.archived_at : body.archived ? now() : null, id);
  await audit(env.DB, ctx, 'dataset_updated', 'dataset', id, body);
  return json({ ok: true });
}

// ---------- fields (numerators / denominators) ----------
// Finds the field with this name in the data set (case-insensitive) or creates it.
// A name that matches a number in the shared denominators data set uses that number instead.
async function fieldFor(db, datasetId, name) {
  const clean = name.replace(/\s+/g, ' ').trim();
  const e = await one(db, 'SELECT * FROM data_elements WHERE dataset_id = ? AND lower(name) = lower(?)', datasetId, clean)
    || await one(db, `SELECT de.* FROM data_elements de JOIN datasets d ON d.id = de.dataset_id
                       WHERE d.shared = 1 AND d.archived_at IS NULL AND de.archived_at IS NULL AND lower(de.name) = lower(?) LIMIT 1`, clean);
  if (e) {
    if (e.archived_at) await run(db, 'UPDATE data_elements SET archived_at = NULL WHERE id = ?', e.id);
    return e.id;
  }
  const id = await pickId(db);
  const sort = (await one(db, 'SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM data_elements WHERE dataset_id = ?', datasetId)).s;
  await run(db, 'INSERT INTO data_elements (id, dataset_id, name, short_name, value_type, min_value, sort, created_at) VALUES (?,?,?,?,?,?,?,?)',
    id, datasetId, clean, clean.slice(0, 50), 'INTEGER', 0, sort, now());
  return id;
}

// Removes a field that no indicator uses any more and that has no values; archives it if it has values.
async function tidyField(db, deId) {
  if (!deId) return;
  if (await one(db, 'SELECT 1 AS x FROM data_elements de JOIN datasets d ON d.id = de.dataset_id WHERE de.id = ? AND d.shared = 1', deId)) return;
  const used = await one(db, 'SELECT COUNT(*) AS n FROM indicators WHERE archived_at IS NULL AND (numerator LIKE ? OR denominator LIKE ?)', `%${deId}%`, `%${deId}%`);
  if (used.n) return;
  const vals = await one(db, 'SELECT COUNT(*) AS n FROM data_values WHERE de_id = ?', deId);
  if (vals.n) await run(db, 'UPDATE data_elements SET archived_at = ? WHERE id = ? AND archived_at IS NULL', now(), deId);
  else {
    await run(db, 'DELETE FROM user_data_elements WHERE de_id = ?', deId);
    await run(db, 'DELETE FROM data_elements WHERE id = ?', deId);
  }
}

// POST /api/datasets/:id/fields { name, prorate } — numbers added directly (used for the shared denominators data set).
export async function createDataElement(request, env, ctx, { datasetId }) {
  const ds = await loadDataset(env.DB, datasetId);
  requireSetupAdmin(ctx, datasetId);
  const body = validate(v.object({ name: v.string({ min: 1, max: 230 }), prorate: v.boolean().default(true) }), await readJson(request));
  if (await one(env.DB, 'SELECT id FROM data_elements WHERE dataset_id = ? AND lower(name) = lower(?) AND archived_at IS NULL', ds.id, body.name)) {
    throw new HttpError(409, 'name_taken', 'This data set already has a number with that name.');
  }
  const id = await fieldFor(env.DB, ds.id, body.name);
  await run(env.DB, 'UPDATE data_elements SET prorate = ? WHERE id = ?', body.prorate ? 1 : 0, id);
  // A population figure added after indicators already asked for a number with the same name: link those
  // indicators to the yearly figure and drop the per-period number (only while nobody has entered values for it).
  if (ds.shared) {
    const twins = await all(env.DB, `SELECT de.id FROM data_elements de JOIN datasets d ON d.id = de.dataset_id
      WHERE d.shared = 0 AND lower(de.name) = lower(?) AND NOT EXISTS (SELECT 1 FROM data_values v WHERE v.de_id = de.id)`, body.name);
    for (const t of twins) {
      for (const col of ['numerator', 'denominator']) {
        await run(env.DB, `UPDATE indicators SET ${col} = replace(${col}, ?, ?), version = version + 1, updated_at = ? WHERE ${col} LIKE ?`, `#{${t.id}}`, `#{${id}}`, now(), `%#{${t.id}}%`);
      }
      await run(env.DB, 'DELETE FROM user_data_elements WHERE de_id = ?', t.id);
      await run(env.DB, 'DELETE FROM data_elements WHERE id = ?', t.id);
    }
  }
  await audit(env.DB, ctx, 'field_created', 'data_element', id, { name: body.name });
  return json({ dataElement: deOut(await one(env.DB, 'SELECT * FROM data_elements WHERE id = ?', id)) }, 201);
}

// Rename a field (fixes a typo everywhere, keeps its values) or set its limits.
export async function updateDataElement(request, env, ctx, { id }) {
  const d = await one(env.DB, 'SELECT * FROM data_elements WHERE id = ?', id);
  if (!d) throw new HttpError(404, 'not_found', 'Field not found.');
  requireSetupAdmin(ctx, d.dataset_id);
  const body = validate(v.object({
    name: v.string({ min: 1, max: 230 }).optional(),
    valueType: v.string({ oneOf: ['INTEGER', 'NUMBER'] }).optional(),
    min: v.number().nullable(),
    max: v.number().nullable(),
    prorate: v.boolean().optional(),
  }), await readJson(request));
  const min = body.min === undefined ? d.min_value : body.min;
  const max = body.max === undefined ? d.max_value : body.max;
  if (min !== null && max !== null && min > max) throw new HttpError(422, 'invalid', 'Minimum must not be above maximum.', { field: 'min' });
  if (body.name && body.name.toLowerCase() !== d.name.toLowerCase() &&
      await one(env.DB, 'SELECT id FROM data_elements WHERE dataset_id = ? AND lower(name) = lower(?)', d.dataset_id, body.name)) {
    throw new HttpError(409, 'name_taken', 'Another field in this data set already has that name.');
  }
  if (body.valueType === 'INTEGER' && d.value_type === 'NUMBER') {
    const frac = await one(env.DB, 'SELECT COUNT(*) AS n FROM data_values WHERE de_id = ? AND value != CAST(value AS INTEGER)', id);
    if (frac.n) throw new HttpError(409, 'has_decimals', 'Some values already have decimals, so this cannot become a whole-number field.');
  }
  await run(env.DB, 'UPDATE data_elements SET name = ?, short_name = ?, value_type = ?, min_value = ?, max_value = ?, prorate = ? WHERE id = ?',
    body.name ?? d.name, (body.name ?? d.name).slice(0, 50), body.valueType ?? d.value_type, min, max,
    body.prorate === undefined ? d.prorate : body.prorate ? 1 : 0, id);
  await audit(env.DB, ctx, 'field_updated', 'data_element', id, body);
  return json({ dataElement: deOut(await one(env.DB, 'SELECT * FROM data_elements WHERE id = ?', id)) });
}

// ---------- indicators ----------
const indicatorSchema = (partial) => {
  const req = (f) => (partial ? f.optional() : f);
  const shape = {
    id: partial ? undefined : idField,
    name: req(v.string({ min: 1, max: 230 })),
    sector: v.string({ min: 1, max: 100 }).optional(),  // defaults to the data set's sector; new names create a sector
    numerator: req(v.string({ min: 1, max: 230 })),
    denominator: v.string({ max: 230 }).optional(),     // empty = a plain count
    source: v.string({ max: 300 }).optional(),
    showAs: v.string({ oneOf: Object.keys(TYPE) }).optional(),
    decimals: v.number({ int: true, min: 0, max: 4 }).optional(),
    shortName: v.string({ min: 1, max: 50 }).optional(),
    description: v.string({ max: 2000 }).optional(),
    sort: v.number({ int: true, min: 0, max: 10000 }).optional(),
    archived: partial ? v.boolean().optional() : undefined,
  };
  for (const k of Object.keys(shape)) if (!shape[k]) delete shape[k];
  return v.object(shape);
};
const schemaFor = indicatorSchema;

function describe(source, description) {
  const parts = [];
  if (description) parts.push(description);
  if (source) parts.push(`Source: ${source}`);
  return parts.join(' — ');
}

export async function createIndicator(request, env, ctx, { datasetId }) {
  const ds = await loadDataset(env.DB, datasetId);
  requireSetupAdmin(ctx, datasetId);
  const body = validate(schemaFor(false), await readJson(request));
  if (await one(env.DB, 'SELECT id FROM indicators WHERE dataset_id = ? AND lower(name) = lower(?) AND archived_at IS NULL', datasetId, body.name)) {
    throw new HttpError(409, 'name_taken', 'This data set already has an indicator with that name.');
  }
  if (ds.shared) throw new HttpError(422, 'invalid', 'The shared denominators data set holds numbers only. Add its numbers with “Add number”, then use them as denominators in other data sets.');
  if (!body.sector && !ds.sector_id) throw new HttpError(422, 'invalid', 'Choose a sector for this indicator.', { field: 'sector' });
  const sectorId = body.sector ? await sectorFor(env.DB, body.sector) : ds.sector_id;
  const id = await pickId(env.DB, body.id);
  const numId = await fieldFor(env.DB, datasetId, body.numerator);
  const den = (body.denominator || '').trim();
  const denId = den ? await fieldFor(env.DB, datasetId, den) : null;
  const showAs = body.showAs || (denId ? 'percent' : 'number');
  const t = now();
  const sort = body.sort ?? ((await one(env.DB, 'SELECT COALESCE(MAX(sort), 0) + 10 AS s FROM indicators WHERE dataset_id = ?', datasetId)).s);
  await run(env.DB,
    `INSERT INTO indicators (id, dataset_id, sector_id, name, short_name, description, source, numerator, denominator, numerator_description,
       denominator_description, type_id, decimals, sort, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    id, ds.id, sectorId, body.name, body.shortName || body.name.slice(0, 50), body.description || '', body.source || '',
    `#{${numId}}`, denId ? `#{${denId}}` : '1', body.numerator.trim(), den || '1', TYPE[showAs],
    body.decimals ?? (showAs === 'number' && !denId ? 0 : 1), sort, t, t);
  await audit(env.DB, ctx, 'indicator_created', 'indicator', id, { name: body.name });
  return json({ indicator: await indicatorById(env.DB, id) }, 201);
}

async function indicatorById(db, id) {
  const i = await one(db, 'SELECT * FROM indicators WHERE id = ?', id);
  const des = await all(db, 'SELECT de.id, de.name FROM data_elements de JOIN datasets d ON d.id = de.dataset_id WHERE de.dataset_id = ? OR d.shared = 1', i.dataset_id);
  const sec = await one(db, 'SELECT id, name FROM sectors WHERE id = ?', i.sector_id);
  return indOut(i, Object.fromEntries(des.map((d) => [d.id, d.name])), sec ? { [sec.id]: sec.name } : {});
}

export async function updateIndicator(request, env, ctx, { id }) {
  const i = await one(env.DB, 'SELECT * FROM indicators WHERE id = ?', id);
  if (!i) throw new HttpError(404, 'not_found', 'Indicator not found.');
  requireSetupAdmin(ctx, i.dataset_id);
  const body = validate(schemaFor(true), await readJson(request));
  const before = await indicatorById(env.DB, id);
  let numerator = i.numerator; let denominator = i.denominator;
  let numDesc = i.numerator_description; let denDesc = i.denominator_description;
  if (body.numerator !== undefined && body.numerator.trim().toLowerCase() !== (before.numerator || '').toLowerCase()) {
    numerator = `#{${await fieldFor(env.DB, i.dataset_id, body.numerator)}}`;
    numDesc = body.numerator.trim();
  }
  if (body.denominator !== undefined && body.denominator.trim().toLowerCase() !== (before.denominator || '').toLowerCase()) {
    const den = body.denominator.trim();
    denominator = den ? `#{${await fieldFor(env.DB, i.dataset_id, den)}}` : '1';
    denDesc = den || '1';
  }
  for (const e of [numerator, denominator]) parseExpression(e); // sanity
  const sectorId = body.sector ? await sectorFor(env.DB, body.sector) : i.sector_id;
  const showAs = body.showAs || (denominator === '1' && body.denominator !== undefined ? 'number' : SHOW_AS[i.type_id]);
  const typeId = TYPE[showAs] || i.type_id;
  const formulaChanged = numerator !== i.numerator || denominator !== i.denominator || typeId !== i.type_id;
  await run(env.DB, 'INSERT OR REPLACE INTO indicator_history (indicator_id, version, snapshot, changed_by, changed_at) VALUES (?,?,?,?,?)',
    id, i.version, JSON.stringify(before), ctx.user.id, now());
  await run(env.DB,
    `UPDATE indicators SET sector_id = ?, name = ?, short_name = ?, description = ?, source = ?, numerator = ?, denominator = ?, numerator_description = ?,
       denominator_description = ?, type_id = ?, decimals = ?, sort = ?, version = ?, updated_at = ?, archived_at = ? WHERE id = ?`,
    sectorId, body.name ?? i.name, body.shortName ?? (body.name ? body.name.slice(0, 50) : i.short_name), body.description ?? i.description,
    body.source ?? i.source, numerator, denominator, numDesc, denDesc, typeId, body.decimals ?? i.decimals, body.sort ?? i.sort,
    formulaChanged ? i.version + 1 : i.version, now(),
    body.archived === undefined ? i.archived_at : body.archived ? now() : null, id);
  if (formulaChanged || body.archived) for (const old of [before.numeratorId, before.denominatorId]) await tidyField(env.DB, old);
  await audit(env.DB, ctx, 'indicator_updated', 'indicator', id, body);
  return json({ indicator: await indicatorById(env.DB, id) });
}

export async function deleteIndicator(request, env, ctx, { id }) {
  const i = await one(env.DB, 'SELECT * FROM indicators WHERE id = ?', id);
  if (!i) throw new HttpError(404, 'not_found', 'Indicator not found.');
  requireSetupAdmin(ctx, i.dataset_id);
  const before = await indicatorById(env.DB, id);
  await run(env.DB, 'UPDATE indicators SET archived_at = ?, updated_at = ? WHERE id = ?', now(), now(), id);
  for (const f of [before.numeratorId, before.denominatorId]) await tidyField(env.DB, f);
  await audit(env.DB, ctx, 'indicator_archived', 'indicator', id, { name: i.name });
  return json({ ok: true });
}

export { describe as indicatorDescription };
