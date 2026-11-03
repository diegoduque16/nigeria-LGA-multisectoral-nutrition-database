// Population figures calculated from another figure (normally Total population) as a share of it,
// e.g. Expected pregnancies = 4.5% × Total population. Values are stored like any other value, so every
// report, export and indicator reads them as usual; they are recalculated whenever the base changes.
import { all, one, run } from './db.js';
import { now } from './util.js';
import { dhisUid } from './dhis.js';

export const TOTAL_NAME = 'Total population';

// The base figure of a shared data set: "Total population", created when missing.
export async function totalField(db, datasetId) {
  const f = await one(db, 'SELECT * FROM data_elements WHERE dataset_id = ? AND lower(name) = lower(?) AND archived_at IS NULL', datasetId, TOTAL_NAME);
  if (f) return f;
  const id = dhisUid();
  const sort = (await one(db, 'SELECT COALESCE(MIN(sort), 10) - 10 AS s FROM data_elements WHERE dataset_id = ?', datasetId)).s;
  await run(db, `INSERT INTO data_elements (id, dataset_id, name, short_name, value_type, sort, created_at, prorate) VALUES (?,?,?,?, 'INTEGER', ?, ?, 0)`,
    id, datasetId, TOTAL_NAME, TOTAL_NAME, sort, now());
  return one(db, 'SELECT * FROM data_elements WHERE id = ?', id);
}

// Recalculates the calculated figures of a data set — all of them, or one (fieldId) — for the given LGAs and year
// (or every LGA / every year when not given).
export async function recalc(db, datasetId, { fieldId = null, ouIds = null, period = null, userId = null } = {}) {
  const calc = await all(db, `SELECT id, calc_base, calc_share FROM data_elements WHERE dataset_id = ? AND archived_at IS NULL
    AND calc_base IS NOT NULL AND calc_share IS NOT NULL${fieldId ? ' AND id = ?' : ''}`, datasetId, ...(fieldId ? [fieldId] : []));
  if (!calc.length) return 0;
  const t = now(); const stmts = []; let n = 0;
  for (const base of [...new Set(calc.map((c) => c.calc_base))]) {
    let sql = 'SELECT ou_id, period, value FROM data_values WHERE de_id = ?'; const args = [base];
    if (period) { sql += ' AND period = ?'; args.push(period); }
    if (ouIds && ouIds.length) { sql += ` AND ou_id IN (${ouIds.map(() => '?').join(',')})`; args.push(...ouIds); }
    const vals = await all(db, sql, ...args);
    const rows = [];
    for (const c of calc.filter((x) => x.calc_base === base)) for (const v of vals) rows.push([c.id, v.ou_id, v.period, Math.round(v.value * c.calc_share / 100)]);
    for (let i = 0; i < rows.length; i += 16) {
      const part = rows.slice(i, i + 16);
      stmts.push(db.prepare(`INSERT INTO data_values (de_id, ou_id, period, value, updated_by, updated_at) VALUES ${part.map(() => '(?,?,?,?,?,?)').join(',')}
        ON CONFLICT(de_id, ou_id, period) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
        .bind(...part.flatMap(([d, o, p, v]) => [d, o, p, v, userId, t])));
    }
    n += rows.length;
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return n;
}
