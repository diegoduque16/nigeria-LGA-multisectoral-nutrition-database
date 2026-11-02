// Pivot data: every indicator of one sector (or all sectors) for one period, for an area and the units
// one level below it (country → states, state → LGAs, LGA → units for unit-reported data sets).
// The app asks for one period per request and pivots the cells itself (keeps each request small).
import { HttpError, json } from '../lib/util.js';
import { one, all } from '../lib/db.js';
import { inScope, datasetAllowed } from '../lib/auth.js';
import { periodType, periodName } from '../lib/dhis.js';
import {
  compileIndicators, indicatorValue, round, loadLgaTotals, rollUp, sharedIdsOf, STATUSES_FINAL, STATUSES_PROVISIONAL,
} from '../lib/aggregate.js';

const PERCENT_TYPE = 'hmSnCXmLYwt';

// GET /api/pivot?period=202601&ou=&sector=&datasets=a,b&provisional=1
export async function pivot(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const period = q.get('period') || '';
  if (!periodType(period)) throw new HttpError(422, 'invalid', 'Choose a period such as 202601, 2026Q1 or 2026.', { field: 'period' });
  let root = q.get('ou') ? await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', q.get('ou')) : ctx.ou;
  if (!root || !inScope(ctx, root)) throw new HttpError(403, 'out_of_scope', 'That area is outside your account.');
  if (root.level === 4) root = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', root.parent_id);
  const sector = q.get('sector') || '';
  const wanted = q.get('datasets') ? q.get('datasets').split(',') : null;
  const statuses = q.get('provisional') === '1' ? STATUSES_PROVISIONAL : STATUSES_FINAL;

  const sectors = Object.fromEntries((await all(env.DB, 'SELECT id, name FROM sectors')).map((s) => [s.id, s.name]));
  const factors = Object.fromEntries((await all(env.DB, 'SELECT id, factor FROM indicator_types')).map((t) => [t.id, t.factor]));
  const datasets = (await all(env.DB, 'SELECT * FROM datasets WHERE archived_at IS NULL AND shared = 0 ORDER BY name'))
    .filter((d) => datasetAllowed(ctx, d.id) && (!wanted || wanted.includes(d.id)));
  const children = root.level === 1 ? await all(env.DB, 'SELECT id, name FROM org_units WHERE level = 2 AND parent_id = ? ORDER BY name', root.id)
    : root.level === 2 ? await all(env.DB, 'SELECT id, name FROM org_units WHERE level = 3 AND parent_id = ? AND closed_at IS NULL ORDER BY name', root.id) : [];

  const indicators = []; const cells = []; const skipped = []; const ous = new Map([[root.id, { id: root.id, name: root.name, level: root.level, total: true }]]);
  for (const c of children) ous.set(c.id, { id: c.id, name: c.name, level: root.level + 1 });
  for (const ds of datasets) {
    const rows = await all(env.DB,
      `SELECT * FROM indicators WHERE dataset_id = ? AND archived_at IS NULL ${sector ? 'AND sector_id = ?' : ''} ORDER BY sort, name`, ...(sector ? [ds.id, sector] : [ds.id]));
    if (!rows.length && sector && ds.sector_id !== sector) continue;
    const inds = compileIndicators(rows, factors);
    const ownIds = (await all(env.DB, 'SELECT id FROM data_elements WHERE dataset_id = ?', ds.id)).map((f) => f.id);
    const perUnit = root.level === 3 && ds.report_level === 4;
    let totals;
    try { totals = await loadLgaTotals(env.DB, ds, period, root, statuses, sharedIdsOf(inds, ownIds), { perUnit }); } catch (e) {
      if (e.code === 'period_mismatch') { skipped.push(ds.name); continue; } throw e;
    }
    for (const i of inds) indicators.push({ id: i.id, name: i.name, sector: sectors[i.sector_id] || '', dataset: ds.name, percent: i.type_id === PERCENT_TYPE, decimals: i.decimals });
    const rr = { id: ds.reporting_rate_id, name: `${ds.name} – reporting rate`, sector: sectors[ds.sector_id] || '', dataset: ds.name, percent: true, decimals: 1, reportingRate: true };
    indicators.push(rr);
    const lgaList = [...totals.lgas.values()];
    const groups = [[root.id, lgaList]];
    if (root.level === 1) for (const c of children) groups.push([c.id, lgaList.filter((l) => l.stateId === c.id)]);
    if (root.level === 2) for (const l of lgaList) groups.push([l.id, [l]]);
    if (perUnit) for (const u of totals.units.values()) { ous.set(u.id, { id: u.id, name: u.name, level: 4 }); groups.push([u.id, [u]]); }
    for (const [ouId, members] of groups) {
      const r = rollUp(members, totals.subPeriods.length);
      if (!r.expected) continue;
      cells.push({ dx: rr.id, pe: period, ou: ouId, v: round(r.reportingRate, 1), n: r.reported, d: r.expected });
      if (!r.reported) continue;
      for (const i of inds) {
        const c = indicatorValue(i, r.values);
        if (c) cells.push({ dx: i.id, pe: period, ou: ouId, v: round(c.value, i.decimals), n: c.numerator, d: c.denominator });
      }
    }
  }
  return json({
    period: { id: period, name: periodName(period) },
    area: { id: root.id, name: root.name, level: root.level },
    indicators, ous: [...ous.values()], cells, skipped,
  });
}
