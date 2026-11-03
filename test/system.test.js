import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, client, setupAdmin, addUser, PW } from './harness.js';
import { lastCompletedPeriod, recentPeriods } from '../src/lib/dhis.js';

const NIGERIA = 's5DPBsdoE8b';
const ABIA = 'FHlOerryBjk';
const ABA_NORTH = 'NmLIx68MjRi';
const ABA_SOUTH = 'FQhClVW8Xg4';
const AROCHUKWU = 'YmDVu2Zobjx';
const ADAMAWA = 'OgjFloqKoqk';

async function world() {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = await admin.post('/api/datasets', { name: 'LGA monthly report', sector: 'Health', frequency: 'MONTHLY' });
  assert.equal(ds.status, 201, JSON.stringify(ds.data));
  const dsId = ds.data.id;
  const anc = await admin.post(`/api/datasets/${dsId}/indicators`, {
    name: 'ANC 4+ coverage', sector: 'Health', numerator: 'Women with 4+ ANC visits', denominator: 'Expected pregnancies', source: 'HMIS ANC register',
  });
  assert.equal(anc.status, 201, JSON.stringify(anc.data));
  const enrol = await admin.post(`/api/datasets/${dsId}/indicators`, {
    name: 'Pupils enrolled', sector: 'Education', numerator: 'Pupils enrolled in primary', source: 'EMIS',
  });
  assert.equal(enrol.status, 201);
  const meta = (await admin.get('/api/metadata')).data;
  const set = meta.datasets[0];
  const field = (n) => set.dataElements.find((d) => d.name === n).id;
  return { env, admin, dsId, set, field, anc: anc.data.indicator, enrol: enrol.data.indicator, meta };
}

test('setup loads all Nigerian org units with their DHIS2 IDs and creates the first admin once', async () => {
  const env = makeEnv();
  const anon = client(env);
  assert.equal((await anon.get('/api/setup')).data.needsSetup, true);
  const bad = await anon.post('/api/setup', { setupKey: 'wrong', name: 'X', email: 'x@gov.ng', password: PW });
  assert.equal(bad.status, 403);
  const admin = await setupAdmin(env);
  const again = await anon.post('/api/setup', { setupKey: env.SETUP_KEY, name: 'Y', email: 'y@gov.ng', password: PW });
  assert.equal(again.status, 409);
  const ous = (await admin.get('/api/orgunits')).data;
  assert.equal(ous.country.id, NIGERIA);
  assert.equal(ous.states.length, 37);
  assert.equal(ous.states.reduce((a, s) => a + s.lgas, 0), 774);
  const abia = await admin.get('/api/orgunits?parent=' + ABIA);
  assert.equal(abia.data.children.length, 17);
  assert.ok(abia.data.children.some((c) => c.id === ABA_NORTH));
  const me = await admin.get('/api/me');
  assert.equal(me.data.user.role, 'sysadmin');
});

test('simple indicator setup creates numerator/denominator fields and sectors; shared names are one field', async () => {
  const { admin, dsId, set, meta } = await world();
  assert.deepEqual(meta.sectors.map((s) => s.name).sort(), ['Education', 'Health']);
  assert.equal(set.frequency, 'MONTHLY');
  assert.equal(set.dataElements.length, 3);
  const ind = set.indicators.find((i) => i.name === 'ANC 4+ coverage');
  assert.equal(ind.numerator, 'Women with 4+ ANC visits');
  assert.equal(ind.denominator, 'Expected pregnancies');
  assert.equal(ind.source, 'HMIS ANC register');
  assert.equal(ind.sector, 'Health');
  assert.equal(ind.showAs, 'percent');
  assert.match(ind.id, /^[A-Za-z][A-Za-z0-9]{10}$/);
  // Same denominator name (different case) reuses the field.
  const r = await admin.post(`/api/datasets/${dsId}/indicators`, { name: 'ANC 1 coverage', sector: 'health', numerator: 'Women with 1st ANC visit', denominator: 'expected pregnancies' });
  assert.equal(r.status, 201);
  assert.equal(r.data.indicator.denominatorId, ind.denominatorId);
  assert.equal(r.data.indicator.sector, 'Health');
  // Existing DHIS2 indicator ID can be kept.
  const k = await admin.post(`/api/datasets/${dsId}/indicators`, { id: 'Abc123def45', name: 'Kept ID', sector: 'Health', numerator: 'Deliveries' });
  assert.equal(k.data.indicator.id, 'Abc123def45');
  const dup = await admin.post(`/api/datasets/${dsId}/indicators`, { id: 'Abc123def45', name: 'Dup', sector: 'Health', numerator: 'X' });
  assert.equal(dup.status, 409);
  // Changing a numerator to a new name swaps the field and removes the unused one.
  const u = await admin.patch(`/api/indicators/${k.data.indicator.id}`, { numerator: 'Facility deliveries', sector: 'WASH' });
  assert.equal(u.data.indicator.numerator, 'Facility deliveries');
  assert.equal(u.data.indicator.sector, 'WASH');
  const after = (await admin.get('/api/metadata')).data.datasets[0].dataElements.map((d) => d.name);
  assert.ok(!after.includes('Deliveries'));
});

test('accounts: assignment to data sets and to specific numerators/denominators', async () => {
  const { env, admin, dsId, field } = await world();
  const health = await addUser(env, admin, {
    name: 'Ngozi', email: 'ngozi@abia.gov.ng', role: 'lga', ouId: ABA_NORTH, datasets: [dsId],
    dataElements: [field('Women with 4+ ANC visits'), field('Expected pregnancies')],
  });
  const educ = await addUser(env, admin, {
    name: 'Emeka', email: 'emeka@abia.gov.ng', role: 'lga', ouId: ABA_NORTH, datasets: [dsId], dataElements: [field('Pupils enrolled in primary')],
  });
  const period = lastCompletedPeriod('MONTHLY');
  const form = (await health.c.get(`/api/entry?dataset=${dsId}&ou=${ABA_NORTH}&period=${period}`)).data;
  assert.deepEqual(form.fields.filter((f) => f.editable).map((f) => f.name).sort(), ['Expected pregnancies', 'Women with 4+ ANC visits']);
  // Health officer cannot type the education value.
  const no = await health.c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [field('Pupils enrolled in primary')]: 5 } });
  assert.equal(no.status, 422);
  // Cannot enter for another LGA.
  const other = await health.c.put('/api/entry', { dataset: dsId, ou: ABA_SOUTH, period, values: {} });
  assert.equal(other.status, 403);
  // Wrong role level is rejected.
  const badLevel = await admin.post('/api/users', { name: 'Z', email: 'z@x.ng', role: 'lga', ouId: ABIA });
  assert.equal(badLevel.status, 422);
  // Each enters their part; submit needs everything.
  await health.c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [field('Women with 4+ ANC visits')]: 40, [field('Expected pregnancies')]: 100 } });
  const early = await health.c.post('/api/entry/submit', { dataset: dsId, ou: ABA_NORTH, period });
  assert.equal(early.status, 422);
  assert.match(early.data.error.message, /Pupils enrolled/);
  await educ.c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [field('Pupils enrolled in primary')]: 900 } });
  const sub = await educ.c.post('/api/entry/submit', { dataset: dsId, ou: ABA_NORTH, period });
  assert.equal(sub.status, 200, JSON.stringify(sub.data));
  assert.equal(sub.data.report.status, 'submitted');
  assert.equal(sub.data.indicators.find((i) => i.name === 'ANC 4+ coverage').value, 40);
  // Locked after submit.
  const locked = await health.c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [field('Expected pregnancies')]: 1 } });
  assert.equal(locked.status, 409);
});

test('validation: whole numbers, no negatives, future periods and wrong frequency refused', async () => {
  const { env, admin, dsId, field } = await world();
  const { c } = await addUser(env, admin, { name: 'L', email: 'l@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const period = lastCompletedPeriod('MONTHLY');
  const f = field('Expected pregnancies');
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [f]: 1.5 } })).status, 422);
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [f]: -3 } })).status, 422);
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [f]: 'abc' } })).status, 422);
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period, values: { [f]: '1,200' } })).status, 200);
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period: '2099' + '01', values: {} })).status, 422);
  assert.equal((await c.put('/api/entry', { dataset: dsId, ou: ABA_NORTH, period: '2026Q1', values: {} })).status, 422);
});

async function report(c, dsId, ou, period, values) {
  const s = await c.put('/api/entry', { dataset: dsId, ou, period, values });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const r = await c.post('/api/entry/submit', { dataset: dsId, ou, period });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}

test('state review, state picture (sum counts, recompute rates) and coverage', async () => {
  const { env, admin, dsId, field, anc } = await world();
  const state = await addUser(env, admin, { name: 'Chi', email: 'chi@abia.gov.ng', role: 'state', ouId: ABIA });
  const lgaA = await addUser(env, admin, { name: 'A', email: 'a@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const lgaB = await addUser(env, admin, { name: 'B', email: 'b@abia.gov.ng', role: 'lga', ouId: ABA_SOUTH });
  const lgaC = await addUser(env, admin, { name: 'C', email: 'c@abia.gov.ng', role: 'lga', ouId: AROCHUKWU });
  const period = lastCompletedPeriod('MONTHLY');
  const [num, den, pup] = [field('Women with 4+ ANC visits'), field('Expected pregnancies'), field('Pupils enrolled in primary')];
  await report(lgaA.c, dsId, ABA_NORTH, period, { [num]: 10, [den]: 100, [pup]: 50 });
  await report(lgaB.c, dsId, ABA_SOUTH, period, { [num]: 90, [den]: 100, [pup]: 70 });
  await report(lgaC.c, dsId, AROCHUKWU, period, { [num]: 1, [den]: 1, [pup]: 1 });

  // State officer sees statuses, accepts two, sends one back.
  const st = (await state.c.get(`/api/status?dataset=${dsId}&period=${period}`)).data;
  assert.equal(st.total, 17);
  assert.equal(st.counts.submitted, 3);
  for (const ou of [ABA_NORTH, ABA_SOUTH]) {
    const r = await state.c.post('/api/entry/review', { dataset: dsId, ou, period, action: 'accept' });
    assert.equal(r.data.report.status, 'accepted');
  }
  const noComment = await state.c.post('/api/entry/review', { dataset: dsId, ou: AROCHUKWU, period, action: 'return' });
  assert.equal(noComment.status, 422);
  const back = await state.c.post('/api/entry/review', { dataset: dsId, ou: AROCHUKWU, period, action: 'return', comment: 'Denominator looks wrong' });
  assert.equal(back.data.report.status, 'returned');
  // LGA user can't review; LGA can now correct.
  assert.equal((await lgaC.c.post('/api/entry/review', { dataset: dsId, ou: AROCHUKWU, period, action: 'accept' })).status, 403);
  const fixed = await lgaC.c.put('/api/entry', { dataset: dsId, ou: AROCHUKWU, period, values: { [den]: 50 } });
  assert.equal(fixed.data.report.status, 'returned');
  // A state officer from another state cannot review Abia.
  const ad = await addUser(env, admin, { name: 'D', email: 'd@adamawa.gov.ng', role: 'state', ouId: ADAMAWA });
  assert.equal((await ad.c.post('/api/entry/review', { dataset: dsId, ou: AROCHUKWU, period, action: 'accept' })).status, 403);

  // Picture: accepted only -> 2 LGAs; ANC = (10+90)/(100+100) = 50%, not the average of LGA rates.
  const pic = (await state.c.get(`/api/picture?dataset=${dsId}&period=${period}`)).data;
  assert.equal(pic.ou.id, ABIA);
  assert.equal(pic.total.reportingUnits, 2);
  assert.equal(pic.total.totalUnits, 17);
  assert.equal(pic.total.indicators[anc.id].value, 50);
  assert.equal(pic.total.values[pup], 120);
  assert.equal(pic.total.reportingRate, Math.round((2 / 17) * 1000) / 10);
  assert.equal(pic.rows.length, 17);
  assert.equal(pic.indicators.find((i) => i.id === anc.id).sector, 'Health');
  // Sector filter.
  const healthOnly = (await state.c.get(`/api/picture?dataset=${dsId}&period=${period}&sector=${anc.sectorId}`)).data;
  assert.deepEqual(healthOnly.indicators.map((i) => i.name), ['ANC 4+ coverage']);
  // Quarter view sums the months.
  const y = period.slice(0, 4); const q = Math.ceil(Number(period.slice(4)) / 3);
  const qp = (await state.c.get(`/api/picture?dataset=${dsId}&period=${y}Q${q}`)).data;
  assert.equal(qp.total.indicators[anc.id].value, 50);
  assert.equal(qp.total.expected, 17 * 3);
  // National view groups by state.
  const nat = (await admin.get(`/api/picture?dataset=${dsId}&period=${period}`)).data;
  assert.equal(nat.rows.length, 37);
  assert.equal(nat.total.totalUnits, 774);
  assert.equal(nat.rows.find((r) => r.id === ABIA).indicators[anc.id].value, 50);
  // State officer cannot see the national picture.
  const scoped = await state.c.get(`/api/picture?dataset=${dsId}&ou=${NIGERIA}&period=${period}`);
  assert.equal(scoped.status, 403);
});

test('exports match the ALMA Export format (metadata + data values)', async () => {
  const { env, admin, dsId, field, anc, enrol, set } = await world();
  const lga = await addUser(env, admin, { name: 'A', email: 'a@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const state = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  const period = lastCompletedPeriod('MONTHLY');
  await report(lga.c, dsId, ABA_NORTH, period, { [field('Women with 4+ ANC visits')]: 33, [field('Expected pregnancies')]: 120, [field('Pupils enrolled in primary')]: 400 });
  await state.c.post('/api/entry/review', { dataset: dsId, ou: ABA_NORTH, period, action: 'accept' });

  const m = await admin.get('/api/export/metadata');
  assert.match(m.headers.get('content-disposition'), /organisationUnits_indicators\.json/);
  const ous = m.data.organisationUnits.organisationUnits;
  assert.equal(ous.length, 812);
  assert.deepEqual(Object.keys(ous.find((o) => o.id === ABA_NORTH)), ['id', 'parent', 'name', 'level']);
  assert.deepEqual(ous.find((o) => o.id === ABA_NORTH).parent, { id: ABIA });
  assert.equal(ous.find((o) => o.id === NIGERIA).parent, undefined);
  const mi = m.data.indicators.find((i) => i.id === anc.id);
  assert.deepEqual(Object.keys(mi), ['id', 'name', 'shortName', 'description', 'numeratorDescription', 'denominatorDescription', 'indicatorType', 'indicatorGroups']);
  assert.equal(mi.numeratorDescription, 'Women with 4+ ANC visits');
  assert.equal(mi.denominatorDescription, 'Expected pregnancies');
  assert.match(mi.description, /Source: HMIS ANC register/);
  assert.equal(mi.indicatorType.name, 'Percentage');
  assert.ok(m.data.indicators.some((i) => i.id === set.reportingRateId));

  const d = await admin.get(`/api/export/data?period=${period}`);
  assert.equal(d.status, 200, JSON.stringify(d.data));
  assert.match(d.headers.get('content-disposition'), new RegExp(`dataValues_${period}\\.json`));
  const dv = d.data.dataValues[0];
  assert.deepEqual(Object.keys(dv), ['headers', 'metaData', 'width', 'rows', 'height', 'headerWidth']);
  assert.deepEqual(dv.headers.map((h) => h.name), ['dx', 'pe', 'ou', 'value']);
  assert.equal(dv.headers[3].type, 'java.lang.Double');
  assert.equal(dv.height, dv.rows.length);
  const val = (dx, ou) => (dv.rows.find((r) => r[0] === dx && r[2] === ou) || [])[3];
  assert.equal(val(anc.id, ABA_NORTH), '27.5');
  assert.equal(val(anc.id, ABIA), '27.5');
  assert.equal(val(anc.id, NIGERIA), '27.5');
  assert.equal(val(enrol.id, ABIA), '400');
  assert.equal(val(set.reportingRateId, ABA_NORTH), '100');
  assert.equal(val(set.reportingRateId, ABIA), String(Math.round(1000 / 17) / 10));
  assert.ok(dv.metaData.items[ABIA].name);
  assert.ok(dv.metaData.dimensions.ou.includes(ABA_NORTH));
  assert.deepEqual(dv.metaData.dimensions.pe, [period]);
  for (const row of dv.rows) assert.equal(typeof row[3], 'string');

  // Several periods -> suffix first-last; levels filter.
  const ps = recentPeriods('MONTHLY', 2).reverse();
  const d2 = await admin.get(`/api/export/data?period=${ps.join(',')}&levels=2`);
  assert.match(d2.headers.get('content-disposition'), new RegExp(`dataValues_${ps[0]}-${ps[1]}\\.json`));
  assert.ok(d2.data.dataValues[0].rows.every((r) => r[2] !== ABA_NORTH && r[2] !== NIGERIA));

  // API token: read-only exports, scoped.
  const t = await admin.post('/api/tokens', { name: 'ALMA upload', ouId: ABIA });
  const bearer = { authorization: 'Bearer ' + t.data.token };
  const anon = client(env);
  const td = await anon.call('GET', `/api/export/data?period=${period}`, undefined, bearer);
  assert.equal(td.status, 200);
  assert.ok(td.data.dataValues[0].rows.every((r) => r[2] !== NIGERIA));
  assert.equal((await anon.call('GET', '/api/users', undefined, bearer)).status, 403);
  assert.equal((await anon.call('GET', `/api/export/data?period=${period}&ou=${NIGERIA}`, undefined, bearer)).status, 403);
  await admin.del('/api/tokens/' + t.data.id);
  assert.equal((await anon.call('GET', `/api/export/data?period=${period}`, undefined, bearer)).status, 401);
});

test('sign-in security: lockout, deactivation, CSRF, password links are single-use', async () => {
  const { env, admin } = await world();
  const { c, user, link } = await addUser(env, admin, { name: 'L', email: 'lock@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const token = link.split('/set-password/')[1];
  assert.equal((await client(env).post('/api/password-links/' + token, { password: PW })).status, 404);
  const x = client(env);
  for (let i = 0; i < 5; i++) assert.equal((await x.post('/api/auth/login', { email: 'lock@abia.gov.ng', password: 'wrong password!' })).status, 401);
  assert.equal((await x.post('/api/auth/login', { email: 'lock@abia.gov.ng', password: PW })).status, 423);
  const reset = await admin.post(`/api/users/${user.id}/reset-link`);
  assert.equal(reset.status, 200);
  assert.equal((await x.post('/api/auth/login', { email: 'LOCK@abia.gov.ng', password: PW })).status, 200);
  await admin.patch(`/api/users/${user.id}`, { active: false });
  assert.equal((await c.get('/api/me')).status, 401);
  const res = await x.call('POST', '/api/auth/logout', {}, { 'x-lga': '0' });
  assert.equal(res.status, 403);
  const weak = await admin.post('/api/users', { name: 'W', email: 'w@abia.gov.ng', role: 'viewer', ouId: ABIA });
  const wt = weak.data.link.split('/set-password/')[1];
  assert.equal((await client(env).post('/api/password-links/' + wt, { password: 'short' })).status, 422);
  const log = await admin.get('/api/audit');
  assert.ok(log.data.entries.some((e) => e.action === 'login_locked'));
});

test('state officers manage only LGA users in their state', async () => {
  const { env, admin, dsId } = await world();
  const st = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA, datasets: [dsId] });
  const ok = await st.c.post('/api/users', { name: 'L', email: 'l2@abia.gov.ng', role: 'lga', ouId: ABA_SOUTH });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.data.user.datasets, [dsId]);
  assert.equal((await st.c.post('/api/users', { name: 'X', email: 'x@ad.gov.ng', role: 'lga', ouId: 'OgjFloqKoqk' })).status, 422);
  assert.equal((await st.c.post('/api/users', { name: 'X', email: 'x2@abia.gov.ng', role: 'state', ouId: ABIA })).status, 403);
  const list = (await st.c.get('/api/users')).data.users;
  assert.ok(list.every((u) => u.role === 'lga' || u.email === 's@abia.gov.ng'));
});

test('per-sector data sets and a shared yearly population data set used as denominator', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  assert.equal((await admin.post('/api/datasets', { name: 'No sector', frequency: 'MONTHLY' })).status, 422);
  const pop = (await admin.post('/api/datasets', { name: 'Population and denominators', shared: true, frequency: 'MONTHLY' })).data;
  const health = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const wash = (await admin.post('/api/datasets', { name: 'WASH – yearly', sector: 'WASH', frequency: 'YEARLY' })).data;
  const preg = await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Expected pregnancies', prorate: true });
  assert.equal(preg.status, 201);
  const hh = await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Households', prorate: false });
  assert.equal((await admin.post(`/api/datasets/${pop.id}/indicators`, { name: 'x', numerator: 'y' })).status, 422);
  // Indicator sector defaults to the data set's; denominator name matches the shared number.
  const anc = (await admin.post(`/api/datasets/${health.id}/indicators`, { name: 'ANC 4+ coverage', numerator: 'Women with 4+ ANC visits', denominator: 'expected pregnancies' })).data.indicator;
  assert.equal(anc.sector, 'Health');
  assert.equal(anc.denominatorId, preg.data.dataElement.id);
  const latr = (await admin.post(`/api/datasets/${wash.id}/indicators`, { name: 'Households with latrine', numerator: 'Households with a latrine', denominator: 'Households' })).data.indicator;
  assert.equal(latr.denominatorId, hh.data.dataElement.id);
  const meta = (await admin.get('/api/metadata')).data;
  assert.equal(meta.datasets.find((d) => d.id === pop.id).frequency, 'YEARLY');
  assert.equal(meta.datasets.find((d) => d.id === health.id).dataElements.length, 1); // shared number not duplicated

  const lga = await addUser(env, admin, { name: 'A', email: 'a@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const st = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  const month = lastCompletedPeriod('MONTHLY');
  const year = month.slice(0, 4);
  // Yearly population: 1,200 expected pregnancies -> 100 per month.
  await report(lga.c, pop.id, ABA_NORTH, year, { [preg.data.dataElement.id]: 1200, [hh.data.dataElement.id]: 500 });
  await st.c.post('/api/entry/review', { dataset: pop.id, ou: ABA_NORTH, period: year, action: 'accept' });
  const numId = anc.numeratorId;
  const form = (await lga.c.put('/api/entry', { dataset: health.id, ou: ABA_NORTH, period: month, values: { [numId]: 40 } })).data;
  assert.deepEqual(form.fields.map((f) => f.name), ['Women with 4+ ANC visits']);
  assert.equal(form.indicators[0].value, 40);
  assert.equal(form.sharedValues[0].value, 100);
  await lga.c.post('/api/entry/submit', { dataset: health.id, ou: ABA_NORTH, period: month });
  await st.c.post('/api/entry/review', { dataset: health.id, ou: ABA_NORTH, period: month, action: 'accept' });
  const pic = (await st.c.get(`/api/picture?dataset=${health.id}&period=${month}`)).data;
  assert.equal(pic.total.indicators[anc.id].value, 40);
  assert.equal(pic.total.indicators[anc.id].denominator, 100);
  assert.ok(pic.fields.some((f) => f.shared && f.name === 'Expected pregnancies'));
  // Yearly view of the monthly data set: only one month reported -> denominator is 1/12 of the year, not the whole year.
  const yp = (await st.c.get(`/api/picture?dataset=${health.id}&period=${year}`)).data;
  assert.equal(yp.total.indicators[anc.id].denominator, 100);
  // "Use as is" numbers are not split (yearly WASH indicator over yearly households).
  const prev = String(Number(year) - 1);
  await report(lga.c, pop.id, ABA_NORTH, prev, { [preg.data.dataElement.id]: 1000, [hh.data.dataElement.id]: 500 });
  await st.c.post('/api/entry/review', { dataset: pop.id, ou: ABA_NORTH, period: prev, action: 'accept' });
  await report(lga.c, wash.id, ABA_NORTH, prev, { [latr.numeratorId]: 200 });
  await st.c.post('/api/entry/review', { dataset: wash.id, ou: ABA_NORTH, period: prev, action: 'accept' });
  const wp = (await st.c.get(`/api/picture?dataset=${wash.id}&period=${prev}`)).data;
  assert.equal(wp.total.indicators[latr.id].value, 40);
});

test('units below the LGA: unit types, wards with their DHIS2 IDs, import, scope, metadata export', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const edu = (await admin.post('/api/datasets', { name: 'Education – yearly', sector: 'Education', frequency: 'YEARLY' })).data;
  let types = (await admin.get('/api/unit-types')).data.types;
  assert.deepEqual(types.map((t) => [t.name, t.isWard]), [['Ward', true], ['Health facility', false]]); // both ship by default
  assert.equal((await admin.post('/api/unit-types', { name: 'health facility' })).status, 409);
  const prim = (await admin.post('/api/unit-types', { name: 'Primary school' })).data.id;
  assert.equal((await admin.post('/api/unit-types', { name: 'primary school' })).status, 409);
  const one = await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Central Primary School', code: 'AB-001' });
  assert.equal(one.status, 201);
  assert.match(one.data.id, /^[A-Za-z][A-Za-z0-9]{10}$/);
  assert.equal((await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'central primary school' })).status, 409);
  // Wards keep their real DHIS2 ID.
  assert.equal((await admin.post('/api/units', { typeId: 'ut_ward', lgaId: ABA_NORTH, name: 'Ward 1' })).status, 422);
  assert.equal((await admin.post('/api/units', { typeId: 'ut_ward', lgaId: ABA_NORTH, name: 'Ward 1', id: 'WardAbaN001' })).status, 201);
  const rows = [
    { row: 2, lgaId: ABA_NORTH, name: 'Central Primary School', type: 'Primary school', code: 'AB-001' },                         // same
    { row: 3, lgaId: ABA_SOUTH, name: 'Ward 2', type: 'Ward', id: 'WardAbaS002' },                                                   // add ward
    { row: 4, state: 'ab Abia State', lga: 'ab Aba South LGA', ward: 'Ward 2', name: 'Girls Secondary School', type: 'Secondary school' }, // add, new type, under the new ward
    { row: 5, lgaId: ABA_NORTH, wardId: 'WardAbaN001', name: 'Ngwa Clinic', type: 'Health facility', id: 'Fac0000001a' },          // add under existing ward
    { row: 6, lgaId: AROCHUKWU, ward: 'Unknown ward', name: 'Arochukwu Model School', type: 'Primary school', id: 'Sch0000001a' },  // add, ward kept as label
    { row: 7, lgaId: AROCHUKWU, name: 'Ward 9', type: 'Ward' },                                                                     // error: ward without ID
    { row: 8, state: 'Abia', lga: 'Nowhere', name: 'Lost School', type: 'Primary school' },                                         // error: LGA
    { row: 9, lgaId: ABA_SOUTH, name: 'girls secondary school', type: 'Secondary school' },                                         // error: duplicate row
    { row: 10, lgaId: ABA_NORTH, name: 'Some unit' },                                                                               // error: no type
    { row: 11 },                                                                                                                    // blank
  ];
  const check = (await admin.post('/api/units/import', { rows })).data;
  assert.equal(check.committed, false);
  assert.deepEqual(check.counts, { add: 4, update: 0, same: 1, error: 4, wards: 1, possibleDuplicates: 0 });
  assert.match(check.results.find((r) => r.row === 6).note, /not loaded yet/);
  assert.equal((await admin.post('/api/units/import', { rows, commit: true })).status, 422);
  const good = rows.filter((r) => ![7, 8, 9, 10].includes(r.row));
  const done = (await admin.post('/api/units/import', { rows: good, commit: true })).data;
  assert.deepEqual(done.counts, { add: 4, update: 0, same: 1, error: 0, wards: 1, possibleDuplicates: 0 });
  types = (await admin.get('/api/unit-types')).data.types;
  assert.deepEqual(types.map((t) => t.name).sort(), ['Health facility', 'Primary school', 'Secondary school', 'Ward']);
  const list = (await admin.get(`/api/units?state=${ABIA}`)).data.units;
  assert.equal(list.length, 6);
  const girls = list.find((u) => u.name === 'Girls Secondary School');
  assert.equal(girls.level, 5); assert.equal(girls.wardId, 'WardAbaS002'); assert.equal(girls.ward, 'Ward 2'); assert.equal(girls.lgaId, ABA_SOUTH);
  assert.equal(list.find((u) => u.id === 'Fac0000001a').wardId, 'WardAbaN001');
  assert.equal(list.find((u) => u.id === 'Sch0000001a').level, 4);
  assert.equal((await admin.get(`/api/units?type=${prim}`)).data.units.length, 2);
  // Move a unit under a ward and back.
  const cps = list.find((u) => u.name === 'Central Primary School');
  assert.equal((await admin.patch('/api/units/' + cps.id, { wardId: 'WardAbaN001' })).status, 200);
  assert.equal((await admin.get(`/api/units?type=${prim}&lga=${ABA_NORTH}`)).data.units[0].wardId, 'WardAbaN001');
  assert.equal((await admin.patch('/api/units/' + cps.id, { wardId: 'WardAbaS002' })).status, 422); // another LGA's ward
  // Unit types in use cannot be removed.
  assert.equal((await admin.del('/api/unit-types/' + prim)).status, 409);
  assert.equal((await admin.del('/api/unit-types/ut_ward')).status, 422);
  // LGA pickers and the normal metadata export are unchanged; units (and their wards) appear only when asked.
  assert.equal((await admin.get('/api/orgunits?parent=' + ABA_NORTH)).data.children.length, 0);
  assert.equal((await admin.get('/api/orgunits?units=1&parent=' + ABA_NORTH)).data.children.length, 3);
  const m1 = (await admin.get('/api/export/metadata')).data.organisationUnits.organisationUnits;
  assert.equal(m1.length, 812);
  const m2 = (await admin.get('/api/export/metadata?units=all')).data.organisationUnits.organisationUnits;
  assert.equal(m2.length, 818);
  assert.deepEqual(m2.find((o) => o.id === 'Fac0000001a'), { id: 'Fac0000001a', parent: { id: 'WardAbaN001' }, name: 'Ngwa Clinic', level: 5 });
  assert.deepEqual(m2.find((o) => o.id === 'WardAbaN001'), { id: 'WardAbaN001', parent: { id: ABA_NORTH }, name: 'Ward 1', level: 4 });
  // A schedule reported by primary schools: exported with the sector, wards come along as parents.
  await admin.patch('/api/datasets/' + edu.id, { reportLevel: 'UNIT', unitTypes: [prim] });
  const m3 = (await admin.get('/api/export/metadata?units=' + (await admin.get('/api/metadata')).data.datasets.find((d) => d.id === edu.id).sectorId)).data.organisationUnits.organisationUnits;
  assert.deepEqual(m3.filter((o) => o.level >= 4).map((o) => o.name).sort(), ['Arochukwu Model School', 'Central Primary School', 'Ward 1']);
  // Wards cannot be mixed with other types in one schedule.
  assert.equal((await admin.patch('/api/datasets/' + edu.id, { unitTypes: [prim, 'ut_ward'] })).status, 422);
  // A state officer only sees and imports within their state; an LGA user cannot manage units.
  const st = await addUser(env, admin, { name: 'S', email: 's@ad.gov.ng', role: 'state', ouId: ADAMAWA, datasets: [edu.id] });
  assert.equal((await st.c.get('/api/units')).data.units.length, 0);
  const out = (await st.c.post('/api/units/import', { rows: [{ state: 'Abia', lga: 'Aba North', name: 'X', type: 'Primary school' }] })).data;
  assert.equal(out.counts.error, 1);
  assert.equal((await st.c.get(`/api/units?state=${ABIA}`)).status, 403);
  const lga = await addUser(env, admin, { name: 'L', email: 'l@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  assert.equal((await lga.c.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Y' })).status, 403);
  // A unit account can sit on a facility under a ward.
  assert.equal((await addUser(env, admin, { name: 'F', email: 'f@abia.gov.ng', role: 'unit', ouId: 'Fac0000001a' })).c ? 1 : 0, 1);
  // Re-importing DHIS2 org units (levels 1-3) with closeMissing does not close units below the LGA.
  const ous = (await admin.get('/api/export/metadata')).data.organisationUnits;
  await admin.post('/api/orgunits/import?closeMissing=true', ous);
  assert.equal((await admin.get('/api/units')).data.units.filter((u) => !u.closed).length, 6);
});

test('reporting by facilities under wards: chosen unit types report and add up to the LGA', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const fac = 'ut_health_facility'; // ships by default
  const ds = (await admin.post('/api/datasets', { name: 'Health – facilities', sector: 'Health', frequency: 'YEARLY', reportLevel: 'UNIT', unitTypes: [fac] })).data;
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Children vaccinated', numerator: 'Children vaccinated' });
  await admin.post('/api/units/import', { commit: true, rows: [
    { lgaId: ABA_NORTH, name: 'Ward 1', type: 'Ward', id: 'WardAbaN001' },
    { lgaId: ABA_NORTH, wardId: 'WardAbaN001', name: 'Clinic A', type: 'Health facility', id: 'FacA0000001' },
    { lgaId: ABA_NORTH, name: 'Clinic B', type: 'Health facility', id: 'FacB0000001' },               // directly under the LGA
    { lgaId: ABA_NORTH, name: 'School X', type: 'Primary school', id: 'SchX0000001' },               // another type: not expected
  ] });
  const year = String(new Date().getFullYear() - 1);
  const form = (await admin.get(`/api/entry?dataset=${ds.id}&ou=FacA0000001&period=${year}`)).data;
  assert.equal(form.ou.ward, 'Ward 1'); assert.equal(form.ou.lga, 'ab Aba North LGA'); assert.equal(form.ou.type, 'Health facility');
  assert.equal((await admin.get(`/api/entry?dataset=${ds.id}&ou=SchX0000001&period=${year}`)).status, 422);
  assert.equal((await admin.get(`/api/entry?dataset=${ds.id}&ou=WardAbaN001&period=${year}`)).status, 422);
  const fid = form.fields[0].id;
  for (const [ou, n] of [['FacA0000001', '30'], ['FacB0000001', '12']]) {
    await admin.put('/api/entry', { dataset: ds.id, ou, period: year, values: { [fid]: n } });
    await admin.post('/api/entry/submit', { dataset: ds.id, ou, period: year });
    await admin.post('/api/entry/review', { dataset: ds.id, ou, period: year, action: 'accept' });
  }
  const st = (await admin.get(`/api/status?dataset=${ds.id}&state=${ABIA}&lga=${ABA_NORTH}&period=${year}`)).data;
  assert.equal(st.total, 2);
  assert.equal(st.lgas.find((u) => u.id === 'FacA0000001').ward, 'Ward 1');
  const pic = (await admin.get(`/api/picture?dataset=${ds.id}&ou=${ABIA}&period=${year}`)).data;
  const an = pic.rows.find((r) => r.id === ABA_NORTH);
  assert.equal(an.values[fid], 42); assert.equal(an.unitsReporting, 2); assert.equal(an.expectedUnits, 2);
  // A ward-reported schedule expects wards only.
  const byWard = (await admin.post('/api/datasets', { name: 'Health – wards', sector: 'Health', frequency: 'YEARLY', reportLevel: 'UNIT', unitTypes: ['ut_ward'] })).data;
  assert.equal((await admin.get(`/api/status?dataset=${byWard.id}&state=${ABIA}&lga=${ABA_NORTH}&period=${year}`)).data.total, 1);
});

test('unit-level reporting: schools report, totals add up to LGA/state, rates count units', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Education – yearly (schools)', sector: 'Education', frequency: 'YEARLY', reportLevel: 'UNIT' })).data;
  const pupils = (await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Pupils enrolled', numerator: 'Pupils enrolled' })).data.indicator;
  const ptr = (await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Pupil-teacher ratio', numerator: 'Pupils enrolled', denominator: 'Teachers', showAs: 'number' })).data.indicator;
  const sector = (await admin.get('/api/units')).data.sectors.find((s) => s.name === 'Education').id;
  const add = async (lgaId, name) => (await admin.post('/api/units', { sectorId: sector, lgaId, name })).data.id;
  const A = await add(ABA_NORTH, 'School A'); const B = await add(ABA_NORTH, 'School B'); await add(ABA_NORTH, 'School C');
  await add(ABA_SOUTH, 'School D');
  const year = String(Number(lastCompletedPeriod('MONTHLY').slice(0, 4)) - 1);
  const [P, T] = [pupils.numeratorId, ptr.denominatorId];

  // Unit user for School A; LGA user enters for School B.
  const ua = await addUser(env, admin, { name: 'Head A', email: 'a@school.ng', role: 'unit', ouId: A });
  const lg = await addUser(env, admin, { name: 'LGA EO', email: 'eo@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  const st = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  // An LGA itself cannot report a unit-level data set; a unit user cannot report another school.
  assert.equal((await lg.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period: year, values: {} })).status, 422);
  assert.equal((await ua.c.put('/api/entry', { dataset: ds.id, ou: B, period: year, values: {} })).status, 403);
  await report(ua.c, ds.id, A, year, { [P]: 300, [T]: 10 });
  await report(lg.c, ds.id, B, year, { [P]: 100, [T]: 10 });
  const form = (await ua.c.get(`/api/entry?dataset=${ds.id}&ou=${A}&period=${year}`)).data;
  assert.equal(form.ou.lga, 'ab Aba North LGA');
  assert.equal(form.indicators.find((i) => i.id === ptr.id).value, 30);
  // The LGA reviews its schools; a unit user cannot review.
  assert.equal((await ua.c.post('/api/entry/review', { dataset: ds.id, ou: A, period: year, action: 'accept' })).status, 403);
  assert.equal((await lg.c.post('/api/entry/review', { dataset: ds.id, ou: A, period: year, action: 'accept' })).data.report.status, 'accepted');
  await st.c.post('/api/entry/review', { dataset: ds.id, ou: B, period: year, action: 'accept' });
  // Status lists schools.
  const status = (await st.c.get(`/api/status?dataset=${ds.id}&period=${year}`)).data;
  assert.equal(status.total, 4);
  assert.equal(status.counts.accepted, 2);
  assert.equal(status.lgas.find((u) => u.id === A).lgaName, 'ab Aba North LGA');
  assert.equal((await lg.c.get(`/api/status?dataset=${ds.id}&period=${year}`)).data.total, 3);
  // State picture: Aba North = A + B; ratio recomputed from sums (400 / 20 = 20); rate counts units (2 of 4).
  const pic = (await st.c.get(`/api/picture?dataset=${ds.id}&period=${year}`)).data;
  const an = pic.rows.find((r) => r.id === ABA_NORTH);
  assert.equal(an.indicators[pupils.id].value, 400);
  assert.equal(an.indicators[ptr.id].value, 20);
  assert.equal(an.unitsReporting, 2); assert.equal(an.expectedUnits, 3);
  assert.equal(pic.total.reportingRate, 50);
  assert.equal(pic.total.unitsReporting, 2); assert.equal(pic.total.expectedUnits, 4);
  // LGA picture lists its schools.
  const lp = (await st.c.get(`/api/picture?dataset=${ds.id}&ou=${ABA_NORTH}&period=${year}`)).data;
  assert.equal(lp.ou.level, 3);
  assert.deepEqual(lp.rows.map((r) => r.name), ['School A', 'School B', 'School C']);
  assert.equal(lp.rows[0].indicators[pupils.id].value, 300);
  assert.equal(lp.total.indicators[pupils.id].value, 400);
  // Export: LGA/state/national values come from the schools; school rows on request, for a state.
  const ex = (await admin.get(`/api/export/data?period=${year}&datasets=${ds.id}`)).data.dataValues[0];
  const val = (dx, ou) => (ex.rows.find((r) => r[0] === dx && r[2] === ou) || [])[3];
  assert.equal(val(pupils.id, NIGERIA), '400');
  assert.equal(val(ds.reportingRateId, ABIA), '50');
  assert.equal((await admin.get(`/api/export/data?period=${year}&datasets=${ds.id}&levels=4`)).status, 422);
  const ex4 = (await admin.get(`/api/export/data?period=${year}&datasets=${ds.id}&levels=3,4&ou=${ABIA}`)).data.dataValues[0];
  assert.equal((ex4.rows.find((r) => r[0] === pupils.id && r[2] === A) || [])[3], '300');
  assert.equal(ex4.metaData.items[A].name, 'School A');
  // Who reports can no longer change once there are reports.
  assert.equal((await admin.patch(`/api/datasets/${ds.id}`, { reportLevel: 'LGA' })).status, 409);
});

test('official population figures: template data, Excel-style import with checks, saved as accepted', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const pop = (await admin.post('/api/datasets', { name: 'Population and denominators', shared: true })).data;
  const preg = (await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Expected pregnancies' })).data.dataElement.id;
  const u5 = (await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Children under 5', prorate: false })).data.dataElement.id;
  const t0 = (await admin.get(`/api/datasets/${pop.id}/population?year=2026`)).data;
  assert.equal(t0.lgas.length, 774);
  assert.deepEqual(t0.fields.map((f) => f.name), ['Expected pregnancies', 'Children under 5']);
  const rows = [
    { row: 2, state: 'ab Abia State', lga: 'ab Aba North LGA', lgaId: ABA_NORTH, values: { [preg]: '4,820', [u5]: 21000 } },
    { row: 3, state: 'Abia', lga: 'Aba South', values: { [preg]: 5100, [u5]: '' } },
    { row: 4, lgaId: ABA_NORTH, values: { [preg]: 1 } },          // duplicate
    { row: 5, lga: 'Nowhere', values: { [preg]: 1 } },             // unknown
    { row: 6, lgaId: AROCHUKWU, values: { [preg]: -5 } },          // negative
    { row: 7, lgaId: ADAMAWA, values: {} },                        // a state ID, not an LGA
  ];
  const check = (await admin.post(`/api/datasets/${pop.id}/population`, { year: '2026', rows })).data;
  assert.deepEqual(check.counts, { lgas: 2, values: 3, changed: 3, error: 4 });
  assert.equal((await admin.post(`/api/datasets/${pop.id}/population`, { year: '2026', rows: rows.slice(0, 2), commit: true })).status, 422); // source needed
  const ok = await admin.post(`/api/datasets/${pop.id}/population`, { year: '2026', source: 'NPC 2026 projections', rows: rows.slice(0, 2), commit: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const t1 = (await admin.get(`/api/datasets/${pop.id}/population?year=2026`)).data;
  assert.equal(t1.source.source, 'NPC 2026 projections');
  assert.equal(t1.lgas.find((l) => l.id === ABA_NORTH).values[preg], 4820);
  assert.equal(t1.lgas.find((l) => l.id === ABA_SOUTH).values[u5], null);
  const st = (await admin.get(`/api/status?dataset=${pop.id}&state=${ABIA}&period=2026`)).data;
  assert.equal(st.counts.accepted, 2);
  // Re-import is idempotent; non-admins cannot import.
  const again = (await admin.post(`/api/datasets/${pop.id}/population`, { year: '2026', rows: rows.slice(0, 2) })).data;
  assert.equal(again.counts.changed, 0);
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  assert.equal((await so.c.get(`/api/datasets/${pop.id}/population?year=2026`)).status, 403);
});

test('pivot: all sectors or one sector, area + one level down, units under an LGA', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const health = (await admin.post('/api/datasets', { name: 'Health – yearly', sector: 'Health', frequency: 'YEARLY' })).data;
  const edu = (await admin.post('/api/datasets', { name: 'Education – schools', sector: 'Education', frequency: 'YEARLY', reportLevel: 'UNIT' })).data;
  const anc = (await admin.post(`/api/datasets/${health.id}/indicators`, { name: 'ANC visits', numerator: 'ANC visits' })).data.indicator;
  const pup = (await admin.post(`/api/datasets/${edu.id}/indicators`, { name: 'Pupils', numerator: 'Pupils' })).data.indicator;
  const sec = Object.fromEntries((await admin.get('/api/units')).data.sectors.map((s) => [s.name, s.id]));
  const school = (await admin.post('/api/units', { sectorId: sec.Education, lgaId: ABA_NORTH, name: 'School A' })).data.id;
  const year = String(Number(lastCompletedPeriod('MONTHLY').slice(0, 4)) - 1);
  const st = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  await report(admin, health.id, ABA_NORTH, year, { [anc.numeratorId]: 50 });
  await report(admin, edu.id, school, year, { [pup.numeratorId]: 300 });
  await admin.post('/api/entry/review', { dataset: health.id, ou: ABA_NORTH, period: year, action: 'accept' });
  await admin.post('/api/entry/review', { dataset: edu.id, ou: school, period: year, action: 'accept' });

  const all = (await st.c.get(`/api/pivot?period=${year}`)).data;
  assert.equal(all.area.id, ABIA);
  assert.equal(all.ous.length, 18); // state + 17 LGAs
  const cell = (d, dx, ou) => (d.cells.find((c) => c.dx === dx && c.ou === ou) || {}).v;
  assert.equal(cell(all, anc.id, ABIA), 50);
  assert.equal(cell(all, pup.id, ABA_NORTH), 300);
  assert.equal(cell(all, health.reportingRateId, ABIA), Math.round(1000 / 17) / 10);
  const onlyHealth = (await st.c.get(`/api/pivot?period=${year}&sector=${sec.Health}`)).data;
  assert.deepEqual(onlyHealth.indicators.map((i) => i.name), ['ANC visits', 'Health – yearly – reporting rate']);
  const nat = (await admin.get(`/api/pivot?period=${year}`)).data;
  assert.equal(nat.ous.length, 38);
  assert.equal(cell(nat, anc.id, ABIA), 50);
  const lga = (await admin.get(`/api/pivot?period=${year}&ou=${ABA_NORTH}`)).data;
  assert.equal(cell(lga, pup.id, school), 300);
  assert.equal((await admin.get(`/api/pivot?period=${year}Q1`)).data.skipped.length, 2); // yearly data sets
  assert.equal((await st.c.get(`/api/pivot?period=${year}&ou=${NIGERIA}`)).status, 403);
});

test('self-registration by link/QR: request, pending sign-in message, approval by admin or state officer, rejection', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const link = (await admin.post('/api/registration-links', { name: 'Abia LGA officers', ouId: ABIA, role: 'lga', datasets: [ds.id], days: 14 })).data.link;
  assert.match(link.url, /#\/register\//);
  const token = link.url.split('/register/')[1];
  const anon = client(env);
  const info = (await anon.get('/api/register/' + token)).data;
  assert.equal(info.area.id, ABIA);
  assert.deepEqual(info.roles.map((r) => r.id), ['lga', 'unit', 'state', 'viewer']);
  assert.equal(info.datasets[0].suggested, true);
  assert.equal((await anon.get(`/api/register/${token}/places`)).data.children.length, 17);
  assert.equal((await anon.get(`/api/register/${token}/places?parent=${ADAMAWA}`)).status, 403); // outside the link's area
  assert.equal((await anon.get('/api/register/nonsense')).status, 404);
  const healthSector = info.sectors.find((x) => x.name === 'Health').id;
  const form = { name: 'Ngozi Eze', email: 'ngozi@abia.gov.ng', phone: '0803 000 0000', jobTitle: 'M&E officer', organisation: 'Aba North LGA', role: 'lga', sectorId: healthSector, ouId: ABA_NORTH, datasets: [ds.id], password: PW };
  const { sectorId: _s, ...noSector } = form;
  assert.equal((await anon.post('/api/register/' + token, noSector)).status, 422);                      // sector is required
  assert.equal((await anon.post('/api/register/' + token, { ...form, ouId: ABIA })).status, 422);       // LGA role needs an LGA
  assert.equal((await anon.post('/api/register/' + token, { ...form, ouId: ADAMAWA })).status, 422);    // outside area
  assert.equal((await anon.post('/api/register/' + token, { ...form, password: 'short' })).status, 422);
  assert.equal((await anon.post('/api/register/' + token, form)).status, 201);
  assert.equal((await anon.post('/api/register/' + token, form)).status, 409);                           // already pending
  // Pending: sign-in explains (only with the right password).
  const pend = await client(env).post('/api/auth/login', { email: form.email, password: PW });
  assert.equal(pend.status, 403); assert.equal(pend.data.error.code, 'pending_approval');
  assert.equal((await client(env).post('/api/auth/login', { email: form.email, password: 'wrong password!' })).status, 401);
  // A state officer of another state does not see it; Abia's does and approves.
  const ad = await addUser(env, admin, { name: 'A', email: 'a@ad.gov.ng', role: 'state', ouId: ADAMAWA });
  assert.equal((await ad.c.get('/api/account-requests')).data.requests.length, 0);
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  const reqs = (await so.c.get('/api/account-requests')).data.requests;
  assert.equal(reqs.length, 1); assert.equal(reqs[0].ou.name, 'ab Aba North LGA'); assert.equal(reqs[0].phone, '0803 000 0000'); assert.equal(reqs[0].sector, 'Health');
  assert.equal((await so.c.post(`/api/account-requests/${reqs[0].id}/approve`, { role: 'state' })).status, 403);
  assert.equal((await so.c.post(`/api/account-requests/${reqs[0].id}/approve`, {})).status, 200);
  assert.equal((await so.c.post(`/api/account-requests/${reqs[0].id}/approve`, {})).status, 409);
  // The person signs in with the password they chose; data set assigned.
  const ng = client(env);
  assert.equal((await ng.post('/api/auth/login', { email: form.email, password: PW })).status, 200);
  const me = (await ng.get('/api/me')).data;
  assert.equal(me.user.role, 'lga'); assert.equal(me.ou.id, ABA_NORTH); assert.deepEqual(me.datasets.map((d) => d.id), [ds.id]);
  // Rejection + message.
  await anon.post('/api/register/' + token, { ...form, email: 'x@y.ng', name: 'Someone Else' });
  const r2 = (await admin.get('/api/account-requests')).data.requests[0];
  await admin.post(`/api/account-requests/${r2.id}/reject`, { note: 'Not a government employee' });
  const rej = await client(env).post('/api/auth/login', { email: 'x@y.ng', password: PW });
  assert.equal(rej.data.error.code, 'request_rejected'); assert.match(rej.data.error.message, /Not a government employee/);
  // Links list with counts; revoked link stops working.
  const links = (await admin.get('/api/registration-links')).data.links;
  assert.deepEqual(links[0].requests, { pending: 0, approved: 1, total: 2 });
  await admin.del('/api/registration-links/' + token);
  assert.equal((await anon.get('/api/register/' + token)).status, 404);
  // An LGA-scoped link only offers LGA-level and unit roles.
  const l2 = (await admin.post('/api/registration-links', { name: 'Aba North schools', ouId: ABA_NORTH, role: 'unit' })).data.link;
  assert.deepEqual((await anon.get('/api/register/' + l2.url.split('/register/')[1])).data.roles.map((r) => r.id), ['lga', 'unit', 'viewer']);
});

test('registration sector: data sets and units must belong to it; empty choice gets the whole sector', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const h1 = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const h2 = (await admin.post('/api/datasets', { name: 'Health – yearly', sector: 'Health', frequency: 'YEARLY' })).data;
  const ed = (await admin.post('/api/datasets', { name: 'Schools', sector: 'Education', frequency: 'YEARLY', reportLevel: 'UNIT' })).data;
  const secs = Object.fromEntries((await admin.get('/api/units')).data.sectors.map((s) => [s.name, s.id]));
  const school = (await admin.post('/api/units', { sectorId: secs.Education, lgaId: ABA_NORTH, name: 'School A' })).data.id;
  const link = (await admin.post('/api/registration-links', { name: 'Education only', ouId: ABIA, sectorId: secs.Education })).data.link;
  assert.equal(link.sector, 'Education');
  const token = link.url.split('/register/')[1];
  const anon = client(env);
  const info = (await anon.get('/api/register/' + token)).data;
  assert.equal(info.sector, secs.Education);
  assert.deepEqual(info.sectors.map((s) => s.name).sort(), ['Education', 'Health']);
  const units = (await anon.get(`/api/register/${token}/places?parent=${ABA_NORTH}&units=1`)).data.children;
  assert.equal(units[0].sectorId, secs.Education);
  const base = { name: 'Head A', email: 'head@school.ng', role: 'unit', ouId: school, password: PW };
  assert.equal((await anon.post('/api/register/' + token, { ...base, sectorId: secs.Health })).status, 422);            // link is Education-only
  assert.equal((await anon.post('/api/register/' + token, { ...base, sectorId: secs.Education, datasets: [h1.id] })).status, 422); // Health data set
  assert.equal((await anon.post('/api/register/' + token, { ...base, sectorId: secs.Education })).status, 201);
  // Open link: a Health LGA officer who ticks nothing gets both Health data sets on approval (not Education).
  const open = (await admin.post('/api/registration-links', { name: 'Any sector', ouId: ABIA })).data.link.url.split('/register/')[1];
  assert.equal((await anon.post('/api/register/' + open, { name: 'Officer', email: 'o@abia.gov.ng', role: 'lga', sectorId: secs.Health, ouId: ABA_NORTH, password: PW })).status, 201);
  const reqs = (await admin.get('/api/account-requests')).data.requests;
  for (const r of reqs) await admin.post(`/api/account-requests/${r.id}/approve`, {});
  const off = client(env); await off.post('/api/auth/login', { email: 'o@abia.gov.ng', password: PW });
  assert.deepEqual((await off.get('/api/me')).data.datasets.map((d) => d.id).sort(), [h1.id, h2.id].sort());
  const head = client(env); await head.post('/api/auth/login', { email: 'head@school.ng', password: PW });
  assert.deepEqual((await head.get('/api/me')).data.datasets.map((d) => d.id), [ed.id]);
});

test('rollout: only active states show up in lists, registration, picture, pivot, totals and exports', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – yearly', sector: 'Health', frequency: 'YEARLY' })).data;
  const ind = (await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Visits', numerator: 'Visits' })).data.indicator;
  const year = String(Number(lastCompletedPeriod('MONTHLY').slice(0, 4)) - 1);
  await report(admin, ds.id, ABA_NORTH, year, { [ind.numeratorId]: 10 });
  await admin.post('/api/entry/review', { dataset: ds.id, ou: ABA_NORTH, period: year, action: 'accept' });
  const link = (await admin.post('/api/registration-links', { name: 'All', ouId: NIGERIA })).data.link.url.split('/register/')[1];
  const adLink = (await admin.post('/api/registration-links', { name: 'Adamawa', ouId: ADAMAWA })).data.link.url.split('/register/')[1];
  // Roll out to Abia only.
  assert.equal((await admin.call('PUT', '/api/rollout', { active: [] })).status, 422);
  const r = await admin.call('PUT', '/api/rollout', { active: [ABIA] });
  assert.equal(r.status, 200); assert.equal(r.data.changed, 36);
  assert.deepEqual((await admin.get('/api/orgunits')).data.states.map((s) => s.id), [ABIA]);
  assert.equal((await admin.get('/api/orgunits?all=1')).data.states.length, 37);
  assert.equal((await admin.get('/api/orgunits?lgas=all')).data.lgas.length, 17);
  const anon = client(env);
  assert.deepEqual((await anon.get(`/api/register/${link}/places`)).data.children.map((c) => c.id), [ABIA]);
  assert.equal((await anon.get('/api/register/' + adLink)).status, 404);
  const nat = (await admin.get(`/api/picture?dataset=${ds.id}&period=${year}`)).data;
  assert.equal(nat.rows.length, 1); assert.equal(nat.total.totalUnits, 17);
  assert.equal(nat.total.reportingRate, Math.round(1000 / 17) / 10);   // rate counts Abia's 17 LGAs, not 774
  assert.equal((await admin.get(`/api/pivot?period=${year}`)).data.ous.length, 2);
  const meta = (await admin.get('/api/export/metadata')).data.organisationUnits.organisationUnits;
  assert.equal(meta.length, 1 + 1 + 17);
  // Data is kept: switching every state back on restores the full picture.
  await admin.call('PUT', '/api/rollout', { active: (await admin.get('/api/orgunits?all=1')).data.states.map((s) => s.id) });
  assert.equal((await admin.get(`/api/picture?dataset=${ds.id}&period=${year}`)).data.total.totalUnits, 774);
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  assert.equal((await so.c.call('PUT', '/api/rollout', { active: [ABIA] })).status, 403);
});

test('sectors can be added, renamed and removed (only when unused)', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const r = await admin.post('/api/sectors', { name: 'Agriculture' });
  assert.equal(r.status, 201);
  assert.equal((await admin.post('/api/sectors', { name: 'agriculture' })).status, 409);
  assert.equal((await admin.patch('/api/sectors/' + r.data.id, { name: 'Agriculture & Food Security' })).status, 200);
  assert.ok((await admin.get('/api/metadata')).data.sectors.some((s) => s.name === 'Agriculture & Food Security'));
  await admin.post('/api/datasets', { name: 'Agric – quarterly', sector: 'Agriculture & Food Security', frequency: 'QUARTERLY' });
  assert.equal((await admin.del('/api/sectors/' + r.data.id)).status, 409);
  const w = (await admin.post('/api/sectors', { name: 'WASH' })).data.id;
  assert.equal((await admin.del('/api/sectors/' + w)).status, 200);
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  assert.equal((await so.c.post('/api/sectors', { name: 'X' })).status, 403);
});

test('a population figure added after the indicator takes over the same-named number', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const h = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const ind = (await admin.post(`/api/datasets/${h.id}/indicators`, { name: 'ANC', numerator: 'ANC visits', denominator: 'Expected pregnancies' })).data.indicator;
  const pop = (await admin.post('/api/datasets', { name: 'Population', shared: true })).data;
  const f = (await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Expected Pregnancies' })).data.dataElement;
  const meta = (await admin.get('/api/metadata')).data;
  const hs = meta.datasets.find((d) => d.id === h.id);
  assert.deepEqual(hs.dataElements.map((d) => d.name), ['ANC visits']);
  assert.equal(hs.indicators.find((i) => i.id === ind.id).denominatorId, f.id);
});

test('a form can be deleted only while nothing was reported on it', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const t = (await admin.post('/api/datasets', { name: 'Education test', sector: 'Education', frequency: 'MONTHLY' })).data;
  await admin.post(`/api/datasets/${t.id}/indicators`, { name: 'Pupils', numerator: 'Pupils enrolled' });
  const used = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const ind = (await admin.post(`/api/datasets/${used.id}/indicators`, { name: 'ANC', numerator: 'ANC visits' })).data;
  assert.ok(ind);
  const form = (await admin.get(`/api/entry?dataset=${used.id}&ou=${ABA_NORTH}`)).data;
  await admin.put('/api/entry', { dataset: used.id, ou: ABA_NORTH, period: form.period, values: { [form.fields[0].id]: '3' } });
  const so = await addUser(env, admin, { name: 'S', email: 's@abia.gov.ng', role: 'state', ouId: ABIA });
  assert.equal((await so.c.del('/api/datasets/' + t.id)).status, 403);
  assert.equal((await admin.del('/api/datasets/' + used.id)).status, 409);
  assert.equal((await admin.del('/api/datasets/' + t.id)).status, 200);
  const meta = (await admin.get('/api/metadata')).data;
  assert.ok(!meta.datasets.some((d) => d.id === t.id));
  assert.ok(meta.datasets.some((d) => d.id === used.id));
});

test('units: own-system codes, coordinates, duplicate warnings, codes and locations in the export', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  await admin.post('/api/datasets', { name: 'Education – yearly', sector: 'Education', frequency: 'YEARLY' });
  const prim = (await admin.post('/api/unit-types', { name: 'Primary school', codeLabel: 'EMIS school code' })).data.id;
  assert.equal((await admin.get('/api/unit-types')).data.types.find((t) => t.id === prim).codeLabel, 'EMIS school code');
  const a = await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Central Primary School', code: 'AB/001', latitude: 5.12, longitude: 7.37 });
  assert.equal(a.status, 201);
  // Coordinates outside Nigeria (swapped) are refused.
  assert.equal((await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Other School', latitude: 7.37, longitude: 25.1 })).status, 422);
  // A possible duplicate (similar name; within 50 m) is flagged and needs “force”; numbered names are not duplicates.
  const dup = await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Central Primary Schol', latitude: 5.1201, longitude: 7.3701 });
  assert.equal(dup.status, 409); assert.equal(dup.data.error.code, 'possible_duplicate');
  assert.equal((await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'Central Primary Schol', force: true })).status, 201);
  assert.equal((await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'LEA Primary School I' })).status, 201);
  assert.equal((await admin.post('/api/units', { typeId: prim, lgaId: ABA_NORTH, name: 'LEA Primary School II' })).status, 201);
  // Import: a row with the same code updates that school (even under another name); a near name is noted.
  const chk = (await admin.post('/api/units/import', { rows: [
    { lgaId: ABA_NORTH, type: 'Primary school', name: 'Central Pry School', code: 'ab/001', latitude: '5.13', longitude: '7.38' },
    { lgaId: ABA_NORTH, type: 'Primary school', name: 'LEA Primary Scool I' },
  ] })).data;
  assert.equal(chk.results[0].status, 'update'); assert.equal(chk.results[0].id, a.data.id);
  assert.match(chk.results[1].note, /Possible duplicate/); assert.equal(chk.counts.possibleDuplicates, 1);
  await admin.post('/api/units/import', { commit: true, rows: [{ lgaId: ABA_NORTH, type: 'Primary school', name: 'Central Pry School', code: 'ab/001', latitude: '5.13', longitude: '7.38' }] });
  const u = (await admin.get(`/api/units?type=${prim}&lga=${ABA_NORTH}`)).data.units.find((x) => x.id === a.data.id);
  assert.equal(u.name, 'Central Pry School'); assert.equal(u.latitude, 5.13);
  const m = (await admin.get('/api/export/metadata?units=all')).data.organisationUnits.organisationUnits.find((o) => o.id === a.data.id);
  assert.equal(m.code, 'ab/001');
  assert.deepEqual(m.geometry, { type: 'Point', coordinates: [7.38, 5.13] });
});

test('indicators: a percentage or a rate per 1,000 needs a denominator', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  const no = await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'ANC coverage', numerator: 'ANC visits', source: 'HMIS', showAs: 'percent' });
  assert.equal(no.status, 422);
  assert.equal((await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Deaths per 1,000', numerator: 'Deaths', source: 'HMIS', showAs: 'per1000', denominator: '' })).status, 422);
  assert.equal((await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'ANC coverage', numerator: 'ANC visits', denominator: 'Expected pregnancies', source: 'HMIS', showAs: 'percent' })).status, 201);
  assert.equal((await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'Clinics open', numerator: 'Clinics open', source: 'Register', showAs: 'number' })).status, 201);
});
