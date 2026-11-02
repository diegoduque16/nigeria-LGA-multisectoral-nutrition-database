// Aggregation: sum LGA values up to states and the country, then recompute indicators from the
// summed numerators and denominators (never averaging LGA percentages).
import { HttpError } from './util.js';
import { all } from './db.js';
import { periodsWithin, parseExpression, evaluate, FREQUENCY_NAMES } from './dhis.js';

export const STATUSES_FINAL = ['accepted'];
export const STATUSES_PROVISIONAL = ['accepted', 'submitted'];

export function compileIndicators(rows, factors) {
  return rows.map((i) => ({
    ...i,
    num: parseExpression(i.numerator).tree,
    den: parseExpression(i.denominator).tree,
    factor: factors[i.type_id] || 1,
  }));
}

// { value, numerator, denominator } or null when the denominator is zero.
export function indicatorValue(ind, values) {
  const n = evaluate(ind.num, values);
  const d = evaluate(ind.den, values);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return { value: (n / d) * ind.factor, numerator: n, denominator: d };
}

export function round(v, decimals) {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// Loads summed values per LGA for one data set and one analysis period, below rootOu.
// Returns { subPeriods, lgas: Map(lgaId -> { id, name, stateId, values, reported, statuses }) }.
export async function loadLgaTotals(db, dataset, period, rootOu, statuses) {
  const subPeriods = periodsWithin(period, dataset.frequency);
  if (!subPeriods.length) {
    throw new HttpError(422, 'period_mismatch', `“${dataset.name}” is reported ${FREQUENCY_NAMES[dataset.frequency].toLowerCase()}, so it cannot be shown for this period. Choose a longer period.`);
  }
  const like = rootOu.path + '/%';
  const lgaRows = await all(db,
    `SELECT id, name, parent_id, path FROM org_units WHERE level = 3 AND closed_at IS NULL AND (id = ? OR path LIKE ?) ORDER BY name`,
    rootOu.id, like);
  const lgas = new Map(lgaRows.map((o) => [o.id, { id: o.id, name: o.name, stateId: o.parent_id, values: {}, reported: 0, statuses: {} }]));
  const peMarks = subPeriods.map(() => '?').join(',');
  const stMarks = statuses.map(() => '?').join(',');
  const reports = await all(db,
    `SELECT r.ou_id, r.period, r.status, r.submitted_at FROM reports r JOIN org_units o ON o.id = r.ou_id
      WHERE r.dataset_id = ? AND r.period IN (${peMarks}) AND (o.id = ? OR o.path LIKE ?)`,
    dataset.id, ...subPeriods, rootOu.id, like);
  for (const r of reports) {
    const l = lgas.get(r.ou_id);
    if (!l) continue;
    l.statuses[r.period] = r.status;
    if (statuses.includes(r.status)) l.reported++;
  }
  const sums = await all(db,
    `SELECT dv.ou_id, dv.de_id, SUM(dv.value) AS v
       FROM data_values dv
       JOIN reports r ON r.dataset_id = ? AND r.ou_id = dv.ou_id AND r.period = dv.period
       JOIN data_elements de ON de.id = dv.de_id AND de.dataset_id = ?
       JOIN org_units o ON o.id = dv.ou_id
      WHERE dv.period IN (${peMarks}) AND r.status IN (${stMarks}) AND (o.id = ? OR o.path LIKE ?)
      GROUP BY dv.ou_id, dv.de_id`,
    dataset.id, dataset.id, ...subPeriods, ...statuses, rootOu.id, like);
  for (const s of sums) {
    const l = lgas.get(s.ou_id);
    if (l) l.values[s.de_id] = s.v;
  }
  return { subPeriods, lgas };
}

// Adds up a group of LGAs. Only LGAs that reported contribute values.
export function rollUp(lgaList, periodsPerLga) {
  const values = {};
  let reported = 0; let reportingUnits = 0;
  for (const l of lgaList) {
    reported += l.reported;
    if (l.reported > 0) reportingUnits++;
    for (const [k, val] of Object.entries(l.values)) values[k] = (values[k] || 0) + val;
  }
  const expected = lgaList.length * periodsPerLga;
  return {
    values,
    reported,
    expected,
    reportingUnits,
    totalUnits: lgaList.length,
    reportingRate: expected ? (reported / expected) * 100 : null,
  };
}
