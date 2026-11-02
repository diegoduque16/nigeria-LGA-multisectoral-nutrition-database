// Reminders: who has not sent, emails with the upload link and their own Excel template attached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, setupAdmin, addUser } from './harness.js';
import { unzip } from '../public/js/unzip.js';

const ABIA = 'FHlOerryBjk';
const ABA_NORTH = 'NmLIx68MjRi';
const ABA_SOUTH = 'FQhClVW8Xg4';

test('reminders: list who has not sent, email each with the upload link and their template attached', async () => {
  const env = makeEnv({ EMAIL_API_KEY: 'test-key', EMAIL_FROM: 'LGA Scorecard <reports@example.org>' });
  const admin = await setupAdmin(env);
  const ds = (await admin.post('/api/datasets', { name: 'Health – monthly', sector: 'Health', frequency: 'MONTHLY' })).data;
  await admin.post(`/api/datasets/${ds.id}/indicators`, { name: 'ANC', numerator: 'ANC visits', denominator: 'Women seen' });
  const north = await addUser(env, admin, { name: 'Ngozi', email: 'ngozi@abia.gov.ng', role: 'lga', ouId: ABA_NORTH });
  await addUser(env, admin, { name: 'Sola', email: 'sola@abia.gov.ng', role: 'lga', ouId: ABA_SOUTH });
  const period = (await admin.get(`/api/status?dataset=${ds.id}&state=${ABIA}`)).data.period;
  // Aba South sends; Aba North only saves a draft.
  const southForm = (await admin.get(`/api/entry?dataset=${ds.id}&ou=${ABA_SOUTH}&period=${period}`)).data;
  await admin.put('/api/entry', { dataset: ds.id, ou: ABA_SOUTH, period, values: Object.fromEntries(southForm.fields.map((f) => [f.id, '4'])) });
  await admin.post('/api/entry/submit', { dataset: ds.id, ou: ABA_SOUTH, period });
  await north.c.put('/api/entry', { dataset: ds.id, ou: ABA_NORTH, period, values: { [southForm.fields[0].id]: '9' } });

  const list = (await admin.get(`/api/reminders?dataset=${ds.id}&period=${period}&ou=${ABIA}`)).data;
  assert.equal(list.emailConfigured, true);
  assert.match(list.link, new RegExp(`/#/upload/${ds.id}/${period}$`));
  const an = list.places.find((p) => p.id === ABA_NORTH);
  assert.equal(an.status, 'draft'); assert.equal(an.users[0].email, 'ngozi@abia.gov.ng');
  assert.ok(!list.places.some((p) => p.id === ABA_SOUTH));
  const sola = (await admin.get('/api/users')).data.users.find((u) => u.email === 'sola@abia.gov.ng');

  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.authorization }); return new Response('{"id":"x"}', { status: 200 }); };
  try {
    const r = (await admin.post('/api/reminders', { dataset: ds.id, period, ou: ABIA, userIds: [an.users[0].id, sola.id], note: 'Before Friday please.' })).data;
    assert.equal(r.sent, 1);
    assert.equal(r.results.find((x) => x.id === sola.id).ok, false); // already sent
  } finally { globalThis.fetch = real; }
  assert.equal(sent.length, 1);
  const mail = sent[0];
  assert.equal(mail.url, 'https://api.resend.com/emails'); assert.equal(mail.auth, 'Bearer test-key');
  assert.deepEqual(mail.body.to, ['ngozi@abia.gov.ng']);
  assert.match(mail.body.subject, /Health – monthly/);
  assert.match(mail.body.text, /Before Friday please\./); assert.ok(mail.body.text.includes(list.link));
  const att = mail.body.attachments[0];
  assert.match(att.filename, /_data_entry\.xlsx$/);
  const files = await unzip(Buffer.from(att.content, 'base64'));
  const sheet = await files.find((f) => f.name === 'xl/worksheets/sheet1.xml').text();
  assert.ok(sheet.includes(ABA_NORTH)); assert.ok(!sheet.includes(ABA_SOUTH)); // only their own LGA
  assert.ok(sheet.includes('<v>9</v>'));                                   // what they saved is filled in
  // Remembered as reminded.
  const again = (await admin.get(`/api/reminders?dataset=${ds.id}&period=${period}&ou=${ABIA}`)).data;
  assert.ok(again.places.find((p) => p.id === ABA_NORTH).users[0].lastReminded);
  // LGA users cannot send reminders; without an email service, sending is refused with an explanation.
  assert.equal((await north.c.get(`/api/reminders?dataset=${ds.id}&period=${period}`)).status, 403);
  const env2 = makeEnv();
  const admin2 = await setupAdmin(env2);
  const ds2 = (await admin2.post('/api/datasets', { name: 'X', sector: 'Health', frequency: 'MONTHLY' })).data;
  const l2 = (await admin2.get(`/api/reminders?dataset=${ds2.id}&period=${period}&ou=${ABIA}`)).data;
  assert.equal(l2.emailConfigured, false);
  assert.equal((await admin2.post('/api/reminders', { dataset: ds2.id, period, ou: ABIA, userIds: [] })).status, 409);
});
