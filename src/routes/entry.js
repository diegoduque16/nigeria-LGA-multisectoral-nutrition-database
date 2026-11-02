// LGA data entry, submission, and state review (accept / send back).
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { requireRole, requireScope, requireDataset, canEnterElement, inScope, datasetAllowed } from '../lib/auth.js';
import {
  periodMatches, periodName, lastCompletedPeriod, recentPeriods, dueAt, monthsOf, FREQUENCY_NAMES,
} from '../lib/dhis.js';
import { compileIndicators, indicatorValue, round, sharedIdsOf } from '../lib/aggregate.js';
import { unitsOf } from '../lib/units.js';

const STATUS_NAMES = { none: 'Not started', draft: 'Draft', submitted: 'Submitted', accepted: 'Accepted', returned: 'Sent back' };
const EDITABLE = ['none', 'draft', 'returned'];

async function loadDataset(db, id) {
  const d = await one(db, 'SELECT * FROM datasets WHERE id = ?', id);
  if (!d || d.archived_at) throw new HttpError(404, 'not_found', 'Data set not found.');
  return d;
}

function checkPeriod(ds, period) {
  if (!periodMatches(period, ds.frequency)) {
    throw new HttpError(422, 'invalid', `“${ds.name}” is reported ${FREQUENCY_NAMES[ds.frequency].toLowerCase()}; that period does not fit.`, { field: 'period' });
  }
  // Shared population/denominator figures are planning numbers, so the current year can be entered.
  const last = ds.shared ? String(Number(lastCompletedPeriod('YEARLY')) + 1) : lastCompletedPeriod(ds.frequency);
  if (period > last && period.length === last.length) throw new HttpError(422, 'future_period', 'You can only report for periods that have ended.', { field: 'period' });
  if (Number(period.slice(0, 4)) < 2015) throw new HttpError(422, 'invalid', 'That period is too far in the past.', { field: 'period' });
}

// The org unit a report is for: an LGA, or — for unit-reported data sets — a unit (school, facility …) of the
// data set's sector. The caller must cover it (unit users their unit, LGA users their LGA, state officers their state).
async function loadReportingOu(db, ctx, ouId, ds) {
  const ou = await one(db, 'SELECT * FROM org_units WHERE id = ?', ouId);
  if (!ou) throw new HttpError(404, 'not_found', 'Organisation unit not found.');
  if (ds.report_level === 4) {
    const f = unitsOf(ds, 'o');
    if (!(await one(db, `SELECT o.id FROM org_units o WHERE o.id = ? AND ${f.sql}`, ou.id, ...f.args))) {
      throw new HttpError(422, 'invalid', `“${ds.name}” is reported by each unit below the LGA (ward, facility, school …). Choose one of its units.`, { field: 'ou' });
    }
    if (ou.closed_at) throw new HttpError(422, 'invalid', 'This unit is closed.', { field: 'ou' });
  } else if (ou.level !== 3) throw new HttpError(422, 'invalid', 'Data is entered for an LGA.', { field: 'ou' });
  requireScope(ctx, ou);
  return ou;
}

const canEnter = (ctx) => ['sysadmin', 'state', 'lga', 'unit'].includes(ctx.role) && !ctx.apiToken;
// State officers review LGA reports; unit reports can also be reviewed by the LGA.
const canReview = (ctx, ou) => !ctx.apiToken && inScope(ctx, ou) && (['sysadmin', 'state'].includes(ctx.role) || (ctx.role === 'lga' && ou.level >= 4));

async function reportOf(db, dsId, ouId, period) {
  return one(db, 'SELECT * FROM reports WHERE dataset_id = ? AND ou_id = ? AND period = ?', dsId, ouId, period);
}

async function factors(db) {
  return Object.fromEntries((await all(db, 'SELECT id, factor FROM indicator_types')).map((t) => [t.id, t.factor]));
}

async function formFor(db, ctx, ds, ou, period) {
  const fields = await all(db, 'SELECT * FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL ORDER BY sort, name', ds.id);
  const vals = await all(db,
    'SELECT de_id, value, updated_at FROM data_values WHERE ou_id = ? AND period = ? AND de_id IN (SELECT id FROM data_elements WHERE dataset_id = ?)',
    ou.id, period, ds.id);
  const byDe = Object.fromEntries(vals.map((x) => [x.de_id, x.value]));
  const rep = await reportOf(db, ds.id, ou.id, period);
  const status = rep ? rep.status : 'none';
  const locked = !EDITABLE.includes(status);
  const inds = compileIndicators(await all(db, 'SELECT * FROM indicators WHERE dataset_id = ? AND archived_at IS NULL ORDER BY sort, name', ds.id), await factors(db));
  // Shared yearly numbers (population etc.) for this LGA, scaled to this period, so the preview matches the state picture.
  const sharedIds = ds.report_level === 4 ? [] : sharedIdsOf(inds, fields.map((f) => f.id)); // population is per LGA, not per unit
  const preview = { ...byDe };
  const sharedOut = [];
  if (sharedIds.length) {
    const year = period.slice(0, 4);
    const share = monthsOf(period).length / 12;
    const sv = await all(db,
      `SELECT de.id, de.name, de.prorate, dv.value FROM data_elements de
         LEFT JOIN data_values dv ON dv.de_id = de.id AND dv.ou_id = ? AND dv.period = ?
        WHERE de.id IN (${sharedIds.map(() => '?').join(',')})`, ou.id, year, ...sharedIds);
    for (const x of sv) {
      const scaled = x.value === null ? null : x.prorate ? x.value * share : x.value;
      if (scaled !== null) preview[x.id] = scaled;
      sharedOut.push({ id: x.id, name: x.name, year, yearValue: x.value, value: scaled === null ? null : round(scaled, 1), prorate: !!x.prorate });
    }
  }
  const sectorNames = Object.fromEntries((await all(db, 'SELECT id, name FROM sectors')).map((x) => [x.id, x.name]));
  const due = dueAt(period, ds.due_day);
  const users = rep ? await all(db, 'SELECT id, name FROM users WHERE id IN (?, ?, ?)', rep.updated_by || '', rep.submitted_by || '', rep.reviewed_by || '') : [];
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || null;
  return {
    dataset: { id: ds.id, name: ds.name, shared: !!ds.shared, reportLevel: ds.report_level === 4 ? 'UNIT' : 'LGA', frequency: ds.frequency, frequencyName: FREQUENCY_NAMES[ds.frequency] },
    ou: {
      id: ou.id, name: ou.name, level: ou.level,
      type: ou.level >= 4 ? ((await one(db, 'SELECT name FROM unit_types WHERE id = ?', ou.unit_type_id || '')) || {}).name || ou.unit_type || '' : '',
      ward: ou.level === 5 ? ((await one(db, 'SELECT name FROM org_units WHERE id = ?', ou.parent_id)) || {}).name || null : null,
      lga: ou.level >= 4 ? ((await one(db, 'SELECT name FROM org_units WHERE id = ?', ou.lga_id || ou.parent_id)) || {}).name || null : null,
    },
    period, periodName: periodName(period),
    sharedValues: sharedOut,
    periods: (ds.shared ? [String(Number(lastCompletedPeriod('YEARLY')) + 1), ...recentPeriods('YEARLY', 6)] : recentPeriods(ds.frequency, 12)).map((p) => ({ id: p, name: periodName(p) })),
    due: ds.shared ? null : due, overdue: status !== 'submitted' && status !== 'accepted' && now() > due,
    fields: fields.map((f) => ({
      id: f.id, name: f.name, valueType: f.value_type, min: f.min_value, max: f.max_value,
      value: byDe[f.id] ?? null,
      editable: canEnter(ctx) && !locked && canEnterElement(ctx, f.id),
    })),
    indicators: inds.map((i) => {
      const r = indicatorValue(i, preview);
      return { id: i.id, name: i.name, sectorId: i.sector_id, sector: sectorNames[i.sector_id] || '', source: i.source, value: r ? round(r.value, i.decimals) : null };
    }),
    report: {
      status, statusName: STATUS_NAMES[status], locked,
      updatedAt: rep ? rep.updated_at : null, updatedBy: rep ? nameOf(rep.updated_by) : null,
      submittedAt: rep ? rep.submitted_at : null, submittedBy: rep ? nameOf(rep.submitted_by) : null,
      late: !!(rep && rep.submitted_at && rep.submitted_at > due),
      reviewedAt: rep ? rep.reviewed_at : null, reviewedBy: rep ? nameOf(rep.reviewed_by) : null,
      comment: rep ? rep.review_comment : null,
    },
    can: {
      edit: canEnter(ctx) && !locked,
      submit: canEnter(ctx) && !locked,
      review: canReview(ctx, ou) && (status === 'submitted' || status === 'accepted'),
    },
  };
}

// GET /api/entry?dataset=&ou=&period=
export async function getEntry(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const ds = await loadDataset(env.DB, q.get('dataset') || '');
  requireDataset(ctx, ds.id);
  const ou = await loadReportingOu(env.DB, ctx, q.get('ou') || '', ds);
  const period = q.get('period') || (ds.shared ? String(Number(lastCompletedPeriod('YEARLY')) + 1) : lastCompletedPeriod(ds.frequency));
  checkPeriod(ds, period);
  return json(await formFor(env.DB, ctx, ds, ou, period));
}

const keySchema = { dataset: v.string({ min: 1, max: 20 }), ou: v.string({ min: 11, max: 11 }), period: v.string({ min: 4, max: 6 }) };

async function prepare(env, ctx, body) {
  if (!canEnter(ctx)) throw new HttpError(403, 'forbidden', 'Your account cannot enter data.');
  const ds = await loadDataset(env.DB, body.dataset);
  requireDataset(ctx, ds.id);
  const ou = await loadReportingOu(env.DB, ctx, body.ou, ds);
  checkPeriod(ds, body.period);
  const rep = await reportOf(env.DB, ds.id, ou.id, body.period);
  return { ds, ou, rep, status: rep ? rep.status : 'none' };
}

// PUT /api/entry  { dataset, ou, period, values: { fieldId: number | null } }  — saves a draft.
export async function saveEntry(request, env, ctx) {
  const raw = await readJson(request);
  const body = validate(v.object(keySchema), raw);
  const values = raw.values && typeof raw.values === 'object' && !Array.isArray(raw.values) ? raw.values : {};
  if (Object.keys(values).length > 500) throw new HttpError(422, 'invalid', 'Too many values in one save.');
  const { ds, ou, rep, status } = await prepare(env, ctx, body);
  if (!EDITABLE.includes(status)) {
    throw new HttpError(409, 'locked', status === 'accepted'
      ? 'This report has been accepted. Ask your reviewer to send it back if it needs a correction.'
      : 'This report has been submitted and is waiting for review. Ask your reviewer to send it back if it needs a correction.');
  }
  const fields = new Map((await all(env.DB, 'SELECT * FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL', ds.id)).map((f) => [f.id, f]));
  const old = Object.fromEntries((await all(env.DB, 'SELECT de_id, value FROM data_values WHERE ou_id = ? AND period = ?', ou.id, body.period)).map((x) => [x.de_id, x.value]));
  const errors = {};
  const changes = [];
  for (const [deId, val] of Object.entries(values)) {
    const f = fields.get(deId);
    if (!f) { errors[deId] = 'Unknown field.'; continue; }
    if (!canEnterElement(ctx, deId)) { if ((old[deId] ?? null) !== val) errors[deId] = 'You are not assigned to enter this value.'; continue; }
    if (val === null || val === '') { if (deId in old) changes.push([deId, null]); continue; }
    const n = typeof val === 'number' ? val : Number(String(val).replace(/,/g, '').trim());
    if (!Number.isFinite(n)) { errors[deId] = 'Enter a number.'; continue; }
    if (f.value_type === 'INTEGER' && !Number.isInteger(n)) { errors[deId] = 'Enter a whole number.'; continue; }
    if (f.min_value !== null && n < f.min_value) { errors[deId] = `Must be at least ${f.min_value}.`; continue; }
    if (f.max_value !== null && n > f.max_value) { errors[deId] = `Must be at most ${f.max_value}.`; continue; }
    if (old[deId] !== n) changes.push([deId, n]);
  }
  if (Object.keys(errors).length) {
    const first = Object.entries(errors)[0];
    const fname = fields.get(first[0]) ? fields.get(first[0]).name : first[0];
    throw new HttpError(422, 'invalid_values', `${fname}: ${first[1]}`, { errors });
  }
  const t = now();
  const stmts = [];
  for (const [deId, n] of changes) {
    stmts.push(n === null
      ? env.DB.prepare('DELETE FROM data_values WHERE de_id = ? AND ou_id = ? AND period = ?').bind(deId, ou.id, body.period)
      : env.DB.prepare(`INSERT INTO data_values (de_id, ou_id, period, value, updated_by, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(de_id, ou_id, period) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(deId, ou.id, body.period, n, ctx.user.id, t));
    stmts.push(env.DB.prepare('INSERT INTO data_value_history (de_id, ou_id, period, old_value, new_value, changed_by, changed_at) VALUES (?,?,?,?,?,?,?)')
      .bind(deId, ou.id, body.period, old[deId] ?? null, n, ctx.user.id, t));
  }
  stmts.push(rep
    ? env.DB.prepare("UPDATE reports SET status = CASE WHEN status = 'returned' THEN 'returned' ELSE 'draft' END, updated_by = ?, updated_at = ? WHERE dataset_id = ? AND ou_id = ? AND period = ?")
      .bind(ctx.user.id, t, ds.id, ou.id, body.period)
    : env.DB.prepare("INSERT INTO reports (dataset_id, ou_id, period, status, updated_by, updated_at) VALUES (?,?,?,'draft',?,?)")
      .bind(ds.id, ou.id, body.period, ctx.user.id, t));
  await env.DB.batch(stmts);
  if (changes.length) await audit(env.DB, ctx, 'values_saved', 'report', `${ds.id}/${ou.id}/${body.period}`, { changed: changes.length });
  return json(await formFor(env.DB, ctx, ds, ou, body.period));
}

// POST /api/entry/submit  { dataset, ou, period }
export async function submitEntry(request, env, ctx) {
  const body = validate(v.object(keySchema), await readJson(request));
  const { ds, ou, status } = await prepare(env, ctx, body);
  if (!EDITABLE.includes(status) || status === 'none') {
    throw new HttpError(409, status === 'none' ? 'empty' : 'locked', status === 'none' ? 'Enter and save the values first.' : 'This report is already submitted.');
  }
  const missing = await all(env.DB,
    `SELECT name FROM data_elements de WHERE dataset_id = ? AND archived_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM data_values dv WHERE dv.de_id = de.id AND dv.ou_id = ? AND dv.period = ?) ORDER BY sort, name`,
    ds.id, ou.id, body.period);
  if (missing.length) {
    const list = missing.slice(0, 3).map((m) => `“${m.name}”`).join(', ') + (missing.length > 3 ? ` and ${missing.length - 3} more` : '');
    throw new HttpError(422, 'incomplete', `Every value is needed before submitting (enter 0 if there were none). Missing: ${list}.`, { missing: missing.map((m) => m.name) });
  }
  const t = now();
  await run(env.DB, "UPDATE reports SET status = 'submitted', submitted_by = ?, submitted_at = ?, version = version + 1 WHERE dataset_id = ? AND ou_id = ? AND period = ?",
    ctx.user.id, t, ds.id, ou.id, body.period);
  await audit(env.DB, ctx, 'report_submitted', 'report', `${ds.id}/${ou.id}/${body.period}`, { late: t > dueAt(body.period, ds.due_day) });
  return json(await formFor(env.DB, ctx, ds, ou, body.period));
}

// POST /api/entry/review  { dataset, ou, period, action: accept | return, comment }
export async function reviewEntry(request, env, ctx) {
  requireRole(ctx, ['sysadmin', 'state', 'lga']);
  const body = validate(v.object({
    ...keySchema,
    action: v.string({ oneOf: ['accept', 'return'] }),
    comment: v.string({ max: 1000 }).optional(),
  }), await readJson(request));
  const ds = await loadDataset(env.DB, body.dataset);
  requireDataset(ctx, ds.id);
  const ou = await loadReportingOu(env.DB, ctx, body.ou, ds);
  if (!canReview(ctx, ou)) throw new HttpError(403, 'forbidden', 'You cannot review this report.');
  const rep = await reportOf(env.DB, ds.id, ou.id, body.period);
  const status = rep ? rep.status : 'none';
  if (body.action === 'accept' && status !== 'submitted') throw new HttpError(409, 'bad_status', 'Only a submitted report can be accepted.');
  if (body.action === 'return') {
    if (!['submitted', 'accepted'].includes(status)) throw new HttpError(409, 'bad_status', 'Only a submitted or accepted report can be sent back.');
    if (!body.comment) throw new HttpError(422, 'invalid', 'Say what needs to be corrected.', { field: 'comment' });
  }
  await run(env.DB, 'UPDATE reports SET status = ?, reviewed_by = ?, reviewed_at = ?, review_comment = ? WHERE dataset_id = ? AND ou_id = ? AND period = ?',
    body.action === 'accept' ? 'accepted' : 'returned', ctx.user.id, now(), body.comment || null, ds.id, ou.id, body.period);
  await audit(env.DB, ctx, body.action === 'accept' ? 'report_accepted' : 'report_returned', 'report', `${ds.id}/${ou.id}/${body.period}`, { comment: body.comment });
  return json(await formFor(env.DB, ctx, ds, ou, body.period));
}

// GET /api/status?dataset=&state=&lga=&period=  — every LGA (or, for unit-reported data sets, every unit) with its report status.
export async function reportStatus(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const ds = await loadDataset(env.DB, q.get('dataset') || '');
  if (!datasetAllowed(ctx, ds.id)) throw new HttpError(403, 'forbidden', 'You are not assigned to this data set.');
  const period = q.get('period') || lastCompletedPeriod(ds.frequency);
  checkPeriod(ds, period);
  const parts = ctx.ou.path.split('/');
  const stateId = q.get('state') || (ctx.ou.level >= 2 ? parts[2] : '');
  const state = await one(env.DB, 'SELECT * FROM org_units WHERE id = ? AND level = 2', stateId);
  if (!state) throw new HttpError(422, 'invalid', 'Choose a state.', { field: 'state' });
  if (!inScope(ctx, state) && !inScope({ ou: state }, ctx.ou)) throw new HttpError(403, 'out_of_scope', 'That state is outside your area.');
  const unitLevel = ds.report_level === 4;
  const lgaId = q.get('lga') || (ctx.ou.level >= 3 ? parts[3] : '');
  let rows;
  if (unitLevel) {
    const lga = lgaId ? await one(env.DB, 'SELECT * FROM org_units WHERE id = ? AND level = 3 AND parent_id = ?', lgaId, state.id) : null;
    const f = unitsOf(ds, 'o');
    rows = await all(env.DB,
      `SELECT o.id, o.name, l.id AS lga_id, l.name AS lga_name, COALESCE(t.name, o.unit_type) AS unit_type, w.name AS ward_name, o.path,
              r.status, r.submitted_at, r.reviewed_at, r.updated_at, r.review_comment
         FROM org_units o JOIN org_units l ON l.id = o.lga_id
         LEFT JOIN unit_types t ON t.id = o.unit_type_id
         LEFT JOIN org_units w ON w.id = o.parent_id AND w.level = 4 AND o.level = 5
         LEFT JOIN reports r ON r.ou_id = o.id AND r.dataset_id = ? AND r.period = ?
        WHERE ${f.sql} AND o.closed_at IS NULL AND o.path LIKE ? ORDER BY l.name, w.name, o.name LIMIT 5000`,
      ds.id, period, ...f.args, (lga ? lga.path : state.path) + '/%');
  } else {
    rows = await all(env.DB,
      `SELECT o.id, o.name, o.path, r.status, r.submitted_at, r.reviewed_at, r.updated_at, r.review_comment
         FROM org_units o LEFT JOIN reports r ON r.ou_id = o.id AND r.dataset_id = ? AND r.period = ?
        WHERE o.parent_id = ? AND o.level = 3 AND o.closed_at IS NULL ORDER BY o.name`, ds.id, period, state.id);
  }
  const due = dueAt(period, ds.due_day);
  const visible = rows.filter((r) => inScope(ctx, r));
  const counts = { none: 0, draft: 0, submitted: 0, accepted: 0, returned: 0 };
  for (const r of visible) counts[r.status || 'none']++;
  const lgas = unitLevel ? await all(env.DB, 'SELECT id, name, path FROM org_units WHERE parent_id = ? AND level = 3 AND closed_at IS NULL ORDER BY name', state.id) : [];
  return json({
    dataset: { id: ds.id, name: ds.name, frequency: ds.frequency, reportLevel: unitLevel ? 'UNIT' : 'LGA' },
    state: { id: state.id, name: state.name },
    lgaId: unitLevel ? lgaId || '' : '',
    lgaOptions: lgas.filter((l) => inScope(ctx, l) || inScope({ ou: l }, ctx.ou)).map((l) => ({ id: l.id, name: l.name })),
    period, periodName: periodName(period), due,
    periods: recentPeriods(ds.frequency, 12).map((p) => ({ id: p, name: periodName(p) })),
    counts, total: visible.length,
    lgas: visible.map((r) => ({
      id: r.id, name: r.name, lgaId: r.lga_id || null, lgaName: r.lga_name || null, type: r.unit_type || '', ward: r.ward_name || '',
      status: r.status || 'none', statusName: STATUS_NAMES[r.status || 'none'],
      submittedAt: r.submitted_at, late: !!(r.submitted_at && r.submitted_at > due), reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at, comment: r.review_comment,
    })),
  });
}
