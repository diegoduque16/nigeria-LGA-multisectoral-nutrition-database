// Reminders: administrators and state officers remind the people whose report is not sent yet. Each email names the
// report, period and due date, links to the upload page, and carries the person's own Excel template (filled with
// what is saved already). Without an email service the same message and link are shown for sharing by hand.
import { HttpError, json, readJson, validate, v, now } from '../lib/util.js';
import { one, all, audit, rateLimit } from '../lib/db.js';
import { requireRole, inScope } from '../lib/auth.js';
import { dueAt, periodName } from '../lib/dhis.js';
import { unitsOf } from '../lib/units.js';
import { loadDataset, checkPeriod, sheetData } from './entry.js';
import { emailConfigured, sendEmail } from '../lib/email.js';
import { entryTemplateSheets, templateFileName } from '../../public/js/template.js';
import { writeWorkbook } from '../../public/js/xlsx.js';

const OPEN = ['none', 'draft', 'returned'];
const fmtDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
const uploadLink = (request, ds, period) => `${new URL(request.url).origin}/#/upload/${ds.id}/${period}`;

// People responsible for the reports still open in the area: LGA accounts (LGA reports) or unit accounts (unit
// reports) attached to that place, active, and assigned to the data set (or to all data sets).
async function openReports(db, ctx, ds, period, area) {
  let places;
  if (ds.report_level === 4) {
    const f = unitsOf(ds, 'o');
    places = await all(db, `SELECT o.id, o.name, o.path, l.name AS lga FROM org_units o JOIN org_units l ON l.id = o.lga_id
      WHERE ${f.sql} AND o.closed_at IS NULL AND o.path LIKE ? ORDER BY l.name, o.name LIMIT 5000`, ...f.args, area.path + '/%');
  } else {
    places = await all(db, `SELECT o.id, o.name, o.path, o.name AS lga FROM org_units o WHERE o.level = 3 AND o.closed_at IS NULL AND (o.id = ? OR o.path LIKE ?) ORDER BY o.name`, area.id, area.path + '/%');
  }
  places = places.filter((p) => inScope(ctx, p));
  const status = new Map((await all(db, 'SELECT ou_id, status FROM reports WHERE dataset_id = ? AND period = ?', ds.id, period)).map((r) => [r.ou_id, r.status]));
  const open = places.filter((p) => OPEN.includes(status.get(p.id) || 'none'));
  const role = ds.report_level === 4 ? 'unit' : 'lga';
  const users = await all(db, `SELECT u.id, u.name, u.email, u.ou_id, u.role FROM users u WHERE u.active = 1 AND u.role = ?
     AND (NOT EXISTS (SELECT 1 FROM user_datasets x WHERE x.user_id = u.id) OR EXISTS (SELECT 1 FROM user_datasets x WHERE x.user_id = u.id AND x.dataset_id = ?))`, role, ds.id);
  const sent = await all(db, `SELECT ref_id, MAX(created_at) AS at FROM audit WHERE action = 'reminder_sent' AND detail LIKE ? GROUP BY ref_id`, `%"dataset":"${ds.id}","period":"${period}"%`);
  const last = new Map(sent.map((r) => [r.ref_id, r.at]));
  return open.map((p) => ({
    id: p.id, name: p.name, lga: p.lga, status: status.get(p.id) || 'none',
    users: users.filter((u) => u.ou_id === p.id).map((u) => ({ id: u.id, name: u.name, email: u.email, lastReminded: last.get(u.id) || null })),
  }));
}

async function setup(env, ctx, q) {
  requireRole(ctx, ['sysadmin', 'state']);
  const ds = await loadDataset(env.DB, q.dataset || '');
  if (ds.shared) throw new HttpError(422, 'invalid', 'Choose a sector report.');
  if (!q.period) throw new HttpError(422, 'invalid', 'Choose the period.', { field: 'period' });
  checkPeriod(ds, q.period);
  let area = q.ou ? await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', q.ou) : ctx.ou;
  if (!area || !inScope(ctx, area)) area = ctx.ou;
  return { ds, period: q.period, area };
}

function message(ds, period, user, link, note) {
  const due = fmtDay(dueAt(period, ds.due_day));
  const pn = periodName(period);
  const text = [
    `Dear ${user.name},`, '',
    `This is a reminder that the report “${ds.name}” for ${pn} has not been sent yet. It is due on ${due}.`, '',
    'Two ways to send it:',
    `1. Fill in the attached Excel template (one row per place you report for), then upload it here: ${link}`,
    '2. Or open the same link and type the numbers in online.', '',
    'Put 0 where there was nothing — every box is needed before the report can be sent.',
    ...(note ? ['', note] : []), '',
    'Thank you.', 'LGA Multi-Sectoral Scorecard Data Reporting System',
  ].join('\n');
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c2321;max-width:560px">
<p>Dear ${esc(user.name)},</p>
<p>This is a reminder that the report <strong>${esc(ds.name)}</strong> for <strong>${esc(pn)}</strong> has not been sent yet. It is due on <strong>${esc(due)}</strong>.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#00704a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Upload or enter the report</a></p>
<p>Two ways to send it:</p>
<ol><li>Fill in the attached Excel template (one row per place you report for), then upload it with the button above.</li><li>Or open the same link and type the numbers in online.</li></ol>
<p>Put <strong>0</strong> where there was nothing — every box is needed before the report can be sent.</p>
${note ? `<p style="background:#fff4dc;padding:10px 12px;border-radius:6px">${esc(note)}</p>` : ''}
<p style="color:#5d6b66;font-size:13px">LGA Multi-Sectoral Scorecard Data Reporting System</p></div>`;
  return { subject: `Reminder: ${ds.name} — ${pn} (due ${due})`, text, html };
}

// GET /api/reminders?dataset=&period=&ou=
export async function reminderList(request, env, ctx) {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  const { ds, period, area } = await setup(env, ctx, q);
  const places = await openReports(env.DB, ctx, ds, period, area);
  const link = uploadLink(request, ds, period);
  return json({
    emailConfigured: emailConfigured(env),
    dataset: { id: ds.id, name: ds.name }, period, periodName: periodName(period), due: dueAt(period, ds.due_day), area: { id: area.id, name: area.name },
    link, places,
    sample: message(ds, period, { name: '[name]' }, link, q.note || '').text,
  });
}

// POST /api/reminders { dataset, period, ou?, userIds: [...], note? } — emails each person with their template.
export async function sendReminders(request, env, ctx) {
  const body = validate(v.object({
    dataset: v.string({ min: 1, max: 20 }), period: v.string({ min: 4, max: 6 }), ou: v.string({ max: 11 }).optional(),
    userIds: v.array(v.string({ min: 1, max: 40 }), { max: 200 }), note: v.string({ max: 600 }).optional(),
  }), await readJson(request));
  const { ds, period, area } = await setup(env, ctx, body);
  if (!emailConfigured(env)) throw new HttpError(409, 'not_configured', 'Email is not set up yet. Share the message and link by hand, or ask the system administrator to connect an email service.');
  await rateLimit(env.DB, 'reminders:' + ctx.user.id, 600, 3600);
  const places = await openReports(env.DB, ctx, ds, period, area);
  const byUser = new Map(); for (const p of places) for (const u of p.users) byUser.set(u.id, u);
  const link = uploadLink(request, ds, period);
  const results = [];
  for (const id of body.userIds) {
    const u = byUser.get(id);
    if (!u) { results.push({ id, ok: false, message: 'Nothing open for this person (already sent, or not responsible).' }); continue; }
    try {
      const full = await one(env.DB, 'SELECT * FROM users WHERE id = ?', id);
      const ou = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', full.ou_id);
      const des = (await all(env.DB, 'SELECT de_id FROM user_data_elements WHERE user_id = ?', id)).map((r) => r.de_id);
      const t = await sheetData(env.DB, { role: full.role, ou, dataElements: des }, ds, period, ou);
      const xlsx = new Uint8Array(await writeWorkbook(entryTemplateSheets(t)).arrayBuffer());
      const m = message(ds, period, u, link, body.note);
      await sendEmail(env, { to: u.email, subject: m.subject, html: m.html, text: m.text, attachments: [{ filename: templateFileName(t), bytes: xlsx }], replyTo: ctx.user.email });
      await audit(env.DB, ctx, 'reminder_sent', 'user', id, { dataset: ds.id, period, email: u.email });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, message: e.message });
    }
  }
  return json({ sent: results.filter((r) => r.ok).length, results, at: now() });
}
