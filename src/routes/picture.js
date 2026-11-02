// State picture (tables only, no charts) and JSON exports in the ALMA Export format.
import { HttpError, json } from '../lib/util.js';
import { one, all, audit } from '../lib/db.js';
import { inScope, datasetAllowed } from '../lib/auth.js';
import { periodType, periodName, periodRange, lastCompletedPeriod, FREQUENCY_NAMES } from '../lib/dhis.js';
import {
  compileIndicators, indicatorValue, round, loadLgaTotals, rollUp, sharedIdsOf, STATUSES_FINAL, STATUSES_PROVISIONAL,
} from '../lib/aggregate.js';
import { indicatorDescription } from './metadata.js';

const PERCENT_TYPE = 'hmSnCXmLYwt';

async function indicatorsOf(db, datasetId, sector) {
  return sector
    ? all(db, 'SELECT * FROM indicators WHERE dataset_id = ? AND sector_id = ? AND archived_at IS NULL ORDER BY sort, name', datasetId, sector)
    : all(db, 'SELECT * FROM indicators WHERE dataset_id = ? AND archived_at IS NULL ORDER BY sort, name', datasetId);
}

async function factorMap(db) {
  return Object.fromEntries((await all(db, 'SELECT id, factor FROM indicator_types')).map((t) => [t.id, t.factor]));
}

async function loadOu(db, ctx, id) {
  const ou = id ? await one(db, 'SELECT * FROM org_units WHERE id = ?', id) : ctx.ou;
  if (!ou) throw new HttpError(404, 'not_found', 'Organisation unit not found.');
  if (!inScope(ctx, ou)) throw new HttpError(403, 'out_of_scope', 'That organisation unit is outside your area.');
  return ou;
}

function cell(ind, values) {
  const r = indicatorValue(ind, values);
  return r ? { value: round(r.value, ind.decimals), numerator: r.numerator, denominator: r.denominator } : null;
}

// GET /api/picture?dataset=&ou=&period=&provisional=1
// For a state: one row per LGA plus the state total. For the country: one row per state plus the national total.
export async function picture(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const ds = await one(env.DB, 'SELECT * FROM datasets WHERE id = ?', q.get('dataset') || '');
  if (!ds) throw new HttpError(404, 'not_found', 'Data set not found.');
  if (!datasetAllowed(ctx, ds.id)) throw new HttpError(403, 'forbidden', 'You are not assigned to this data set.');
  let ou = await loadOu(env.DB, ctx, q.get('ou'));
  if (ou.level === 3) ou = await one(env.DB, 'SELECT * FROM org_units WHERE id = ?', ou.parent_id);
  const period = q.get('period') || lastCompletedPeriod(ds.frequency);
  if (!periodType(period)) throw new HttpError(422, 'invalid', 'Unknown period.', { field: 'period' });
  const provisional = q.get('provisional') === '1';
  const statuses = provisional ? STATUSES_PROVISIONAL : STATUSES_FINAL;
  const inds = compileIndicators(await indicatorsOf(env.DB, ds.id, q.get('sector')), await factorMap(env.DB));
  const own = await all(env.DB, 'SELECT id, name FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL ORDER BY sort, name', ds.id);
  const sharedIds = sharedIdsOf(inds, own.map((f) => f.id));
  const shared = sharedIds.length ? await all(env.DB, `SELECT id, name FROM data_elements WHERE id IN (${sharedIds.map(() => '?').join(',')}) ORDER BY sort, name`, ...sharedIds) : [];
  const fields = [...own, ...shared.map((f) => ({ ...f, shared: true }))];
  const { subPeriods, lgas } = await loadLgaTotals(env.DB, ds, period, ou, statuses, sharedIds);
  const sectorNames = Object.fromEntries((await all(env.DB, 'SELECT id, name FROM sectors')).map((x) => [x.id, x.name]));

  const lgaList = [...lgas.values()];
  let rows;
  if (ou.level === 1) {
    const states = await all(env.DB, 'SELECT id, name FROM org_units WHERE level = 2 AND parent_id = ? ORDER BY name', ou.id);
    rows = states.map((s) => ({ id: s.id, name: s.name, level: 2, ...summarize(rollUp(lgaList.filter((l) => l.stateId === s.id), subPeriods.length), inds, fields) }));
  } else {
    rows = lgaList.map((l) => ({ id: l.id, name: l.name, level: 3, ...summarize(rollUp([l], subPeriods.length), inds, fields), statuses: l.statuses }));
  }
  const total = { id: ou.id, name: ou.name, level: ou.level, ...summarize(rollUp(lgaList, subPeriods.length), inds, fields) };
  return json({
    dataset: { id: ds.id, name: ds.name, frequency: ds.frequency, frequencyName: FREQUENCY_NAMES[ds.frequency] },
    ou: { id: ou.id, name: ou.name, level: ou.level },
    period, periodName: periodName(period), subPeriods, provisional,
    indicators: inds.map((i) => ({ id: i.id, name: i.name, sectorId: i.sector_id, sector: sectorNames[i.sector_id] || '', source: i.source, percent: i.type_id === PERCENT_TYPE, numerator: i.numerator_description, denominator: i.denominator === '1' ? '' : i.denominator_description })),
    fields,
    total, rows,
  });
}

function summarize(r, inds, fields) {
  return {
    reportingUnits: r.reportingUnits, totalUnits: r.totalUnits,
    reported: r.reported, expected: r.expected,
    reportingRate: r.reportingRate === null ? null : round(r.reportingRate, 1),
    indicators: Object.fromEntries(inds.map((i) => [i.id, r.reported ? cell(i, r.values) : null])),
    values: Object.fromEntries(fields.map((f) => [f.id, r.reported ? (r.values[f.id] ?? 0) : null])),
  };
}

// ---------- exports ----------
// ?datasets=a,b narrows the data sets; ?sector=id narrows the indicators (see indicatorsOf).
async function exportDatasets(db, ctx, param) {
  const all_ = await all(db, 'SELECT * FROM datasets WHERE archived_at IS NULL ORDER BY name');
  const wanted = param ? param.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const list = all_.filter((d) => (!wanted || wanted.includes(d.id)) && datasetAllowed(ctx, d.id));
  if (!list.length) throw new HttpError(422, 'invalid', 'No data sets to export.', { field: 'datasets' });
  return list;
}

// Org units the export covers: the caller's scope plus the units above it (so parents resolve).
// Sector units (level 4: schools, facilities ...) are included only when asked for, optionally for one sector.
async function exportOrgUnits(db, root, units = null) {
  const ancestors = root.path.split('/').filter(Boolean).slice(0, -1);
  const below = (await all(db, 'SELECT id, name, level, parent_id, closed_at, sector_id FROM org_units WHERE (id = ? OR path LIKE ?) AND closed_at IS NULL ORDER BY level, name', root.id, root.path + '/%'))
    .filter((o) => o.level <= 3 || (units && (units === 'all' || o.sector_id === units)));
  const above = ancestors.length ? await all(db, `SELECT id, name, level, parent_id, closed_at FROM org_units WHERE id IN (${ancestors.map(() => '?').join(',')}) ORDER BY level`, ...ancestors) : [];
  return [...above, ...below];
}

function attachment(name) {
  return { 'content-disposition': `attachment; filename="${name}"` };
}

// GET /api/export/metadata?datasets=a,b&ou=  -> organisationUnits_indicators.json
export async function exportMetadata(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const root = await loadOu(env.DB, ctx, q.get('ou'));
  const datasets = await exportDatasets(env.DB, ctx, q.get('datasets'));
  const inc = q.get('units');
  const units = await exportOrgUnits(env.DB, root, inc ? (inc === 'all' ? 'all' : inc) : null);
  const types = Object.fromEntries((await all(env.DB, 'SELECT id, name FROM indicator_types')).map((t) => [t.id, t.name]));
  const indicators = [];
  for (const ds of datasets) {
    const rows = await indicatorsOf(env.DB, ds.id, q.get('sector'));
    for (const i of rows) {
      indicators.push({
        id: i.id,
        name: i.name,
        shortName: i.short_name,
        description: indicatorDescription(i.source, i.description) || i.name,
        numeratorDescription: i.numerator_description,
        denominatorDescription: i.denominator_description,
        indicatorType: { id: i.type_id, name: types[i.type_id] },
        indicatorGroups: [{ id: ds.group_id }, { id: i.sector_id }],
      });
    }
    indicators.push({
      id: ds.reporting_rate_id,
      name: `${ds.name} – reporting rate`,
      shortName: `${ds.name} RR`.slice(0, 50),
      description: `Share of expected ${FREQUENCY_NAMES[ds.frequency].toLowerCase()} ${ds.name} reports that were received.`,
      numeratorDescription: 'Reports received',
      denominatorDescription: 'Reports expected',
      indicatorType: { id: PERCENT_TYPE, name: types[PERCENT_TYPE] },
      indicatorGroups: [{ id: ds.group_id }],
    });
  }
  const body = {
    organisationUnits: {
      organisationUnits: units.map((o) => (o.level === 1 || !o.parent_id
        ? { id: o.id, name: o.name, level: o.level }
        : { id: o.id, parent: { id: o.parent_id }, name: o.name, level: o.level })),
    },
    indicators,
  };
  await audit(env.DB, ctx, 'export_metadata', null, null, { datasets: datasets.map((d) => d.id), ou: root.id });
  return json(body, 200, attachment('organisationUnits_indicators.json'));
}

const header = (name, column, valueType) => ({
  name, column, valueType, type: valueType === 'NUMBER' ? 'java.lang.Double' : 'java.lang.String', hidden: false, meta: name !== 'value',
});

// GET /api/export/data?datasets=&period=202601[,202602|..]&from=&to=&ou=&levels=1,2,3&provisional=1
//   -> dataValues_<period>.json
export async function exportData(request, env, ctx) {
  const q = new URL(request.url).searchParams;
  const root = await loadOu(env.DB, ctx, q.get('ou'));
  const datasets = await exportDatasets(env.DB, ctx, q.get('datasets'));
  let periods;
  if (q.get('from') && q.get('to')) periods = periodRange(q.get('from'), q.get('to'), 36);
  else periods = (q.get('period') || '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!periods || !periods.length || periods.length > 36 || periods.some((p) => !periodType(p))) {
    throw new HttpError(422, 'invalid', 'Give one or more periods such as 202601, 2026Q1 or 2026 (up to 36).', { field: 'period' });
  }
  const levels = (q.get('levels') || '1,2,3').split(',').map(Number).filter((n) => [1, 2, 3].includes(n));
  const statuses = q.get('provisional') === '1' ? STATUSES_PROVISIONAL : STATUSES_FINAL;
  const factors = await factorMap(env.DB);
  const units = await exportOrgUnits(env.DB, root);
  const unitById = new Map(units.map((u) => [u.id, u]));

  const items = {};
  const dims = { dx: [], pe: [], ou: [], co: [] };
  const rows = [];
  const seenOu = new Set();
  const skipped = [];

  for (const ds of datasets) {
    const inds = compileIndicators(await indicatorsOf(env.DB, ds.id, q.get('sector')), factors);
    const ownIds = (await all(env.DB, 'SELECT id FROM data_elements WHERE dataset_id = ?', ds.id)).map((f) => f.id);
    const sharedIds = sharedIdsOf(inds, ownIds);
    for (const i of inds) { items[i.id] = { name: i.name }; if (!dims.dx.includes(i.id)) dims.dx.push(i.id); }
    items[ds.reporting_rate_id] = { name: `${ds.name} – reporting rate` };
    if (!dims.dx.includes(ds.reporting_rate_id)) dims.dx.push(ds.reporting_rate_id);

    for (const pe of periods) {
      let totals;
      try { totals = await loadLgaTotals(env.DB, ds, pe, root, statuses, sharedIds); } catch (e) {
        if (e.code === 'period_mismatch') { skipped.push(`${ds.name} ${pe}`); continue; } else throw e;
      }
      const { subPeriods, lgas } = totals;
      const lgaList = [...lgas.values()];
      // Groups: each LGA, each state, the country (whichever are within scope and requested).
      const groups = [];
      if (levels.includes(3)) for (const l of lgaList) groups.push([l.id, [l]]);
      if (levels.includes(2)) {
        for (const u of units) {
          if (u.level !== 2 || (root.level === 2 && u.id !== root.id) || root.level === 3) continue;
          groups.push([u.id, lgaList.filter((l) => l.stateId === u.id)]);
        }
      }
      if (levels.includes(1) && root.level === 1) groups.push([root.id, lgaList]);

      for (const [ouId, members] of groups) {
        const r = rollUp(members, subPeriods.length);
        if (!r.totalUnits) continue;
        let any = false;
        if (r.reported) {
          for (const i of inds) {
            const c = indicatorValue(i, r.values);
            if (!c) continue;
            rows.push([i.id, pe, ouId, String(round(c.value, i.decimals))]);
            any = true;
          }
        }
        rows.push([ds.reporting_rate_id, pe, ouId, String(round(r.reportingRate, 1))]);
        any = true;
        if (any) seenOu.add(ouId);
      }
      if (!dims.pe.includes(pe)) { dims.pe.push(pe); items[pe] = { name: periodName(pe) }; }
    }
  }
  for (const id of seenOu) {
    const u = unitById.get(id);
    items[id] = { name: u ? u.name : id };
    dims.ou.push(id);
  }
  if (!rows.length) {
    throw new HttpError(422, 'no_data', skipped.length ? `Nothing to export: ${skipped[0]} does not match the data set’s reporting frequency.` : 'No data values were found for the selected data sets, periods and area.');
  }
  const headers = [header('dx', 'Data', 'TEXT'), header('pe', 'Period', 'TEXT'), header('ou', 'Organisation unit', 'TEXT'), header('value', 'Value', 'NUMBER')];
  const merged = { headers, metaData: { items, dimensions: dims }, width: headers.length, rows, height: rows.length, headerWidth: headers.length };
  const suffix = periods.length === 1 ? periods[0] : `${periods[0]}-${periods[periods.length - 1]}`;
  await audit(env.DB, ctx, 'export_data', null, null, { datasets: datasets.map((d) => d.id), periods, ou: root.id, rows: rows.length });
  return json({ dataValues: [merged] }, 200, attachment(`dataValues_${suffix}.json`));
}
