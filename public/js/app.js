// LGA Multi-Sectoral Scorecard Data Reporting System — single-page app (no framework, no dashboards: forms and tables).

// ---------- tiny helpers ----------
// replaceChildren() would print empty slots as the text "null"; skip them, like h() does.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) {
  return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
};
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
const field = (label, input, hint) => h('label', { class: 'f' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
// Page heading: title, one plain sentence on what the page is for, optional "How does this work?" steps, buttons.
// Page heading: where you are (area), title, one plain sentence on what the page is for, the steps, buttons.
// The steps are shown open so nobody has to guess; each person can fold them away (remembered per page).
function pageHead({ title, sub, text, how, actions, back }) {
  const pg = PAGES.find((p) => p.id === state.page);
  const grp = pg && GROUPS.find((g) => g.id === pg.group);
  const showArea = grp && !is(...ENTRY_ROLES);
  const key = 'howHidden:' + (state.page || '');
  let steps = null;
  if (how && how.length) {
    const list = h('ol', { class: 'howsteps' }, how.map((x) => h('li', {}, x)));
    const toggle = h('button', { class: 'link small' });
    const paint = () => { const hid = !!pref(key); list.hidden = hid; toggle.textContent = hid ? 'Show how this works' : 'Hide these steps'; };
    toggle.addEventListener('click', () => { pref(key, !pref(key)); paint(); });
    paint();
    steps = h('div', { class: 'how' }, h('div', { class: 'howhead' }, h('strong', {}, 'How this works'), toggle), list);
  }
  return h('div', { class: 'headwrap' },
    h('div', { class: 'head' },
      h('div', { class: 'headtext' },
        back ? h('a', { class: 'back', href: back[0] }, '← ', back[1]) : null,
        showArea ? h('div', { class: 'area ' + (grp.admin ? 'area-admin area-' + grp.id : '') }, grp.admin ? 'Administration · ' : '', grp.name) : null,
        h('h1', {}, title),
        sub ? h('div', { class: 'muted' }, sub) : null,
        text ? h('p', { class: 'lead' }, text) : null),
      actions && actions.filter(Boolean).length ? h('div', { class: 'actions' }, actions) : null),
    steps);
}
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

// Pages are grouped by what people do. Data entry accounts (LGA, unit) get a short, simple menu;
// everyone else gets a side menu with Reporting / Results / Set-up / People.
const ALL = ['sysadmin', 'setupadmin', 'state', 'lga', 'unit', 'viewer'];
const ENTRY_ROLES = ['lga', 'unit'];
// Day-to-day work first; the two administration areas (Set-up, Users & access) sit apart in their own shaded block.
const GROUPS = [
  { id: 'report', name: 'Reports', desc: 'Reports sent in by LGAs and schools / facilities' },
  { id: 'results', name: 'Results', desc: 'What the accepted reports add up to' },
  { id: 'setup', name: 'Set-up', admin: true, desc: 'What is reported: sectors, forms, indicators, places' },
  { id: 'people', name: 'Users & access', admin: true, desc: 'Who can sign in, and what they can do' },
];
const hasUnitSets = () => myDatasets().some((d) => d.reportLevel === 'UNIT');
const PAGES = [
  { id: 'home', name: () => (is(...ENTRY_ROLES) ? 'My reports' : 'Home'), short: 'What needs doing now', roles: ALL, desc: 'Start here: what needs doing and where to find everything.' },
  { id: 'review', group: 'report', name: () => (is('lga') ? 'Check school reports' : 'Approve reports'), short: 'Accept or send back what was sent', roles: ['sysadmin', 'state', 'lga'], nav: () => !is('lga') || hasUnitSets(),
    desc: () => (is('lga') ? 'Your schools / facilities send their reports to you. Check each one: Accept it (it then counts) or Send it back with a note.' : 'When an LGA presses Send, its report waits here. Check each one: Accept it (it then counts in the results) or Send it back with a note saying what to correct.') },
  { id: 'entry', group: 'report', name: 'Type in a report', short: 'On behalf of an LGA', roles: ['sysadmin', 'state', 'lga', 'unit'], nav: () => !is(...ENTRY_ROLES), desc: 'Type in the numbers of a report for an LGA that cannot do it themselves, and send it.' },
  { id: 'picture', group: 'results', name: 'Results table', short: 'One form, one period', roles: ['sysadmin', 'setupadmin', 'state', 'viewer'], desc: 'The indicators of one form for one period, with a row per state, LGA or school / facility.' },
  { id: 'pivot', group: 'results', name: () => (is(...ENTRY_ROLES) ? 'Results' : 'Compare over time'), short: 'Places × indicators × periods', roles: ['sysadmin', 'setupadmin', 'state', 'lga', 'viewer'], desc: 'Compare indicators across places and periods (a pivot table), and download it to Excel.' },
  { id: 'export', group: 'results', name: 'Export to scorecard', short: 'The two JSON files', roles: ['sysadmin', 'setupadmin', 'state', 'viewer'], desc: 'Download the two JSON files that the scorecard platform reads.' },
  { id: 'setup', group: 'setup', name: 'Sectors & indicators', short: 'Add a sector and its form', roles: ['sysadmin', 'setupadmin'], desc: 'Add a sector (Health, Education …), its reporting form and the indicators on that form.' },
  { id: 'population', group: 'setup', name: 'Population figures', short: 'Yearly denominators', roles: ['sysadmin', 'setupadmin'], desc: 'Yearly numbers per LGA that indicators divide by: population, under-5s, expected pregnancies …' },
  { id: 'units', group: 'setup', name: 'Schools & facilities', short: 'Places below the LGA', roles: ['sysadmin', 'setupadmin', 'state'], desc: 'Places below the LGA that report on their own (schools, health facilities, water points …).' },
  { id: 'rollout', group: 'setup', name: 'States in use', short: 'Which states take part', roles: ['sysadmin'], desc: 'Choose which states use the system. The others are hidden everywhere.' },
  { id: 'accounts', group: 'people', name: 'Users', short: 'Accounts, sign-up requests, QR codes', roles: ['sysadmin', 'state'], desc: 'Create accounts, approve sign-up requests and share registration QR codes.' },
  { id: 'audit', group: 'people', name: 'Activity log', short: 'Who did what, when', roles: ['sysadmin'], desc: 'Who signed in, changed, sent, approved or downloaded what, and when.' },
];
const pageDesc = (p) => (typeof p.desc === 'function' ? p.desc() : p.desc);
const pageName = (p) => (typeof p.name === 'function' ? p.name() : p.name);
const ROLE_HELP = {
  sysadmin: 'Full control: sets up sectors, forms and indicators, chooses the states in use, manages every user, and sees everything.',
  setupadmin: 'Sets up sectors, forms and indicators, and sees all results. Does not manage users.',
  state: 'Approves (or sends back) the reports of the LGAs in one state, sees the state’s results, and manages LGA accounts there.',
  lga: 'Types in and sends the reports of one LGA. Also checks the reports of its schools / facilities, if a sector reports by unit.',
  unit: 'Types in and sends the reports of one school, health facility or other unit.',
  viewer: 'Only looks at results and downloads them. Enters nothing.',
};

async function loadMe() {
  try { state.me = await get('/api/me'); } catch { state.me = null; }
  return state.me;
}
async function meta(force = false) { if (!state.meta || force) state.meta = await get('/api/metadata'); return state.meta; }
async function orgs() { if (!state.orgs) state.orgs = await get('/api/orgunits'); return state.orgs; }
const lgaCache = {};
const unitCache = {};
async function unitsOf(lgaId) { if (!unitCache[lgaId]) unitCache[lgaId] = (await get(`/api/orgunits?parent=${lgaId}&units=1`)).children; return unitCache[lgaId]; }
async function lgasOf(stateId) { if (!lgaCache[stateId]) lgaCache[stateId] = (await get('/api/orgunits?parent=' + stateId)).children.filter((c) => !c.closed); return lgaCache[stateId]; }

const navPages = () => PAGES.filter((p) => p.roles.includes(role()) && (!p.nav || p.nav()));
function renderChrome(page) {
  const top = $('#top');
  const side = $('#side');
  if (!state.me) { top.hidden = true; side.hidden = true; document.body.classList.remove('with-side'); return; }
  top.hidden = false;
  const shown = navPages();
  // Data entry pages opened from "My reports" keep "My reports" highlighted.
  const current = page === 'entry' && is(...ENTRY_ROLES) ? (state.fromReview ? 'review' : 'home') : page === 'entry' && state.fromReview ? 'review' : page;
  const link = (p, withShort) => h('a', { href: '#/' + p.id, class: p.id === current ? 'on' : '', 'data-page': p.id, title: pageDesc(p), onclick: () => { state.fromReview = false; } },
    h('span', { class: 'nl' }, pageName(p)), withShort && p.short ? h('span', { class: 'ns' }, p.short) : null);
  if (is(...ENTRY_ROLES) || is('viewer')) {
    // Simple menu across the top.
    side.hidden = true; document.body.classList.remove('with-side');
    $('#nav').replaceChildren(...shown.map((p) => link(p, false)));
  } else {
    side.hidden = false; document.body.classList.add('with-side');
    $('#nav').replaceChildren();
    const group = (g) => {
      const ps = shown.filter((p) => p.group === g.id);
      return ps.length ? h('div', { class: 'navgroup' }, h('div', { class: 'navlabel', title: g.desc }, g.name), ps.map((p) => link(p, true))) : null;
    };
    const work = GROUPS.filter((g) => !g.admin).map(group).filter(Boolean);
    const admin = GROUPS.filter((g) => g.admin).map(group).filter(Boolean);
    side.replaceChildren(
      link(shown[0], true),
      work,
      admin.length ? h('div', { class: 'adminblock' }, h('div', { class: 'admintitle' }, 'Administration'), admin) : null,
    );
  }
  const setTop = () => document.documentElement.style.setProperty('--toph', `${top.offsetHeight}px`);
  setTop(); if (!window.__topWatch) { window.__topWatch = true; window.addEventListener('resize', () => { const t = $('#top'); if (t && !t.hidden) document.documentElement.style.setProperty('--toph', `${t.offsetHeight}px`); }); }
  if (is('sysadmin', 'state')) {
    get('/api/account-requests').then(({ requests }) => {
      const a = $('#side a[data-page="accounts"]');
      if (a && requests.length) a.append(h('span', { class: 'badge', title: 'Account requests waiting for approval' }, String(requests.length)));
    }).catch(() => {});
  }
  $('#who').replaceChildren(
    h('span', { class: 'whoami', title: ROLE_HELP[role()] || '' }, h('strong', {}, state.me.user.name), h('span', { class: 'rolechip' }, state.me.user.roleName), h('span', { class: 'muted' }, state.me.ou ? state.me.ou.name : '')),
    h('a', { href: '#/me' }, 'Password'),
    h('button', { class: 'link', onclick: async () => { await api('POST', '/api/auth/logout', {}); state.me = null; state.meta = null; state.orgs = null; go('#/login'); } }, 'Sign out'),
  );
}

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || '';
  if (page === 'set-password') return renderSetPassword(parts[1]);
  if (page === 'register') return renderRegister(parts[1]);
  if (!state.me) await loadMe();
  if (!state.me) {
    const s = await get('/api/setup').catch(() => ({ needsSetup: false }));
    renderChrome();
    return s.needsSetup ? renderFirstSetup(s) : renderLogin();
  }
  const allowed = PAGES.filter((p) => p.roles.includes(role()));
  const target = page === 'me' ? 'me' : allowed.find((p) => p.id === page) ? page : 'home';
  if (target !== page) return go('#/' + target);
  if (target !== 'entry') state.fromReview = target === 'review';
  state.page = target;
  renderChrome(target);
  mount(h('p', { class: 'muted' }, 'Loading…'));
  try {
    await ({ home: renderHome, entry: renderEntry, review: renderReview, picture: renderPicture, pivot: renderPivot, export: renderExport, setup: renderSetup, population: renderPopulation, units: renderUnits, rollout: renderRollout, accounts: renderAccounts, audit: renderAudit, me: renderMe })[target](...parts.slice(1));
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
    h('h1', {}, 'Sign in'), h('p', { class: 'muted small' }, 'LGA Multi-Sectoral Scorecard Data Reporting System'),
    h('div', { class: 'grid2' }, field('Email', email)), field('Password', pw), h('p'), btn, err,
    h('p', { class: 'muted small' }, 'Forgot your password? Ask your administrator for a new sign-in link.'));
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    try { await api('POST', '/api/auth/login', { email: email.value, password: pw.value }); await loadMe(); go('#/'); } catch (e) { err.textContent = e.message; if (e.body && e.body.error && e.body.error.code === 'pending_approval') err.className = 'note info'; }
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
    try { await api('POST', '/api/setup', { setupKey: key.value, name: name.value, email: email.value, password: pw.value }); await loadMe(); go('#/home'); } catch (e) { err.textContent = e.message; }
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
const dsLabel = (d) => (d.shared ? d.name + ' (shared)' : (d.sector && !d.name.toLowerCase().startsWith(d.sector.toLowerCase()) ? `${d.sector} — ${d.name}` : d.name) + (d.reportLevel === 'UNIT' ? ' · by unit' : ''));
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

// ---------- home ----------
const STATUS_PLAIN = {
  none: 'Not started',
  draft: 'Started — not sent yet',
  submitted: 'Sent — waiting to be checked',
  accepted: 'Accepted',
  returned: 'Sent back — please correct',
};
const ACTION_FOR = { none: 'Start', draft: 'Continue', returned: 'Correct and send again', submitted: 'View', accepted: 'View' };
const periodWord = (freq) => ({ MONTHLY: 'Month', QUARTERLY: 'Quarter', YEARLY: 'Year' })[freq] || 'Period';

function renderHome() {
  return is(...ENTRY_ROLES) ? renderMyReports() : renderOverview();
}

// LGA and unit accounts: a to-do list of their reports, newest periods first.
async function renderMyReports() {
  await meta();
  const ou = state.me.ou;
  const sets = myDatasets().filter((d) => (is('unit') ? d.reportLevel === 'UNIT' : d.reportLevel !== 'UNIT'));
  const unitSets = is('lga') ? myDatasets().filter((d) => d.reportLevel === 'UNIT') : [];
  const head = pageHead({
    title: 'My reports',
    sub: `${ou.name}${ou.lga ? ' · ' + ou.lga : ''}`,
    text: 'These are the reports you send. Click a report to type in its numbers.',
    how: [
      'Click Start (or Continue) next to a report.',
      'Type each number. Put 0 when there was nothing — every box must be filled.',
      'Press Send. If you are not finished, press Save and come back later.',
      `The ${is('unit') ? 'LGA or state' : 'state'} checks it. If something is wrong they send it back with a note; correct it and send it again.`,
    ],
  });
  if (!sets.length && !unitSets.length) return mount(head, noDatasets());
  const cards = await Promise.all(sets.map(async (ds) => {
    const first = await get('/api/entry' + qs({ dataset: ds.id, ou: ou.id }));
    const recent = first.periods.slice(0, ds.shared ? 1 : 3);
    const forms = await Promise.all(recent.map((p) => (p.id === first.period ? first : get('/api/entry' + qs({ dataset: ds.id, ou: ou.id, period: p.id })).catch(() => null))));
    const open = (f) => { pref('ds', ds.id); pref('pe:' + ds.id, f.period); go('#/entry'); };
    return h('div', { class: 'panel report-card' },
      h('div', { class: 'rc-head' }, h('h2', {}, ds.shared ? 'Population figures' : ds.name),
        h('span', { class: 'muted small' }, ds.shared ? 'Once a year' : `${ds.frequencyName} · due on day ${ds.dueDay} of the next month`)),
      h('table', { class: 'todo' }, h('tbody', {}, forms.filter(Boolean).map((f) => {
        const s = f.report.status;
        return h('tr', { class: 'click', onclick: () => open(f) },
          h('td', { class: 'pe' }, f.periodName),
          h('td', {}, pill(s, STATUS_PLAIN[s]), f.overdue && f.can.edit ? h('span', { class: 'late' }, `Late — was due ${fmtDay(f.due)}`) : !['submitted', 'accepted'].includes(s) && f.due ? h('span', { class: 'muted small' }, ` Due ${fmtDay(f.due)}`) : null,
            s === 'returned' && f.report.comment ? h('div', { class: 'small bad-text' }, `Note: “${f.report.comment}”`) : null),
          h('td', { class: 'n' }, h('button', { class: ['none', 'draft', 'returned'].includes(s) ? 'primary' : '' }, ACTION_FOR[s] || 'Open')));
      }))),
      first.periods.length > recent.length ? h('p', { class: 'muted small' }, 'Need an older period? Open any report and change the ', periodWord(ds.frequency).toLowerCase(), ' at the top.') : null);
  }));
  let unitCard = null;
  if (unitSets.length) {
    const stateId = ou.path ? ou.path.split('/')[2] : null;
    const rows = await Promise.all(unitSets.map((ds) => get('/api/status' + qs({ dataset: ds.id, state: stateId })).then((st) => ({ ds, st })).catch(() => null)));
    unitCard = h('div', { class: 'panel report-card' },
      h('div', { class: 'rc-head' }, h('h2', {}, 'Reports from your schools / facilities'), h('span', { class: 'muted small' }, 'You check these before they count')),
      h('table', { class: 'todo' }, h('tbody', {}, rows.filter(Boolean).map(({ ds, st }) => h('tr', { class: 'click', onclick: () => { pref('ds', ds.id); go('#/review'); } },
        h('td', {}, ds.name, h('div', { class: 'muted small' }, st.periodName)),
        h('td', {}, st.counts.submitted ? pill('submitted', `${st.counts.submitted} waiting for you`) : pill('accepted', 'Nothing waiting'), h('span', { class: 'muted small' }, ` ${st.counts.accepted} of ${st.total} accepted`)),
        h('td', { class: 'n' }, h('button', { class: st.counts.submitted ? 'primary' : '' }, 'Check')))))));
  }
  mount(h('div', {}, head, cards, unitCard));
}

// Everyone else: what is waiting, the set-up checklist (administrators) and a map of the system.
async function renderOverview() {
  const m = await meta();
  const ou = state.me.ou;
  const blocks = [];
  // Reports waiting for approval (state officers; administrators when few states are in use).
  if (is('state', 'sysadmin')) {
    const o = await orgs();
    const states = is('state') ? [{ id: ou.id, name: ou.name }] : o.states.length <= 6 ? o.states : [];
    const sets = myDatasets().filter((d) => !d.shared && !d.archived);
    const res = await Promise.all(states.flatMap((s) => sets.map((ds) => get('/api/status' + qs({ dataset: ds.id, state: s.id })).then((st) => ({ s, ds, st })).catch(() => null))));
    const waiting = res.filter((x) => x && x.st.counts.submitted);
    blocks.push(h('div', { class: 'panel' }, h('h2', {}, 'Reports waiting for approval'),
      !states.length ? h('p', {}, 'Open ', h('a', { href: '#/review' }, 'Approve reports'), ' and choose a state.')
        : waiting.length ? h('table', { class: 'todo' }, h('tbody', {}, waiting.map(({ s, ds, st }) => h('tr', { class: 'click', onclick: () => { pref('ds', ds.id); pref('state', s.id); pref('pe:' + ds.id, st.period); go('#/review'); } },
          h('td', {}, ds.name, h('div', { class: 'muted small' }, `${is('state') ? '' : s.name + ' · '}${st.periodName}`)),
          h('td', {}, pill('submitted', `${st.counts.submitted} waiting`), h('span', { class: 'muted small' }, ` ${st.counts.accepted} of ${st.total} accepted`)),
          h('td', { class: 'n' }, h('button', { class: 'primary' }, 'Check them'))))))
          : h('p', { class: 'muted' }, 'Nothing is waiting for you right now for the latest periods.')));
  }
  if (is('state', 'sysadmin')) {
    const { requests } = await get('/api/account-requests').catch(() => ({ requests: [] }));
    if (requests.length) blocks.push(h('div', { class: 'note warn' }, `${requests.length} ${requests.length === 1 ? 'person is' : 'people are'} waiting for you to approve their account. `, h('a', { href: '#/accounts' }, 'Open Users →')));
  }
  // Set-up checklist for administrators.
  if (is('sysadmin', 'setupadmin')) {
    const active = is('sysadmin') ? (await get('/api/orgunits?all=1')).states : null;
    const shared = m.datasets.find((d) => d.shared && !d.archived);
    const forms = m.datasets.filter((d) => !d.shared && !d.archived);
    const sectors = new Set(forms.map((d) => d.sectorId));
    const inds = forms.reduce((n, d) => n + d.indicators.filter((i) => !i.archived).length, 0);
    const byUnit = forms.filter((d) => d.reportLevel === 'UNIT');
    const users = is('sysadmin') ? (await get('/api/users')).users : null;
    const step = (done, title, detail, href, btn) => h('li', { class: done ? 'done' : '' },
      h('span', { class: 'tick' }, done ? '✓' : ''), h('div', {}, h('strong', {}, title), h('div', { class: 'muted small' }, detail)), href ? h('a', { class: 'btn', href }, btn) : null);
    blocks.push(h('div', { class: 'panel' }, h('h2', {}, 'Getting the system ready'),
      h('p', { class: 'muted small' }, 'Do these in order. Each step can be changed later.'),
      h('ol', { class: 'steps' },
        active ? step(active.some((s) => !s.active), '1. Choose the states in use', `${active.filter((s) => s.active).length} of ${active.length} states are in use.`, '#/rollout', 'States in use') : null,
        step(!!shared && shared.dataElements.length > 0, `${active ? '2' : '1'}. Population figures`, shared ? `${shared.dataElements.filter((f) => !f.archived).length} population numbers (e.g. expected pregnancies) that indicators can divide by.` : 'The yearly numbers every sector divides by: population, under-5s, expected pregnancies …', '#/population', shared ? 'Open' : 'Create'),
        step(inds > 0, `${active ? '3' : '2'}. Sectors, forms and indicators`, forms.length ? `${sectors.size} sector${sectors.size === 1 ? '' : 's'}, ${forms.length} form${forms.length === 1 ? '' : 's'}, ${inds} indicator${inds === 1 ? '' : 's'}.` : 'Add a sector (Health, Education, Agriculture …) with its reporting form and indicators.', '#/setup', forms.length ? 'Open' : 'Add a sector'),
        byUnit.length ? step(false, `${active ? '4' : '3'}. Schools & facilities`, `${byUnit.map((d) => d.name).join(', ')} ${byUnit.length === 1 ? 'is' : 'are'} reported by each school / facility: load the list of them.`, '#/units', 'Open') : null,
        users ? step(users.length > 1, `${byUnit.length ? '5' : '4'}. Users`, `${users.length} account${users.length === 1 ? '' : 's'}. Create accounts, or print a registration QR code and approve the requests.`, '#/accounts', 'Open') : null)));
  }
  // Map of the system: every page this account can use, with what it is for.
  const shown = navPages().filter((p) => p.id !== 'home');
  blocks.push(h('h2', {}, 'What you can do here'),
    h('div', { class: 'tiles' }, GROUPS.map((g) => {
      const ps = shown.filter((p) => p.group === g.id);
      return ps.length ? h('div', { class: 'tile' + (g.admin ? ' tile-admin' : '') }, h('h3', {}, g.admin ? 'Administration · ' + g.name : g.name), h('p', { class: 'muted small' }, g.desc), ps.map((p) => h('a', { class: 'tile-link', href: '#/' + p.id }, h('strong', {}, pageName(p)), h('span', { class: 'muted small' }, pageDesc(p))))) : null;
    })));
  mount(h('div', {},
    pageHead({ title: `Welcome, ${state.me.user.name.split(' ')[0]}`, sub: `${state.me.user.roleName}${ou ? ' · ' + ou.name : ''}`, text: ROLE_HELP[role()] }),
    blocks));
}

// ---------- data entry ----------
async function renderEntry() {
  await meta();
  let sets = myDatasets();
  // Data entry accounts only pick among the forms they send themselves. An LGA opening one of its schools'
  // reports (from “Check school reports”) sees just that form.
  if (is('unit')) sets = sets.filter((d) => d.reportLevel === 'UNIT');
  if (is('lga')) {
    const cur = sets.find((d) => d.id === pref('ds'));
    sets = cur && cur.reportLevel === 'UNIT' ? [cur] : sets.filter((d) => d.reportLevel !== 'UNIT');
  }
  if (!sets.length) return mount(noDatasets());
  const ds = sets.find((d) => d.id === pref('ds')) || sets[0];
  let ouId; let pickers = [];
  const byUnit = ds.reportLevel === 'UNIT';
  if (role() === 'unit') ouId = state.me.ou.id;
  else if (role() === 'lga') ouId = state.me.ou.id;
  else {
    const stateId = role() === 'state' ? state.me.ou.id : pref('state');
    const sp = role() === 'state' ? { value: state.me.ou.id } : await pickState(stateId, (v) => { pref('state', v); pref('lga', null); renderEntry(); });
    const lgas = await lgasOf(sp.value);
    ouId = lgas.some((l) => l.id === pref('lga')) ? pref('lga') : lgas[0].id;
    pickers = [sp.el, field('LGA', select(lgas, ouId, { onchange: (e) => { pref('lga', e.target.value); renderEntry(); } }))];
  }
  if (byUnit && role() !== 'unit') {
    // Unit-reported data set: choose the school / facility inside the LGA.
    const units = (await unitsOf(ouId)).filter((u) => u.sectorId === ds.sectorId);
    if (!units.length) {
      return mount(h('div', {}, h('div', { class: 'bar' }, field('Report (form)', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderEntry(); } })), pickers),
        h('div', { class: 'panel empty' }, `“${ds.name}” is reported by each ${ds.sector ? ds.sector.toLowerCase() + ' ' : ''}school / facility, and none are listed for this LGA yet. Add them on the Schools & facilities page.`)));
    }
    ouId = units.some((u) => u.id === pref('unit')) ? pref('unit') : units[0].id;
    pickers = [...pickers, field('School / facility', select(units, ouId, { onchange: (e) => { pref('unit', e.target.value); renderEntry(); } }))];
  } else if (!byUnit && role() === 'unit') {
    return mount(h('div', { class: 'note info' }, `“${ds.name}” is reported by the LGA, not by each unit.`));
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
  const simple = is(...ENTRY_ROLES);
  const toUnit = form.ou.level === 4;
  const checker = toUnit ? 'the LGA or state' : 'the state';
  const dsSel = select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), form.dataset.id, { onchange: (e) => { pref('ds', e.target.value); renderEntry(); } });
  const peSel = select(form.periods, form.period, { onchange: (e) => { pref('pe:' + form.dataset.id, e.target.value); renderEntry(); } });

  const fieldById = Object.fromEntries(form.fields.map((f) => [f.id, f]));
  const groups = state.meta ? sectorGroups(form) : [['', form.fields.map((f) => f.id)]];
  const rows = [];
  for (const [sector, ids] of groups) {
    if (groups.length > 1 || sector) rows.push(h('tr', { class: 'sector' }, h('td', { colspan: 2 }, sector)));
    for (const id of ids) {
      const f = fieldById[id]; if (!f) continue;
      const inp = h('input', { class: 'num', inputmode: f.valueType === 'INTEGER' ? 'numeric' : 'decimal', value: f.value === null ? '' : String(f.value), disabled: !f.editable, 'aria-label': f.name, placeholder: f.editable ? '' : '' });
      inp.addEventListener('input', () => { inp.classList.remove('bad'); dirty = true; });
      inputs[f.id] = inp;
      rows.push(h('tr', {}, h('td', {}, f.name, f.editable || r.locked ? null : h('div', { class: 'muted small' }, 'Typed in by another person')), h('td', { class: 'n' }, inp)));
    }
  }
  let dirty = false;

  const collect = () => Object.fromEntries(Object.entries(inputs).filter(([id]) => fieldById[id].editable).map(([id, i]) => [id, i.value.trim() === '' ? null : i.value.trim()]));
  async function save(quiet) {
    err.textContent = '';
    try {
      const { data } = await api('PUT', '/api/entry', { dataset: form.dataset.id, ou: form.ou.id, period: form.period, values: collect() });
      dirty = false; if (!quiet) toast('Saved. Nothing has been sent yet.'); return data;
    } catch (e) {
      const errs = (e.body && e.body.error && e.body.error.errors) || {};
      for (const id of Object.keys(errs)) if (inputs[id]) inputs[id].classList.add('bad');
      err.textContent = e.message; throw e;
    }
  }
  const saveBtn = h('button', {}, 'Save, send later');
  saveBtn.addEventListener('click', busy(saveBtn, async () => { const d = await save(); main().replaceChildren(entryView(d, sets, pickers)); }));
  const submitBtn = h('button', { class: 'primary big' }, toUnit ? 'Send' : 'Send to the state');
  submitBtn.addEventListener('click', busy(submitBtn, async () => {
    if (form.can.edit && (dirty || r.status === 'none' || r.status === 'returned')) await save(true);
    try {
      const { data } = await api('POST', '/api/entry/submit', { dataset: form.dataset.id, ou: form.ou.id, period: form.period });
      toast('Sent. Thank you!'); main().replaceChildren(entryView(data, sets, pickers));
    } catch (e) { err.textContent = e.message; }
  }));

  const reviewBox = form.can.review ? reviewControls(form, (d) => main().replaceChildren(entryView(d, sets, pickers))) : null;

  // One plain sentence on where this report stands and what to do next.
  const statusNote = {
    none: form.can.edit ? h('div', { class: 'note info' }, h('strong', {}, 'Not started. '), 'Type the numbers below, then press ', h('strong', {}, toUnit ? 'Send' : 'Send to the state'), '.') : null,
    draft: form.can.edit ? h('div', { class: 'note info' }, h('strong', {}, 'Saved but not sent yet. '), `Finish the numbers and press ${toUnit ? 'Send' : 'Send to the state'}.`) : null,
    returned: h('div', { class: 'note bad' }, h('strong', {}, 'Sent back for correction. '), r.comment ? `Note from ${r.reviewedBy || 'the reviewer'}: “${r.comment}”. ` : '', form.can.edit ? 'Correct the numbers and send again.' : ''),
    submitted: h('div', { class: 'note warn' }, h('strong', {}, 'Sent. '), `${fmtDate(r.submittedAt)}${r.submittedBy ? ' by ' + r.submittedBy : ''}. Waiting for ${checker} to check it. It can no longer be changed unless it is sent back.`),
    accepted: h('div', { class: 'note ok' }, h('strong', {}, 'Accepted. '), `${fmtDate(r.reviewedAt)}${r.reviewedBy ? ' by ' + r.reviewedBy : ''}. These numbers now count in the results.`),
  }[r.status];

  const results = [
    form.sharedValues && form.sharedValues.length ? h('div', {}, h('h3', {}, 'Population figures used'),
      h('p', { class: 'muted small' }, 'Entered once a year for this LGA; not typed in here.'),
      h('table', {}, h('tbody', {}, form.sharedValues.map((x) => h('tr', {}, h('td', {}, x.name),
        h('td', { class: 'n' }, x.yearValue === null ? h('span', { class: 'late' }, `Missing for ${x.year}`) : x.prorate && form.dataset.frequency !== 'YEARLY' ? `${fmtNum(x.yearValue)} for ${x.year} → ${fmtNum(x.value, 1)} for this period` : fmtNum(x.yearValue))))))) : null,
    form.indicators.length ? h('div', {}, h('h3', {}, 'Indicators calculated from these numbers'),
      h('table', {}, h('tbody', {}, form.indicators.map((i) => h('tr', {}, h('td', {}, i.name, h('span', { class: 'muted small' }, i.sector ? ` · ${i.sector}` : '')), h('td', { class: 'n' }, fmtNum(i.value, 2))))))) : null,
  ].filter(Boolean);

  return h('div', {},
    pageHead({
      back: simple ? (toUnit && is('lga') ? ['#/review', 'Check school reports'] : ['#/home', 'My reports']) : form.can.review ? ['#/review', 'Approve reports'] : null,
      title: `${form.dataset.name} — ${form.periodName}`,
      sub: [form.ou.type, form.ou.name, form.ou.lga].filter(Boolean).join(' · '),
      text: simple ? null : form.can.review && ['submitted', 'accepted'].includes(r.status) ? 'Check the numbers, then decide at the bottom: Accept or Send back.' : 'Type in a report on behalf of an LGA (or a school / facility).',
      actions: [pill(r.status, STATUS_PLAIN[r.status]), r.late ? h('span', { class: 'late' }, 'Sent late') : null],
    }),
    h('div', { class: 'bar' + (simple ? ' bar-simple' : '') }, sets.length > 1 || !simple ? field(simple ? 'Report' : 'Report (form)', dsSel) : null, pickers, field(periodWord(form.dataset.frequency), peSel)),
    statusNote,
    form.overdue && form.can.edit ? h('div', { class: 'note warn' }, `This report was due on ${fmtDay(form.due)}.`) : null,
    h('div', { class: 'panel' },
      form.fields.length ? h('table', { class: 'entry' }, h('thead', {}, h('tr', {}, h('th', {}, 'What to count'), h('th', { class: 'n' }, 'Number'))), h('tbody', {}, rows))
        : h('div', { class: 'empty' }, 'This form has no indicators yet.'),
      err,
      form.can.edit ? h('div', { class: 'sendbar' },
        h('div', { class: 'sendbtn' }, submitBtn, h('span', { class: 'hint' }, `Sends it to ${checker} to check. Every box must have a number — put 0 if there were none.`)),
        h('div', { class: 'sendbtn' }, saveBtn, h('span', { class: 'hint' }, 'Keeps what you typed. Nothing is sent.'))) : null),
    reviewBox,
    results.length ? h('details', { class: 'panel', open: !simple || undefined }, h('summary', {}, 'See the results these numbers give'), results) : null,
    r.updatedAt ? h('p', { class: 'muted small' }, `Last saved ${fmtDate(r.updatedAt)}${r.updatedBy ? ' by ' + r.updatedBy : ''}.`) : null,
  );
}

function reviewControls(form, after) {
  const comment = h('textarea', { placeholder: 'If you send it back: what needs to be corrected? The person who sent it will see this.' });
  const accept = h('button', { class: 'primary' }, 'Accept');
  const back = h('button', { class: 'danger' }, 'Send back for correction');
  const act = (action, btn) => busy(btn, async () => {
    if (action === 'return' && !comment.value.trim()) { toast('Write what needs to be corrected first.', true); comment.focus(); return; }
    const { data } = await api('POST', '/api/entry/review', { dataset: form.dataset.id, ou: form.ou.id, period: form.period, action, comment: comment.value.trim() || undefined });
    toast(action === 'accept' ? 'Accepted — it now counts in the results' : 'Sent back'); after(data);
  });
  accept.addEventListener('click', act('accept', accept));
  back.addEventListener('click', act('return', back));
  const submitted = form.report.status === 'submitted';
  return h('div', { class: 'panel decide' }, h('h2', {}, submitted ? 'Approve or send back' : 'Found a mistake?'),
    h('p', { class: 'muted small' }, submitted
      ? 'Check the numbers above. Accept if they look right — the report then counts in the results. Send back if something must be fixed, and write what.'
      : 'This report is already accepted. If you find a mistake, you can still send it back with a note.'),
    comment, h('p'), h('div', { class: 'actions' }, submitted ? accept : null, back));
}

// ---------- review (status of every LGA) ----------
async function renderReview() {
  const sets = myDatasets();
  if (!sets.length) return mount(noDatasets());
  // LGA reviewers only review unit-reported data sets (their schools / facilities).
  const usable = role() === 'lga' ? sets.filter((d) => d.reportLevel === 'UNIT') : sets;
  if (!usable.length) return mount(h('div', { class: 'note info' }, 'None of your reports come from schools or facilities, so there is nothing for you to check here.'));
  const ds = usable.find((d) => d.id === pref('ds')) || usable[0];
  const byUnit = ds.reportLevel === 'UNIT';
  const sp = ['state', 'lga'].includes(role()) ? { value: state.me.ou.path ? state.me.ou.path.split('/')[2] : state.me.ou.id } : await pickState(pref('state'), (v) => { pref('state', v); pref('rlga', ''); renderReview(); });
  const period = pref('pe:' + ds.id);
  const lgaFilter = byUnit && role() !== 'lga' ? pref('rlga') || '' : '';
  const params = { dataset: ds.id, state: sp.value, lga: lgaFilter, period };
  const st = await get('/api/status' + qs(params)).catch(async (e) => {
    if (e.body && e.body.error && e.body.error.field === 'period') { pref('pe:' + ds.id, null); return get('/api/status' + qs({ ...params, period: undefined })); } throw e;
  });
  await meta();
  const open = (l) => {
    pref('ds', ds.id); pref('state', sp.value); pref('pe:' + ds.id, st.period);
    if (byUnit) { pref('lga', l.lgaId); pref('unit', l.id); } else pref('lga', l.id);
    go('#/entry');
  };
  const what = byUnit ? 'schools / facilities' : 'LGAs';
  const order = { submitted: 0, returned: 1, draft: 2, none: 3, accepted: 4 };
  const list = [...st.lgas].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const todo = { submitted: 'Check it', returned: 'Waiting for the correction', draft: 'Being typed in', none: 'Not started yet', accepted: 'Done' };
  const summary = [st.counts.submitted ? `${st.counts.submitted} waiting for you` : 'nothing waiting for you', `${st.counts.accepted} accepted`, st.counts.returned ? `${st.counts.returned} sent back` : null, `${st.counts.none + st.counts.draft} not sent yet`].filter(Boolean).join(' · ');
  mount(h('div', {},
    pageHead({
      title: role() === 'lga' ? 'Check school / facility reports' : 'Approve reports',
      sub: `${role() === 'lga' ? state.me.ou.name : st.state.name} · ${st.dataset.name} · ${st.periodName} · due ${fmtDay(st.due)}`,
      text: `When ${byUnit ? 'a school or facility' : 'an LGA'} presses Send, its report waits here for you. Nothing counts in the results until you accept it.`,
      how: [
        'Choose the form and the period at the top.',
        'Reports waiting for you are at the top of the list, marked yellow. Click one to open it.',
        'Look at the numbers. If they look right, press Accept — they now count in the results.',
        'If something is wrong, write what to fix and press Send back. The sender sees your note, corrects it and sends it again.',
      ],
    }),
    h('div', { class: 'bar' },
      field('Report (form)', select(usable.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderReview(); } })),
      role() === 'state' || role() === 'lga' ? null : sp.el,
      byUnit && role() !== 'lga' ? field('LGA', select([{ id: '', name: 'All LGAs' }, ...st.lgaOptions], lgaFilter, { onchange: (e) => { pref('rlga', e.target.value); renderReview(); } })) : null,
      field(periodWord(ds.frequency), select(st.periods, st.period, { onchange: (e) => { pref('pe:' + ds.id, e.target.value); renderReview(); } }))),
    h('div', { class: 'note ' + (st.counts.submitted ? 'warn' : 'ok') }, h('strong', {}, `${st.total} ${what}: `), summary),
    list.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, byUnit ? h('th', {}, 'LGA') : null, h('th', {}, byUnit ? 'School / facility' : 'LGA'), h('th', {}, 'Status'), h('th', {}, 'Sent'), h('th', {}, 'Checked'), h('th', {}, 'Note'), h('th', {}, ''))),
      h('tbody', {}, list.map((l) => h('tr', { class: 'click' + (l.status === 'submitted' ? ' hot' : ''), onclick: () => open(l) },
        byUnit ? h('td', { class: 'small' }, l.lgaName) : null,
        h('td', {}, l.name, l.type ? h('span', { class: 'muted small' }, ` · ${l.type}`) : null), h('td', {}, pill(l.status, STATUS_PLAIN[l.status]), l.late ? h('span', { class: 'late' }, 'Late') : null),
        h('td', {}, fmtDate(l.submittedAt)), h('td', {}, fmtDate(l.reviewedAt)), h('td', { class: 'small muted' }, l.comment || ''),
        h('td', { class: 'n' }, l.status === 'submitted' ? h('button', { class: 'primary' }, 'Open and check') : h('span', { class: 'muted small' }, todo[l.status])))))))
      : h('div', { class: 'panel empty' }, byUnit ? 'No schools / facilities are listed for this sector here yet. Add them on the Schools & facilities page.' : 'No LGAs.'),
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
  const period = choices.some((c) => c.id === pref('ppe:' + ds.id)) ? pref('ppe:' + ds.id) : (choices.find((c) => !c.name.includes('so far')) || choices[0]).id;
  const provisional = !!pref('prov');
  const sector = pref('sector') || '';
  const byUnit = ds.reportLevel === 'UNIT';
  let ouOptions = [];
  let ou = state.me.ou.id;
  if (state.me.ou.level === 1) {
    const o = await orgs();
    ouOptions = [{ id: o.country.id, name: `${o.country.name} (all states)` }, ...o.states];
  } else if (state.me.ou.level === 2) {
    ouOptions = [{ id: state.me.ou.id, name: state.me.ou.name }];
  }
  // Unit-reported data sets can be opened down to one LGA to see its schools / facilities.
  const topIds = ouOptions.map((x) => x.id);
  const chosenState = state.me.ou.level === 2 ? state.me.ou.id : topIds.slice(1).includes(pref('pstate')) ? pref('pstate') : '';
  if (byUnit && chosenState) {
    const lgas = await lgasOf(chosenState);
    ouOptions = [...ouOptions, ...lgas.map((l) => ({ id: l.id, name: `   ${l.name} — units` }))];
  }
  if (ouOptions.length) ou = ouOptions.some((x) => x.id === pref('pou')) ? pref('pou') : ouOptions[0].id;
  const p = await get('/api/picture' + qs({ dataset: ds.id, ou, period, provisional: provisional ? 1 : '', sector }));
  const sectors = m.sectors.filter((s) => s.indicators);
  const unitLabel = p.ou.level === 1 ? 'State' : p.ou.level === 3 ? 'Unit' : 'LGA';
  const coverage = (r, isTotal) => (byUnit
    ? (p.ou.level === 3 && !isTotal ? (r.reported ? 'Yes' : 'No') : `${r.unitsReporting} of ${r.expectedUnits} units`)
    : (p.ou.level === 1 || isTotal ? `${r.reportingUnits} of ${r.totalUnits}` : r.reported ? 'Yes' : 'No'));
  const percentCell = (c) => (c ? fmtNum(c.value, 2) : '—');
  const row = (r, cls) => h('tr', { class: cls },
    h('td', {}, r.name),
    h('td', { class: 'n' }, coverage(r, !!cls)),
    h('td', { class: 'n' }, r.reportingRate === null ? '—' : fmtNum(r.reportingRate, 1) + '%'),
    p.indicators.map((i) => h('td', { class: 'n', title: r.indicators[i.id] ? `${fmtNum(r.indicators[i.id].numerator, 2)} / ${fmtNum(r.indicators[i.id].denominator, 2)}` : '' }, percentCell(r.indicators[i.id]))));
  const fieldRow = (r, cls) => h('tr', { class: cls }, h('td', {}, r.name), p.fields.map((f) => h('td', { class: 'n' }, fmtNum(r.values[f.id], 2))));

  mount(h('div', {},
    pageHead({
      title: `Results table — ${p.ou.name}, ${p.periodName}`,
      sub: `${p.dataset.name} · ${byUnit ? `${p.total.unitsReporting} of ${p.total.expectedUnits} schools / facilities reporting` : `${p.total.reportingUnits} of ${p.total.totalUnits} LGAs reporting`} · ${provisional ? 'includes reports not yet accepted' : 'accepted reports only'}`,
      text: 'The indicators of one form for one period. The first row is the total for the whole area; then one row per place.',
      how: [
        'Choose the form, the area and the period.',
        'Totals add up the numbers of the places that reported, then recalculate each rate. They never average percentages.',
        'Point at a value to see the two numbers it is calculated from.',
        'Only accepted reports count, unless you tick “Include reports not yet accepted”.',
      ],
      actions: [h('button', { onclick: () => window.print() }, 'Print')],
    }),
    h('div', { class: 'bar' },
      field('Report (form)', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderPicture(); } })),
      ouOptions.length > 1 ? field('Area', select(ouOptions, ou, { onchange: (e) => {
        const v = e.target.value; pref('pou', v);
        if (topIds.includes(v)) pref('pstate', v === topIds[0] && state.me.ou.level === 1 ? '' : v);
        renderPicture();
      } })) : null,
      field('Period', select(choices, period, { onchange: (e) => { pref('ppe:' + ds.id, e.target.value); renderPicture(); } })),
      field('Sector', select([{ id: '', name: 'All sectors' }, ...sectors], sector, { onchange: (e) => { pref('sector', e.target.value); renderPicture(); } })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: provisional, onchange: (e) => { pref('prov', e.target.checked); renderPicture(); } }), 'Include reports not yet accepted')),
    p.indicators.length ? null : h('div', { class: 'note info' }, 'No indicators for this selection.'),
    h('h2', {}, 'Indicators'),
    h('p', { class: 'muted small' }, byUnit ? 'Each LGA adds up the numbers of its units that reported; totals then recompute each rate. The reporting rate counts units. Hover a value to see its numerator / denominator.' : 'Totals add up the numerators and denominators of the LGAs that reported, then recompute each rate. Hover a value to see its numerator / denominator.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, unitLabel), h('th', { class: 'n' }, byUnit && p.ou.level !== 3 ? 'Units reporting' : p.ou.level === 1 ? 'LGAs reporting' : 'Reported'), h('th', { class: 'n' }, 'Reporting rate'),
        p.indicators.map((i) => h('th', { class: 'n', title: [i.numerator, i.denominator].filter(Boolean).join(' ÷ ') + (i.source ? ` — Source: ${i.source}` : '') }, i.name, i.percent ? ' (%)' : '', h('div', { class: 'cov' }, i.sector))))),
      h('tbody', {}, row(p.total, 'total'), p.rows.map((r) => row(r))))),
    h('h2', {}, 'Reported numbers'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, unitLabel), p.fields.map((f) => h('th', { class: 'n' }, f.name)))),
      h('tbody', {}, fieldRow(p.total, 'total'), p.rows.map((r) => fieldRow(r))))),
  ));
}

// ---------- pivot table ----------
function periodList(type, count) {
  const now = new Date(Date.now() + 3600000); const y = now.getUTCFullYear(); const m = now.getUTCMonth() + 1;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const out = [];
  if (type === 'MONTH') for (let i = 1; i <= count; i++) { const d = new Date(Date.UTC(y, m - 1 - i, 1)); out.push({ id: `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`, name: `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}` }); }
  if (type === 'QUARTER') { let q = Math.ceil(m / 3) - 1; let qy = y; if (!q) { q = 4; qy--; } for (let i = 0; i < count; i++) { out.push({ id: `${qy}Q${q}`, name: `Q${q} ${qy}` }); if (!--q) { q = 4; qy--; } } }
  if (type === 'YEAR') for (let i = 1; i <= count; i++) out.push({ id: String(y - i), name: String(y - i) });
  return out; // newest first
}

const pivotCache = new Map();
async function renderPivot() {
  const m = await meta();
  const o = await orgs();
  const P = (k, d) => pref('pv.' + k) ?? d;
  const setP = (k, v) => { pref('pv.' + k, v); renderPivot(); };
  const ptype = P('ptype', 'YEAR');
  const plist = periodList(ptype, ptype === 'MONTH' ? 24 : ptype === 'QUARTER' ? 12 : 6);
  const from = plist.some((x) => x.id === P('from')) ? P('from') : plist[Math.min(ptype === 'MONTH' ? 2 : 0, plist.length - 1)].id;
  const to = plist.some((x) => x.id === P('to')) ? P('to') : plist[0].id;
  const periods = plist.filter((x) => x.id >= from && x.id <= to).reverse();
  // Areas: what the account covers, plus LGAs (to see units) when a state is chosen.
  let areas = [];
  if (state.me.ou.level === 1) areas = [{ id: o.country.id, name: `${o.country.name} — by state` }, ...o.states.map((s) => ({ id: s.id, name: `${s.name} — by LGA` }))];
  else if (state.me.ou.level === 2) areas = [{ id: state.me.ou.id, name: `${state.me.ou.name} — by LGA` }];
  else areas = [{ id: state.me.ou.id, name: `${state.me.ou.name} — by unit` }];
  const pstate = state.me.ou.level === 2 ? state.me.ou.id : areas.some((a) => a.id === P('pstate')) ? P('pstate') : '';
  if (pstate && state.me.ou.level <= 2) areas = [...areas, ...(await lgasOf(pstate)).map((l) => ({ id: l.id, name: `   ${l.name} — by unit` }))];
  const area = areas.some((a) => a.id === P('area')) ? P('area') : areas[0].id;
  const sector = P('sector', '');
  const prov = !!P('prov', false);
  const rowsDim = P('rows', 'ou'); const colsDim = P('cols', 'dx') === rowsDim ? (rowsDim === 'dx' ? 'ou' : 'dx') : P('cols', 'dx');
  const filterDim = ['ou', 'dx', 'pe'].find((d) => d !== rowsDim && d !== colsDim);
  const shade = !!P('shade', true);
  const hideEmpty = !!P('hideEmpty', true);

  const status = h('p', { class: 'muted small' }, 'Loading…');
  const holder = h('div');
  const controls = h('div', {},
    h('div', { class: 'bar' },
      field('Sector', select([{ id: '', name: 'All sectors' }, ...m.sectors], sector, { onchange: (e) => setP('sector', e.target.value) })),
      field('Area', select(areas, area, { onchange: (e) => { const v = e.target.value; pref('pv.area', v); if (o.states.some((s) => s.id === v)) pref('pv.pstate', v); else if (v === o.country.id) pref('pv.pstate', ''); renderPivot(); } })),
      field('Periods', select([{ id: 'MONTH', name: 'Months' }, { id: 'QUARTER', name: 'Quarters' }, { id: 'YEAR', name: 'Years' }], ptype, { onchange: (e) => { pref('pv.from', null); pref('pv.to', null); setP('ptype', e.target.value); } })),
      field('From', select([...plist].reverse(), from, { onchange: (e) => setP('from', e.target.value) })),
      field('To', select([...plist].reverse(), to, { onchange: (e) => setP('to', e.target.value) }))),
    h('div', { class: 'bar' },
      field('Rows (down the side)', select([{ id: 'ou', name: 'Places' }, { id: 'dx', name: 'Indicators' }, { id: 'pe', name: 'Periods' }], rowsDim, { onchange: (e) => setP('rows', e.target.value) })),
      field('Columns (across the top)', select([{ id: 'ou', name: 'Places' }, { id: 'dx', name: 'Indicators' }, { id: 'pe', name: 'Periods' }].filter((x) => x.id !== rowsDim), colsDim, { onchange: (e) => setP('cols', e.target.value) })),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: shade, onchange: (e) => setP('shade', e.target.checked) }), 'Shade values'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: hideEmpty, onchange: (e) => setP('hideEmpty', e.target.checked) }), 'Hide empty rows/columns'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prov, onchange: (e) => setP('prov', e.target.checked) }), 'Include reports not yet accepted')));
  mount(h('div', {},
    pageHead({
      title: is(...ENTRY_ROLES) ? 'Results' : 'Pivot table',
      text: 'Compare indicators across places and periods — one sector, or all sectors together.',
      how: [
        'Choose the sector, the area and the periods (from – to).',
        'Choose what goes down the side (Rows) and across the top (Columns): places, indicators or periods. The third one becomes a choice above the table.',
        'Rates are recalculated from the added-up numbers, never averaged. Point at a value to see its two numbers.',
        'Download Excel saves the table as you see it.',
      ],
    }),
    controls, status, holder));

  // Fetch one period at a time (small requests), three in parallel.
  const all_ = { indicators: new Map(), ous: new Map(), cells: [], skipped: new Set() };
  let done = 0;
  const queue = [...periods];
  async function worker() {
    while (queue.length) {
      const pe = queue.shift();
      const key = JSON.stringify([pe.id, area, sector, prov]);
      let d = pivotCache.get(key);
      if (!d) { d = await get('/api/pivot' + qs({ period: pe.id, ou: area, sector, provisional: prov ? 1 : '' })); pivotCache.set(key, d); }
      for (const i of d.indicators) all_.indicators.set(i.id, i);
      for (const u of d.ous) if (!all_.ous.has(u.id)) all_.ous.set(u.id, u);
      all_.cells.push(...d.cells);
      d.skipped.forEach((x) => all_.skipped.add(x));
      status.textContent = `Loading… ${++done} of ${periods.length} periods`;
    }
  }
  try { await Promise.all([1, 2, 3].map(worker)); } catch (e) { status.textContent = ''; holder.replaceChildren(h('div', { class: 'note bad' }, e.message)); return; }

  const dims = {
    ou: [...all_.ous.values()].sort((a, b) => (b.total ? 1 : 0) - (a.total ? 1 : 0) || a.name.localeCompare(b.name)).map((u) => ({ id: u.id, name: u.name, total: u.total })),
    dx: [...all_.indicators.values()].map((i) => ({ id: i.id, name: i.name + (i.percent ? ' (%)' : ''), sub: [i.sector, i.reportingRate ? null : i.dataset].filter(Boolean).join(' · '), rr: i.reportingRate })),
    pe: periods.map((p) => ({ id: p.id, name: p.name })),
  };
  const filterVal = dims[filterDim].some((x) => x.id === P('f.' + filterDim)) ? P('f.' + filterDim) : (filterDim === 'pe' ? dims.pe[dims.pe.length - 1] || {} : dims[filterDim][0] || {}).id;
  const idx = new Map(all_.cells.map((c) => [`${c.dx}|${c.pe}|${c.ou}`, c]));
  const at = (r, c) => { const k = { [rowsDim]: r, [colsDim]: c, [filterDim]: filterVal }; return idx.get(`${k.dx}|${k.pe}|${k.ou}`); };
  let rowsList = dims[rowsDim]; let colsList = dims[colsDim];
  if (hideEmpty) {
    rowsList = rowsList.filter((r) => colsList.some((c) => at(r.id, c.id)));
    colsList = colsList.filter((c) => rowsList.some((r) => at(r.id, c.id)));
  }
  // Shading: per indicator (values on different scales), light green scale.
  const ranges = new Map();
  for (const c of all_.cells) { const r = ranges.get(c.dx) || [Infinity, -Infinity]; ranges.set(c.dx, [Math.min(r[0], c.v), Math.max(r[1], c.v)]); }
  const shadeOf = (c) => {
    if (!shade || !c) return null;
    const [lo, hi] = ranges.get(c.dx); if (hi <= lo) return null;
    const t = (c.v - lo) / (hi - lo);
    return `rgba(0, 112, 74, ${(0.06 + t * 0.34).toFixed(2)})`;
  };
  const label = (d) => h('div', {}, d.name, d.sub ? h('div', { class: 'cov' }, d.sub) : null);
  const table = h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, ''), colsList.map((c) => h('th', { class: 'n' }, label(c))))),
    h('tbody', {}, rowsList.map((r) => h('tr', { class: r.total ? 'total' : '' }, h('td', {}, label(r)), colsList.map((c) => {
      const v = at(r.id, c.id);
      const td = h('td', { class: 'n', title: v ? `${fmtNum(v.n, 2)} / ${fmtNum(v.d, 2)}` : '' }, v ? fmtNum(v.v, 2) : '—');
      const bg = shadeOf(v); if (bg && !r.total) td.style.background = bg;
      return td;
    })))));
  const filterNames = { ou: 'Place', dx: 'Indicator', pe: 'Period' };
  const xls = h('button', {}, 'Download Excel');
  xls.addEventListener('click', busy(xls, async () => {
    const { writeWorkbook } = await import('./xlsx.js');
    const fv = dims[filterDim].find((x) => x.id === filterVal);
    const sheet = [[`${filterNames[filterDim]}: ${fv ? fv.name : ''}`, ...colsList.map((c) => c.name)],
      ...rowsList.map((r) => [r.name, ...colsList.map((c) => { const v = at(r.id, c.id); return v ? v.v : ''; })])];
    saveBlob(writeWorkbook([{ name: 'Pivot', rows: sheet, widths: [36, ...colsList.map(() => 16)] }]), 'pivot_table.xlsx');
  }));
  status.textContent = all_.skipped.size ? `Not shown for these periods (different reporting frequency): ${[...all_.skipped].join(', ')}.` : '';
  holder.replaceChildren(
    h('div', { class: 'bar' }, dims[filterDim].length ? field(filterNames[filterDim], select(dims[filterDim].map((x) => ({ id: x.id, name: x.name })), filterVal, { onchange: (e) => setP('f.' + filterDim, e.target.value) })) : null, xls,
      h('span', { class: 'muted small' }, `${rowsList.length} rows × ${colsList.length} columns · ${prov ? 'includes reports not yet accepted' : 'accepted reports only'} · hover a value for numerator / denominator`)),
    rowsList.length && colsList.length ? h('div', { class: 'scroll' }, table) : h('div', { class: 'panel empty' }, 'No data for this selection.'));
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
  const lv = [1, 2, 3, 4].map((n) => h('input', { type: 'checkbox', value: n, checked: n < 4 }));
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
    pageHead({
      title: 'Export to scorecard',
      text: 'Download the two files the scorecard platform needs. They are in the same format as the ALMA Export app and keep the DHIS2 IDs.',
      how: [
        'Tick the forms to include and choose the area.',
        'Download the metadata file first (places and indicators). You only need it again when indicators or places change.',
        'Choose the periods and levels, then download the data values file.',
        'Upload both files to the scorecard platform. Only accepted reports are included unless you tick the box.',
      ],
    }),
    h('div', { class: 'panel' },
      h('h3', {}, 'Which forms and which area'),
      h('div', { class: 'chips' }, sets.map((d, i) => h('label', { class: 'check' }, dsChecks[i], dsLabel(d)))),
      h('div', { class: 'bar' }, field('Sector', sectorSel), field('Area', areaSel)),
      h('h3', {}, 'Step 1 · Places and indicators (metadata file)'),
      h('p', { class: 'muted small' }, 'organisationUnits_indicators.json — org units with their DHIS2 IDs, and the indicators (with a reporting-rate indicator per data set).'),
      h('label', { class: 'check' }, withUnits, 'Also include the schools / facilities below each LGA (for the chosen sector)'), h('p'),
      metaBtn,
      h('h3', {}, 'Step 2 · The numbers (data values file)'),
      h('div', { class: 'bar' }, field('Period type', typeSel), field('From', from), field('To', to),
        h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Levels:'), ['Country', 'State', 'LGA', 'Schools / facilities (one state)'].map((n, i) => h('label', { class: 'check' }, lv[i], n)))),
      h('label', { class: 'check' }, prov, 'Include reports not yet accepted'),
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
  return h('div', { class: 'panel' }, h('h2', {}, 'Automatic downloads (API tokens)'),
    h('p', { class: 'muted small' }, 'For automated downloads: send “Authorization: Bearer <token>” to /api/export/metadata or /api/export/data. Tokens can only read exports for their area.'),
    h('div', { class: 'bar' }, field('Name', name), field('Area', area), add), out,
    list.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Area'), h('th', {}, 'Created'), h('th', {}, 'Last used'), h('th'))),
      h('tbody', {}, list.map((t) => h('tr', {}, h('td', {}, t.name), h('td', {}, t.ou_name), h('td', {}, fmtDay(t.created_at)), h('td', {}, fmtDate(t.last_used_at)),
        h('td', {}, t.revoked_at ? h('span', { class: 'muted' }, 'Revoked') : h('button', { class: 'link', onclick: async () => { await api('DELETE', '/api/tokens/' + t.id); toast('Revoked'); renderExport(); } }, 'Revoke')))))) : null);
}

// ---------- indicator setup ----------
async function renderSetup(dsId) {
  const m = await meta(true);
  const ds = dsId && m.datasets.find((d) => d.id === dsId);
  if (ds && ds.shared) return go('#/population');
  return ds ? renderForm(ds, m) : renderSectors(m);
}

// The three steps of adding a sector, shown on the sectors page and on each form (with the current one marked).
function sectorSteps(current, ds) {
  const steps = [
    ['Name the sector', 'Say how often it reports and who reports: each LGA, or each school / facility.'],
    ['Add its indicators', 'One row per indicator: what is counted (numerator) and, for a rate, what it is divided by (denominator). These become the boxes on the form.'],
    ['Give people access', 'On Users, create accounts or a registration QR code for this sector. Its people then see the form under “My reports”.'],
  ];
  return h('ol', { class: 'flow' }, steps.map(([t, d], i) => h('li', { class: i + 1 < current ? 'done' : i + 1 === current ? 'now' : '' },
    h('span', { class: 'flownum' }, i + 1 < current ? '✓' : String(i + 1)),
    h('div', {}, h('strong', {}, t), h('div', { class: 'small muted' }, d),
      i === 2 && current >= 2 && ds ? h('a', { class: 'btn small-btn', href: '#/accounts' }, 'Go to Users →') : null))));
}

// Overview: one card per sector with its reporting forms.
function renderSectors(m) {
  const admin = is('sysadmin');
  const shared = m.datasets.find((d) => d.shared && !d.archived);
  const forms = m.datasets.filter((d) => !d.shared);
  const freqHow = (d) => `${d.frequencyName} · ${d.reportLevel === 'UNIT' ? 'each school / facility reports' : 'each LGA reports'} · due on day ${d.dueDay} of the next month`;
  const formRow = (d) => h('tr', { class: 'click' + (d.archived ? ' archived' : ''), onclick: () => go('#/setup/' + d.id) },
    h('td', {}, h('strong', {}, d.name), d.archived ? h('span', { class: 'muted small' }, ' (archived)') : null, h('div', { class: 'muted small' }, freqHow(d))),
    h('td', { class: 'n small' }, `${d.indicators.filter((i) => !i.archived).length} indicators`, h('div', { class: 'muted' }, `${d.dataElements.filter((f) => !f.archived).length} numbers to type in`)),
    h('td', { class: 'n' }, h('button', {}, 'Open')));
  const sectorIds = [...new Set([...m.sectors.map((s) => s.id), ...forms.map((d) => d.sectorId)])];
  const cards = sectorIds.map((sid) => {
    const known = m.sectors.find((s) => s.id === sid);
    const mine = forms.filter((d) => d.sectorId === sid).sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.name.localeCompare(b.name));
    if (!known) {
      // Forms whose sector is missing: say so and offer the two ways out. Archived ones are not shown.
      const open = mine.filter((d) => !d.archived);
      if (!open.length) return null;
      return h('div', { class: 'panel sector-card' },
        h('div', { class: 'rc-head' }, h('h2', {}, 'Forms without a sector')),
        h('div', { class: 'note warn' }, 'These forms belong to no sector. Open one and use Form settings to choose its sector — or, if it was only a test, Delete form (possible while nothing was reported on it; otherwise Archive form).'),
        h('table', { class: 'todo' }, h('tbody', {}, open.map((d) => h('tr', {},
          h('td', {}, h('strong', {}, d.name), h('div', { class: 'muted small' }, freqHow(d))),
          h('td', { class: 'n small' }, `${d.indicators.filter((i) => !i.archived).length} indicators`),
          h('td', { class: 'n' }, h('div', { class: 'actions' }, h('button', { onclick: () => go('#/setup/' + d.id) }, 'Open'), admin ? h('button', { onclick: () => datasetDialog(d, m) }, 'Form settings') : null)))))));
    }
    const sec = known;
    const unused = !mine.length && !sec.indicators;
    return h('div', { class: 'panel sector-card' },
      h('div', { class: 'rc-head' }, h('h2', {}, sec.name),
        h('div', { class: 'actions' },
          admin && sec.id ? h('button', { class: 'link', onclick: () => renameSector(sec) }, 'Rename sector') : null,
          admin && sec.id && unused ? h('button', { class: 'link danger-link', onclick: () => removeSector(sec) }, 'Remove sector') : null)),
      mine.length ? h('table', { class: 'todo' }, h('tbody', {}, mine.map(formRow)))
        : unused ? h('div', { class: 'note info' }, `${sec.name} has no reporting form yet, so nobody can report for it. Add one below, then add its indicators.`)
          : h('p', { class: 'muted small' }, 'This sector has indicators on other sectors’ forms but no form of its own.'),
      admin ? h('div', { class: 'actions' }, h('button', { class: 'link', onclick: () => datasetDialog(null, m, false, sec.name) }, `+ Add ${mine.length ? 'another' : 'a'} form to ${sec.name}`)) : null);
  }).filter(Boolean);

  mount(h('div', {},
    pageHead({
      title: 'Sectors & indicators',
      text: 'Each sector (Health, Education, Agriculture, WASH …) has its own reporting form. A form is a list of indicators; the boxes people fill in come from each indicator’s numerator and denominator.',
      actions: admin ? [h('button', { class: 'primary big', onclick: () => sectorDialog(m) }, '+ Add a sector')] : null,
    }),
    h('div', { class: 'panel guide' }, h('h2', {}, 'Adding a sector takes three steps'), sectorSteps(admin ? 1 : 0),
      admin ? h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => sectorDialog(m) }, 'Start: + Add a sector')) : h('p', { class: 'muted small' }, 'Only system administrators can add a sector. You can add and change indicators on the forms of your sectors.')),
    !shared ? h('div', { class: 'note info' }, 'Tip: indicators that divide by population (e.g. “Expected pregnancies”) need the ', h('a', { href: '#/population' }, 'Population figures'), ' set up first.') : null,
    h('h2', {}, cards.length ? `Your sectors (${cards.length})` : ''),
    cards.length ? cards : h('div', { class: 'panel empty' },
      h('h2', {}, 'No sectors yet'),
      h('p', {}, 'Start with one, for example Health with a monthly form reported by each LGA.')),
  ));
}

// Population figures: their own page under Set-up.
async function renderPopulation() {
  const m = await meta(true);
  const ds = m.datasets.find((d) => d.shared && !d.archived);
  const admin = is('sysadmin');
  const head = pageHead({
    title: 'Population figures',
    text: 'Yearly numbers for every LGA that indicators of any sector can divide by — total population, children under 5, expected pregnancies, school-age children … They are usually imported from the official projections (NPC), not typed in by LGAs.',
    how: [
      'Add each number you need (e.g. “Expected pregnancies”) with “Add number”.',
      'Fill in the figures for each LGA: press “Load from WorldPop” for the GRID3 / WorldPop modelled estimates (choose which column fills which number), or download the Excel template and import official figures (e.g. NPC).',
      'When WorldPop publishes a new version, this page says so (it checks once a day, or press “Check for a new version”). Load it to refresh the figures.',
      'On a form, type the same name as an indicator’s denominator. Monthly indicators automatically use one twelfth of a yearly flow.',
    ],
    actions: ds ? [h('button', { onclick: () => datasetDialog(ds, m) }, 'Settings')] : null,
  });
  if (!ds) {
    return mount(h('div', {}, head, h('div', { class: 'panel empty' }, h('h2', {}, 'Not created yet'),
      h('p', {}, 'Create the list once; then add the numbers and import the figures.'),
      admin ? h('button', { class: 'primary', onclick: () => datasetDialog(null, m, true) }, 'Create population figures') : h('p', { class: 'muted' }, 'Ask a system administrator to create it.'))));
  }
  mount(h('div', {}, head, sharedPanel(ds)));
}

async function removeSector(sec) {
  if (!confirm(`Remove the sector “${sec.name}”? It has no forms or indicators, so nothing is lost.`)) return;
  try { await api('DELETE', '/api/sectors/' + sec.id); toast('Sector removed'); state.meta = null; route(); } catch (e) { toast(e.message, true); }
}

async function renameSector(sec) {
  const name = prompt(`New name for the sector “${sec.name}”:`, sec.name);
  if (!name || name.trim() === sec.name) return;
  try { await api('PATCH', '/api/sectors/' + sec.id, { name: name.trim() }); toast('Sector renamed'); state.meta = null; route(); } catch (e) { toast(e.message, true); }
}

// One form: its indicators (editable grid) and the numbers people type in.
function renderForm(ds, m) {
  const sectorList = h('datalist', { id: 'sector-list' }, m.sectors.map((s) => h('option', { value: s.name })));
  const sharedFields = m.datasets.filter((d) => d.shared && !d.archived).flatMap((d) => d.dataElements.filter((f) => !f.archived));
  const fieldList = h('datalist', { id: 'field-list' },
    ds.dataElements.filter((d) => !d.archived).map((d) => h('option', { value: d.name })),
    ds.shared ? [] : sharedFields.map((f) => h('option', { value: f.name, label: 'Population figure (shared)' })));
  const head = pageHead({
    back: ['#/setup', 'All sectors'],
    title: ds.shared ? 'Population figures' : dsLabel({ ...ds, reportLevel: 'LGA' }).replace(' — ', ': '),
    sub: ds.shared ? 'Shared by all sectors · entered once a year per LGA'
      : `${ds.sector || 'No sector'} · ${ds.frequencyName} · ${ds.reportLevel === 'UNIT' ? 'each school / facility reports (added up to the LGA)' : 'each LGA reports'} · due on day ${ds.dueDay} of the next month${ds.archived ? ' · ARCHIVED' : ''}`,
    text: ds.shared ? 'Add each yearly number here. Then import the official figures for every LGA from Excel.'
      : 'Add one row per indicator, then press Add. The numerator and denominator become the boxes people fill in on this form.',
    how: ds.shared ? null : [
      'Indicator: the name people will see, e.g. “ANC 4+ coverage”.',
      'Numerator: what is counted, e.g. “Women with 4+ ANC visits”. This becomes a box on the form.',
      'Denominator (optional): what it is divided by. Leave it empty for a plain count. If it is a population figure (e.g. “Expected pregnancies”), pick it from the list — it is then taken from the yearly figures instead of being asked each time.',
      'Typing the same name twice uses the same box. Show as: percentage, per 1,000, or number.',
      'IDs are made automatically. Paste an existing DHIS2 ID only if the indicator already exists in DHIS2.',
    ],
    actions: [h('button', { onclick: () => datasetDialog(ds, m) }, 'Form settings (name, how often, who reports)')],
  });

  const rows = ds.indicators.filter((i) => !i.archived);
  const bySector = new Map();
  for (const i of rows) { const k = i.sector || 'Other'; if (!bySector.has(k)) bySector.set(k, []); bySector.get(k).push(i); }
  const body = [];
  for (const [sector, list] of [...bySector.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (bySector.size > 1) body.push(h('tr', { class: 'sector' }, h('td', { colspan: 7 }, sector)));
    for (const i of list) body.push(indicatorRow(ds, i, m));
  }
  body.push(h('tr', { class: 'sector newrow' }, h('td', { colspan: 7 }, 'Add a new indicator')));
  body.push(indicatorRow(ds, null, m));

  mount(h('div', {}, head, sectorList, fieldList,
    h('div', { class: 'panel guide' }, sectorSteps(rows.length ? 3 : 2, ds)),
    rows.length ? null : h('div', { class: 'note info' }, 'This form has no indicators yet. Fill in the row marked “Add a new indicator” and press Add.'),
    h('div', { class: 'scroll' }, h('table', { class: 'setup' },
      h('colgroup', {}, ['sector', 'name', 'num', 'den', 'src', 'show', 'id'].map((c) => h('col', { class: 'c-' + c }))),
      h('thead', {}, h('tr', {}, h('th', {}, 'Sector'), h('th', {}, 'Indicator'), h('th', {}, 'Numerator (counted)'), h('th', {}, 'Denominator (optional)'), h('th', {}, 'Source'), h('th', {}, 'Show as'), h('th', {}, 'ID'))),
      h('tbody', {}, body))),
    fieldsPanel(ds)));
}

// A real dropdown of the sectors (the value is the sector name, as the API expects).
// An empty or unknown current value shows “Choose a sector”, never a blank box.
function sectorSelect(m, current, attrs = {}) {
  const names = m.sectors.map((x) => x.name);
  const opts = [...(current && names.includes(current) ? [] : [{ id: '', name: current ? `${current} (not a sector any more)` : 'Choose a sector' }]), ...names.map((n) => ({ id: n, name: n }))];
  return select(opts, current && names.includes(current) ? current : '', attrs);
}

// A new sector is created together with its first reporting form.
function sectorDialog(m) {
  const forms = m.datasets.filter((d) => !d.shared);
  const sector = h('input', { placeholder: 'e.g. Agriculture' });
  const freq = select(m.frequencies, 'MONTHLY');
  const level = select([{ id: 'LGA', name: 'Each LGA' }, { id: 'UNIT', name: 'Each school / facility (added up to the LGA)' }], 'LGA');
  const due = h('input', { type: 'number', min: 1, max: 28, value: 15 });
  const name = h('input', { placeholder: 'e.g. Agriculture – monthly' });
  let typed = false;
  name.addEventListener('input', () => { typed = true; });
  const suggest = () => { if (!typed) name.value = sector.value.trim() ? `${sector.value.trim()} – ${freq.options[freq.selectedIndex].text.toLowerCase()}` : ''; };
  sector.addEventListener('input', suggest); freq.addEventListener('change', suggest);
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Create sector and open its form');
  const dlg = h('dialog', {}, h('div', { class: 'area area-admin area-setup' }, 'Step 1 of 3'), h('h2', {}, 'Add a sector'),
    h('p', { class: 'muted small' }, 'A sector is a ministry or department that reports on its own form, e.g. Health, Education, Agriculture, WASH, Social Protection. You will add the indicators on the next screen.'),
    h('div', { class: 'grid2' },
      field('Sector name', sector, 'As people will see it.'),
      field('How often it reports', freq, 'Each report covers one month, quarter or year.'),
      field('Who reports', level, 'Each LGA sends one report — or each school / facility sends its own.'),
      field('Due day', due, 'Day of the month after the period ends, e.g. 15.'),
      field('Form name', name, 'Filled in for you; change it if you like.')),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    if (!sector.value.trim()) { err.textContent = 'Give the sector a name.'; return; }
    const existing = m.sectors.find((s) => s.name.toLowerCase() === sector.value.trim().toLowerCase());
    if (existing && forms.some((d) => d.sectorId === existing.id)) { err.textContent = `“${existing.name}” already exists. Use “+ Add another form to ${existing.name}” on its card instead.`; return; }
    try {
      const { data } = await api('POST', '/api/datasets', { name: name.value.trim() || sector.value.trim(), sector: sector.value.trim(), frequency: freq.value, reportLevel: level.value, dueDay: Number(due.value) });
      dlg.close(); state.meta = null; await loadMe(); toast(`Sector “${sector.value.trim()}” added. Now add its indicators.`); go('#/setup/' + data.id);
    } catch (e) { err.textContent = e.message; }
  }));
  document.body.append(dlg); dlg.showModal(); sector.focus();
}

function indicatorRow(ds, i, m) {
  const isNew = !i;
  const sector = sectorSelect(m, i ? i.sector : ds.sector);
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
    state.meta = null; route();
  }));
  if (del) del.addEventListener('click', busy(del, async () => {
    if (!confirm(`Remove “${i.name}”? Values already reported are kept.`)) return;
    await api('DELETE', '/api/indicators/' + i.id); toast('Removed'); state.meta = null; route();
  }));
  return h('tr', {}, h('td', {}, sector), h('td', {}, name), h('td', {}, num), h('td', {}, den), h('td', {}, source), h('td', {}, showAs),
    h('td', {}, isNew ? id : idTag(i.id), h('div', { class: 'actions' }, btn, del)));
}

function fieldsPanel(ds) {
  const list = ds.dataElements.filter((d) => !d.archived);
  if (!list.length) return null;
  return h('details', { class: 'panel' }, h('summary', {}, `Boxes on the form — the numbers people type in (${list.length})`),
    h('p', { class: 'muted small' }, 'Made from the numerators and denominators above. Rename one here to fix a typo everywhere; numbers already reported are kept. “Whole numbers” refuses decimals; “Max” refuses anything larger.'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Whole numbers'), h('th', {}, 'Max'), h('th', {}, 'ID'), h('th'))),
      h('tbody', {}, list.map((d) => {
        const name = h('input', { value: d.name, size: 40 });
        const whole = h('input', { type: 'checkbox', checked: d.valueType === 'INTEGER' });
        const max = h('input', { type: 'number', value: d.max ?? '', placeholder: 'none', size: 8 });
        const b = h('button', {}, 'Save');
        b.addEventListener('click', busy(b, async () => {
          await api('PATCH', '/api/fields/' + d.id, { name: name.value.trim(), valueType: whole.checked ? 'INTEGER' : 'NUMBER', max: max.value === '' ? null : Number(max.value) });
          toast('Saved'); state.meta = null; route();
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
    toast('Added'); state.meta = null; route();
  }));
  return h('div', {},
    h('h2', {}, '1 · The numbers'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Number (entered once a year per LGA)'), h('th', {}, 'For monthly or quarterly indicators'), h('th', {}, 'ID'), h('th'))),
      h('tbody', {}, list.map((d) => {
        const n = h('input', { value: d.name, size: 36 });
        const sel = select([{ id: '1', name: 'Split by months (÷12 per month)' }, { id: '0', name: 'Use the yearly figure as is' }], d.prorate ? '1' : '0');
        const b = h('button', {}, 'Save');
        b.addEventListener('click', busy(b, async () => { await api('PATCH', '/api/fields/' + d.id, { name: n.value.trim(), prorate: sel.value === '1' }); toast('Saved'); state.meta = null; route(); }));
        return h('tr', {}, h('td', {}, n), h('td', {}, sel), h('td', {}, idTag(d.id)), h('td', {}, b));
      }), h('tr', {}, h('td', {}, name), h('td', {}, h('label', { class: 'check' }, split, 'Split by months')), h('td'), h('td', {}, add))))),
    h('p', { class: 'muted small' }, '“Split by months” suits yearly flows such as expected pregnancies or births: a monthly indicator divides by one twelfth. “As is” suits counts such as households, schools or total population. Each LGA can also type these in once a year under My reports.'),
    list.length ? h('h2', {}, '2 · The figures for each LGA') : null,
    list.length ? h('p', { class: 'muted small' }, 'Two ways to fill them: the GRID3 / WorldPop modelled estimates, downloaded for you, or official figures (e.g. NPC projections) from Excel. Each import only fills the numbers you choose for the year you choose.') : null,
    list.length ? worldpopPanel(ds, list) : null,
    list.length ? populationImportPanel(ds, list) : h('div', { class: 'note info' }, 'Add at least one number above; then you can import the figures for each LGA.'));
}

// ---------- GRID3 / WorldPop modelled population estimates ----------
function worldpopPanel(ds, fields) {
  const box = h('div', { class: 'panel' }, h('h3', {}, 'GRID3 / WorldPop modelled estimates'), h('p', { class: 'muted small' }, 'Loading…'));
  const fileIn = h('input', { type: 'file', accept: '.zip,.csv', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (!f) return;
    try {
      let csv; let name = f.name;
      if (/\.zip$/i.test(f.name)) {
        const { unzip } = await import('./unzip.js');
        const files = (await unzip(await f.arrayBuffer())).filter((x) => /\.csv$/i.test(x.name));
        const pick = files.find((x) => /lga/i.test(x.name.split('/').pop())) || files[0];
        if (!pick) throw new Error('No CSV table inside this ZIP file.');
        csv = await pick.text(); name = `${f.name} → ${pick.name}`;
      } else csv = await f.text();
      const m = /v(\d+)[_.](\d+)/i.exec(f.name);
      const { data } = await api('POST', '/api/worldpop/table', { name, csv, version: m ? `${m[1]}.${m[2]}` : undefined });
      worldpopDialog(ds, fields, data, paint);
    } catch (e) { toast(e.message, true); }
  });
  async function paint(check) {
    let st; let ok = true;
    try { st = await get('/api/worldpop' + (check ? '?check=1' : '')); } catch (e) {
      ok = false; if (check) toast(e.message, true);
      st = await get('/api/worldpop').catch(() => ({}));
    }
    const latest = st.check && st.check.latest;
    const want = latest || (st.imported && st.imported.version) || '3.0';
    const load = h('button', { class: 'primary' }, `Load v${want} from WorldPop`);
    load.addEventListener('click', busy(load, async () => worldpopDialog(ds, fields, await get('/api/worldpop/table?version=' + want), () => paint())));
    const checkBtn = h('button', {}, 'Check for a new version');
    checkBtn.addEventListener('click', busy(checkBtn, async () => {
      if (await paint(true)) { const s2 = await get('/api/worldpop'); toast(s2.newerAvailable ? `New version on WorldPop: v${s2.check.latest}` : `Checked WorldPop: v${s2.check.latest} is the latest`); }
    }));
    box.replaceChildren(
      h('h3', {}, 'GRID3 / WorldPop modelled estimates'),
      h('p', { class: 'muted small' }, 'Population for every LGA modelled by WorldPop (University of Southampton) for GRID3, e.g. “NGA population v3.0” = 2025 estimates. The system downloads the LGA table, matches each LGA by name, and you choose which column fills which number.'),
      st.imported ? h('div', { class: 'note ok' }, h('strong', {}, `In use: v${st.imported.version}`), ` — saved as the ${st.imported.year} figures by ${st.imported.by}, ${fmtDate(st.imported.at)}.`)
        : h('div', { class: 'note info' }, 'Not imported yet.'),
      st.newerAvailable && st.imported ? h('div', { class: 'note warn' }, h('strong', {}, `A newer version is available: v${latest}. `), 'Load it below to refresh the figures.') : null,
      h('p', { class: 'muted small' }, latest ? `Latest on WorldPop: v${latest} · checked ${fmtDate(st.check.checkedAt)} (the system also checks once a day).` : 'Not checked yet.'),
      h('div', { class: 'actions' }, load, checkBtn, h('button', { onclick: () => fileIn.click() }, 'Upload the table instead (.zip or .csv)'), fileIn,
        h('a', { href: st.source || 'https://data.worldpop.org/repo/wopr/NGA/population/', target: '_blank', rel: 'noopener', class: 'small' }, 'WorldPop release files ↗')));
    return ok;
  }
  paint();
  return box;
}

// Which column of the WorldPop table suits each population number (by name).
function suggestColumn(fieldName, cols) {
  const n = fieldName.toLowerCase();
  const pick = (re) => cols.find((c) => re.test(c.toLowerCase()));
  if (/under.?1\b|infant|under one/.test(n)) return pick(/under_?1$|^u1$/);
  if (/under.?5|u5|under five/.test(n)) return pick(/under_?5|^u5/);
  if (/under.?15/.test(n)) return pick(/under_?15/);
  if (/15.?49|women|childbearing|wcba/.test(n)) return pick(/f_?15_?49|wcba/);
  if (/total|population|^pop/.test(n)) return pick(/total|^pop|population|mean|scaled|sum/) || (cols.length === 1 ? cols[0] : undefined);
  return undefined;
}

function worldpopDialog(ds, fields, t, after) {
  const cols = t.columns.numeric;
  const thisYear = new Date().getFullYear();
  const ref = t.referenceYear || thisYear;
  const version = h('input', { value: t.version || '', placeholder: 'e.g. 3.0', size: 6 });
  const years = [];
  for (let y = Math.min(ref, thisYear) - 1; y <= thisYear + 2; y++) years.push({ id: String(y), name: String(y) + (y === ref ? ' (year of the estimates)' : '') });
  const yearSel = select(years, String(ref));
  const growth = h('input', { type: 'number', step: '0.1', min: 0, max: 10, placeholder: 'none', size: 6 });
  const maps = fields.map((f) => {
    const col = select([{ id: '', name: '— don’t fill —' }, ...cols.map((c) => ({ id: c, name: c }))], suggestColumn(f.name, cols) || '');
    const factor = h('input', { type: 'number', step: 'any', min: 0, value: 1, size: 7 });
    const ex = h('td', { class: 'n small' });
    return { f, col, factor, ex };
  });
  const sample = t.rows[0];
  const mult = () => {
    const g = Number(growth.value) || 0; const dy = Number(yearSel.value) - ref;
    return g ? Math.pow(1 + g / 100, dy) : 1;
  };
  const valueOf = (m, r) => { const v = r.values[m.col.value]; return m.col.value && Number.isFinite(v) ? Math.round(v * (Number(m.factor.value) || 0) * mult()) : null; };
  const refresh = () => { for (const m of maps) m.ex.textContent = sample && m.col.value ? fmtNum(valueOf(m, sample)) : '—'; };
  for (const m of maps) { m.col.addEventListener('change', refresh); m.factor.addEventListener('input', refresh); }
  yearSel.addEventListener('change', refresh); growth.addEventListener('input', refresh);
  refresh();
  const fuzzy = t.rows.filter((r) => r.fuzzy);
  const err = h('div', { class: 'err' }); const progress = h('span', { class: 'muted small' });
  const save = h('button', { class: 'primary', disabled: !t.rows.length }, `Save figures for ${t.rows.length} LGAs`);
  const list = (title, items, fmt) => (items.length ? h('details', {}, h('summary', { class: 'small' }, `${title} (${items.length})`), h('ul', { class: 'small' }, items.slice(0, 300).map((x) => h('li', {}, fmt(x))))) : null);
  const dlg = h('dialog', { class: 'wide' }, h('h2', {}, `WorldPop population${t.version ? ' v' + t.version : ''} — check and choose`),
    h('p', { class: 'muted small' }, t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener' }, t.file) : t.file, ` · ${t.fileRows} rows in the file · columns: ${[t.columns.state, t.columns.lga, ...cols].filter(Boolean).join(', ')}`),
    h('div', { class: 'counts' },
      h('span', { class: 'pill s-accepted' }, `Matched: ${t.rows.length} of ${t.lgasInUse} LGAs in the states in use`),
      fuzzy.length ? h('span', { class: 'pill s-draft' }, `Matched by a close spelling: ${fuzzy.length}`) : null,
      t.unmatched.length ? h('span', { class: 'pill s-returned' }, `Not matched: ${t.unmatched.length}`) : null,
      t.otherStates ? h('span', { class: 'pill s-none' }, `Rows for states not in use: ${t.otherStates}`) : null),
    list('Close spellings — please check', fuzzy, (r) => `${r.fileName} → ${r.lgaName} (${r.state})`),
    list('Rows not matched to an LGA (skipped)', t.unmatched, (r) => `${r.lga}${r.state ? ', ' + r.state : ''}${r.note ? ' — ' + r.note : ''}`),
    list('Our LGAs with no row in the file (keep their current figures)', t.missing, (r) => `${r.name} (${r.state})`),
    h('h3', {}, 'Which column fills which number'),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Our number'), h('th', {}, 'Column in the file'), h('th', {}, '× factor'), h('th', { class: 'n' }, sample ? `Example: ${sample.lgaName}` : 'Example'))),
      h('tbody', {}, maps.map((m) => h('tr', {}, h('td', {}, m.f.name), h('td', {}, m.col), h('td', {}, m.factor), m.ex)))),
    h('p', { class: 'muted small' }, 'Factor: use it to derive a number from a column, e.g. expected pregnancies = total population × the share your programme uses. Leave 1 to copy the column as it is.'),
    h('div', { class: 'grid2' },
      field('Save as the figures for', yearSel),
      field('Growth per year, % (optional)', growth, `Projects from ${ref} to a later year, e.g. 2.5. Empty = use the estimates as they are.`),
      t.version ? null : field('WorldPop version', version, 'As in the file name, e.g. 3.0.')),
    err, h('p'), h('div', { class: 'actions' }, save, progress, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const used = maps.filter((m) => m.col.value);
    if (!used.length) { err.textContent = 'Choose a column for at least one number.'; return; }
    const ver = t.version || version.value.trim();
    if (!/^\d+(\.\d+)+$/.test(ver)) { err.textContent = 'Say which WorldPop version this is (e.g. 3.0).'; return; }
    const year = yearSel.value;
    const notes = [Number(growth.value) && Number(year) !== ref ? `projected from ${ref} at ${growth.value}%/yr` : null,
      ...used.filter((m) => Number(m.factor.value) !== 1).map((m) => `${m.f.name} = ${m.col.value} × ${m.factor.value}`)].filter(Boolean);
    const source = `GRID3/WorldPop NGA population v${ver} (${t.referenceYear || 'modelled'} estimates)${notes.length ? '; ' + notes.join('; ') : ''}`.slice(0, 200);
    const rows = t.rows.map((r, i) => ({ row: i + 2, lgaId: r.lgaId, values: Object.fromEntries(used.map((m) => [m.f.id, valueOf(m, r)]).filter(([, v]) => v !== null)) }));
    const { data: check } = await api('POST', `/api/datasets/${ds.id}/population`, { year, rows });
    if (check.counts.error) { err.textContent = check.results.filter((r) => r.status === 'error').slice(0, 5).map((r) => `${r.lga}: ${r.message}`).join(' · '); return; }
    for (let i = 0; i < rows.length; i += 60) {
      progress.textContent = `Saving ${Math.min(i + 60, rows.length)} of ${rows.length}…`;
      await api('POST', `/api/datasets/${ds.id}/population`, { year, source, rows: rows.slice(i, i + 60), commit: true });
    }
    await api('POST', '/api/worldpop/imported', { version: ver, year, mapping: used.map((m) => ({ number: m.f.name, column: m.col.value, factor: Number(m.factor.value) })) });
    dlg.close(); toast(`Saved ${year} figures for ${rows.length} LGAs from WorldPop v${ver}`); pref('popYear', year); route();
  }));
  document.body.append(dlg); dlg.showModal();
}

// Official population figures (NPC / NBS …) for every LGA from one Excel sheet.
function populationImportPanel(ds, fields) {
  const y = new Date().getFullYear();
  const years = [y + 1, y, y - 1, y - 2, y - 3, y - 4].map((x) => ({ id: String(x), name: String(x) }));
  const yearSel = select(years, pref('popYear') || String(y), { onchange: () => { pref('popYear', yearSel.value); showSource(); } });
  const info = h('div', { class: 'muted small' });
  const showSource = async () => {
    info.textContent = '';
    try {
      const t = await get(`/api/datasets/${ds.id}/population?year=${yearSel.value}`);
      const filled = t.lgas.filter((l) => Object.values(l.values).some((v) => v !== null)).length;
      info.textContent = t.source ? `${yearSel.value}: ${filled} of ${t.lgas.length} LGAs have figures · last import “${t.source.source}” by ${t.source.by}, ${fmtDate(t.source.at)}` : `${yearSel.value}: ${filled} of ${t.lgas.length} LGAs have figures.`;
    } catch {}
  };
  showSource();
  const tpl = h('button', {}, 'Download template');
  tpl.addEventListener('click', busy(tpl, async () => {
    const t = await get(`/api/datasets/${ds.id}/population?year=${yearSel.value}`);
    const { writeWorkbook } = await import('./xlsx.js');
    const head = ['State', 'LGA', 'LGA ID', ...t.fields.map((f) => f.name)];
    const rows = t.lgas.map((l) => [l.state, l.name, l.id, ...t.fields.map((f) => l.values[f.id] ?? '')]);
    saveBlob(writeWorkbook([
      { name: `Population ${t.year}`, rows: [head, ...rows], widths: [20, 28, 14, ...t.fields.map(() => 22)] },
      { name: 'How to fill', rows: [['How to fill'], ...[
        `One row per LGA for the year ${t.year}. Fill in the official figures (e.g. from the National Population Commission projections).`,
        'Keep the State, LGA and LGA ID columns as they are — they link each row to the right LGA.',
        'Numbers only, without decimals or text (commas are fine). Leave a cell empty to keep what is already stored.',
        'You can delete rows you do not have figures for.',
        'Then use “Import Excel” on the Population & denominators page, choose the same year and say where the figures come from.',
      ].map((x) => [x])], widths: [110] },
    ]), `Population_${t.year}_template.xlsx`);
  }));
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (f) try { await populationImportDialog(ds, fields, f, yearSel.value, showSource); } catch (e) { toast(e.message, true); }
  });
  return h('div', { class: 'panel' }, h('h3', {}, 'Official figures from Excel (NPC projections or any other source)'),
    h('p', { class: 'muted small' }, 'Download the template (one row per LGA, one column per number, filled with what is already stored), add the official figures, then import it. Imported figures are saved as accepted for that year.'),
    h('div', { class: 'bar' }, field('Year', yearSel), tpl, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Import Excel'), fileIn), info);
}

async function populationImportDialog(ds, fields, file, year, after) {
  const { readSheet } = await import('./xlsx.js');
  const rows = await readSheet(file);
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hi = rows.findIndex((r) => r.some((c) => ['lgaid', 'lga'].includes(norm(c))));
  if (hi < 0) throw new Error('No “LGA” or “LGA ID” column found. Use the template (Download template).');
  const head = rows[hi].map(norm);
  const ci = { state: head.indexOf('state'), lga: head.indexOf('lga'), lgaId: head.indexOf('lgaid') };
  const cols = fields.map((f) => ({ f, i: head.indexOf(norm(f.name)) })).filter((x) => x.i >= 0);
  if (!cols.length) throw new Error('None of the columns match a number in this data set (e.g. “' + fields[0].name + '”). Use the template.');
  const missingCols = fields.filter((f) => !cols.some((c) => c.f.id === f.id)).map((f) => f.name);
  const data = rows.slice(hi + 1).map((r, i) => ({
    row: hi + i + 2,
    state: ci.state >= 0 ? String(r[ci.state] ?? '').trim() : '', lga: ci.lga >= 0 ? String(r[ci.lga] ?? '').trim() : '', lgaId: ci.lgaId >= 0 ? String(r[ci.lgaId] ?? '').trim() : '',
    values: Object.fromEntries(cols.map(({ f, i: c }) => [f.id, String(r[c] ?? '').trim()])),
  })).filter((r) => r.lga || r.lgaId);
  if (!data.length) throw new Error('The file has no LGA rows.');
  const { data: check } = await api('POST', `/api/datasets/${ds.id}/population`, { year, rows: data });
  const c = check.counts;
  const errors = check.results.filter((r) => r.status === 'error');
  const source = h('input', { placeholder: `e.g. NPC ${year} projections`, size: 40 });
  const go = h('button', { class: 'primary', disabled: !!c.error || !c.lgas }, `Save figures for ${c.lgas} LGA${c.lgas === 1 ? '' : 's'}`);
  const progress = h('span', { class: 'muted small' });
  const err = h('div', { class: 'err' });
  const dlg = h('dialog', {}, h('h2', {}, `Population figures ${year} — check`),
    h('p', { class: 'muted small' }, file.name, ` · ${data.length} LGA rows · columns: ${cols.map((x) => x.f.name).join(', ')}`),
    missingCols.length ? h('div', { class: 'note warn' }, `Not in the file (kept as they are): ${missingCols.join(', ')}.`) : null,
    h('div', { class: 'counts' }, h('span', { class: 'pill s-accepted' }, `LGAs with figures: ${c.lgas}`), h('span', { class: 'pill s-draft' }, `Values changing: ${c.changed}`), h('span', { class: 'pill s-returned' }, `Problems: ${c.error}`)),
    errors.length ? h('div', {}, h('div', { class: 'note bad' }, 'Fix these rows in the file and import again. Nothing has been saved.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'LGA'), h('th', {}, 'Problem'))),
        h('tbody', {}, errors.slice(0, 200).map((e) => h('tr', {}, h('td', {}, e.row), h('td', {}, e.lga), h('td', {}, e.message)))))))
      : h('div', {}, field('Source of these figures (required)', source)),
    err, h('p'), h('div', { class: 'actions' }, go, progress, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  go.addEventListener('click', busy(go, async () => {
    err.textContent = '';
    if (!source.value.trim()) { err.textContent = 'Say where the figures come from.'; return; }
    const ok = new Set(check.results.filter((r) => ['changed', 'same'].includes(r.status)).map((r) => r.row));
    const todo = data.filter((r) => ok.has(r.row));
    for (let i = 0; i < todo.length; i += 60) {
      progress.textContent = `Saving ${Math.min(i + 60, todo.length)} of ${todo.length}…`;
      await api('POST', `/api/datasets/${ds.id}/population`, { year, source: source.value.trim(), rows: todo.slice(i, i + 60), commit: true });
    }
    dlg.close(); toast(`Saved population figures for ${todo.length} LGAs`); after();
  }));
  document.body.append(dlg); dlg.showModal();
}

// Edit a form's settings, add another form to a sector, or create the population figures.
function datasetDialog(ds, m, makeShared = false, presetSector = '') {
  const shared = ds ? ds.shared : makeShared;
  const name = h('input', { value: ds ? ds.name : shared ? 'Population and denominators' : presetSector ? `${presetSector} – ` : '' });
  const sector = sectorSelect(m, ds ? ds.sector : presetSector, { disabled: !!presetSector });
  const freq = select(m.frequencies, ds ? ds.frequency : 'MONTHLY');
  const level = select([{ id: 'LGA', name: 'Each LGA' }, { id: 'UNIT', name: 'Each school / facility (added up to the LGA)' }], ds ? ds.reportLevel : 'LGA');
  const due = h('input', { type: 'number', min: 1, max: 28, value: ds ? ds.dueDay : 15 });
  const id = h('input', { class: 'mono', placeholder: 'made automatically', maxlength: 11 });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, ds ? 'Save' : 'Create');
  const title = ds ? (shared ? 'Population figures — settings' : 'Form settings') : shared ? 'Create population figures' : `Add another form to ${presetSector || 'a sector'}`;
  const dlg = h('dialog', {}, h('h2', {}, title),
    shared ? h('p', { class: 'muted small' }, 'One yearly list of numbers (population, under-5s, expected pregnancies …) that every sector’s indicators can divide by. It has no indicators of its own.')
      : !ds ? h('p', { class: 'muted small' }, 'A sector can have more than one form, e.g. a monthly one and a yearly one, or one sent by each LGA and one by each school.') : null,
    ds && !shared ? h('p', { class: 'muted small' }, 'Once reports exist, the sector, how often and who reports can no longer change.') : null,
    h('div', { class: 'grid2' },
      field('Form name', name),
      shared ? null : field('Sector', sector),
      shared ? null : field('How often it reports', freq),
      shared ? null : field('Who reports', level),
      shared ? null : field('Due day', due, 'Day of the month after the period ends.'),
      ds ? field('ID', idTag(ds.id)) : field('ID (optional)', id, 'Only to reuse an existing DHIS2 ID.')),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel'),
      ds && is('sysadmin') ? h('button', { class: 'danger', title: 'Archived forms are hidden from data entry; their data is kept.', onclick: async () => { await api('PATCH', '/api/datasets/' + ds.id, { archived: !ds.archived }); dlg.close(); state.meta = null; route(); } }, ds.archived ? 'Restore form' : 'Archive form') : null,
      ds && !shared && is('sysadmin') ? h('button', { class: 'link danger-link', title: 'Only while nothing was reported on it', onclick: async () => {
        if (!confirm(`Delete the form “${ds.name}” and its indicators for good? This is only possible while nothing was reported on it.`)) return;
        try { await api('DELETE', '/api/datasets/' + ds.id); } catch (e) { err.textContent = e.message; return; }
        dlg.close(); state.meta = null; await loadMe(); toast(`Form “${ds.name}” deleted`); go('#/setup');
      } }, 'Delete form') : null));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const body = shared ? { name: name.value.trim() } : { name: name.value.trim(), sector: sector.value.trim(), frequency: freq.value, reportLevel: level.value, dueDay: Number(due.value) };
    if (shared && !ds) body.shared = true;
    let newId = null;
    try {
      if (ds) await api('PATCH', '/api/datasets/' + ds.id, body);
      else { if (id.value.trim()) body.id = id.value.trim(); newId = (await api('POST', '/api/datasets', body)).data.id; }
    } catch (e) { err.textContent = e.message; return; }
    dlg.close(); state.meta = null; await loadMe();
    if (newId) go('#/setup/' + newId); else route();
  }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- sector org units (schools, facilities ...) ----------
const UNIT_HEADERS = ['State', 'LGA', 'LGA ID', 'Name', 'Type', 'Ward (optional)', 'Code', 'DHIS2 ID (optional)'];

// Rollout: which states take part (system administrators).
async function rolloutPanel() {
  const { states } = await get('/api/orgunits?all=1');
  const boxes = states.map((st) => ({ st, box: h('input', { type: 'checkbox', checked: st.active }) }));
  const count = h('span', { class: 'muted small' });
  const upd = () => { const n = boxes.filter((b) => b.box.checked).length; count.textContent = `${n} of ${states.length} states active`; };
  boxes.forEach((b) => b.box.addEventListener('change', upd)); upd();
  const save = h('button', { class: 'primary' }, 'Save rollout');
  save.addEventListener('click', busy(save, async () => {
    const { data } = await api('PUT', '/api/rollout', { active: boxes.filter((b) => b.box.checked).map((b) => b.st.id) });
    state.orgs = null; for (const k of Object.keys(lgaCache)) delete lgaCache[k];
    toast(`Rollout saved (${data.changed} state${data.changed === 1 ? '' : 's'} changed)`);
  }));
  const all = (on) => () => { boxes.forEach((b) => { b.box.checked = on; }); upd(); };
  return h('div', { class: 'panel' },
    h('div', { class: 'actions' }, h('button', { class: 'link', onclick: all(true) }, 'Select all'), h('button', { class: 'link', onclick: all(false) }, 'Select none'), count),
    h('div', { class: 'chips rollout' }, boxes.map((b) => h('label', { class: 'check' }, b.box, b.st.name))),
    h('p'), save);
}

async function renderRollout() {
  mount(h('div', {},
    pageHead({
      title: 'States in use',
      text: 'Tick the states that use the system, then press Save. The other states are hidden everywhere: in lists, registration QR codes, results, national totals, reporting rates and exports.',
      how: ['Nothing is deleted: data and accounts of a state you untick are kept and come back when you tick it again.'],
    }),
    await rolloutPanel()));
}

async function renderUnits() {
  const rollout = null;
  const sectorPref = pref('unitSector');
  const first = await get('/api/units' + qs({ sector: sectorPref, state: state.me.ou.level === 1 ? pref('unitState') : undefined }));
  if (!first.sectors.length) return mount(h('div', {}, pageHead({ title: 'Schools & facilities', text: 'Places below the LGA that report on their own.' }), h('div', { class: 'panel empty' }, 'Add a sector first (Sectors & indicators). Schools and facilities are listed per sector.')));
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
    rollout,
    pageHead({
      title: 'Schools & facilities',
      text: 'Places below each LGA that a sector reports on — schools, health facilities, water points … You only need them when a form is reported by each school / facility.',
      how: [
        'Choose the sector.',
        'Add one place with the form below, or download the Excel template, fill one row per place and press Import Excel. You see a check before anything is saved.',
        'For Health, “Load health facilities” reads a state’s facilities (with their DHIS2 IDs) from the scorecard platform.',
        'Click a place to rename or close it. Places are never deleted, so past data stays.',
      ],
      actions: [tplBtn, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Import Excel'), fileIn,
        h('button', { onclick: () => scorecardDialog(sector, sectorName, states, stateId) }, 'Load health facilities')],
    }),
    h('div', { class: 'bar' },
      field('Sector', select(first.sectors, sector, { onchange: (e) => { pref('unitSector', e.target.value); renderUnits(); } })),
      states ? field('State', select([{ id: '', name: 'All states' }, ...states], stateId, { onchange: (e) => { pref('unitState', e.target.value); pref('unitLga', ''); renderUnits(); } })) : null,
      field('LGA', select([{ id: '', name: 'All LGAs' }, ...lgaOpts], lgaFilter, { onchange: (e) => { pref('unitLga', e.target.value); renderUnits(); } })),
      h('div', { class: 'muted small' }, `${units.length} place${units.length === 1 ? '' : 's'}`), listBtn),
    h('div', { class: 'panel' }, h('h2', {}, `Add one ${sectorName.toLowerCase()} place`), typeList,
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
  const [{ requests }, { links }] = await Promise.all([get('/api/account-requests'), get('/api/registration-links')]);
  const roleFilter = pref('userRole') || '';
  const q = (pref('userQ') || '').toLowerCase();
  const shownUsers = users.filter((u) => (!roleFilter || u.role === roleFilter) && (!q || `${u.name} ${u.email} ${u.ou ? u.ou.name : ''}`.toLowerCase().includes(q)));
  const search = h('input', { type: 'search', placeholder: 'Name, email or place', value: pref('userQ') || '' });
  search.addEventListener('change', () => { pref('userQ', search.value.trim()); renderAccounts(); });
  const choice = (title, text, btn) => h('div', { class: 'choice' }, h('strong', {}, title), h('p', { class: 'muted small' }, text), btn);
  mount(h('div', {},
    pageHead({
      title: 'Users',
      text: 'Everyone signs in with their own account. Each account has one role and one place (the country, a state, an LGA or a school / facility) and only sees that place.',
    }),
    requestsPanel(requests, m),
    h('div', { class: 'choices' },
      choice('Add one person', 'Fill in their name, email, role and place. You get a one-time link to send them (email or WhatsApp); they choose their own password.',
        h('button', { class: 'primary', onclick: () => userDialog(null, roles, m) }, '+ New account')),
      choice('Let many people sign up', 'Make a QR code for an area and sector, and print or share it. People scan it and ask for an account; you approve them here.',
        h('button', { onclick: () => linkDialog(m) }, '+ Registration QR code')),
      is('sysadmin') ? choice('Add an administrator', 'A System administrator can do everything you can: set-up, users, states in use. A Data set administrator only sets up sectors, forms and indicators, and sees the results.',
        h('button', { onclick: () => userDialog(null, roles, m, 'admin') }, '+ New administrator')) : null),
    linksPanel(links),
    h('details', { class: 'panel roles' }, h('summary', {}, 'What each role can do'),
      h('table', {}, h('tbody', {}, roles.map((r) => h('tr', {}, h('td', {}, h('strong', {}, r.name)), h('td', { class: 'small' }, ROLE_HELP[r.id] || '')))))),
    h('h2', {}, `All users (${users.length})`),
    h('div', { class: 'bar' },
      field('Role', select([{ id: '', name: 'All roles' }, ...roles.filter((r) => users.some((u) => u.role === r.id))], roleFilter, { onchange: (e) => { pref('userRole', e.target.value); renderAccounts(); } })),
      field('Search', search),
      h('span', { class: 'muted small' }, shownUsers.length === users.length ? 'Click a name to change it.' : `${shownUsers.length} shown · click a name to change it.`)),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Email'), h('th', {}, 'Role'), h('th', {}, 'Place'), h('th', {}, 'Forms'), h('th', {}, 'Last sign-in'), h('th', {}, 'Status'))),
      h('tbody', {}, shownUsers.map((u) => h('tr', { class: 'click', onclick: () => userDialog(u, roles, m) },
        h('td', {}, u.name), h('td', {}, u.email), h('td', {}, u.roleName), h('td', {}, u.ou ? u.ou.name : ''),
        h('td', { class: 'small' }, assignedText(u, m)),
        h('td', {}, fmtDate(u.lastLoginAt)),
        h('td', {}, !u.active ? pill('none', 'Switched off') : u.locked ? pill('returned', 'Locked') : !u.passwordSet ? pill('submitted', 'Invited — not signed in yet') : pill('accepted', 'Active')))))))));
}

// ---------- self-registration: requests, links, QR codes ----------
function requestsPanel(requests, m) {
  if (!requests.length) return null;
  const dsName = (id) => (m.datasets.find((d) => d.id === id) || {}).name || '';
  return h('div', { class: 'panel hotpanel' }, h('h2', {}, `People waiting for you to approve their account (${requests.length})`),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Contact'), h('th', {}, 'Job / organisation'), h('th', {}, 'Sector'), h('th', {}, 'Asked for'), h('th', {}, 'Where'), h('th', {}, 'Data sets'), h('th', {}, 'Sent'), h('th'))),
      h('tbody', {}, requests.map((r) => {
        const approve = h('button', { class: 'primary' }, 'Approve');
        const reject = h('button', { class: 'danger' }, 'Reject');
        approve.addEventListener('click', busy(approve, async () => { await api('POST', `/api/account-requests/${r.id}/approve`, {}); toast(`${r.name} can now sign in`); renderAccounts(); }));
        reject.addEventListener('click', busy(reject, async () => {
          const note = prompt(`Reason for not approving ${r.name} (shown to them when they try to sign in):`, '');
          if (note === null) return;
          await api('POST', `/api/account-requests/${r.id}/reject`, { note }); toast('Request rejected'); renderAccounts();
        }));
        return h('tr', {},
          h('td', {}, r.name, r.note ? h('div', { class: 'cov' }, `“${r.note}”`) : null),
          h('td', { class: 'small' }, r.email, r.phone ? h('div', {}, r.phone) : null),
          h('td', { class: 'small' }, [r.jobTitle, r.organisation].filter(Boolean).join(' · ')),
          h('td', {}, r.sector || '—'),
          h('td', {}, r.roleName),
          h('td', { class: 'small' }, r.ou.name, r.ou.lga ? h('div', { class: 'cov' }, r.ou.lga) : null),
          h('td', { class: 'small' }, r.datasets.map(dsName).filter(Boolean).join(', ') || (r.sector ? `All ${r.sector}` : 'All')),
          h('td', { class: 'small' }, fmtDate(r.createdAt), h('div', { class: 'cov' }, `via “${r.link}”`)),
          h('td', {}, h('div', { class: 'actions' }, approve, reject)));
      })))),
    h('p', { class: 'muted small' }, 'Approve: the account is created with the password the person chose, and they can sign in at once. Reject: they see your reason when they try to sign in. You can change their forms afterwards in the list below.'));
}

function linksPanel(links) {
  if (!links.length) return null;
  return h('details', { class: 'panel', open: links.some((l) => l.active) || undefined }, h('summary', {}, `Registration QR codes (${links.filter((l) => l.active).length} active)`),
    h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Area'), h('th', {}, 'Requests'), h('th', {}, 'Valid until'), h('th', {}, 'Status'), h('th'))),
      h('tbody', {}, links.map((l) => h('tr', {},
        h('td', {}, l.name, l.sector ? h('div', { class: 'cov' }, l.sector) : null), h('td', {}, l.area ? l.area.name : ''),
        h('td', { class: 'small' }, `${l.requests.pending} waiting · ${l.requests.approved} approved · ${l.requests.total} total`),
        h('td', { class: 'small' }, fmtDay(l.expiresAt)),
        h('td', {}, l.active ? pill('accepted', 'Active') : pill('none', l.revoked ? 'Stopped' : 'Expired')),
        h('td', {}, h('div', { class: 'actions' },
          l.active ? h('button', { onclick: () => showQr(l) }, 'Show QR') : null,
          l.active ? h('button', { class: 'link', onclick: async () => { if (!confirm(`Stop “${l.name}”? The QR code will no longer work.`)) return; await api('DELETE', '/api/registration-links/' + l.id); toast('Stopped'); renderAccounts(); } }, 'Stop') : null)))))));
}

async function linkDialog(m) {
  const o = await orgs();
  const areas = state.me.ou.level === 1 ? [{ id: o.country.id, name: `${o.country.name} (any state)` }, ...o.states] : [{ id: state.me.ou.id, name: state.me.ou.name }];
  const name = h('input', { placeholder: 'e.g. Abia LGA M&E officers — Nov 2026', size: 40 });
  const area = select(areas, areas[0].id);
  const lgaPick = h('select');
  const fillLga = async () => {
    const l = area.value === o.country.id ? [] : await lgasOf(area.value);
    lgaPick.replaceChildren(h('option', { value: '' }, '— whole area —'), ...l.map((x) => h('option', { value: x.id }, x.name)));
  };
  area.addEventListener('change', fillLga); await fillLga();
  const roleOpts = [{ id: '', name: 'Let them choose' }, { id: 'lga', name: 'LGA data entry' }, { id: 'unit', name: 'Unit data entry (school, facility …)' },
    ...(is('sysadmin') ? [{ id: 'state', name: 'State officer' }, { id: 'viewer', name: 'Viewer' }] : [])];
  const roleSel = select(roleOpts, is('state') ? 'lga' : '');
  const days = h('input', { type: 'number', min: 1, max: 365, value: 30, size: 5 });
  const sectorPick = select([{ id: '', name: 'Any sector (they choose)' }, ...m.sectors.filter((x) => m.datasets.some((d) => d.sectorId === x.id && !d.shared))], '');
  const dsBoxes = m.datasets.filter((d) => !d.archived && !d.shared).map((d) => ({ d, box: h('input', { type: 'checkbox' }) }));
  const dsWrap = h('div');
  const fillDs = () => {
    const list = dsBoxes.filter((x) => !sectorPick.value || x.d.sectorId === sectorPick.value);
    for (const x of dsBoxes) if (!list.includes(x)) x.box.checked = false;
    dsWrap.replaceChildren(list.length ? h('div', {}, h('h3', {}, 'Data sets to suggest (optional)'), h('div', { class: 'chips' }, list.map((x) => h('label', { class: 'check' }, x.box, dsLabel(x.d))))) : null);
  };
  sectorPick.addEventListener('change', fillDs); fillDs();
  const err = h('div', { class: 'err' });
  const create = h('button', { class: 'primary' }, 'Create QR code');
  const dlg = h('dialog', {}, h('h2', {}, 'New registration QR code'),
    h('p', { class: 'muted small' }, 'Anyone with this QR code can ask for an account inside the area you choose. Nobody gets in until you approve them.'),
    h('div', { class: 'grid2' }, field('Name (for you)', name), field('Area', area), field('Or one LGA', lgaPick), field('Sector', sectorPick), field('Suggested role', roleSel), field('Valid for (days)', days)),
    dsWrap,
    err, h('p'), h('div', { class: 'actions' }, create, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  create.addEventListener('click', busy(create, async () => {
    err.textContent = '';
    try {
      const { data } = await api('POST', '/api/registration-links', {
        name: name.value.trim(), ouId: lgaPick.value || area.value, role: roleSel.value || undefined, sectorId: sectorPick.value || undefined,
        datasets: dsBoxes.filter((x) => x.box.checked).map((x) => x.d.id), days: Number(days.value) || 30,
      });
      dlg.close(); renderAccounts(); showQr(data.link);
    } catch (e) { err.textContent = e.message; }
  }));
  document.body.append(dlg); dlg.showModal();
}

async function showQr(link) {
  const { qrSvg, qrMatrix } = await import('./qr.js');
  const svg = new DOMParser().parseFromString(qrSvg(link.url, 260), 'image/svg+xml').documentElement;
  const png = h('button', {}, 'Download image');
  png.addEventListener('click', () => {
    // Printable card: QR code + title + short instructions.
    const mtx = qrMatrix(link.url); const n = mtx.length + 8; const scale = 12; const W = n * scale; const H = W + 170;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000';
    mtx.forEach((row, r) => row.forEach((dark, k) => { if (dark) g.fillRect((k + 4) * scale, (r + 4) * scale, scale, scale); }));
    g.textAlign = 'center'; g.fillStyle = '#1c2321';
    g.font = 'bold 26px system-ui, sans-serif'; g.fillText('LGA Multi-Sectoral Scorecard — request an account', W / 2, W + 40);
    g.font = '22px system-ui, sans-serif'; g.fillText(link.name.slice(0, 60), W / 2, W + 80);
    g.fillStyle = '#5d6b66'; g.font = '18px system-ui, sans-serif';
    g.fillText('Scan with your phone camera, fill in your details, wait for approval.', W / 2, W + 118);
    g.fillText(`Valid until ${fmtDay(link.expiresAt)}`, W / 2, W + 148);
    c.toBlob((b) => saveBlob(b, `registration_qr_${link.name.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)}.png`), 'image/png');
  });
  const dlg = h('dialog', { class: 'qr' }, h('h2', {}, link.name),
    h('p', { class: 'muted small' }, `${link.area ? link.area.name + ' · ' : ''}valid until ${fmtDay(link.expiresAt)}`),
    h('div', { class: 'qrbox' }, svg),
    h('p', { class: 'small' }, 'Share it on WhatsApp, in an email, or print it. People scan it with their phone camera, fill in their details and wait for approval.'),
    h('div', { class: 'linkbox' }, h('input', { value: link.url, readonly: true }), h('button', { onclick: () => copy(link.url) }, 'Copy link')),
    h('p'), h('div', { class: 'actions' }, png, h('button', { onclick: () => window.print() }, 'Print'), h('button', { onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

// Public page reached from the QR code.
async function renderRegister(token) {
  renderChrome();
  let info;
  try { info = (await api('GET', '/api/register/' + token)).data; } catch (e) {
    return mount(h('div', { class: 'panel card-narrow' }, h('h1', {}, 'Link not valid'), h('p', {}, e.message), h('a', { href: '#/login' }, 'Go to sign in')));
  }
  const places = async (parent, units) => (await api('GET', `/api/register/${token}/places?parent=${parent}${units ? '&units=1' : ''}`)).data.children;
  const name = h('input', { autocomplete: 'name' }); const email = h('input', { type: 'email', autocomplete: 'email' });
  const phone = h('input', { type: 'tel', autocomplete: 'tel' }); const job = h('input'); const org = h('input', { placeholder: 'e.g. Ministry of Health, Aba North LGA' });
  const roleSel = select(info.roles, info.role && info.roles.some((r) => r.id === info.role) ? info.role : info.roles[0].id);
  const stateSel = h('select'); const lgaSel = h('select'); const unitSel = h('select');
  const where = h('div', { class: 'grid2' });
  const note = h('textarea', { placeholder: 'Anything the administrator should know (optional)' });
  const pw = h('input', { type: 'password', autocomplete: 'new-password' }); const pw2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const dsBoxes = info.datasets.map((d) => ({ d, box: h('input', { type: 'checkbox', checked: d.suggested }), label: null }));
  const sectorSel = select([{ id: '', name: 'Choose your sector' }, ...info.sectors], info.sector || '', { disabled: !!info.sector });
  const dsArea = h('div');
  // Only the chosen sector's data sets; all ticked unless the QR code suggested specific ones.
  function fillDatasets() {
    const sid = sectorSel.value;
    const mine = dsBoxes.filter((x) => x.d.sectorId === sid);
    const anySuggested = mine.some((x) => x.d.suggested);
    for (const x of dsBoxes) x.box.checked = x.d.sectorId === sid && (anySuggested ? x.d.suggested : true);
    dsArea.replaceChildren(sid && mine.length ? h('div', {}, h('h3', {}, 'What you will report or follow'),
      h('div', { class: 'chips' }, mine.map((x) => h('label', { class: 'check' }, x.box, x.d.name + (x.d.byUnit ? ' (by school / facility)' : ''))))) : null);
  }
  sectorSel.addEventListener('change', () => { fillDatasets(); fillUnits(); });
  const err = h('div', { class: 'err' });
  const send = h('button', { class: 'primary', type: 'submit' }, 'Send request');
  const opt = (list, empty) => [h('option', { value: '' }, empty), ...list.map((x) => h('option', { value: x.id }, x.name + (x.type ? ` (${x.type})` : '')))];
  // The link's area decides where pickers start: country → states, state → LGAs, LGA → units.
  const lvl = () => (info.roles.find((r) => r.id === roleSel.value) || {}).level;
  async function fillStates() { if (info.area.level === 1) stateSel.replaceChildren(...opt(await places(info.area.id), 'Choose your state')); }
  async function fillLgas() {
    const sid = info.area.level === 1 ? stateSel.value : info.area.level === 2 ? info.area.id : null;
    if (info.area.level === 3) { lgaSel.replaceChildren(h('option', { value: info.area.id }, info.area.name)); return fillUnits(); }
    lgaSel.replaceChildren(...opt(sid ? await places(sid) : [], 'Choose your LGA')); await fillUnits();
  }
  async function fillUnits() {
    const list = lgaSel.value ? (await places(lgaSel.value, true)).filter((u) => !sectorSel.value || u.sectorId === sectorSel.value) : [];
    unitSel.replaceChildren(...opt(list, !lgaSel.value ? '—' : list.length ? 'Choose your school / facility' : 'None listed for this sector yet'));
  }
  stateSel.addEventListener('change', fillLgas); lgaSel.addEventListener('change', fillUnits);
  function layout() {
    const l = lvl();
    where.replaceChildren(...[
      info.area.level === 1 && l !== 1 ? field('State', stateSel) : null,
      (l === 3 || l === 4 || l === null) && info.area.level <= 3 ? field(l === null ? 'LGA (optional)' : 'LGA', lgaSel) : null,
      l === 4 ? field('Unit (school, facility …)', unitSel) : null].filter(Boolean));
  }
  roleSel.addEventListener('change', layout);
  await fillStates(); await fillLgas(); layout(); fillDatasets();
  const form = h('form', { class: 'panel card-narrow reg' },
    h('h1', {}, 'Request an account'),
    h('p', { class: 'muted small' }, `LGA Multi-Sectoral Scorecard Data Reporting System · ${info.name} · ${info.area.name}`),
    h('div', { class: 'grid2' }, field('Full name', name), field('Email', email), field('Phone', phone), field('Job title', job)), field('Organisation / office', org),
    h('h3', {}, 'Your sector and where you work'), h('div', { class: 'grid2' }, field('Sector', sectorSel), field('I will be', roleSel)), where,
    dsArea,
    h('h3', {}, 'Choose a password'), h('div', { class: 'grid2' }, field('Password (10+ characters)', pw), field('Type it again', pw2)),
    note, err, h('p'), send,
    h('p', { class: 'muted small' }, 'An administrator checks your request. Once approved, sign in with your email and this password.'));
  form.addEventListener('submit', busy(send, async () => {
    err.textContent = '';
    if (pw.value !== pw2.value) { err.textContent = 'The two passwords do not match.'; return; }
    const l = lvl();
    const ouId = l === 4 ? unitSel.value : l === 3 ? lgaSel.value : l === 2 ? (info.area.level === 1 ? stateSel.value : info.area.id) : (lgaSel.value || stateSel.value || info.area.id);
    if (!sectorSel.value) { err.textContent = 'Choose your sector.'; return; }
    if (!ouId) { err.textContent = 'Choose where you work.'; return; }
    try {
      await api('POST', '/api/register/' + token, {
        name: name.value.trim(), email: email.value.trim(), phone: phone.value.trim() || undefined, jobTitle: job.value.trim() || undefined,
        organisation: org.value.trim() || undefined, role: roleSel.value, sectorId: sectorSel.value, ouId, datasets: dsBoxes.filter((x) => x.box.checked).map((x) => x.d.id),
        note: note.value.trim() || undefined, password: pw.value,
      });
      mount(h('div', { class: 'panel card-narrow' }, h('h1', {}, 'Request sent'),
        h('p', {}, 'Thank you. An administrator will check your request. Once it is approved you can sign in with your email and the password you chose.'),
        h('a', { href: '#/login', class: 'btn' }, 'Go to sign in')));
    } catch (e) { err.textContent = e.message; }
  }));
  mount(form);
}

function assignedText(u, m) {
  const ds = u.datasets.length ? u.datasets.map((id) => (m.datasets.find((d) => d.id === id) || {}).name).filter(Boolean).join(', ') : 'All forms';
  return u.dataElements.length ? `${ds} · ${u.dataElements.length} number${u.dataElements.length === 1 ? '' : 's'} only` : ds;
}

async function userDialog(u, roles, m, presetRole = null) {
  const allowedRoles = (is('sysadmin') ? roles : roles.filter((r) => ['lga', 'unit'].includes(r.id)))
    .filter((r) => presetRole !== 'admin' || ['sysadmin', 'setupadmin'].includes(r.id));
  const name = h('input', { value: u ? u.name : '', autocomplete: 'off' });
  const email = h('input', { type: 'email', value: u ? u.email : '', autocomplete: 'off' });
  const roleSel = select(allowedRoles, u ? u.role : presetRole === 'admin' ? 'sysadmin' : (allowedRoles.find((r) => r.id === 'lga') || allowedRoles[0]).id);
  const o = await orgs();
  const stateSel = select(o.states, u && u.ou && u.ou.level >= 2 ? null : o.states[0].id);
  const lgaSel = h('select');
  const unitSel = h('select');
  const where = h('div', { class: 'grid2' });
  const err = h('div', { class: 'err' });
  const out = h('div');

  // Pre-select the state of an existing LGA/state user.
  let initialState = state.me.ou.level === 2 ? state.me.ou.id : o.states[0].id;
  if (u && u.ou && u.ou.level === 2) initialState = u.ou.id;
  const ouParts = u && u.ou && u.ou.path ? u.ou.path.split('/') : [];
  if (u && u.ou && u.ou.level >= 3) initialState = ouParts[2] || initialState;
  stateSel.value = initialState;
  async function fillUnits() {
    const list = lgaSel.value ? await unitsOf(lgaSel.value) : [];
    const sectorName = (id) => ((m.sectors.find((x) => x.id === id) || {}).name || '');
    unitSel.replaceChildren(...(list.length ? list.map((x) => h('option', { value: x.id, selected: u && u.ou && x.id === u.ou.id }, `${x.name}${x.sectorId ? ' — ' + sectorName(x.sectorId) : ''}`))
      : [h('option', { value: '' }, 'No units in this LGA yet')]));
  }
  async function fillLgas() {
    const l = await lgasOf(stateSel.value);
    const lgaOfUser = u && u.ou ? (u.ou.level === 3 ? u.ou.id : u.ou.level === 4 ? ouParts[3] : null) : null;
    lgaSel.replaceChildren(...l.map((x) => h('option', { value: x.id, selected: x.id === lgaOfUser }, x.name)));
    await fillUnits();
  }
  stateSel.addEventListener('change', fillLgas);
  lgaSel.addEventListener('change', fillUnits);
  function layoutWhere() {
    const lvl = (roles.find((r) => r.id === roleSel.value) || {}).level;
    const showState = lvl !== 1 && state.me.ou.level === 1;
    where.replaceChildren(
      showState ? field('State', stateSel) : null,
      lvl === 3 || lvl === 4 || lvl === null ? field(lvl === null ? 'LGA (leave state for state-wide viewer)' : 'LGA', lgaSel) : null,
      lvl === 4 ? field('Unit (school, facility …)', unitSel) : null);
    if (lvl === null && !lgaSel.querySelector('option[value=""]')) lgaSel.prepend(h('option', { value: '' }, '— whole state —'));
    if (lvl === null && state.me.ou.level === 1 && !stateSel.querySelector('option[value=""]')) stateSel.prepend(h('option', { value: '' }, '— whole country —'));
  }
  roleSel.addEventListener('change', layoutWhere);
  await fillLgas(); layoutWhere();
  const showRoleHelp = () => { const el = dlg && dlg.querySelector('.role-help'); if (el) el.textContent = ROLE_HELP[roleSel.value] || ''; };
  roleSel.addEventListener('change', showRoleHelp);

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
    h('h2', {}, u ? u.name : presetRole === 'admin' ? 'New administrator' : 'New account'),
    h('div', { class: 'grid2' }, field('Full name', name), field('Email', email), field('Role', roleSel)),
    where,
    h('p', { class: 'muted small role-help' }),
    h('h3', {}, 'Forms this person works on'),
    h('div', { class: 'chips' }, dsBoxes.map((x) => h('label', { class: 'check' }, x.box, dsLabel(x.d)))),
    h('p', { class: 'muted small' }, 'Nothing ticked = all forms.'),
    h('details', {}, h('summary', { class: 'small' }, 'Advanced: only some numbers on a form'),
      h('p', { class: 'muted small' }, 'Use this when two people share a form (e.g. a Health officer and an Education officer). Tick only the numbers this person types in. Nothing ticked = every number.'),
      deArea),
    u ? h('label', { class: 'check' }, active, 'Account active') : null,
    err, out, h('p'),
    h('div', { class: 'actions' }, save, reset, h('button', { onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => { dlg.remove(); renderAccounts(); });
  showRoleHelp();

  const showLink = (link, exp) => out.replaceChildren(h('div', { class: 'note ok' },
    'Send this one-time link to the person (by email or WhatsApp). It works once and expires ', fmtDate(exp), '.',
    h('div', { class: 'linkbox' }, h('input', { value: link, readonly: true }), h('button', { onclick: () => copy(link) }, 'Copy'))));

  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const lvl = (roles.find((r) => r.id === roleSel.value) || {}).level;
    let ouId = lvl === 1 ? o.country.id : lvl === 2 ? (state.me.ou.level === 2 ? state.me.ou.id : stateSel.value) : lvl === 4 ? unitSel.value : lgaSel.value;
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
    pageHead({ title: 'Activity log', text: 'Every sign-in, set-up change, data save, approval, import and download, with who did it and when (latest 200).' }),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Item'), h('th', {}, 'Details'))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, fmtDate(e.created_at)), h('td', {}, e.user_name || e.user_email || e.user_id || '—'),
        h('td', {}, e.action.replace(/_/g, ' ')), h('td', { class: 'mono' }, e.ref_id || ''), h('td', { class: 'small muted' }, e.detail ? JSON.stringify(e.detail).slice(0, 160) : ''))))))));
}

// Entry view groups numbers by sector; make sure metadata is loaded once signed in.
window.addEventListener('hashchange', () => { if (state.me && !state.meta) meta().catch(() => {}); });
