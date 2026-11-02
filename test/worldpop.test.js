// GRID3 / WorldPop population import: version check, table download (zip), LGA matching, saving.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { makeEnv, setupAdmin, addUser } from './harness.js';
import { placeKey, parseCsv, detectColumns } from '../src/routes/worldpop.js';
import { unzip } from '../public/js/unzip.js';

const ALKALERI = 'v3GUZsQb0Un';
const BAUCHI = 'ziJ3yxfgb3m';

// A real (deflate) ZIP file with the given entries.
function makeZip(entries) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text); const comp = deflateRawSync(data); const nm = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(local, nm, comp); central.push(c, nm); offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const CSV = [
  'statename,lganame,total,under5,f15_49',
  'Bauchi,Alkaleri,"512,345.6",98000.2,110000',
  'Bauchi,Bauchi,900000,170000,200000',
  'Bauchi,Bogorro,250000,47000,55000', // close spelling of "Bogoro"
  'Bauchi,Nowhere,1000,200,300',       // no such LGA
  'Lagos,Ikeja,700000,90000,180000',   // state not in use
].join('\r\n');

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return fn().finally(() => { globalThis.fetch = real; });
}
const worldpop = (calls) => async (url) => {
  calls.push(String(url));
  if (String(url).endsWith('/NGA/population/')) return new Response('<a href="v1.2/">v1.2/</a> <a href="v2.0/">v2.0/</a> <a href="v3.0/">v3.0/</a> <a href="v3.1/">v3.1/</a>');
  if (String(url).endsWith('v3.0/NGA_population_v3_0_table.zip')) return new Response(makeZip({ 'NGA_population_v3_0_table/national_pop_total_scaled.csv': 'total\n237527782', 'NGA_population_v3_0_table/lga_pop_total_scaled.csv': CSV }));
  return new Response('not found', { status: 404 });
};

test('helpers: names, CSV, columns, unzip', async () => {
  assert.equal(placeKey('ba Bauchi State'), 'bauchi');
  assert.equal(placeKey('ab Obi Nwga LGA'), 'obinwga');
  assert.equal(placeKey('fc Federal Capital Territory'), 'fct');
  assert.equal(placeKey('FCT'), 'fct');
  const g = parseCsv(CSV);
  assert.equal(g.length, 6); assert.equal(g[1][2], '512,345.6');
  assert.deepEqual(detectColumns(g[0], g.slice(1)), { state: 'statename', lga: 'lganame', numeric: ['total', 'under5', 'f15_49'] });
  const files = await unzip(makeZip({ 'a.csv': 'x,y\n1,2' }));
  assert.equal(await files[0].text(), 'x,y\n1,2');
});

test('WorldPop: check for versions, load the table, match LGAs, save, remember the version', async () => {
  const env = makeEnv();
  const admin = await setupAdmin(env);
  assert.equal((await admin.put('/api/rollout', { active: [BAUCHI] })).status, 200);
  const pop = (await admin.post('/api/datasets', { name: 'Population', shared: true })).data;
  const total = (await admin.post(`/api/datasets/${pop.id}/fields`, { name: 'Total population', prorate: false })).data.dataElement;
  const calls = [];
  await withFetch(worldpop(calls), async () => {
    let st = (await admin.get('/api/worldpop')).data;
    assert.equal(st.check, null);
    st = (await admin.get('/api/worldpop?check=1')).data;
    assert.deepEqual(st.check.versions, ['1.2', '2.0', '3.0', '3.1']);
    assert.equal(st.check.latest, '3.1');
    assert.equal(st.newerAvailable, true);

    const missing = await admin.get('/api/worldpop/table?version=3.1');
    assert.equal(missing.status, 502);

    const t = (await admin.get('/api/worldpop/table?version=3.0')).data;
    assert.equal(t.referenceYear, 2025);
    assert.match(t.file, /lga_pop_total_scaled\.csv$/);
    assert.deepEqual(t.columns.numeric, ['total', 'under5', 'f15_49']);
    assert.equal(t.otherStates, 1);
    assert.equal(t.rows.length, 3);
    const alk = t.rows.find((r) => r.lgaId === ALKALERI);
    assert.equal(alk.values.total, 512345.6);
    const bog = t.rows.find((r) => r.fileName === 'Bogorro');
    assert.equal(bog.lgaName, 'ba Bogoro LGA'); assert.equal(bog.fuzzy, true);
    assert.deepEqual(t.unmatched.map((u) => u.lga), ['Nowhere']);
    assert.equal(t.missing.length, t.lgasInUse - 3);

    // Saving goes through the usual population import; then the version is remembered.
    const rows = t.rows.map((r, i) => ({ row: i + 2, lgaId: r.lgaId, values: { [total.id]: Math.round(r.values.total) } }));
    assert.equal((await admin.post(`/api/datasets/${pop.id}/population`, { year: '2025', source: 'GRID3/WorldPop NGA population v3.0', rows, commit: true })).status, 200);
    st = (await admin.post('/api/worldpop/imported', { version: '3.0', year: '2025' })).data;
    assert.equal(st.imported.version, '3.0');
    assert.equal(st.newerAvailable, true); // 3.1 is out
    const tbl = (await admin.get(`/api/datasets/${pop.id}/population?year=2025`)).data;
    assert.equal(tbl.lgas.find((l) => l.id === ALKALERI).values[total.id], 512346);
  });

  // Uploaded copy (the app unzips .zip uploads and sends the CSV).
  const up = (await admin.post('/api/worldpop/table', { name: 'lga_pop_total_scaled.csv', csv: CSV, version: '3.0' })).data;
  assert.equal(up.rows.length, 3);
  assert.equal(up.referenceYear, 2025);

  // Only administrators.
  const so = await addUser(env, admin, { name: 'S', email: 's@bauchi.gov.ng', role: 'state', ouId: BAUCHI });
  assert.equal((await so.c.get('/api/worldpop')).status, 403);
});
