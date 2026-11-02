// LGA data entry, submission, and state review (accept / send back).
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, run, audit } from '../lib/db.js';
import { requireRole, requireScope, requireDataset, canEnterElement, inScope, datasetAllowed } from '../lib/auth.js';
import {
  periodMatches, periodName, lastCompletedPeriod, recentPeriods, dueAt, FREQUENCY_NAMES,
} from '../lib/dhis.js';
import { compileIndicators, indicatorValue, round } from '../lib/aggregate.js';

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
  const last = lastCompletedPeriod(ds.frequency);
  if (period > last && period.length === last.length) throw new HttpError(422, 'future_period', 'You can only report for periods that have ended.', { field: 'period' });
  if (Number(period.slice(0, 4)) < 2015) throw new HttpError(422, 'invalid', 'That period is too far in the past.', { field: 'period' });
}

// The caller may enter data for this LGA: LGA users for their own LGA, state officers for LGAs in their state.
async function loadLga(db, ctx, ouId) {
  const ou = await one(db, 'SELECT * FROM org_units WHERE id = ?', ouId);
  if (!ou) throw new HttpError(404, 'not_found', 'Organisation unit not found.');
  if (ou.level !== 3) throw new HttpError(422, 'invalid', 'Data is entered for an LGA.', { field: 'ou' });
  requireScope(ctx, ou);
  return ou;
}

const canEnter = (ctx) => ['sysadmin', 'state', 'lga'].includes(ctx.role) && !ctx.apiToken;
const canReview = (ctx, ou) => ['sysadmin', 'state'].includes(ctx.role) && inScope(ctx, ou) && !ctx.apiToken;

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
  const sectorNames = Object.fromEntries((await all(db, 'SELECT id, name FROM sectors')).map((x) => [x.id, x.name]));
  const due = dueAt(period, ds.due_day);
  const users = rep ? await all(db, 'SELECT id, name FROM users WHERE id IN (?, ?, ?)', rep.updated_by || '', rep.submitted_by || '', rep.reviewed_by || '') : [];
  const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || null;
  return {
    dataset: { id: ds.id, name: ds.name, frequency: ds.frequency, frequencyName: FREQUENCY_NAMES[ds.frequency] },
    ou: { id: ou.id, name: ou.name },
    period, periodName: periodName(period),
    periods: recentPeriods(ds.frequency, 12).map((p) => ({ id: p, name: periodName(p) })),
    due, overdue: status !== 'submitted' && status !== 'accepted' && now() > due,
    fields: fields.map((f) => ({
      id: f.id, name: f.name, valueType: f.value_type, min: f.min_value, max: f.max_value,
      value: byDe[f.id] ?? null,
      editable: canEnter(ctx) && !locked && canEnterElement(ctx, f.id),
    })),
    indicators: inds.map((i) => {
      const r = indicatorValue(i, byDe);
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
  const ou = await loadLga(env.DB, ctx, q.get('ou') || '');
  const period = q.get('period') || lastCompletedPeriod(ds.frequency);
  checkPeriod(ds, period);
  return json(await formFor(env.DB, ctx, ds, ou, period));
}

const keySchema = { dataset: v.string({ min: 1, max: 20 }), ou: v.string({ min: 11, max: 11 }), period: v.string({ min: 4, max: 6 }) };

async function prepare(env, ctx, body) {
  if (!canEnter(ctx)) throw new HttpError(403, 'forbidden', 'Your account cannot enter data.');
  const ds = await loadDataset(env.DB, body.dataset);
  requireDataset(ctx, ds.id);
  const ou = await loadLga(env.DB, ctx, body.ou);
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
      ? 'This report has been accepted. Ask your state officer to send it back if it needs a correction.'
      : 'This report has been submitted and is waiting for review. Ask your state officer to send it back if it needs a correction.');
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
  requireRole(ctx, ['sysadmin', 'state']);
  const body = validate(v.object({
    ...keySchema,
    action: v.string({ oneOf: ['accept', 'return'] }),
    comment: v.string({ max: 1000 }).optional(),
  }), await readJson(request));
  const ds = await loadDataset(env.DB, body.dataset);
  requireDataset(ctx, ds.id);
  const ou = await loadLga(env.DB, ctx, body.ou);
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

// GET /api/status?dataset=&state=&period=  — every LGA in the state with its report status.
export async function reportStatus(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const ds = await loadDataset(env.DB, q.get('dataset') || '');
  if (!datasetAllowed(ctx, ds.id)) throw new HttpError(403, 'forbidden', 'You are not assigned to this data set.');
  const period = q.get('period') || lastCompletedPeriod(ds.frequency);
  checkPeriod(ds, period);
  const stateId = q.get('state') || (ctx.ou.level === 2 ? ctx.ou.id : ctx.ou.level === 3 ? ctx.ou.path.split('/')[2] : '');
  const state = await one(env.DB, 'SELECT * FROM org_units WHERE id = ? AND level = 2', stateId);
  if (!state) throw new HttpError(422, 'invalid', 'Choose a state.', { field: 'state' });
  if (!inScope(ctx, state) && !inScope({ ou: state }, ctx.ou)) throw new HttpError(403, 'out_of_scope', 'That state is outside your area.');
  const rows = await all(env.DB,
    `SELECT o.id, o.name, r.status, r.submitted_at, r.reviewed_at, r.updated_at, r.review_comment
       FROM org_units o LEFT JOIN reports r ON r.ou_id = o.id AND r.dataset_id = ? AND r.period = ?
      WHERE o.parent_id = ? AND o.level = 3 AND o.closed_at IS NULL ORDER BY o.name`, ds.id, period, state.id);
  const due = dueAt(period, ds.due_day);
  const visible = ctx.ou.level === 3 ? rows.filter((r) => r.id === ctx.ou.id) : rows;
  const counts = { none: 0, draft: 0, submitted: 0, accepted: 0, returned: 0 };
  for (const r of rows) counts[r.status || 'none']++;
  return json({
    dataset: { id: ds.id, name: ds.name, frequency: ds.frequency },
    state: { id: state.id, name: state.name },
    period, periodName: periodName(period), due,
    periods: recentPeriods(ds.frequency, 12).map((p) => ({ id: p, name: periodName(p) })),
    counts, total: rows.length,
    lgas: visible.map((r) => ({
      id: r.id, name: r.name, status: r.status || 'none', statusName: STATUS_NAMES[r.status || 'none'],
      submittedAt: r.submitted_at, late: !!(r.submitted_at && r.submitted_at > due), reviewedAt: r.reviewed_at,
      updatedAt: r.updated_at, comment: r.review_comment,
    })),
  });
}
