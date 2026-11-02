// Indicator dictionary: one definition per indicator, shared by every sector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, setupAdmin, addUser } from './harness.js';

const ABIA = 'FHlOerryBjk';

test('dictionary: one definition per name, shared across sectors, edits propagate, Excel import, codes in export', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const health = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const sp = (await admin.post('/api/datasets', { name: 'Social protection – monthly', sector: 'Social protection', frequency: 'MONTHLY' })).data;
  // A new indicator adds an entry to the dictionary.
  const a = (await admin.post(`/api/datasets/${health.id}/indicators`, { name: 'Children screened for wasting', numerator: 'Children 6-59 months screened (MUAC)', denominator: 'Children under 5' })).data.indicator;
  let defs = (await admin.get('/api/dictionary')).data.definitions;
  assert.equal(defs.length, 1); assert.equal(defs[0].uses.length, 1); assert.equal(a.defId, defs[0].id);
  // The same name with another calculation is refused; the same entry can be used by another sector.
  const clash = await admin.post(`/api/datasets/${sp.id}/indicators`, { name: 'children screened for wasting', numerator: 'Children screened' });
  assert.equal(clash.status, 409); assert.equal(clash.data.error.code, 'definition_conflict');
  const b = (await admin.post(`/api/datasets/${sp.id}/indicators`, { defId: defs[0].id })).data.indicator;
  assert.equal(b.name, 'Children screened for wasting'); assert.equal(b.numerator, 'Children 6-59 months screened (MUAC)');
  assert.equal((await admin.post(`/api/datasets/${sp.id}/indicators`, { defId: defs[0].id })).status, 409); // already on this schedule
  // Editing the entry changes it in both sectors (names and the boxes people fill in).
  const upd = (await admin.patch('/api/dictionary/' + defs[0].id, { code: 'NUT-01', name: 'Children 6-59 months screened for wasting', numerator: 'Children 6-59 months screened' })).data;
  assert.equal(upd.indicatorsUpdated, 2);
  const meta = (await admin.get('/api/metadata')).data;
  for (const id of [health.id, sp.id]) {
    const i = meta.datasets.find((d) => d.id === id).indicators.find((x) => !x.archived);
    assert.equal(i.name, 'Children 6-59 months screened for wasting'); assert.equal(i.numerator, 'Children 6-59 months screened');
  }
  // Editing a sector's indicator edits the shared entry too.
  await admin.patch('/api/indicators/' + a.id, { source: 'CMAM register' });
  defs = (await admin.get('/api/dictionary')).data.definitions;
  assert.equal(defs[0].source, 'CMAM register');
  assert.equal((await admin.get('/api/metadata')).data.datasets.find((d) => d.id === sp.id).indicators.find((x) => !x.archived).source, 'CMAM register');
  // Excel import: match by code, add new, refuse bad rows.
  const rows = [
    { row: 2, code: 'NUT-01', name: 'Children 6-59 months screened for wasting', numerator: 'Children 6-59 months screened', denominator: 'Children under 5', showAs: 'Percentage', framework: 'NMPFAN 1.1' },
    { row: 3, code: 'NUT-02', name: 'Exclusive breastfeeding', numerator: 'Infants 0-5 months exclusively breastfed', denominator: 'Infants 0-5 months', showAs: 'Percentage', sector: 'Health' },
    { row: 4, code: 'NUT-03', name: 'Households with home gardens', numerator: 'Households with a home garden', showAs: 'Sometimes' },
    { row: 5, code: 'NUT-04', name: 'Bad sector', numerator: 'X', sector: 'Mining' },
  ];
  const chk = (await admin.post('/api/dictionary/import', { rows })).data;
  assert.deepEqual(chk.counts, { add: 1, update: 1, same: 0, error: 2 });
  assert.equal((await admin.post('/api/dictionary/import', { rows, commit: true })).status, 422);
  await admin.post('/api/dictionary/import', { rows: rows.slice(0, 2), commit: true });
  defs = (await admin.get('/api/dictionary')).data.definitions;
  assert.equal(defs.length, 2);
  assert.equal(defs.find((d) => d.code === 'NUT-01').framework, 'NMPFAN 1.1');
  assert.equal(defs.find((d) => d.code === 'NUT-02').sector, 'Health');
  // Export: the code goes with each indicator; two sectors using one entry get the sector added.
  const ex = (await admin.get(`/api/export/metadata?ou=${ABIA}`)).data.indicators.filter((i) => i.code);
  assert.deepEqual(ex.map((i) => i.code).sort(), ['NUT-01-HEALTH', 'NUT-01-SOCIAL_PROTECTION']);
  // Entries in use cannot be removed; unused ones can. Only administrators change the dictionary.
  assert.equal((await admin.del('/api/dictionary/' + defs.find((d) => d.code === 'NUT-01').id)).status, 409);
  assert.equal((await admin.del('/api/dictionary/' + defs.find((d) => d.code === 'NUT-02').id)).status, 200);
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  assert.equal((await so.c.post('/api/dictionary', { name: 'X', numerator: 'Y' })).status, 403);
});
