// LGA Sector Reporting — single-page app (no framework, no dashboards: forms and tables).

// ---------- tiny helpers ----------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
}
const main = () => $('#main');
function mount(...nodes) { const m = main(); m.replaceChildren(...nodes); window.scrollTo(0, 0); }

let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, bad ? 6000 : 3000);
}

class ApiError extends Error { constructor(status, body) { super((body && body.error && body.error.message) || 'Request failed'); this.status = status; this.body = body; } }
async function api(method, path, body) {
  const opts = { method, headers: { 'x-lga': '1' }, credentials: 'same-origin' };
  if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (res.status === 401 && state.me && path !== '/api/me' && !path.startsWith('/api/auth')) { state.me = null; toast('Your session ended. Please sign in again.', true); go('#/login'); throw new ApiError(401, data); }
  if (!res.ok) throw new ApiError(res.status, data);
  return { data, res };
}
const get = (p) => api('GET', p).then((r) => r.data);
const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

async function download(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) { let m = 'Export failed.'; try { m = (await res.json()).error.message; } catch {} throw new Error(m); }
  const name = (/filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '') || [])[1] || 'export.json';
  const blob = await res.blob();
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}

function copy(text) { navigator.clipboard.writeText(text).then(() => toast('Copied'), () => toast('Copy failed — select and copy it manually', true)); }
const fmtNum = (v, d = 0) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: d }));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '—');
const fmtDay = (ms) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) : '—');
const pill = (status, name) => h('span', { class: 'pill s-' + status }, name || status);
const field = (label, input) => h('label', { class: 'f' }, label, input);
const select = (opts, value, attrs = {}) => h('select', attrs, opts.map((o) => h('option', { value: o.id, selected: o.id === value }, o.name)));
const idTag = (id) => h('span', { class: 'id', title: 'Click to copy this ID', onclick: () => copy(id) }, id);

function busy(btn, fn) {
  return async (e) => {
    if (e) e.preventDefault();
    btn.disabled = true;
    try { await fn(); } catch (err) { if (err.status !== 401) toast(err.message, true); } finally { btn.disabled = false; }
  };
}

// ---------- state & routing ----------
const state = { me: null, meta: null, orgs: null, prefs: {} };
try { state.prefs = JSON.parse(localStorage.getItem('lga.prefs') || '{}'); } catch {}
function pref(k, v) { if (v === undefined) return state.prefs[k]; state.prefs[k] = v; try { localStorage.setItem('lga.prefs', JSON.stringify(state.prefs)); } catch {} return v; }
const go = (hash) => { if (location.hash !== hash) location.hash = hash; else route(); };
const role = () => state.me && state.me.user.role;
const is = (...roles) => roles.includes(role());

const PAGES = [
  { id: 'entry', name: 'Data entry', roles: ['sysadmin', 'state', 'lga'] },
  { id: 'review', name: 'Review', roles: ['sysadmin', 'state'] },
  { id: 'picture', name: 'State picture', roles: ['sysadmin', 'setupadmin', 'state', 'viewer'] },
  { id: 'export', name: 'Export', roles: ['sysadmin', 'setupadmin', 'state', 'viewer'] },
  { id: 'setup', name: 'Indicators', roles: ['sysadmin', 'setupadmin'] },
  { id: 'units', name: 'Org units', roles: ['sysadmin', 'setupadmin', 'state'] },
  { id: 'accounts', name: 'Accounts', roles: ['sysadmin', 'state'] },
  { id: 'audit', name: 'Audit log', roles: ['sysadmin'] },
];

async function loadMe() {
  try { state.me = await get('/api/me'); } catch { state.me = null; }
  return state.me;
}
async function meta(force = false) { if (!state.meta || force) state.meta = await get('/api/metadata'); return state.meta; }
async function orgs() { if (!state.orgs) state.orgs = await get('/api/orgunits'); return state.orgs; }
const lgaCache = {};
async function lgasOf(stateId) { if (!lgaCache[stateId]) lgaCache[stateId] = (await get('/api/orgunits?parent=' + stateId)).children.filter((c) => !c.closed); return lgaCache[stateId]; }

function renderChrome(page) {
  const top = $('#top');
  if (!state.me) { top.hidden = true; return; }
  top.hidden = false;
  $('#nav').replaceChildren(...PAGES.filter((p) => p.roles.includes(role())).map((p) => h('a', { href: '#/' + p.id, class: p.id === page ? 'on' : '' }, p.name)));
  $('#who').replaceChildren(
    h('span', {}, state.me.user.name, ' · ', state.me.user.roleName, state.me.ou ? ' · ' + state.me.ou.name : ''),
    h('a', { href: '#/me' }, 'Password'),
    h('button', { class: 'link', onclick: async () => { await api('POST', '/api/auth/logout', {}); state.me = null; state.meta = null; state.orgs = null; go('#/login'); } }, 'Sign out'),
  );
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || '';
  if (page === 'set-password') return renderSetPassword(parts[1]);
  if (!state.me) await loadMe();
  if (!state.me) {
    const s = await get('/api/setup').catch(() => ({ needsSetup: false }));
    renderChrome();
    return s.needsSetup ? renderFirstSetup(s) : renderLogin();
  }
  const allowed = PAGES.filter((p) => p.roles.includes(role()));
  const target = page === 'me' ? 'me' : allowed.find((p) => p.id === page) ? page : allowed[0].id;
  if (target !== page) return go('#/' + target);
  renderChrome(target);
  mount(h('p', { class: 'muted' }, 'Loading…'));
  try {
    await ({ entry: renderEntry, review: renderReview, picture: renderPicture, export: renderExport, setup: renderSetup, units: renderUnits, accounts: renderAccounts, audit: renderAudit, me: renderMe })[target]();
  } catch (e) {
    if (e.status !== 401) mount(h('div', { class: 'note bad' }, e.message));
  }
}
window.addEventListener('hashchange', route);
route();

// ---------- sign in, first setup, password links ----------
function renderLogin() {
  const err = h('div', { class: 'err' });
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Sign in');
  const form = h('form', { class: 'panel card-narrow' },
    h('h1', {}, 'Sign in'), h('p', { class: 'muted small' }, 'LGA Sector Reporting System'),
    h('div', { class: 'grid2' }, field('Email', email)), field('Password', pw), h('p'), btn, err,
    h('p', { class: 'muted small' }, 'Forgot your password? Ask your administrator for a new sign-in link.'));
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    try { await api('POST', '/api/auth/login', { email: email.value, password: pw.value }); await loadMe(); go('#/'); } catch (e) { err.textContent = e.message; }
  }));
  mount(form); email.focus();
}

function renderFirstSetup(s) {
  const err = h('div', { class: 'err' });
  const key = h('input', { type: 'password', autocomplete: 'off' });
  const name = h('input', { autocomplete: 'name' });
  const email = h('input', { type: 'email', autocomplete: 'username' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Create administrator');
  const form = h('form', { class: 'panel card-narrow' },
    h('h1', {}, 'First-time setup'),
    h('p', { class: 'muted small' }, 'Creates the first system administrator and loads Nigeria’s 37 states and 774 LGAs with their DHIS2 IDs.'),
    s.setupKeyConfigured ? null : h('div', { class: 'note warn' }, 'Add a SETUP_KEY secret to the Worker in Cloudflare first.'),
    field('Setup key', key), field('Your name', name), field('Email', email), field('Password (10+ characters)', pw), h('p'), btn, err);
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    try { await api('POST', '/api/setup', { setupKey: key.value, name: name.value, email: email.value, password: pw.value }); await loadMe(); go('#/setup'); } catch (e) { err.textContent = e.message; }
  }));
  mount(form);
}

async function renderSetPassword(token) {
  renderChrome();
  let info;
  try { info = (await api('GET', '/api/password-links/' + token)).data; } catch (e) {
    return mount(h('div', { class: 'panel card-narrow' }, h('h1', {}, 'Link not valid'), h('p', {}, e.message), h('a', { href: '#/login' }, 'Go to sign in')));
  }
  const err = h('div', { class: 'err' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: 10 });
  const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Set password and sign in');
  const form = h('form', { class: 'panel card-narrow' },
    h('h1', {}, info.purpose === 'invite' ? `Welcome, ${info.name}` : 'Choose a new password'),
    h('p', { class: 'muted small' }, 'Account: ', info.email),
    field('New password (10+ characters)', pw), field('Type it again', pw2), h('p'), btn, err);
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    if (pw.value !== pw2.value) { err.textContent = 'The two passwords do not match.'; return; }
    try { await api('POST', '/api/password-links/' + token, { password: pw.value }); history.replaceState(null, '', '#/'); state.me = null; route(); } catch (e) { err.textContent = e.message; }
  }));
  mount(form);
}

function renderMe() {
  const err = h('div', { class: 'err' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'primary', type: 'submit' }, 'Change password');
  const form = h('form', { class: 'panel card-narrow' }, h('h1', {}, 'Change password'), field('Current password', cur), field('New password (10+ characters)', pw), h('p'), btn, err);
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    try { await api('POST', '/api/me/password', { current: cur.value, password: pw.value }); toast('Password changed'); cur.value = pw.value = ''; } catch (e) { err.textContent = e.message; }
  }));
  mount(form);
}

// ---------- shared pickers ----------
const dsLabel = (d) => (d.shared ? d.name + ' (shared)' : d.sector && !d.name.toLowerCase().startsWith(d.sector.toLowerCase()) ? `${d.sector} — ${d.name}` : d.name);
// Shown when there is nothing to report on yet: admins get a way forward, others are told who to ask.
function noDatasets() {
  if (is('sysadmin', 'setupadmin')) {
    return h('div', { class: 'panel empty' },
      h('h2', {}, 'No data sets yet'),
      h('p', {}, 'As an administrator, start by creating a data set (for example “LGA monthly report”) and adding its indicators.'),
      h('a', { class: 'btn', href: '#/setup' }, 'Go to Indicators'));
  }
  return h('div', { class: 'note info' }, 'No data sets are assigned to your account yet. Ask your administrator.');
}

function myDatasets() { return state.me.datasets; }

async function pickState(value, onChange) {
  const o = await orgs();
  const states = o.states;
  if (states.length === 1) return { el: null, value: states[0].id };
  const v = value && states.some((s) => s.id === value) ? value : states[0].id;
  const el = select(states, v, { onchange: (e) => onChange(e.target.value) });
  return { el: field('State', el), value: v };
}

// ---------- data entry ----------
async function renderEntry() {
  await meta();
  const sets = myDatasets();
  if (!sets.length) return mount(noDatasets());
  const ds = sets.find((d) => d.id === pref('ds')) || sets[0];
  let ouId; let pickers = [];
  if (role() === 'lga') ouId = state.me.ou.id;
  else {
    const stateId = role() === 'state' ? state.me.ou.id : pref('state');
    const sp = role() === 'state' ? { value: state.me.ou.id } : await pickState(stateId, (v) => { pref('state', v); pref('lga', null); renderEntry(); });
    const lgas = await lgasOf(sp.value);
    ouId = lgas.some((l) => l.id === pref('lga')) ? pref('lga') : lgas[0].id;
    pickers = [sp.el, field('LGA', select(lgas, ouId, { onchange: (e) => { pref('lga', e.target.value); renderEntry(); } }))];
  }
  const period = pref('pe:' + ds.id);
  let form;
  try { form = await get('/api/entry' + qs({ dataset: ds.id, ou: ouId, period })); } catch (e) {
    if (e.body && e.body.error && e.body.error.field === 'period') { pref('pe:' + ds.id, null); form = await get('/api/entry' + qs({ dataset: ds.id, ou: ouId })); } else throw e;
  }
  mount(entryView(form, sets, pickers));
}

function sectorGroups(form) {
  // Group fields under the sector(s) of the indicators that use them.
  const m = state.meta;
  const set = m && m.datasets.find((d) => d.id === form.dataset.id);
  const bySector = new Map();
  const placed = new Set();
  if (set) {
    for (const ind of set.indicators.filter((i) => !i.archived)) {
      const key = ind.sector || 'Other';
      if (!bySector.has(key)) bySector.set(key, []);
      for (const fid of [ind.numeratorId, ind.denominatorId]) {
        if (fid && !placed.has(fid)) { placed.add(fid); bySector.get(key).push(fid); }
      }
    }
  }
  const rest = form.fields.filter((f) => !placed.has(f.id)).map((f) => f.id);
  const restLabel = set && set.shared ? 'Population & denominators (for the year)' : 'Other';
  if (rest.length) bySector.set(restLabel, [...(bySector.get(restLabel) || []), ...rest]);
  return [...bySector.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function entryView(form, sets, pickers) {
  const r = form.report;
  const inputs = {};
  const err = h('div', { class: 'err' });
  const dsSel = select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), form.dataset.id, { onchange: (e) => { pref('ds', e.target.value); renderEntry(); } });
  const peSel = select(form.periods, form.period, { onchange: (e) => { pref('pe:' + form.dataset.id, e.target.value); renderEntry(); } });

  const fieldById = Object.fromEntries(form.fields.map((f) => [f.id, f]));
  const groups = state.meta ? sectorGroups(form) : [['', form.fields.map((f) => f.id)]];
  const rows = [];
  for (const [sector, ids] of groups) {
    if (groups.length > 1 || sector) rows.push(h('tr', { class: 'sector' }, h('td', { colspan: 2 }, sector)));
    for (const id of ids) {
      const f = fieldById[id]; if (!f) continue;
      const inp = h('input', { class: 'num', inputmode: f.valueType === 'INTEGER' ? 'numeric' : 'decimal', value: f.value === null ? '' : String(f.value), disabled: !f.editable, 'aria-label': f.name });
      inp.addEventListener('input', () => { inp.classList.remove('bad'); dirty = true; });
      inputs[f.id] = inp;
      rows.push(h('tr', {}, h('td', {}, f.name, f.editable || r.locked ? null : h('span', { class: 'muted small' }, ' (entered by another account)')), h('td', { class: 'n' }, inp)));
    }
  }
  let dirty = false;

  const collect = () => Object.fromEntries(Object.entries(inputs).filter(([id]) => fieldById[id].editable).map(([id, i]) => [id, i.value.trim() === '' ? null : i.value.trim()]));
  async function save(quiet) {
    err.textContent = '';
    try {
      const { data } = await api('PUT', '/api/entry', { dataset: form.dataset.id, ou: form.ou.id, period: form.period, values: collect() });
      dirty = false; if (!quiet) toast('Saved'); return data;
    } catch (e) {
      const errs = (e.body && e.body.error && e.body.error.errors) || {};
      for (const id of Object.keys(errs)) if (inputs[id]) inputs[id].classList.add('bad');
      err.textContent = e.message; throw e;
    }
  }
  const saveBtn = h('button', {}, 'Save draft');
  saveBtn.addEventListener('click', busy(saveBtn, async () => { const d = await save(); main().replaceChildren(entryView(d, sets, pickers)); }));
  const submitBtn = h('button', { class: 'primary' }, 'Submit to state');
  submitBtn.addEventListener('click', busy(submitBtn, async () => {
    if (form.can.edit && (dirty || r.status === 'none' || r.status === 'returned')) await save(true);
    try {
      const { data } = await api('POST', '/api/entry/submit', { dataset: form.dataset.id, ou: form.ou.id, period: form.period });
      toast('Submitted'); main().replaceChildren(entryView(data, sets, pickers));
    } catch (e) { err.textContent = e.message; }
  }));

  const reviewBox = form.can.review ? reviewControls(form, (d) => main().replaceChildren(entryView(d, sets, pickers))) : null;

  return h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, form.ou.name), h('div', { class: 'muted' }, `${form.dataset.name} · ${form.periodName} · ${form.dataset.frequencyName}`)), h('div', {}, pill(r.status, r.statusName), r.late ? h('span', { class: 'late' }, 'Late') : null)),
    h('div', { class: 'bar' }, field('Data set', dsSel), pickers, field('Period', peSel)),
    r.status === 'returned' ? h('div', { class: 'note bad' }, h('strong', {}, 'Sent back for correction: '), r.comment || '', r.reviewedBy ? ` — ${r.reviewedBy}` : '') : null,
    r.status === 'submitted' ? h('div', { class: 'note warn' }, `Submitted ${fmtDate(r.submittedAt)}${r.submittedBy ? ' by ' + r.submittedBy : ''}. Waiting for the state to review.`) : null,
    r.status === 'accepted' ? h('div', { class: 'note ok' }, `Accepted ${fmtDate(r.reviewedAt)}${r.reviewedBy ? ' by ' + r.reviewedBy : ''}.`) : null,
    form.overdue && form.can.edit ? h('div', { class: 'note warn' }, `This report was due on ${fmtDay(form.due)}.`) : null,
    h('div', { class: 'panel' },
      form.fields.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Value'), h('th', { class: 'n' }, 'Number'))), h('tbody', {}, rows))
        : h('div', { class: 'empty' }, 'This data set has no indicators yet.'),
      err,
      form.can.edit ? h('div', { class: 'actions' }, h('p'), saveBtn, submitBtn, h('span', { class: 'muted small' }, 'Every value is needed to submit — enter 0 if there were none.')) : null),
    form.sharedValues && form.sharedValues.length ? h('div', { class: 'panel' }, h('h2', {}, 'Population figures used'),
      h('p', { class: 'muted small' }, 'From the yearly “Population & denominators” data set for this LGA.'),
      h('table', {}, h('tbody', {}, form.sharedValues.map((x) => h('tr', {}, h('td', {}, x.name),
        h('td', { class: 'n' }, x.yearValue === null ? h('span', { class: 'late' }, `Missing for ${x.year}`) : x.prorate && form.dataset.frequency !== 'YEARLY' ? `${fmtNum(x.yearValue)} for ${x.year} → ${fmtNum(x.value, 1)} for this period` : fmtNum(x.yearValue))))))) : null,
    form.indicators.length ? h('div', { class: 'panel' }, h('h2', {}, 'Indicators for this LGA'),
      h('table', {}, h('tbody', {}, form.indicators.map((i) => h('tr', {}, h('td', {}, i.name, h('span', { class: 'muted small' }, i.sector ? ` · ${i.sector}` : '')), h('td', { class: 'n' }, fmtNum(i.value, 2))))))) : null,
    reviewBox,
    r.updatedAt ? h('p', { class: 'muted small' }, `Last saved ${fmtDate(r.updatedAt)}${r.updatedBy ? ' by ' + r.updatedBy : ''}.`) : null,
  );
}

function reviewControls(form, after) {
  const comment = h('textarea', { placeholder: 'What needs to be corrected? (needed to send back)' });
  const accept = h('button', { class: 'primary' }, 'Accept');
  const back = h('button', { class: 'danger' }, 'Send back for correction');
  const act = (action, btn) => busy(btn, async () => {
    const { data } = await api('POST', '/api/entry/review', { dataset: form.dataset.id, ou: form.ou.id, period: form.period, action, comment: comment.value.trim() || undefined });
    toast(action === 'accept' ? 'Accepted' : 'Sent back'); after(data);
  });
  accept.addEventListener('click', act('accept', accept));
  back.addEventListener('click', act('return', back));
  return h('div', { class: 'panel' }, h('h2', {}, 'Review'), comment, h('p'), h('div', { class: 'actions' }, form.report.status === 'submitted' ? accept : null, back));
}

// ---------- review (status of every LGA) ----------
async function renderReview() {
  const sets = myDatasets();
  if (!sets.length) return mount(noDatasets());
  const ds = sets.find((d) => d.id === pref('ds')) || sets[0];
  const sp = role() === 'state' ? { value: state.me.ou.id } : await pickState(pref('state'), (v) => { pref('state', v); renderReview(); });
  const period = pref('pe:' + ds.id);
  const st = await get('/api/status' + qs({ dataset: ds.id, state: sp.value, period })).catch(async (e) => {
    if (e.body && e.body.error && e.body.error.field === 'period') { pref('pe:' + ds.id, null); return get('/api/status' + qs({ dataset: ds.id, state: sp.value })); } throw e;
  });
  await meta();
  const names = { none: 'Not started', draft: 'Draft', submitted: 'Submitted', accepted: 'Accepted', returned: 'Sent back' };
  const open = (l) => { pref('ds', ds.id); pref('state', sp.value); pref('lga', l.id); pref('pe:' + ds.id, st.period); go('#/entry'); };
  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, `${st.state.name} — review`), h('div', { class: 'muted' }, `${st.dataset.name} · ${st.periodName} · due ${fmtDay(st.due)}`))),
    h('div', { class: 'bar' },
      field('Data set', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderReview(); } })),
      sp.el,
      field('Period', select(st.periods, st.period, { onchange: (e) => { pref('pe:' + ds.id, e.target.value); renderReview(); } }))),
    h('div', { class: 'counts' }, Object.entries(st.counts).map(([k, n]) => h('span', { class: 'pill s-' + k }, `${names[k]}: ${n}`)), h('span', { class: 'pill s-none' }, `Total LGAs: ${st.total}`)),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'LGA'), h('th', {}, 'Status'), h('th', {}, 'Submitted'), h('th', {}, 'Reviewed'), h('th', {}, 'Comment'))),
      h('tbody', {}, st.lgas.map((l) => h('tr', { class: 'click', onclick: () => open(l) },
        h('td', {}, l.name), h('td', {}, pill(l.status, l.statusName), l.late ? h('span', { class: 'late' }, 'Late') : null),
        h('td', {}, fmtDate(l.submittedAt)), h('td', {}, fmtDate(l.reviewedAt)), h('td', { class: 'small muted' }, l.comment || '')))))),
    h('p', { class: 'muted small' }, 'Click an LGA to open its report, then accept it or send it back.'),
  ));
}

// ---------- state picture ----------
function periodChoices(freq) {
  const now = new Date(Date.now() + 3600000);
  const y = now.getUTCFullYear(); const m = now.getUTCMonth() + 1;
  const out = [];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (freq === 'MONTHLY') for (let i = 1; i <= 18; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push({ id: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`, name: `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}` }); }
  if (freq !== 'YEARLY') { let q = Math.ceil(m / 3); let qy = y; for (let i = 0; i < 8; i++) { out.push({ id: `${qy}Q${q}`, name: `Q${q} ${qy}${i === 0 ? ' (so far)' : ''}` }); q--; if (!q) { q = 4; qy--; } } }
  for (let i = 0; i < 4; i++) out.push({ id: String(y - i), name: `${y - i}${i === 0 ? ' (so far)' : ''}` });
  return out;
}

async function renderPicture() {
  const m = await meta();
  const sets = myDatasets();
  if (!sets.length) return mount(noDatasets());
  const ds = sets.find((d) => d.id === pref('ds')) || sets[0];
  const choices = periodChoices(ds.frequency);
  const period = choices.some((c) => c.id === pref('ppe:' + ds.id)) ? pref('ppe:' + ds.id) : choices[0].id;
  const provisional = !!pref('prov');
  const sector = pref('sector') || '';
  let ouOptions = [];
  let ou = state.me.ou.id;
  if (state.me.ou.level === 1) {
    const o = await orgs();
    ouOptions = [{ id: o.country.id, name: `${o.country.name} (all states)` }, ...o.states];
    ou = ouOptions.some((x) => x.id === pref('pou')) ? pref('pou') : ouOptions[0].id;
  }
  const p = await get('/api/picture' + qs({ dataset: ds.id, ou, period, provisional: provisional ? 1 : '', sector }));
  const sectors = m.sectors.filter((s) => s.indicators);
  const unitLabel = p.ou.level === 1 ? 'State' : 'LGA';
  const percentCell = (c) => (c ? fmtNum(c.value, 2) : '—');
  const row = (r, cls) => h('tr', { class: cls },
    h('td', {}, r.name),
    h('td', { class: 'n' }, p.ou.level === 1 || cls ? `${r.reportingUnits} of ${r.totalUnits}` : r.reported ? 'Yes' : 'No'),
    h('td', { class: 'n' }, r.reportingRate === null ? '—' : fmtNum(r.reportingRate, 1) + '%'),
    p.indicators.map((i) => h('td', { class: 'n', title: r.indicators[i.id] ? `${fmtNum(r.indicators[i.id].numerator, 2)} / ${fmtNum(r.indicators[i.id].denominator, 2)}` : '' }, percentCell(r.indicators[i.id]))));
  const fieldRow = (r, cls) => h('tr', { class: cls }, h('td', {}, r.name), p.fields.map((f) => h('td', { class: 'n' }, fmtNum(r.values[f.id], 2))));

  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, `${p.ou.name} — ${p.periodName}`), h('div', { class: 'muted' }, `${p.dataset.name} · ${p.total.reportingUnits} of ${p.total.totalUnits} LGAs reporting · ${provisional ? 'includes reports not yet accepted' : 'accepted reports only'}`)),
      h('div', { class: 'actions' }, h('button', { onclick: () => window.print() }, 'Print'))),
    h('div', { class: 'bar' },
      field('Data set', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderPicture(); } })),
      ouOptions.length ? field('Area', select(ouOptions, ou, { onchange: (e) => { pref('pou', e.target.value); renderPicture(); } })) : null,
      field('Period', select(choices, period, { onchange: (e) => { pref('ppe:' + ds.id, e.target.value); renderPicture(); } })),
      field('Sector', select([{ id: '', name: 'All sectors' }, ...sectors], sector, { onchange: (e) => { pref('sector', e.target.value); renderPicture(); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: provisional, onchange: (e) => { pref('prov', e.target.checked); renderPicture(); } }), 'Include submitted (not yet accepted)')),
    p.indicators.length ? null : h('div', { class: 'note info' }, 'No indicators for this selection.'),
    h('h2', {}, 'Indicators'),
    h('p', { class: 'muted small' }, 'Totals add up the numerators and denominators of the LGAs that reported, then recompute each rate. Hover a value to see its numerator / denominator.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, unitLabel), h('th', { class: 'n' }, p.ou.level === 1 ? 'LGAs reporting' : 'Reported'), h('th', { class: 'n' }, 'Reporting rate'),
        p.indicators.map((i) => h('th', { class: 'n', title: [i.numerator, i.denominator].filter(Boolean).join(' ÷ ') + (i.source ? ` — Source: ${i.source}` : '') }, i.name, i.percent ? ' (%)' : '', h('div', { class: 'cov' }, i.sector))))),
      h('tbody', {}, row(p.total, 'total'), p.rows.map((r) => row(r))))),
    h('h2', {}, 'Reported numbers'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, unitLabel), p.fields.map((f) => h('th', { class: 'n' }, f.name)))),
      h('tbody', {}, fieldRow(p.total, 'total'), p.rows.map((r) => fieldRow(r))))),
  ));
}

// ---------- export ----------
async function renderExport() {
  const m = await meta();
  const sets = myDatasets();
  if (!sets.length) return mount(noDatasets());
  const o = await orgs();
  const areas = state.me.ou.level === 1 ? [{ id: o.country.id, name: `${o.country.name} (all states)` }, ...o.states] : [{ id: state.me.ou.id, name: state.me.ou.name }];
  const dsChecks = sets.map((d) => h('input', { type: 'checkbox', value: d.id, checked: true }));
  const sectorSel = select([{ id: '', name: 'All sectors' }, ...m.sectors], '');
  const areaSel = select(areas, areas[0].id);
  const now = new Date(Date.now() + 3600000);
  const ym = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const typeSel = select([{ id: 'MONTH', name: 'Months' }, { id: 'QUARTER', name: 'Quarters' }, { id: 'YEAR', name: 'Years' }], 'MONTH');
  const from = h('input', { value: ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))), size: 8 });
  const to = h('input', { value: ym(last), size: 8 });
  typeSel.addEventListener('change', () => {
    const y = now.getUTCFullYear(); const q = Math.ceil((now.getUTCMonth() + 1) / 3);
    if (typeSel.value === 'MONTH') { from.value = ym(new Date(Date.UTC(y, now.getUTCMonth() - 3, 1))); to.value = ym(last); }
    if (typeSel.value === 'QUARTER') { from.value = `${y - 1}Q${q}`; to.value = q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`; }
    if (typeSel.value === 'YEAR') { from.value = String(y - 2); to.value = String(y - 1); }
  });
  const lv = [1, 2, 3].map((n) => h('input', { type: 'checkbox', value: n, checked: true }));
  const prov = h('input', { type: 'checkbox' });
  const params = () => ({
    datasets: dsChecks.filter((c) => c.checked).map((c) => c.value).join(','), sector: sectorSel.value, ou: areaSel.value,
  });
  const withUnits = h('input', { type: 'checkbox' });
  const metaBtn = h('button', { class: 'primary' }, 'Download metadata');
  metaBtn.addEventListener('click', busy(metaBtn, async () => toast('Downloaded ' + await download('/api/export/metadata' + qs({ ...params(), units: withUnits.checked ? (sectorSel.value || 'all') : '' })))));
  const dataBtn = h('button', { class: 'primary' }, 'Download data values');
  dataBtn.addEventListener('click', busy(dataBtn, async () => toast('Downloaded ' + await download('/api/export/data' + qs({
    ...params(), from: from.value.trim(), to: to.value.trim(), levels: lv.filter((c) => c.checked).map((c) => c.value).join(','), provisional: prov.checked ? 1 : '',
  })))));

  const tokens = is('sysadmin') ? await tokenPanel(areas) : null;
  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Export'), h('div', { class: 'muted' }, 'JSON files in the same format as the ALMA Export app, ready to upload to the scorecard platform.'))),
    h('div', { class: 'panel' },
      h('h3', {}, 'What'),
      h('div', { class: 'chips' }, sets.map((d, i) => h('label', { class: 'check' }, dsChecks[i], dsLabel(d)))),
      h('div', { class: 'bar' }, field('Sector', sectorSel), field('Area', areaSel)),
      h('h3', {}, '1 · Metadata'),
      h('p', { class: 'muted small' }, 'organisationUnits_indicators.json — org units with their DHIS2 IDs, and the indicators (with a reporting-rate indicator per data set).'),
      h('label', { class: 'check' }, withUnits, 'Also include org units below LGAs (schools, health facilities…) for the chosen sector'), h('p'),
      metaBtn,
      h('h3', {}, '2 · Data values'),
      h('div', { class: 'bar' }, field('Period type', typeSel), field('From', from), field('To', to),
        h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Levels:'), ['Country', 'State', 'LGA'].map((n, i) => h('label', { class: 'check' }, lv[i], n)))),
      h('label', { class: 'check' }, prov, 'Include submitted reports that are not yet accepted'),
      h('p', { class: 'muted small' }, 'dataValues_<period>.json — one row per indicator, period and org unit. Periods use DHIS2 codes: 202601, 2026Q1, 2026.'),
      dataBtn),
    tokens,
  ));
}

async function tokenPanel(areas) {
  const list = (await get('/api/tokens')).tokens;
  const name = h('input', { placeholder: 'e.g. Scorecard upload' });
  const area = select(areas, areas[0].id);
  const out = h('div');
  const add = h('button', {}, 'Create token');
  add.addEventListener('click', busy(add, async () => {
    const { data } = await api('POST', '/api/tokens', { name: name.value, ouId: area.value });
    out.replaceChildren(h('div', { class: 'note warn' }, 'Copy this token now — it will not be shown again.', h('div', { class: 'linkbox' }, h('input', { value: data.token, readonly: true }), h('button', { onclick: () => copy(data.token) }, 'Copy'))));
  }));
  return h('div', { class: 'panel' }, h('h2', {}, 'API tokens'),
    h('p', { class: 'muted small' }, 'For automated downloads: send “Authorization: Bearer <token>” to /api/export/metadata or /api/export/data. Tokens can only read exports for their area.'),
    h('div', { class: 'bar' }, field('Name', name), field('Area', area), add), out,
    list.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Area'), h('th', {}, 'Created'), h('th', {}, 'Last used'), h('th'))),
      h('tbody', {}, list.map((t) => h('tr', {}, h('td', {}, t.name), h('td', {}, t.ou_name), h('td', {}, fmtDay(t.created_at)), h('td', {}, fmtDate(t.last_used_at)),
        h('td', {}, t.revoked_at ? h('span', { class: 'muted' }, 'Revoked') : h('button', { class: 'link', onclick: async () => { await api('DELETE', '/api/tokens/' + t.id); toast('Revoked'); renderExport(); } }, 'Revoke')))))) : null);
}

// ---------- indicator setup ----------
async function renderSetup() {
  const m = await meta(true);
  const dsId = m.datasets.some((d) => d.id === pref('setupDs')) ? pref('setupDs') : (m.datasets[0] || {}).id;
  const ds = m.datasets.find((d) => d.id === dsId);
  const sectorList = h('datalist', { id: 'sector-list' }, m.sectors.map((s) => h('option', { value: s.name })));
  const sharedSets = m.datasets.filter((d) => d.shared && !d.archived);
  const sharedFields = sharedSets.flatMap((d) => d.dataElements.filter((f) => !f.archived));
  const fieldList = h('datalist', { id: 'field-list' },
    ds ? ds.dataElements.filter((d) => !d.archived).map((d) => h('option', { value: d.name })) : [],
    ds && !ds.shared ? sharedFields.map((f) => h('option', { value: f.name, label: 'Population & denominators (shared)' })) : []);

  const newDs = h('button', { onclick: () => datasetDialog(null, m) }, '+ New sector data set');
  const newShared = sharedSets.length ? null : h('button', { onclick: () => datasetDialog(null, m, true) }, '+ Population & denominators');
  const head = h('div', { class: 'head' },
    h('div', {}, h('h1', {}, 'Indicators'), h('div', { class: 'muted' }, 'One data set per sector. Write each indicator with its numerator, denominator and source; IDs are created automatically.')),
    is('sysadmin') ? h('div', { class: 'actions' }, newShared, newDs) : null);
  if (!ds) {
    return mount(head, h('div', { class: 'panel' },
      h('h2', {}, 'Getting started'),
      h('ol', {},
        h('li', {}, h('strong', {}, 'Population & denominators'), ' — one yearly data set for numbers every sector divides by (total population, under-5s, expected pregnancies, households…). Entered once a year.'),
        h('li', {}, h('strong', {}, 'One data set per sector'), ' — e.g. “Health – monthly”, “Agriculture – quarterly”, “WASH – yearly”, each with its own frequency.'),
        h('li', {}, 'Add indicators to each sector data set. Type a population number’s name as the denominator and it is used automatically.')),
      is('sysadmin') ? h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => datasetDialog(null, m, true) }, 'Create Population & denominators'),
        h('button', { onclick: () => datasetDialog(null, m) }, '+ New sector data set')) : null));
  }

  const tabs = h('div', { class: 'bar' },
    field('Data set', select(m.datasets.map((d) => ({ id: d.id, name: dsLabel(d) + (d.archived ? ' (archived)' : '') })), ds.id, { onchange: (e) => { pref('setupDs', e.target.value); renderSetup(); } })),
    h('div', { class: 'muted small' }, ds.shared ? 'Shared by all sectors · ' : `Sector: `, ds.shared ? null : h('strong', {}, ds.sector || '—'), ds.shared ? null : ' · ',
      `Reporting frequency: `, h('strong', {}, ds.frequencyName), ds.shared ? ' · current year can be entered' : ` · due on day ${ds.dueDay} of the following month`, ' · ',
      h('button', { class: 'link', onclick: () => datasetDialog(ds, m) }, 'Edit data set')));
  if (ds.shared) return mount(h('div', {}, head, tabs, sharedPanel(ds)));

  const rows = ds.indicators.filter((i) => !i.archived);
  const bySector = new Map();
  for (const i of rows) { const k = i.sector || 'Other'; if (!bySector.has(k)) bySector.set(k, []); bySector.get(k).push(i); }
  const body = [];
  for (const [sector, list] of [...bySector.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    body.push(h('tr', { class: 'sector' }, h('td', { colspan: 7 }, sector)));
    for (const i of list) body.push(indicatorRow(ds, i, m));
  }
  body.push(indicatorRow(ds, null, m));

  mount(h('div', {}, head, tabs, sectorList, fieldList,
    h('div', { class: 'scroll' }, h('table', { class: 'setup' },
      h('colgroup', {}, ['sector', 'name', 'num', 'den', 'src', 'show', 'id'].map((c) => h('col', { class: 'c-' + c }))),
      h('thead', {}, h('tr', {}, h('th', {}, 'Sector'), h('th', {}, 'Indicator'), h('th', {}, 'Numerator'), h('th', {}, 'Denominator (optional)'), h('th', {}, 'Source'), h('th', {}, 'Show as'), h('th', {}, 'ID'))),
      h('tbody', {}, body))),
    h('p', { class: 'muted small' }, 'Numerators and denominators become the numbers LGAs enter. Typing the same name twice uses the same number. A name from Population & denominators (e.g. “Expected pregnancies”) uses that yearly figure instead of asking LGAs for it each time. Leave the denominator empty for a plain count.'),
    fieldsPanel(ds)));
}

function indicatorRow(ds, i, m) {
  const isNew = !i;
  const sector = h('input', { list: 'sector-list', value: i ? i.sector : ds.sector || pref('lastSector') || '', placeholder: 'e.g. Health' });
  const name = h('input', { value: i ? i.name : '', placeholder: isNew ? 'New indicator name' : '' });
  const num = h('input', { list: 'field-list', value: i ? i.numerator : '', placeholder: 'e.g. Women with 4+ ANC visits' });
  const den = h('input', { list: 'field-list', value: i ? i.denominator : '', placeholder: 'e.g. Expected pregnancies' });
  const source = h('input', { value: i ? i.source : '', placeholder: 'e.g. HMIS register' });
  const showAs = select(m.showAs, i ? i.showAs : 'percent');
  const id = h('input', { class: 'mono', placeholder: 'auto-generated', maxlength: 11, title: 'Leave empty to generate a DHIS2-style ID, or paste an existing DHIS2 indicator ID' });
  const btn = h('button', { class: isNew ? 'primary' : '' }, isNew ? 'Add' : 'Save');
  const del = isNew ? null : h('button', { class: 'link', title: 'Remove indicator' }, 'Remove');
  const vals = () => ({ sector: sector.value.trim(), name: name.value.trim(), numerator: num.value.trim(), denominator: den.value.trim(), source: source.value.trim(), showAs: den.value.trim() ? showAs.value : 'number' });
  btn.addEventListener('click', busy(btn, async () => {
    if (isNew) {
      const body = vals(); if (id.value.trim()) body.id = id.value.trim();
      await api('POST', `/api/datasets/${ds.id}/indicators`, body);
      pref('lastSector', body.sector); toast('Indicator added');
    } else { await api('PATCH', '/api/indicators/' + i.id, vals()); toast('Saved'); }
    state.meta = null; renderSetup();
  }));
  if (del) del.addEventListener('click', busy(del, async () => {
    if (!confirm(`Remove “${i.name}”? Values already reported are kept.`)) return;
    await api('DELETE', '/api/indicators/' + i.id); toast('Removed'); state.meta = null; renderSetup();
  }));
  return h('tr', {}, h('td', {}, sector), h('td', {}, name), h('td', {}, num), h('td', {}, den), h('td', {}, source), h('td', {}, showAs),
    h('td', {}, isNew ? id : idTag(i.id), h('div', { class: 'actions' }, btn, del)));
}

function fieldsPanel(ds) {
  const list = ds.dataElements.filter((d) => !d.archived);
  if (!list.length) return null;
  return h('details', { class: 'panel' }, h('summary', {}, `Numbers LGAs enter (${list.length})`),
    h('p', { class: 'muted small' }, 'Rename a number here to fix a typo everywhere; reported values are kept.'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Whole numbers'), h('th', {}, 'Max'), h('th', {}, 'ID'), h('th'))),
      h('tbody', {}, list.map((d) => {
        const name = h('input', { value: d.name, size: 40 });
        const whole = h('input', { type: 'checkbox', checked: d.valueType === 'INTEGER' });
        const max = h('input', { type: 'number', value: d.max ?? '', placeholder: 'none', size: 8 });
        const b = h('button', {}, 'Save');
        b.addEventListener('click', busy(b, async () => {
          await api('PATCH', '/api/fields/' + d.id, { name: name.value.trim(), valueType: whole.checked ? 'INTEGER' : 'NUMBER', max: max.value === '' ? null : Number(max.value) });
          toast('Saved'); state.meta = null; renderSetup();
        }));
        return h('tr', {}, h('td', {}, name), h('td', {}, whole), h('td', {}, max), h('td', {}, idTag(d.id)), h('td', {}, b));
      }))));
}

function sharedPanel(ds) {
  const list = ds.dataElements.filter((d) => !d.archived);
  const name = h('input', { placeholder: 'e.g. Expected pregnancies' });
  const split = h('input', { type: 'checkbox', checked: true });
  const add = h('button', { class: 'primary' }, 'Add number');
  add.addEventListener('click', busy(add, async () => {
    await api('POST', `/api/datasets/${ds.id}/fields`, { name: name.value.trim(), prorate: split.checked });
    toast('Added'); state.meta = null; renderSetup();
  }));
  return h('div', {},
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Number (entered once a year per LGA)'), h('th', {}, 'For monthly or quarterly indicators'), h('th', {}, 'ID'), h('th'))),
      h('tbody', {}, list.map((d) => {
        const n = h('input', { value: d.name, size: 36 });
        const sel = select([{ id: '1', name: 'Split by months (÷12 per month)' }, { id: '0', name: 'Use the yearly figure as is' }], d.prorate ? '1' : '0');
        const b = h('button', {}, 'Save');
        b.addEventListener('click', busy(b, async () => { await api('PATCH', '/api/fields/' + d.id, { name: n.value.trim(), prorate: sel.value === '1' }); toast('Saved'); state.meta = null; renderSetup(); }));
        return h('tr', {}, h('td', {}, n), h('td', {}, sel), h('td', {}, idTag(d.id)), h('td', {}, b));
      }), h('tr', {}, h('td', {}, name), h('td', {}, h('label', { class: 'check' }, split, 'Split by months')), h('td'), h('td', {}, add))))),
    h('p', { class: 'muted small' }, '“Split by months” suits yearly flows such as expected pregnancies or births: a monthly indicator divides by one twelfth. “As is” suits counts such as households, schools or total population. Each LGA (or the state on its behalf) enters these once a year under Data entry.'));
}

function datasetDialog(ds, m, makeShared = false) {
  const shared = ds ? ds.shared : makeShared;
  const name = h('input', { value: ds ? ds.name : shared ? 'Population and denominators' : '' });
  const sector = h('input', { list: 'sector-list-dlg', value: ds ? ds.sector : '', placeholder: 'e.g. Health' });
  const freq = select(m.frequencies, ds ? ds.frequency : 'MONTHLY');
  const due = h('input', { type: 'number', min: 1, max: 28, value: ds ? ds.dueDay : 15 });
  const id = h('input', { class: 'mono', placeholder: 'auto', maxlength: 11 });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, ds ? 'Save' : 'Create');
  const dlg = h('dialog', {}, h('h2', {}, ds ? 'Edit data set' : shared ? 'Population & denominators' : 'New sector data set'),
    h('datalist', { id: 'sector-list-dlg' }, m.sectors.map((x) => h('option', { value: x.name }))),
    shared ? h('p', { class: 'muted small' }, 'A yearly data set for numbers that every sector’s indicators divide by. It has no indicators of its own.') : null,
    h('div', { class: 'grid2' }, field('Name', name), shared ? null : field('Sector', sector), shared ? null : field('Reporting frequency', freq),
      shared ? null : field('Due day (of the following month)', due), ds ? field('ID', idTag(ds.id)) : field('ID (optional)', id)),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel'),
      ds && is('sysadmin') ? h('button', { class: 'danger', onclick: async () => { await api('PATCH', '/api/datasets/' + ds.id, { archived: !ds.archived }); dlg.close(); state.meta = null; renderSetup(); } }, ds.archived ? 'Restore' : 'Archive') : null));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const body = shared ? { name: name.value.trim() } : { name: name.value.trim(), sector: sector.value.trim(), frequency: freq.value, dueDay: Number(due.value) };
    if (shared && !ds) body.shared = true;
    try {
      if (ds) await api('PATCH', '/api/datasets/' + ds.id, body);
      else { if (id.value.trim()) body.id = id.value.trim(); const { data } = await api('POST', '/api/datasets', body); pref('setupDs', data.id); }
    } catch (e) { err.textContent = e.message; return; }
    dlg.close(); state.meta = null; await loadMe(); renderSetup();
  }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- sector org units (schools, facilities ...) ----------
const UNIT_HEADERS = ['State', 'LGA', 'LGA ID', 'Name', 'Type', 'Ward (optional)', 'Code', 'DHIS2 ID (optional)'];

async function renderUnits() {
  const sectorPref = pref('unitSector');
  const first = await get('/api/units' + qs({ sector: sectorPref, state: state.me.ou.level === 1 ? pref('unitState') : undefined }));
  if (!first.sectors.length) return mount(h('div', { class: 'panel empty' }, 'Create a sector data set on the Indicators page first; org units are added per sector.'));
  const o = await orgs();
  const sector = first.sector;
  const sectorName = (first.sectors.find((x) => x.id === sector) || {}).name;
  const states = state.me.ou.level === 1 ? o.states : null;
  const stateId = states ? (states.some((x) => x.id === pref('unitState')) ? pref('unitState') : '') : state.me.ou.level === 2 ? state.me.ou.id : null;
  const lgaFilter = pref('unitLga') || '';
  const units = first.units.filter((u) => !lgaFilter || u.lgaId === lgaFilter);

  // add one
  const addState = states ? select(states, stateId || states[0].id) : null;
  const addLga = h('select');
  const fillLgas = async () => {
    const sid = addState ? addState.value : state.me.ou.level === 2 ? state.me.ou.id : null;
    const l = sid ? await lgasOf(sid) : [state.me.ou];
    addLga.replaceChildren(...l.map((x) => h('option', { value: x.id, selected: x.id === lgaFilter }, x.name)));
  };
  if (addState) addState.addEventListener('change', fillLgas);
  await fillLgas();
  const typeList = h('datalist', { id: 'unit-types' }, first.types.map((t) => h('option', { value: t })));
  const nName = h('input', { placeholder: sectorName === 'Education' ? 'e.g. Central Primary School' : 'Name' });
  const nType = h('input', { list: 'unit-types', placeholder: sectorName === 'Education' ? 'e.g. Primary school' : 'e.g. Health facility', size: 16 });
  const nCode = h('input', { placeholder: 'optional', size: 10 });
  const nId = h('input', { class: 'mono', placeholder: 'auto-generated', maxlength: 11, size: 13 });
  const addBtn = h('button', { class: 'primary' }, 'Add');
  addBtn.addEventListener('click', busy(addBtn, async () => {
    const body = { sectorId: sector, lgaId: addLga.value, name: nName.value.trim(), type: nType.value.trim(), code: nCode.value.trim() };
    if (nId.value.trim()) body.id = nId.value.trim();
    await api('POST', '/api/units', body); toast('Added'); pref('unitLga', addLga.value); renderUnits();
  }));

  // excel
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (f) try { await importDialog(f, sector, sectorName); } catch (e) { toast(e.message, true); }
  });
  const tplBtn = h('button', {}, 'Download Excel template');
  tplBtn.addEventListener('click', busy(tplBtn, async () => {
    const { lgas } = await get('/api/orgunits?lgas=all');
    const { writeWorkbook } = await import('./xlsx.js');
    const blob = writeWorkbook([
      { name: `${sectorName} units`, rows: [UNIT_HEADERS], widths: [18, 24, 14, 36, 20, 20, 12, 20] },
      { name: 'LGAs', rows: [['State', 'LGA', 'LGA ID'], ...lgas.map((l) => [l.state, l.name, l.id])], widths: [22, 30, 14] },
      { name: 'How to fill', rows: [['How to fill the template'], ...[
        `One row per ${sectorName.toLowerCase()} unit (e.g. ${sectorName === 'Education' ? 'a school' : 'a facility or site'}).`,
        'State and LGA: copy the names from the “LGAs” sheet, or put the LGA ID instead (safest).',
        'Name is required. Type and Code are optional (Type e.g. “Primary school”).',
        'DHIS2 ID: only if the unit already exists in DHIS2 — paste its 11-character ID to keep it. Leave empty to create a new ID.',
        'Rows that match an existing unit (same name in the same LGA) update it instead of creating a duplicate.',
        'Save as .xlsx (or .csv) and use “Import Excel” on the Org units page. You will see a check before anything is saved.',
      ].map((t) => [t])], widths: [110] },
    ]);
    saveBlob(blob, `${sectorName.replace(/[^A-Za-z0-9]+/g, '_')}_org_units_template.xlsx`);
  }));
  const listBtn = h('button', {}, 'Download list');
  listBtn.addEventListener('click', busy(listBtn, async () => {
    const { writeWorkbook } = await import('./xlsx.js');
    saveBlob(writeWorkbook([{ name: `${sectorName} units`, rows: [UNIT_HEADERS, ...units.map((u) => [u.stateName, u.lgaName, u.lgaId, u.name, u.type, u.ward, u.code, u.id])], widths: [18, 24, 14, 36, 20, 20, 12, 20] }]),
      `${sectorName.replace(/[^A-Za-z0-9]+/g, '_')}_org_units.xlsx`);
  }));

  const lgaOpts = [...new Map(first.units.map((u) => [u.lgaId, u.lgaName])).entries()].map(([id, name]) => ({ id, name }));
  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Org units'), h('div', { class: 'muted' }, 'Units below each LGA that a sector reports on — schools, health facilities, water points… Each gets a DHIS2-style ID.')),
      h('div', { class: 'actions' }, tplBtn, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Import Excel'), fileIn,
        h('button', { onclick: () => scorecardDialog(sector, sectorName, states, stateId) }, 'Load health facilities'))),
    h('div', { class: 'bar' },
      field('Sector', select(first.sectors, sector, { onchange: (e) => { pref('unitSector', e.target.value); renderUnits(); } })),
      states ? field('State', select([{ id: '', name: 'All states' }, ...states], stateId, { onchange: (e) => { pref('unitState', e.target.value); pref('unitLga', ''); renderUnits(); } })) : null,
      field('LGA', select([{ id: '', name: 'All LGAs' }, ...lgaOpts], lgaFilter, { onchange: (e) => { pref('unitLga', e.target.value); renderUnits(); } })),
      h('div', { class: 'muted small' }, `${units.length} unit${units.length === 1 ? '' : 's'}`), listBtn),
    h('div', { class: 'panel' }, h('h2', {}, 'Add one'), typeList,
      h('div', { class: 'bar' }, addState ? field('State', addState) : null, field('LGA', addLga), field('Name', nName), field('Type', nType), field('Code', nCode), field('DHIS2 ID', nId), addBtn)),
    units.length > 2000 ? h('p', { class: 'muted small' }, `Showing the first 2,000 of ${units.length}. Choose an LGA, or use “Download list” for all.`) : null,
    units.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'State'), h('th', {}, 'LGA'), h('th', {}, 'Ward'), h('th', {}, 'Name'), h('th', {}, 'Type'), h('th', {}, 'Code'), h('th', {}, 'ID'), h('th', {}, 'Status'))),
      h('tbody', {}, units.slice(0, 2000).map((u) => h('tr', { class: 'click', onclick: () => unitDialog(u) },
        h('td', {}, u.stateName), h('td', {}, u.lgaName), h('td', { class: 'small' }, u.ward), h('td', {}, u.name), h('td', {}, u.type), h('td', {}, u.code),
        h('td', {}, h('span', { class: 'id' }, u.id)), h('td', {}, u.closed ? pill('none', 'Closed') : pill('accepted', 'Open')))))))
      : h('div', { class: 'panel empty' }, `No ${sectorName} units yet. Add one above, or download the Excel template, fill it in and import it.`),
  ));
}

function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function unitDialog(u) {
  const name = h('input', { value: u.name }); const type = h('input', { value: u.type, list: 'unit-types' }); const code = h('input', { value: u.code });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Save');
  const close = h('button', { class: 'danger' }, u.closed ? 'Reopen' : 'Close unit');
  const dlg = h('dialog', {}, h('h2', {}, u.name), h('p', { class: 'muted small' }, `${u.lgaName}, ${u.stateName} · ID `, idTag(u.id)),
    h('div', { class: 'grid2' }, field('Name', name), field('Type', type), field('Code', code)), err, h('p'),
    h('div', { class: 'actions' }, save, close, h('button', { onclick: () => dlg.close() }, 'Cancel')),
    h('p', { class: 'muted small' }, 'Closing keeps the unit and its ID but hides it from new work. Units are never deleted, so past data stays traceable.'));
  dlg.addEventListener('close', () => dlg.remove());
  const send = (b, body) => busy(b, async () => {
    try { await api('PATCH', '/api/units/' + u.id, body()); dlg.close(); toast('Saved'); renderUnits(); } catch (e) { err.textContent = e.message; }
  });
  save.addEventListener('click', send(save, () => ({ name: name.value.trim(), type: type.value.trim(), code: code.value.trim() })));
  close.addEventListener('click', send(close, () => ({ closed: !u.closed })));
  document.body.append(dlg); dlg.showModal();
}

// Reads the file, maps its columns, asks the server to check every row, then imports on confirmation.
async function importDialog(file, sectorId, sectorName) {
  if (/\.json$/i.test(file.name)) return checkAndImport(await rowsFromDhis2Json(await file.text()), sectorId, sectorName, file.name);
  const { readSheet } = await import('./xlsx.js');
  const rows = await readSheet(file);
  const hi = rows.findIndex((r) => r.some((c) => /^name$/i.test(String(c).trim())));
  if (hi < 0) throw new Error('No “Name” column found. Use the Excel template (Download Excel template).');
  const head = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (test) => head.findIndex(test);
  const ci = {
    state: col((c) => c === 'state'), lga: col((c) => c === 'lga' || c === 'lga name'), lgaId: col((c) => c === 'lga id' || c === 'lga uid'), ward: col((c) => c.startsWith('ward')),
    name: col((c) => c === 'name'), type: col((c) => c === 'type'), code: col((c) => c === 'code'), id: col((c) => c.startsWith('dhis2 id') || c === 'id' || c === 'uid'),
  };
  if (ci.lga < 0 && ci.lgaId < 0) throw new Error('No “LGA” or “LGA ID” column found. Use the Excel template.');
  const data = rows.slice(hi + 1).map((r, i) => {
    const g = (k) => (ci[k] >= 0 ? String(r[ci[k]] ?? '').trim() : '');
    return { row: hi + i + 2, state: g('state'), lga: g('lga'), lgaId: g('lgaId'), name: g('name'), type: g('type'), ward: g('ward'), code: g('code'), id: g('id') };
  }).filter((r) => r.name || r.lga || r.lgaId);
  if (!data.length) throw new Error('The file has no rows under the header.');
  return checkAndImport(data, sectorId, sectorName, file.name);
}

// DHIS2 / ALMA Export organisation units file: units below LGAs (direct, or under a ward) keep their DHIS2 IDs.
async function rowsFromDhis2Json(text) {
  let body; try { body = JSON.parse(text); } catch { throw new Error('This JSON file could not be read.'); }
  let list = body && !Array.isArray(body) ? body.organisationUnits : body;
  if (list && !Array.isArray(list)) list = list.organisationUnits;
  if (!Array.isArray(list)) throw new Error('No organisationUnits found in this file.');
  const { lgas } = await get('/api/orgunits?lgas=all');
  const lgaIds = new Set(lgas.map((l) => l.id));
  const byId = new Map(list.map((o) => [o.id, o]));
  const rows = [];
  for (const o of list) {
    const p = o.parent && o.parent.id;
    if (!p || lgaIds.has(o.id)) continue;
    if (lgaIds.has(p)) rows.push({ row: rows.length + 1, lgaId: p, name: o.name, id: o.id });
    else { const w = byId.get(p); const gp = w && w.parent && w.parent.id; if (gp && lgaIds.has(gp)) rows.push({ row: rows.length + 1, lgaId: gp, ward: w.name, name: o.name, id: o.id }); }
  }
  if (!rows.length) throw new Error('No units below LGAs in your area were found in this file.');
  return rows;
}

// Health facilities live from the scorecard platform (DHIS2 IDs), one state at a time.
const SCORECARD = 'https://www.malariascorecard.org';
async function scorecardDialog(sectorId, sectorName, states, stateId) {
  const o = await orgs();
  const stList = states || o.states;
  const stSel = select(stList, stateId || stList[0].id);
  const status = h('p', { class: 'muted small' });
  const start = h('button', { class: 'primary' }, 'Load');
  const dlg = h('dialog', {}, h('h2', {}, 'Load health facilities'),
    h('p', { class: 'muted small' }, `Reads the health facility list (with DHIS2 IDs and wards) from the scorecard platform for one state, then shows the usual import check before anything is saved into “${sectorName}”.`),
    field('State', stSel), status, h('div', { class: 'actions' }, start, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  start.addEventListener('click', busy(start, async () => {
    const j = async (path) => { const r = await fetch(SCORECARD + path); if (!r.ok) throw new Error(`Scorecard platform answered ${r.status}.`); return r.json(); };
    status.textContent = 'Finding the state…';
    try { await j('/api/regions?parentId=35469'); } catch (e) { status.textContent = ''; throw new Error('Could not reach the scorecard platform: ' + e.message); }
    const stateRegion = (await j('/api/regions?parentId=35469&depth=1')).find((x) => x.dhisRegionId === stSel.value);
    if (!stateRegion) throw new Error('This state was not found on the scorecard platform.');
    const lgaRegions = (await j(`/api/regions?parentId=${stateRegion.id}&depth=1`)).filter((x) => x.parentId === stateRegion.id && !/cold store/i.test(x.name));
    const rows = []; let done = 0; let next = 0;
    async function worker() {
      while (next < lgaRegions.length) {
        const l = lgaRegions[next++];
        const items = await j(`/api/regions?parentId=${l.id}&depth=3`);
        const byId = new Map(items.map((x) => [x.id, x]));
        for (const x of items) {
          const w = byId.get(x.parentId);
          if (w && w.parentId === l.id && !/cold store/i.test(x.name) && /^[A-Za-z][A-Za-z0-9]{10}$/.test(x.dhisRegionId || '')) {
            rows.push({ row: rows.length + 1, lgaId: l.dhisRegionId, ward: w.name, name: x.name.replace(/\s+/g, ' ').trim(), type: 'Health facility', id: x.dhisRegionId });
          }
        }
        status.textContent = `Reading LGAs… ${++done} of ${lgaRegions.length} (${rows.length} facilities so far)`;
      }
    }
    await Promise.all([1, 2, 3, 4].map(worker));
    dlg.close();
    await checkAndImport(rows, sectorId, sectorName, `scorecard platform — ${stSel.options[stSel.selectedIndex].text}`);
  }));
  document.body.append(dlg); dlg.showModal();
}

async function checkAndImport(data, sectorId, sectorName, sourceName) {
  const { data: check } = await api('POST', '/api/units/import', { sectorId, rows: data });
  const c = check.counts;
  const errors = check.results.filter((r) => r.status === 'error');
  const go = h('button', { class: 'primary', disabled: !!c.error || !(c.add + c.update) }, `Import ${c.add + c.update} unit${c.add + c.update === 1 ? '' : 's'}`);
  const dlg = h('dialog', {}, h('h2', {}, `Import ${sectorName} units — check`),
    h('p', { class: 'muted small' }, sourceName, ` · ${data.length} rows`),
    h('div', { class: 'counts' }, h('span', { class: 'pill s-accepted' }, `New: ${c.add}`), h('span', { class: 'pill s-draft' }, `Updated: ${c.update}`),
      h('span', { class: 'pill s-none' }, `Unchanged: ${c.same}`), h('span', { class: 'pill s-returned' }, `Problems: ${c.error}`)),
    errors.length ? h('div', {}, h('div', { class: 'note bad' }, 'Fix these rows in the file and import it again. Nothing has been saved.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Name'), h('th', {}, 'Problem'))),
        h('tbody', {}, errors.slice(0, 200).map((e) => h('tr', {}, h('td', {}, e.row), h('td', {}, e.name), h('td', {}, e.message)))))))
      : h('div', { class: 'note ok' }, 'All rows look good.'),
    h('p'), h('div', { class: 'actions' }, go, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  const progress = h('span', { class: 'muted small' });
  go.after(progress);
  go.addEventListener('click', busy(go, async () => {
    const status = new Map(check.results.map((x) => [x.row, x.status]));
    const todo = data.filter((r) => ['add', 'update'].includes(status.get(r.row)));
    const parts = []; for (let i = 0; i < todo.length; i += 300) parts.push(todo.slice(i, i + 300));
    let added = 0; let updated = 0;
    for (let i = 0; i < parts.length; i++) {
      progress.textContent = `Saving part ${i + 1} of ${parts.length}…`;
      const { data: done } = await api('POST', '/api/units/import', { sectorId, rows: parts[i], commit: true });
      added += done.counts.add; updated += done.counts.update;
    }
    dlg.close(); toast(`Imported: ${added} new, ${updated} updated`); renderUnits();
  }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- accounts ----------
async function renderAccounts() {
  const [{ users, roles }, m] = await Promise.all([get('/api/users'), meta()]);
  const add = h('button', { class: 'primary', onclick: () => userDialog(null, roles, m) }, '+ New account');
  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Accounts'), h('div', { class: 'muted' }, 'Create an account, choose where it works, and which data sets and numbers it reports. The person gets a one-time link to set their password.')), add),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Area'), h('th', {}, 'Assigned'), h('th', {}, 'Last sign-in'), h('th', {}, 'Status'))),
      h('tbody', {}, users.map((u) => h('tr', { class: 'click', onclick: () => userDialog(u, roles, m) },
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.roleName), h('td', {}, u.ou ? u.ou.name : ''),
        h('td', { class: 'small' }, assignedText(u, m)),
        h('td', {}, fmtDate(u.lastLoginAt)),
        h('td', {}, !u.active ? pill('none', 'Deactivated') : u.locked ? pill('returned', 'Locked') : !u.passwordSet ? pill('submitted', 'Invited') : pill('accepted', 'Active')))))))));
}

function assignedText(u, m) {
  const ds = u.datasets.length ? u.datasets.map((id) => (m.datasets.find((d) => d.id === id) || {}).name).filter(Boolean).join(', ') : 'All data sets';
  return u.dataElements.length ? `${ds} · ${u.dataElements.length} number${u.dataElements.length === 1 ? '' : 's'} only` : ds;
}

async function userDialog(u, roles, m) {
  const allowedRoles = is('sysadmin') ? roles : roles.filter((r) => r.id === 'lga');
  const name = h('input', { value: u ? u.name : '', autocomplete: 'off' });
  const email = h('input', { type: 'email', value: u ? u.email : '', autocomplete: 'off' });
  const roleSel = select(allowedRoles, u ? u.role : allowedRoles[allowedRoles.length > 2 ? 3 : 0].id);
  const o = await orgs();
  const stateSel = select(o.states, u && u.ou && u.ou.level >= 2 ? null : o.states[0].id);
  const lgaSel = h('select');
  const where = h('div', { class: 'grid2' });
  const err = h('div', { class: 'err' });
  const out = h('div');

  // Pre-select the state of an existing LGA/state user.
  let initialState = state.me.ou.level === 2 ? state.me.ou.id : o.states[0].id;
  if (u && u.ou && u.ou.level === 2) initialState = u.ou.id;
  if (u && u.ou && u.ou.level === 3) {
    for (const s of o.states) { const l = await lgasOf(s.id); if (l.some((x) => x.id === u.ou.id)) { initialState = s.id; break; } }
  }
  stateSel.value = initialState;
  async function fillLgas() {
    const l = await lgasOf(stateSel.value);
    lgaSel.replaceChildren(...l.map((x) => h('option', { value: x.id, selected: u && u.ou && x.id === u.ou.id }, x.name)));
  }
  stateSel.addEventListener('change', fillLgas);
  function layoutWhere() {
    const lvl = (roles.find((r) => r.id === roleSel.value) || {}).level;
    const showState = lvl !== 1 && state.me.ou.level === 1;
    where.replaceChildren(
      showState ? field('State', stateSel) : null,
      lvl === 3 || lvl === null ? field(lvl === null ? 'LGA (leave state for state-wide viewer)' : 'LGA', lgaSel) : null);
    if (lvl === null && !lgaSel.querySelector('option[value=""]')) lgaSel.prepend(h('option', { value: '' }, '— whole state —'));
    if (lvl === null && state.me.ou.level === 1 && !stateSel.querySelector('option[value=""]')) stateSel.prepend(h('option', { value: '' }, '— whole country —'));
  }
  roleSel.addEventListener('change', layoutWhere);
  await fillLgas(); layoutWhere();

  // Data sets and the numbers (numerators/denominators) the account may enter.
  const dsBoxes = m.datasets.filter((d) => !d.archived).map((d) => ({ d, box: h('input', { type: 'checkbox', checked: u ? u.datasets.includes(d.id) : false }) }));
  const deBoxes = [];
  const deArea = h('div');
  function layoutFields() {
    const chosen = dsBoxes.filter((x) => x.box.checked).map((x) => x.d);
    const sets = chosen.length ? chosen : m.datasets.filter((d) => !d.archived);
    deBoxes.length = 0;
    deArea.replaceChildren(...sets.map((d) => {
      // group numbers by the sector of the indicators that use them
      const sectorOf = {};
      for (const i of d.indicators.filter((x) => !x.archived)) for (const f of [i.numeratorId, i.denominatorId]) if (f && !sectorOf[f]) sectorOf[f] = i.sector || 'Other';
      const groups = {};
      for (const f of d.dataElements.filter((x) => !x.archived)) (groups[sectorOf[f.id] || 'Other'] ||= []).push(f);
      return h('div', {}, h('h3', {}, d.name), Object.keys(groups).sort().map((s) => h('div', {}, h('div', { class: 'small muted' }, s),
        h('div', { class: 'chips' }, groups[s].map((f) => { const b = h('input', { type: 'checkbox', value: f.id, checked: u ? u.dataElements.includes(f.id) : false }); deBoxes.push(b); return h('label', { class: 'check' }, b, f.name); })))));
    }));
  }
  dsBoxes.forEach((x) => x.box.addEventListener('change', layoutFields));
  layoutFields();

  const active = h('input', { type: 'checkbox', checked: u ? u.active : true });
  const save = h('button', { class: 'primary' }, u ? 'Save' : 'Create account');
  const reset = u ? h('button', {}, u.passwordSet ? 'New password link' : 'New invite link') : null;
  const dlg = h('dialog', {},
    h('h2', {}, u ? u.name : 'New account'),
    h('div', { class: 'grid2' }, field('Full name', name), field('Email', email), field('Role', roleSel)),
    where,
    h('h3', {}, 'Data sets'),
    h('div', { class: 'chips' }, dsBoxes.map((x) => h('label', { class: 'check' }, x.box, dsLabel(x.d)))),
    h('p', { class: 'muted small' }, 'None ticked = all data sets.'),
    h('h3', {}, 'Numbers this account enters'),
    h('p', { class: 'muted small' }, 'Tick only the numerators/denominators this person is responsible for. None ticked = all numbers in their data sets.'),
    deArea,
    u ? h('label', { class: 'check' }, active, 'Account active') : null,
    err, out, h('p'),
    h('div', { class: 'actions' }, save, reset, h('button', { onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => { dlg.remove(); renderAccounts(); });

  const showLink = (link, exp) => out.replaceChildren(h('div', { class: 'note ok' },
    'Send this one-time link to the person (by email or WhatsApp). It works once and expires ', fmtDate(exp), '.',
    h('div', { class: 'linkbox' }, h('input', { value: link, readonly: true }), h('button', { onclick: () => copy(link) }, 'Copy'))));

  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const lvl = (roles.find((r) => r.id === roleSel.value) || {}).level;
    let ouId = lvl === 1 ? o.country.id : lvl === 2 ? (state.me.ou.level === 2 ? state.me.ou.id : stateSel.value) : lgaSel.value;
    if (lvl === null) ouId = lgaSel.value || (state.me.ou.level === 2 ? state.me.ou.id : stateSel.value) || o.country.id;
    const body = {
      name: name.value.trim(), email: email.value.trim(), role: roleSel.value, ouId,
      datasets: dsBoxes.filter((x) => x.box.checked).map((x) => x.d.id),
      dataElements: deBoxes.filter((b) => b.checked).map((b) => b.value),
    };
    try {
      if (u) { await api('PATCH', '/api/users/' + u.id, { ...body, active: active.checked }); toast('Saved'); dlg.close(); }
      else { const { data } = await api('POST', '/api/users', body); u = data.user; save.textContent = 'Save'; showLink(data.link, data.linkExpiresAt); }
    } catch (e) { err.textContent = e.message; }
  }));
  if (reset) reset.addEventListener('click', busy(reset, async () => { const { data } = await api('POST', `/api/users/${u.id}/reset-link`); showLink(data.link, data.linkExpiresAt); }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- audit ----------
async function renderAudit() {
  const { entries } = await get('/api/audit');
  mount(h('div', {},
    h('div', { class: 'head' }, h('div', {}, h('h1', {}, 'Audit log'), h('div', { class: 'muted' }, 'Sign-ins, account changes, setup changes, data saves, reviews and exports (latest 200).'))),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Item'), h('th', {}, 'Details'))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.created_at)), h('td', {}, e.user_name || e.user_email || e.user_id || '—'),
        h('td', {}, e.action.replace(/_/g, ' ')), h('td', { class: 'mono' }, e.ref_id || ''), h('td', { class: 'small muted' }, e.detail ? JSON.stringify(e.detail).slice(0, 160) : ''))))))));
}

// Entry view groups numbers by sector; make sure metadata is loaded once signed in.
window.addEventListener('hashchange', () => { if (state.me && !state.meta) meta().catch(() => {}); });
