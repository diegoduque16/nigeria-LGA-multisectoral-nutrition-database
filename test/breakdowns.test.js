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

test('breakdowns: upgrading a database with existing data keeps every total', async () => {
  // Build a database up to migration 0011, report a total, then apply 0012 as the live upgrade does.
  const { D1Shim } = await import('./harness.js');
  const { readdirSync, readFileSync } = await import('node:fs');
  const DB = new D1Shim();
  const dir = new URL('../migrations/', import.meta.url);
  const files = readdirSync(dir).sort();
  for (const f of files.filter((f) => f < '0012')) DB.db.exec(readFileSync(new URL(f, dir), 'utf8'));
  const env = makeEnv({ DB });
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Children screened', numerator: 'Children screened for wasting' });
  const de = (await DB.prepare('SELECT id FROM data_elements WHERE dataset_id = ?').bind(ds.id).first()).id;
  const period = lastCompletedPeriod('MONTHLY');
  // An accepted report with a total, as the live database holds today.
  DB.db.prepare("INSERT INTO reports (dataset_id, ou_id, period, status, updated_at) VALUES (?,?,?,'accepted',1)").run(ds.id, ABA_NORTH, period);
  DB.db.prepare('INSERT INTO data_values (de_id, ou_id, period, value, updated_at) VALUES (?,?,?,50,1)').run(de, ABA_NORTH, period);
  // Upgrade.
  for (const f of files.filter((f) => f >= '0012')) DB.db.exec(readFileSync(new URL(f, dir), 'utf8'));
  let pic = (await admin.get(`/api/picture?dataset=${ds.id}&ou=${ABIA}&period=${period}`)).data;
  assert.equal(pic.total.values[de], 50);
  // Switching a breakdown on later: old accepted totals still count; the form shows the earlier total.
  assert.equal((await admin.patch('/api/fields/' + de, { breakdownId: 'bd_sex' })).status, 200);
  pic = (await admin.get(`/api/picture?dataset=${ds.id}&ou=${ABIA}&period=${period}`)).data;
  assert.equal(pic.total.values[de], 50);
  assert.equal(pic.total.values[`${de}:f`], null);
  const form = (await admin.get(`/api/entry?dataset=${ds.id}&ou=${ABA_NORTH}&period=${period}`)).data;
  assert.equal(form.fields[0].value, 50); assert.equal(form.fields[0].parts.length, 2);
  // Export still sends the total.
  const ex = (await admin.get(`/api/export/data?period=${period}&datasets=${ds.id}`)).data;
  const exRows = ex.dataValues[0].rows;
  assert.ok(exRows.some((row) => row[2] === ABA_NORTH && Number(row[3]) === 50), JSON.stringify(exRows));
  // Switching it off again: nothing lost.
  await admin.patch('/api/fields/' + de, { breakdownId: null, breakdown2Id: null });
  assert.equal((await admin.get(`/api/entry?dataset=${ds.id}&ou=${ABA_NORTH}&period=${period}`)).data.fields[0].parts.length, 0);
});

test('breakdowns: send back and correct, partial access, facilities, Excel sheet, pivot, population refused', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const pop = (await admin.post('/api/datasets', { name: 'Population', shared: true })).data;
  const u5 = (await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Children under 5', prorate: false })).data.dataElement;
  assert.equal((await admin.patch('/api/fields/' + u5.id, { breakdownId: 'bd_sex' })).status, 422); // population: never

  const ds = (await admin.post('/api/datasets', { name: 'Nutrition – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'SAM admissions', numerator: 'Children admitted for SAM' });
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Vitamin A', numerator: 'Children given vitamin A' });
  const els = (await admin.get('/api/metadata')).data.datasets.find((d) => d.id === ds.id).dataElements;
  const sam = els.find((d) => d.name === 'Children admitted for SAM').id;
  const vita = els.find((d) => d.name === 'Children given vitamin A').id;
  await admin.patch('/api/fields/' + sam, { breakdownId: 'bd_sex' });
  const period = lastCompletedPeriod('MONTHLY');

  // Two people share the form: one types SAM (broken down), the other vitamin A.
  const a = await addUser(env, admin, { name: 'A', email: 'a@abia.gov.ng', role: 'lga', ouId: ABA_NORTH, datasets: [ds.id], dataElements: [sam] });
  const b = await addUser(env, admin, { name: 'B', email: 'b@abia.gov.ng', role: 'lga', ouId: ABA_NORTH, datasets: [ds.id], dataElements: [vita] });
  const nope = await b.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:f`]: 1 } });
  assert.equal(nope.status, 422); assert.match(nope.data.error.message, /not assigned/);
  let r = await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:f`]: 4, [`${sam}:m`]: '1,000' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.fields.find((f) => f.id === sam).value, 1004);
  assert.equal((await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:f`]: 1.5 } })).status, 422); // whole numbers
  assert.equal((await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:f`]: -1 } })).status, 422);
  // A plain total for a broken-down number (e.g. an old template) is refused; sending the same total back is harmless.
  assert.equal((await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [sam]: 99 } })).status, 422);
  assert.equal((await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [sam]: 1004 } })).status, 200);
  await b.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [vita]: 7 } });
  assert.equal((await b.c.post('/api/entry/submit', { dataset: ds.id, ou: ABA_NORTH, period })).status, 200);

  // State sends it back; LGA corrects one part; the total follows.
  const st = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  await st.c.post('/api/entry/review', { dataset: ds.id, ou: ABA_NORTH, period, action: 'return', comment: 'Check boys' });
  r = await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:m`]: 10 } });
  assert.equal(r.data.fields.find((f) => f.id === sam).value, 14);
  // Clearing a part is allowed while editing, but then it cannot be sent.
  await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:m`]: null } });
  assert.equal((await a.c.post('/api/entry/submit', { dataset: ds.id, ou: ABA_NORTH, period })).status, 422);
  await a.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [`${sam}:m`]: 10 } });
  assert.equal((await a.c.post('/api/entry/submit', { dataset: ds.id, ou: ABA_NORTH, period })).status, 200);
  await st.c.post('/api/entry/review', { dataset: ds.id, ou: ABA_NORTH, period, action: 'accept' });

  // Excel sheet: one column per part, with the values in.
  const sh = (await st.c.get(`/api/entry/sheet?dataset=${ds.id}&ou=${ABIA}&period=${period}`)).data;
  const json = JSON.stringify(sh);
  assert.ok(json.includes(`${sam}:f`) && json.includes(`${sam}:m`), 'part columns in template');
  assert.ok(json.includes('Children admitted for SAM — Female'));

  // Results and the pivot view.
  const pic = (await st.c.get(`/api/picture?dataset=${ds.id}&period=${period}`)).data;
  assert.equal(pic.total.values[sam], 14); assert.equal(pic.total.values[`${sam}:f`], 4); assert.equal(pic.total.values[`${sam}:m`], 10);
  const pv = await st.c.get(`/api/pivot?period=${period}&datasets=${ds.id}`);
  assert.equal(pv.status, 200, JSON.stringify(pv.data));

  // Facilities: parts add up from each facility to the LGA.
  const fac = 'ut_health_facility'; // ships by default
  const fds = (await admin.post('/api/datasets', { name: 'Health – facilities', sector: 'Health', frequency: 'YEARLY', reportLevel: 'UNIT', unitTypes: [fac] })).data;
  await admin.post(`/api/datasets/${fds.id}/indicators`, { name: 'Vaccinated', numerator: 'Children vaccinated' });
  await admin.post('/api/units/import', { commit: true, rows: [
    { lgaId: ABA_NORTH, name: 'Clinic A', type: 'Health facility', id: 'FacA0000001' },
    { lgaId: ABA_NORTH, name: 'Clinic B', type: 'Health facility', id: 'FacB0000001' }] });
  const fde = (await admin.get('/api/metadata')).data.datasets.find((d) => d.id === fds.id).dataElements[0].id;
  await admin.patch('/api/fields/' + fde, { breakdownId: 'bd_sex' });
  const year = String(new Date().getFullYear() - 1);
  for (const [ou, f, m] of [['FacA0000001', 3, 4], ['FacB0000001', 5, 6]]) {
    assert.equal((await admin.put('/api/entry', { dataset: fds.id, ou, period: year, values: { [`${fde}:f`]: f, [`${fde}:m`]: m } })).status, 200);
    assert.equal((await admin.post('/api/entry/submit', { dataset: fds.id, ou, period: year })).status, 200);
    await admin.post('/api/entry/review', { dataset: fds.id, ou, period: year, action: 'accept' });
  }
  const fp = (await admin.get(`/api/picture?dataset=${fds.id}&ou=${ABIA}&period=${year}`)).data;
  const an = fp.rows.find((x) => x.id === ABA_NORTH);
  assert.equal(an.values[fde], 18); assert.equal(an.values[`${fde}:f`], 8); assert.equal(an.values[`${fde}:m`], 10);
  const lp = (await admin.get(`/api/picture?dataset=${fds.id}&ou=${ABA_NORTH}&period=${year}`)).data;
  assert.equal(lp.rows.find((x) => x.id === 'FacB0000001').values[`${fde}:m`], 6);
  // Export of org units, metadata and data still works.
  assert.equal((await admin.get(`/api/export/metadata?ou=${ABIA}`)).status, 200);
  assert.equal((await admin.get(`/api/export/data?period=${year}&datasets=${fds.id}`)).status, 200);
});
