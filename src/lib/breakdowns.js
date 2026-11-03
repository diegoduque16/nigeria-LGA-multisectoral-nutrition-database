// Breakdowns: the parts a number is split into (e.g. Female / Male; or Female 0–5 months …).
import { all } from './db.js';

export async function breakdownMap(db) {
  return new Map((await all(db, 'SELECT * FROM breakdowns')).map((b) => [b.id, { id: b.id, name: b.name, options: JSON.parse(b.options) }]));
}

// The parts of a data element: [] when it has no breakdown; else one per option (or per pair of options).
export function partsOf(de, bmap) {
  const a = de.breakdown_id && bmap.get(de.breakdown_id);
  const b = de.breakdown2_id && bmap.get(de.breakdown2_id);
  if (!a) return [];
  if (!b) return a.options.map((o) => ({ key: o.id, name: o.name }));
  return a.options.flatMap((x) => b.options.map((y) => ({ key: `${x.id}.${y.id}`, name: `${x.name}, ${y.name}` })));
}
