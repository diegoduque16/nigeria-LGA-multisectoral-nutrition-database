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
