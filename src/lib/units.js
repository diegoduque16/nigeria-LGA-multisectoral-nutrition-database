// Units below the LGA: which ones report on a schedule.
// A schedule reported by unit lists its unit types (dataset_unit_types). Older schedules without a list keep the
// earlier rule: every unit of the schedule's sector.
import { all } from './db.js';

export const WARD_TYPE = 'ut_ward';

// SQL condition (for an org_units alias) selecting the units that report on dataset ds, with its bound values.
export function unitsOf(ds, alias = 'u') {
  return {
    sql: `${alias}.level >= 4 AND (${alias}.unit_type_id IN (SELECT type_id FROM dataset_unit_types WHERE dataset_id = ?)
      OR (NOT EXISTS (SELECT 1 FROM dataset_unit_types WHERE dataset_id = ?) AND ${alias}.sector_id = ?))`,
    args: [ds.id, ds.id, ds.sector_id || ''],
  };
}

export async function typesOfDataset(db, dsId) {
  return (await all(db, 'SELECT type_id FROM dataset_unit_types WHERE dataset_id = ?', dsId)).map((r) => r.type_id);
}

// Map dataset id -> [type ids], for many data sets at once.
export async function typesByDataset(db) {
  const m = {};
  for (const r of await all(db, 'SELECT dataset_id, type_id FROM dataset_unit_types')) (m[r.dataset_id] ||= []).push(r.type_id);
  return m;
}
