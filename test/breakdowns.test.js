// Breakdowns: a number asked per sex / age group; the total is the sum of the parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, setupAdmin, addUser } from './harness.js';
import { lastCompletedPeriod } from '../src/lib/dhis.js';

const ABIA = 'FHlOerryBjk';
const ABA_NORTH = 'NmLIx68MjRi';

test('breakdowns: parts per sex and age, total adds up, submit needs every part, results show parts', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Children screened', numerator: 'Children screened for wasting' });
  let meta = (await admin.get('/api/metadata')).data;
  assert.deepEqual(meta.breakdowns.map((b) => b.id).sort(), ['bd_age_u5', 'bd_sex']);
  const de = meta.datasets.find((d) => d.id === ds.id).dataElements[0];

  // Settings: unknown or repeated breakdowns are refused.
  assert.equal((await admin.patch('/api/fields/' + de.id, { breakdownId: 'nope' })).status, 422);
  assert.equal((await admin.patch('/api/fields/' + de.id, { breakdownId: 'bd_sex', breakdown2Id: 'bd_sex' })).status, 422);
  assert.equal((await admin.patch('/api/fields/' + de.id, { breakdownId: 'bd_sex', breakdown2Id: 'bd_age_u5' })).status, 200);
  meta = (await admin.get('/api/metadata')).data;
  const f = meta.datasets.find((d) => d.id === ds.id).dataElements[0];
  assert.equal(f.breakdownId, 'bd_sex'); assert.equal(f.breakdown2Id, 'bd_age_u5');

  const lga = await addUser(env, admin, { name: 'L', email: 'l@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const period = lastCompletedPeriod('MONTHLY');
  const form = (await lga.c.get(`/api/entry?dataset=${ds.id}&ou=${ABA_NORTH}&period=${period}`)).data;
  assert.equal(form.fields[0].parts.length, 6);
  assert.equal(form.fields[0].parts[0].name, 'Female, 0–5 months');

  // Some parts: saved, total = sum; sending is refused until every part is filled.
  const some = await lga.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${de.id}:f.a0_5`]: 3, [`${de.id}:m.a0_5`]: 4 } });
  assert.equal(some.status, 200, JSON.stringify(some.data));
  assert.equal(some.data.fields[0].value, 7);
  assert.equal((await lga.c.post('/api/entry/submit', { dataset: ds.id, ou: ABA_NORTH, period })).status, 422);
  assert.equal((await lga.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${de.id}:x.y`]: 1 } })).status, 422);
  const all = Object.fromEntries(form.fields[0].parts.map((p, i) => [`${de.id}:${p.key}`, i + 1]));
  await lga.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: all });
  const sent = await lga.c.post('/api/entry/submit', { dataset: ds.id, ou: ABA_NORTH, period });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));

  // Results: the total and each part, summed.
  const state = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  await state.c.post('/api/entry/review', { dataset: ds.id, ou: ABA_NORTH, period, action: 'accept' });
  const pic = (await state.c.get(`/api/picture?dataset=${ds.id}&period=${period}`)).data;
  assert.equal(pic.total.values[de.id], 21);
  assert.equal(pic.total.values[`${de.id}:f.a0_5`], 1);
  assert.equal(pic.fields.length, 7);

  // Custom lists: renaming keeps option ids; removing an option with values is refused.
  const nb = (await admin.post('/api/breakdowns', { name: 'Residence', options: ['Urban', 'Rural'] })).data;
  meta = (await admin.get('/api/metadata')).data;
  const res = meta.breakdowns.find((b) => b.id === nb.id);
  await admin.patch('/api/breakdowns/' + nb.id, { name: 'Residence', options: ['Urban', 'Rural', 'Camp'] });
  const after = (await admin.get('/api/metadata')).data.breakdowns.find((b) => b.id === nb.id);
  assert.equal(after.options[0].id, res.options[0].id); assert.equal(after.options.length, 3);
  assert.equal((await admin.patch('/api/breakdowns/bd_sex', { name: 'Sex', options: ['Female'] })).status, 422);
  assert.equal((await admin.del('/api/breakdowns/bd_sex')).status, 422);
  assert.equal((await admin.del('/api/breakdowns/' + nb.id)).status, 200);
  assert.equal((await state.c.post('/api/breakdowns', { name: 'X', options: ['a', 'b'] })).status, 403);
});
