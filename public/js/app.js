// LGA Multi-Sectoral Nutrition Scorecard Data Reporting System — single-page app (no framework, no dashboards: forms and tables).

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
// The same, for a group of controls (a label element may only wrap one control).
const fieldGroup = (label, input, hint) => h('div', { class: 'f' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
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
const ALL = ['sysadmin', 'setupadmin', 'national', 'state', 'lga', 'unit', 'viewer'];
const ENTRY_ROLES = ['lga', 'unit'];
// Day-to-day work first; the two administration areas (Set-up, Users & access) sit apart in their own shaded block.
const GROUPS = [
  { id: 'report', name: 'Reports', desc: 'Reports sent in by LGAs and schools / facilities' },
  { id: 'results', name: 'Results', desc: 'What the accepted reports add up to' },
  { id: 'setup', name: 'Set-up', admin: true, desc: 'What is reported: sectors, indicators, population, places' },
  { id: 'people', name: 'Users & access', admin: true, desc: 'Who can sign in, and what they can do' },
];
const hasUnitSets = () => myDatasets().some((d) => d.reportLevel === 'UNIT');
const PAGES = [
  { id: 'home', name: () => (is(...ENTRY_ROLES) ? 'My reports' : 'Home'), short: 'What needs doing now', roles: ALL, desc: 'Start here: what needs doing and where to find everything.' },
  { id: 'review', group: 'report', name: () => (is('lga') ? 'Org unit reports' : 'Who has sent'), short: 'Sent or not, per place', roles: ['sysadmin', 'national', 'state', 'lga'], nav: () => !is('lga') || hasUnitSets(), desc: () => (is('lga') ? 'Which org units below your LGA have sent their report. Open one to see it or type it in.' : 'For each report and period: % of LGAs (or org units below the LGA) that have sent, by state, then LGA by LGA.') },
  { id: 'reminders', group: 'report', name: 'Send reminders', short: 'Email those who have not sent', roles: ['sysadmin', 'national', 'state'], desc: 'Remind the people whose report is not sent yet: an email with their Excel template attached and a link to upload it.' },
  { id: 'upload', name: 'Upload a report', roles: ['sysadmin', 'national', 'state', 'lga', 'unit'], nav: () => false, desc: 'Upload a filled Excel template.' },
  { id: 'entry', group: 'report', name: 'Type in a report', short: 'On behalf of an LGA', roles: ['sysadmin', 'national', 'state', 'lga', 'unit'], nav: () => !is(...ENTRY_ROLES), desc: 'Type in the numbers of a report for an LGA that cannot do it themselves, and send it.' },
  { id: 'picture', group: 'results', name: 'Results table', short: 'One report, one period', roles: ['sysadmin', 'setupadmin', 'national', 'state', 'viewer'], desc: 'The indicators of one report for one period, with a row per state, LGA or school / facility.' },
  { id: 'pivot', group: 'results', name: () => (is(...ENTRY_ROLES) ? 'Results' : 'Compare over time'), short: 'Places × indicators × periods', roles: ['sysadmin', 'setupadmin', 'national', 'state', 'lga', 'viewer'], desc: 'Compare indicators across places and periods (a pivot table), and download it to Excel.' },
  { id: 'export', group: 'results', name: 'Export to scorecard', short: 'The two JSON files', roles: ['sysadmin', 'setupadmin', 'national', 'state', 'viewer'], desc: 'Download the two JSON files that the scorecard platform reads.' },
  { id: 'setup', group: 'setup', name: 'Sectors & indicators', short: 'Add a sector and its indicators', roles: ['sysadmin', 'setupadmin'], desc: 'Add a sector (Health, Education …), how often it reports, and its indicators.' },
  { id: 'dictionary', group: 'setup', name: 'Indicator dictionary', short: 'Shared definitions and codes', roles: ['sysadmin', 'setupadmin'], nav: () => false, desc: 'One definition per indicator — code, calculation, source, framework — shared by every sector that reports it.' },
  { id: 'population', group: 'setup', name: 'Population figures', short: 'Yearly denominators', roles: ['sysadmin', 'setupadmin'], desc: 'Yearly numbers per LGA that indicators divide by: population, under-5s, expected pregnancies …' },
  { id: 'units', group: 'setup', name: 'Units below the LGA', short: 'Child org units: facilities, schools …', roles: ['sysadmin', 'setupadmin', 'national', 'state'], desc: 'The child org units of each LGA (DHIS2 level 4) that a sector reports on: health facilities, schools, water points, markets … Set them up per sector.' },
  { id: 'rollout', group: 'setup', name: 'States in use', short: 'Which states take part', roles: ['sysadmin'], desc: 'Choose which states use the system. The others are hidden everywhere.' },
  { id: 'accounts', group: 'people', name: 'Users', short: 'Accounts, sign-up requests, QR codes', roles: ['sysadmin', 'national', 'state'], desc: 'Create accounts, approve sign-up requests and share registration QR codes.' },
  { id: 'audit', group: 'people', name: 'Activity log', short: 'Who did what, when', roles: ['sysadmin'], desc: 'Who signed in, changed, sent, approved or downloaded what, and when.' },
];
const pageDesc = (p) => (typeof p.desc === 'function' ? p.desc() : p.desc);
const pageName = (p) => (typeof p.name === 'function' ? p.name() : p.name);
const ROLE_HELP = {
  sysadmin: 'Full control: sets up sectors and indicators, chooses the states in use, manages every user, and sees everything.',
  setupadmin: 'Adds sectors and indicators, sets up the population figures, and sees all results. Does not manage users.',
  national: 'Data entry for the whole country: can type in a report for any state’s LGAs, sees all results, and manages state, LGA and school data-entry accounts.',
  state: 'Data entry for a whole state: can type in a report for any of its LGAs, sees the state’s results and manages LGA accounts there.',
  lga: 'Types in and sends the reports of one LGA (and of its schools / facilities, if a sector reports by unit).',
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
  if (is('sysadmin')) {
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
    if (page && !['login', 'me'].includes(page)) pref('afterLogin', location.hash);
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
    await ({ home: renderHome, entry: renderEntry, review: renderReview, picture: renderPicture, pivot: renderPivot, export: renderExport, setup: renderSetup, population: renderPopulation, dictionary: renderDictionary, reminders: renderReminders, upload: renderUpload, units: renderUnits, rollout: renderRollout, accounts: renderAccounts, audit: renderAudit, me: renderMe })[target](...parts.slice(1));
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
    h('h1', {}, 'Sign in'), h('p', { class: 'muted small' }, 'LGA Multi-Sectoral Nutrition Scorecard Data Reporting System'),
    h('div', { class: 'grid2' }, field('Email', email)), field('Password', pw), h('p'), btn, err,
    h('p', { class: 'muted small' }, 'Forgot your password? Ask your administrator for a new sign-in link.'));
  form.addEventListener('submit', busy(btn, async () => {
    err.textContent = '';
    try { await api('POST', '/api/auth/login', { email: email.value, password: pw.value }); await loadMe(); const next = pref('afterLogin'); pref('afterLogin', null); go(next || '#/'); } catch (e) { err.textContent = e.message; if (e.body && e.body.error && e.body.error.code === 'pending_approval') err.className = 'note info'; }
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
// Does unit u report on schedule ds? Its unit types, or (older schedules) the schedule's sector.
const unitReports = (ds, u) => ((ds.unitTypes || []).length ? ds.unitTypes.includes(u.typeId) : u.sectorId === ds.sectorId);
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
  submitted: 'Sent',
  accepted: 'Sent',
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
      'Once sent, it counts in the results straight away. Made a mistake? Ask your system administrator to delete it, then type it in again.',
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
      h('div', { class: 'rc-head' }, h('h2', {}, 'Reports from your schools / facilities'), h('span', { class: 'muted small' }, 'They count as soon as each one sends')),
      h('table', { class: 'todo' }, h('tbody', {}, rows.filter(Boolean).map(({ ds, st }) => h('tr', { class: 'click', onclick: () => { pref('ds', ds.id); go('#/review'); } },
        h('td', {}, ds.name, h('div', { class: 'muted small' }, st.periodName)),
        h('td', {}, pill(st.counts.accepted + st.counts.submitted === st.total ? 'accepted' : 'draft', `${st.counts.accepted + st.counts.submitted} of ${st.total} sent`)),
        h('td', { class: 'n' }, h('button', {}, 'See which')))))));
  }
  mount(h('div', {}, head, cards, unitCard));
}

// Everyone else: what is waiting, the set-up checklist (administrators) and a map of the system.
async function renderOverview() {
  const m = await meta();
  const ou = state.me.ou;
  const blocks = [];
  // (No approval step: sent reports count straight away, so nothing waits for approval.)
  if (false) {
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
  if (is('sysadmin')) {
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
        step(inds > 0, `${active ? '3' : '2'}. Sectors and indicators`, forms.length ? `${sectors.size} sector${sectors.size === 1 ? '' : 's'}, ${inds} indicator${inds === 1 ? '' : 's'}.` : 'Add a sector (Health, Education, Agriculture …) and its indicators.', '#/setup', forms.length ? 'Open' : 'Add a sector'),
        byUnit.length ? step(false, `${active ? '4' : '3'}. Units below the LGA`, `${byUnit.map((d) => d.name).join(', ')} ${byUnit.length === 1 ? 'is' : 'are'} reported by each school / facility: load the list of them.`, '#/units', 'Open') : null,
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
    state.entryArea = { state: sp.value, lga: ouId }; // for the Excel template
    pickers = [sp.el, field('LGA', select(lgas, ouId, { onchange: (e) => { pref('lga', e.target.value); renderEntry(); } }))];
  }
  if (byUnit && role() !== 'unit') {
    // Unit-reported schedule: choose the ward / facility / school inside the LGA (the schedule's unit types).
    const units = (await unitsOf(ouId)).filter((u) => unitReports(ds, u)).map((u) => ({ id: u.id, name: u.ward && u.typeId !== 'ut_ward' ? `${u.name} — ${u.ward}` : u.name }));
    if (!units.length) {
      return mount(h('div', {}, h('div', { class: 'bar' }, field('Report', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderEntry(); } })), pickers),
        h('div', { class: 'panel empty' }, `“${ds.name}” is reported by ${whoText(ds)}, and none are listed for this LGA yet. Add them under Set-up → Units below the LGA.`)));
    }
    ouId = units.some((u) => u.id === pref('unit')) ? pref('unit') : units[0].id;
    pickers = [...pickers, field(whoText(ds).replace(/^each /, '').replace(/^./, (c) => c.toUpperCase()), select(units, ouId, { onchange: (e) => { pref('unit', e.target.value); renderEntry(); } }))];
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
      if (f.parts && f.parts.length) { rows.push(...partRows(f)); continue; }
      const inp = h('input', { class: 'num', inputmode: f.valueType === 'INTEGER' ? 'numeric' : 'decimal', value: f.value === null ? '' : String(f.value), disabled: !f.editable, 'aria-label': f.name, placeholder: f.editable ? '' : '' });
      inp.addEventListener('input', () => { inp.classList.remove('bad'); dirty = true; });
      inputs[f.id] = inp;
      rows.push(h('tr', {}, h('td', {}, f.name, f.editable || r.locked ? null : h('div', { class: 'muted small' }, 'Typed in by another person')), h('td', { class: 'n' }, inp)));
    }
  }
  let dirty = false;
  // A broken-down number: one box per part (Female, Male …); its total adds itself up.
  function partRows(f) {
    const total = h('span', { class: 'total' });
    const boxes = f.parts.map((p) => {
      const inp = h('input', { class: 'num', inputmode: f.valueType === 'INTEGER' ? 'numeric' : 'decimal', value: p.value === null ? '' : String(p.value), disabled: !f.editable, 'aria-label': `${f.name} — ${p.name}` });
      inputs[`${f.id}:${p.key}`] = inp;
      return [p, inp];
    });
    const sum = () => {
      const vals = boxes.map(([, i]) => i.value.trim()).filter((x) => x !== '').map(Number);
      total.textContent = vals.length ? `Total ${fmtNum(vals.reduce((a, b) => a + b, 0))}${vals.length < boxes.length ? ' so far' : ''}` : (f.value !== null ? `Earlier total ${fmtNum(f.value)} — please split it` : 'Total adds up here');
    };
    for (const [, inp] of boxes) inp.addEventListener('input', () => { for (const [, i] of boxes) i.classList.remove('bad'); dirty = true; sum(); });
    sum();
    return [h('tr', { class: 'parent' }, h('td', {}, f.name, f.editable || r.locked ? null : h('div', { class: 'muted small' }, 'Typed in by another person')), h('td', { class: 'n muted small' }, total)),
      ...boxes.map(([p, inp]) => h('tr', { class: 'part' }, h('td', {}, p.name), h('td', { class: 'n' }, inp)))];
  }

  const editableKey = (k) => (fieldById[k.split(':')[0]] || {}).editable;
  const collect = () => Object.fromEntries(Object.entries(inputs).filter(([id]) => editableKey(id)).map(([id, i]) => [id, i.value.trim() === '' ? null : i.value.trim()]));
  async function save(quiet) {
    err.textContent = '';
    try {
      const { data } = await api('PUT', '/api/entry', { dataset: form.dataset.id, ou: form.ou.id, period: form.period, values: collect() });
      dirty = false; if (!quiet) toast('Saved. Nothing has been sent yet.'); return data;
    } catch (e) {
      const errs = (e.body && e.body.error && e.body.error.errors) || {};
      for (const id of Object.keys(errs)) for (const [k, i] of Object.entries(inputs)) if (k === id || k.startsWith(id + ':')) i.classList.add('bad');
      err.textContent = e.message; throw e;
    }
  }
  const saveBtn = h('button', {}, 'Save, send later');
  saveBtn.addEventListener('click', busy(saveBtn, async () => { const d = await save(); main().replaceChildren(entryView(d, sets, pickers)); }));
  const submitBtn = h('button', { class: 'primary big' }, 'Send');
  submitBtn.addEventListener('click', busy(submitBtn, async () => {
    if (form.can.edit && (dirty || r.status === 'none' || r.status === 'returned')) await save(true);
    try {
      const { data } = await api('POST', '/api/entry/submit', { dataset: form.dataset.id, ou: form.ou.id, period: form.period });
      toast('Sent. Thank you!'); main().replaceChildren(entryView(data, sets, pickers));
    } catch (e) { err.textContent = e.message; }
  }));

  

  // One plain sentence on where this report stands and what to do next.
  const statusNote = {
    none: form.can.edit ? h('div', { class: 'note info' }, h('strong', {}, 'Not started. '), 'Type the numbers below, then press ', h('strong', {}, 'Send'), '.') : null,
    draft: form.can.edit ? h('div', { class: 'note info' }, h('strong', {}, 'Saved but not sent yet. '), 'Finish the numbers and press Send.') : null,
    returned: h('div', { class: 'note bad' }, h('strong', {}, 'Sent back for correction. '), r.comment ? `Note from ${r.reviewedBy || 'the reviewer'}: “${r.comment}”. ` : '', form.can.edit ? 'Correct the numbers and send again.' : ''),
    submitted: h('div', { class: 'note ok' }, h('strong', {}, 'Sent. '), `${fmtDate(r.submittedAt)}${r.submittedBy ? ' by ' + r.submittedBy : ''}. These numbers count in the results.`),
    accepted: h('div', { class: 'note ok' }, h('strong', {}, 'Sent. '), `${fmtDate(r.submittedAt || r.reviewedAt)}${(r.submittedBy || r.reviewedBy) ? ' by ' + (r.submittedBy || r.reviewedBy) : ''}. These numbers count in the results. To correct them, ask a system administrator to delete this report, then type it in again.`),
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
      back: simple ? ['#/home', 'My reports'] : null,
      title: `${form.dataset.name} — ${form.periodName}`,
      sub: [form.ou.type, form.ou.name, form.ou.lga].filter(Boolean).join(' · '),
      text: simple ? null : 'Type in a report on behalf of an LGA (or a school / facility).',
      actions: [pill(r.status, STATUS_PLAIN[r.status]), r.late ? h('span', { class: 'late' }, 'Sent late') : null],
    }),
    h('div', { class: 'bar' + (simple ? ' bar-simple' : '') }, sets.length > 1 || !simple ? field(simple ? 'Report' : 'Report', dsSel) : null, pickers, field(periodWord(form.dataset.frequency), peSel)),
    statusNote,
    form.overdue && form.can.edit ? h('div', { class: 'note warn' }, `This report was due on ${fmtDay(form.due)}.`) : null,
    h('div', { class: 'panel' },
      form.fields.length ? h('table', { class: 'entry' }, h('thead', {}, h('tr', {}, h('th', {}, 'What to count'), h('th', { class: 'n' }, 'Number'))), h('tbody', {}, rows))
        : h('div', { class: 'empty' }, 'This report has no indicators yet.'),
      err,
      form.can.edit ? h('div', { class: 'sendbar' },
        h('div', { class: 'sendbtn' }, submitBtn, h('span', { class: 'hint' }, 'It counts in the results straight away and can no longer be changed. Every box must have a number — put 0 if there were none.')),
        h('div', { class: 'sendbtn' }, saveBtn, h('span', { class: 'hint' }, 'Keeps what you typed. Nothing is sent.'))) : null),
    is('sysadmin') && r.status !== 'none' ? h('div', { class: 'actions' }, deleteReportBtn(form, (d) => main().replaceChildren(entryView(d, sets, pickers)))) : null,
    results.length ? h('details', { class: 'panel', open: !simple || undefined }, h('summary', {}, 'See the results these numbers give'), results) : null,
    is('sysadmin', 'state', 'lga', 'unit') ? excelEntryBar(form) : null,
    r.updatedAt ? h('p', { class: 'muted small' }, `Last saved ${fmtDate(r.updatedAt)}${r.updatedBy ? ' by ' + r.updatedBy : ''}.`) : null,
  );
}

// A system administrator removes a report (its numbers and its status), e.g. to have it typed in again.
function deleteReportBtn(form, after) {
  const b = h('button', { class: 'link danger-link' }, 'Delete this report');
  b.addEventListener('click', busy(b, async () => {
    if (!confirm(`Delete the ${form.dataset.name} report of ${form.ou.name} for ${form.periodName}? Its numbers are removed and it no longer counts in the results. This cannot be undone.`)) return;
    const { data } = await api('DELETE', '/api/entry' + qs({ dataset: form.dataset.id, ou: form.ou.id, period: form.period }));
    toast('Report deleted'); after(data);
  }));
  return b;
}

// ---------- Excel data-entry template ----------
// One row per place (LGA, or unit below the LGA) the account reports for, one column per number, filled with what
// is saved already. Row 2 holds the IDs the upload needs.
function excelEntryBar(form) {
  const ds = form.dataset;
  const byUnit = ds.reportLevel === 'UNIT';
  // The area: an LGA user their LGA, a unit user their unit; others the chosen LGA (unit reports) or state.
  const ea = state.entryArea || {};
  const area = is('lga', 'unit') ? undefined : byUnit ? ea.lga : ea.state;
  const dl = h('button', {}, 'Download Excel template');
  dl.addEventListener('click', busy(dl, async () => {
    const t = await get('/api/entry/sheet' + qs({ dataset: ds.id, period: form.period, ou: area }));
    const [{ writeWorkbook }, { entryTemplateSheets, templateFileName }] = await Promise.all([import('./xlsx.js'), import('./template.js')]);
    saveBlob(writeWorkbook(entryTemplateSheets(t)), templateFileName(t));
  }));
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (f) try { await uploadEntryExcel(f); } catch (e) { toast(e.message, true); }
  });
  return h('details', { class: 'panel excelbar' },
    h('summary', {}, 'Many places at once? Use an Excel template'),
    h('p', { class: 'muted small' }, `Download a sheet with one row per ${byUnit ? 'unit' : 'LGA'} you report for (${form.periodName}), fill it in — offline if you like — and upload it. The numbers are saved as drafts; you can send the complete ones in the same step.`),
    h('div', { class: 'actions' }, dl, h('button', { onclick: () => fileIn.click() }, 'Upload filled Excel'), fileIn));
}

async function uploadEntryExcel(file) {
  const { readSheet } = await import('./xlsx.js');
  const rows = await readSheet(file);
  const hi = rows.findIndex((r) => String(r[0] || '').trim() === 'Place ID');
  if (hi < 0 || !rows[hi + 1]) throw new Error('This is not a data-entry template (no “Place ID” column). Download the template first.');
  const head = rows[hi]; const ids = rows[hi + 1];
  const dsId = String(ids[1] || '').trim(); const period = String(ids[2] || '').trim();
  const ds = myDatasets().find((d) => d.id === dsId);
  if (!ds) throw new Error('This template is for a report you are not assigned to.');
  const cols = ids.map((x, i) => ({ i, id: String(x || '').trim(), name: head[i] })).filter((c) => c.i > 2 && /^[A-Za-z0-9_]{6,}(:[a-z0-9_.]+)?$/.test(c.id) && c.id !== dsId);
  if (!cols.length) throw new Error('No number columns found in the template.');
  const todo = [];
  for (const r of rows.slice(hi + 2)) {
    const ou = String(r[0] || '').trim();
    if (!ou) continue;
    const values = {};
    for (const c of cols) { const v = String(r[c.i] ?? '').trim(); if (v !== '') values[c.id] = v; }
    if (Object.keys(values).length) todo.push({ ou, name: [r[4] && ds.reportLevel === 'UNIT' ? r[4] : r[2]].join(''), values, full: Object.keys(values).length === cols.length });
  }
  if (!todo.length) throw new Error('No numbers were found in the file.');
  const send = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'primary' }, `Save ${todo.length} report${todo.length === 1 ? '' : 's'}`);
  const progress = h('span', { class: 'muted small' });
  const out = h('div');
  const dlg = h('dialog', { class: 'wide' }, h('h2', {}, `Upload — ${ds.name}, ${period}`),
    h('p', { class: 'muted small' }, `${file.name} · ${todo.length} place${todo.length === 1 ? '' : 's'} with numbers (${todo.filter((t) => t.full).length} complete) · ${cols.length} number column${cols.length === 1 ? '' : 's'}`),
    h('label', { class: 'check' }, send, 'Also send each complete report for checking (otherwise they are saved as drafts)'),
    out, h('p'), h('div', { class: 'actions' }, go, progress, h('button', { onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => { dlg.remove(); route(); });
  go.addEventListener('click', busy(go, async () => {
    const res = [];
    for (let i = 0; i < todo.length; i++) {
      const t = todo[i];
      progress.textContent = `Saving ${i + 1} of ${todo.length}…`;
      try {
        await api('PUT', '/api/entry', { dataset: ds.id, ou: t.ou, period, values: t.values });
        if (send.checked) {
          try { await api('POST', '/api/entry/submit', { dataset: ds.id, ou: t.ou, period }); res.push({ t, ok: 'Saved and sent' }); } catch (e) { res.push({ t, ok: 'Saved as draft', note: e.message }); }
        } else res.push({ t, ok: 'Saved as draft' });
      } catch (e) { res.push({ t, bad: e.message }); }
    }
    progress.textContent = '';
    go.disabled = true;
    const bad = res.filter((r) => r.bad);
    out.replaceChildren(
      h('div', { class: 'note ' + (bad.length ? 'warn' : 'ok') }, `${res.length - bad.length} saved${send.checked ? ` (${res.filter((r) => r.ok === 'Saved and sent').length} sent)` : ''}${bad.length ? ` · ${bad.length} not saved` : ''}.`),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Place'), h('th', {}, 'Result'), h('th', {}, 'Note'))),
        h('tbody', {}, res.map((r) => h('tr', {}, h('td', {}, r.t.name || r.t.ou), h('td', {}, r.bad ? pill('returned', 'Not saved') : pill(r.ok === 'Saved and sent' ? 'submitted' : 'draft', r.ok)), h('td', { class: 'small' }, r.bad || r.note || '')))))));
  }));
  document.body.append(dlg); dlg.showModal();
}

// The page a reminder email links to: one report and period, with the template to download and the upload button.
async function renderUpload(dsId, period) {
  await meta();
  const ds = myDatasets().find((d) => d.id === dsId);
  if (!ds) return mount(h('div', { class: 'note info' }, 'This report is not assigned to your account. Ask your administrator.'));
  const t = await get('/api/entry/sheet' + qs({ dataset: ds.id, period, ou: is('lga', 'unit', 'state') ? undefined : state.entryArea && (ds.reportLevel === 'UNIT' ? state.entryArea.lga : state.entryArea.state) })).catch((e) => { throw e; });
  const form = { dataset: { id: ds.id, reportLevel: ds.reportLevel }, period: t.period, periodName: t.periodName };
  const open = t.rows.filter((r) => ['none', 'draft', 'returned'].includes(r.status));
  const bar = excelEntryBar(form); bar.open = true;
  mount(h('div', {},
    pageHead({
      back: is(...ENTRY_ROLES) ? ['#/home', 'My reports'] : null,
      title: `${ds.name} — ${t.periodName}`,
      sub: `Due ${fmtDay(t.due)} · ${t.rows.length} place${t.rows.length === 1 ? '' : 's'} · ${open.length} not sent yet`,
      text: 'Fill in the Excel template (it may already be attached to your email), then upload it here. Or type the numbers in online.',
      how: ['Download the template (or use the one attached to the email).', 'Type each number; put 0 where there was nothing.', 'Press “Upload filled Excel” and choose the file. Tick “Also send” to send the complete reports for checking.'],
    }),
    bar,
    h('div', { class: 'panel' }, h('h3', {}, 'Or type the numbers in online'),
      h('table', { class: 'todo' }, h('tbody', {}, t.rows.slice(0, 200).map((r) => h('tr', { class: 'click', onclick: () => {
        pref('ds', ds.id); pref('pe:' + ds.id, t.period);
        if (ds.reportLevel === 'UNIT' && !is('unit')) { pref('lga', null); pref('unit', r.id); } else if (!is('lga', 'unit')) pref('lga', r.id);
        go('#/entry');
      } }, h('td', {}, r.name, r.ward ? h('span', { class: 'muted small' }, ` · ${r.ward}`) : null), h('td', {}, pill(r.status, STATUS_PLAIN[r.status])), h('td', { class: 'n' }, h('button', {}, ['none', 'draft', 'returned'].includes(r.status) ? 'Open' : 'View')))))))));
}

// Reminders: pick a report and period, see who has not sent, email them (template attached + upload link).
async function renderReminders() {
  await meta();
  const sets = myDatasets().filter((d) => !d.shared);
  if (!sets.length) return mount(noDatasets());
  const ds = sets.find((d) => d.id === pref('remDs')) || sets[0];
  const o = await orgs();
  const stateId = is('state') ? state.me.ou.id : o.states.some((x) => x.id === pref('remState')) ? pref('remState') : (o.states[0] || {}).id;
  const periods = (await get('/api/status' + qs({ dataset: ds.id, state: stateId }))).periods;
  const period = periods.some((p) => p.id === pref('remPe:' + ds.id)) ? pref('remPe:' + ds.id) : periods[0].id;
  const r = await get('/api/reminders' + qs({ dataset: ds.id, period, ou: stateId }));
  const note = h('textarea', { placeholder: 'Optional note added to the email, e.g. “Please send by Friday — the state review meeting is on Monday.”' });
  const people = r.places.flatMap((p) => p.users.map((u) => ({ p, u, box: h('input', { type: 'checkbox', checked: true }) })));
  const noAccount = r.places.filter((p) => !p.users.length);
  const send = h('button', { class: 'primary', disabled: !r.emailConfigured || !people.length }, `Email ${people.length} reminder${people.length === 1 ? '' : 's'}`);
  const out = h('div');
  send.addEventListener('click', busy(send, async () => {
    const ids = people.filter((x) => x.box.checked).map((x) => x.u.id);
    if (!ids.length) { toast('Tick at least one person.', true); return; }
    const { data } = await api('POST', '/api/reminders', { dataset: ds.id, period, ou: stateId, userIds: ids, note: note.value.trim() || undefined });
    const bad = data.results.filter((x) => !x.ok);
    out.replaceChildren(h('div', { class: 'note ' + (bad.length ? 'warn' : 'ok') }, `${data.sent} reminder${data.sent === 1 ? '' : 's'} sent.`, bad.length ? ` ${bad.length} not sent: ${bad.map((b) => `${(people.find((x) => x.u.id === b.id) || { u: { name: b.id } }).u.name} (${b.message})`).join('; ')}` : ''));
    toast(`${data.sent} reminder${data.sent === 1 ? '' : 's'} sent`);
  }));
  const copyMsg = (u) => copy(r.sample.replace('[name]', u.name) + (note.value.trim() ? '' : ''));
  mount(h('div', {},
    pageHead({
      title: 'Send reminders',
      text: 'Everyone whose report is not sent yet gets an email: which report, the period and due date, a link to the upload page, and their own Excel template attached (filled with what they saved so far).',
      how: ['Choose the report and the period.', 'Untick anyone you do not want to remind; add a note if you like.', 'Press “Email reminders”. Each person can upload the filled template from the link, or type the numbers online.'],
    }),
    h('div', { class: 'bar' },
      field('Report', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('remDs', e.target.value); renderReminders(); } })),
      is('state') ? null : field('State', select(o.states, stateId, { onchange: (e) => { pref('remState', e.target.value); renderReminders(); } })),
      field(periodWord(ds.frequency), select(periods, period, { onchange: (e) => { pref('remPe:' + ds.id, e.target.value); renderReminders(); } }))),
    r.emailConfigured ? null : h('div', { class: 'note warn' }, h('strong', {}, 'Email is not connected yet. '),
      'Until it is, copy each person’s message (it includes the upload link) and send it by WhatsApp or your own email; they download the template from the link. ',
      is('sysadmin') ? 'To connect email: create a free account at resend.com, verify the lganutritiondata.org domain there, then add the secret EMAIL_API_KEY and the variable EMAIL_FROM (e.g. “LGA Scorecard <reports@lganutritiondata.org>”) to the Worker in Cloudflare.' : 'Ask the system administrator to connect an email service.'),
    h('div', { class: 'panel' },
      h('h2', {}, `${r.places.length} report${r.places.length === 1 ? '' : 's'} not sent — ${r.periodName}, due ${fmtDay(r.due)}`),
      r.places.length ? h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Place'), h('th', {}, 'Status'), h('th', {}, 'Person'), h('th', {}, 'Email'), h('th', {}, 'Last reminded'), h('th'))),
        h('tbody', {}, people.map(({ p, u, box }) => h('tr', {}, h('td', {}, box), h('td', {}, p.name, p.lga && p.lga !== p.name ? h('div', { class: 'cov' }, p.lga) : null),
          h('td', {}, pill(p.status, STATUS_PLAIN[p.status])), h('td', {}, u.name), h('td', { class: 'small' }, u.email), h('td', { class: 'small' }, fmtDate(u.lastReminded)),
          h('td', {}, h('button', { class: 'link', onclick: () => copyMsg(u) }, 'Copy message')))))))
        : h('p', { class: 'muted' }, 'Every report is sent. Nothing to remind.'),
      noAccount.length ? h('p', { class: 'muted small' }, `No account to remind for: ${noAccount.map((p) => p.name).join(', ')}. Create accounts on the Users page.`) : null,
      h('p'), h('div', { class: 'f' }, h('span', {}, 'Note in the email (optional)'), note), h('p'),
      h('div', { class: 'actions' }, send, h('button', { onclick: () => copy(r.link) }, 'Copy upload link')), out),
    h('details', { class: 'panel' }, h('summary', {}, 'See the email text'), h('pre', { class: 'small', style: 'white-space:pre-wrap' }, r.sample))));
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
// "Who has sent": a drill-down. Whole country → one row per state (% sent); a state → its LGAs; for reports sent by
// schools / facilities, an LGA → each school / facility. State and LGA users start at their own level.
async function renderReview() {
  // Population figures are entered centrally, not sent by anyone, so they are not listed here.
  const sets = myDatasets().filter((d) => !d.shared && !d.archived);
  if (!sets.length) return mount(noDatasets());
  // LGA reviewers only review data sets reported by org units below the LGA.
  const usable = role() === 'lga' ? sets.filter((d) => d.reportLevel === 'UNIT') : sets;
  if (!usable.length) return mount(h('div', { class: 'note info' }, 'None of your reports come from org units below the LGA.'));
  const ds = usable.find((d) => d.id === pref('ds')) || usable[0];
  const byUnit = ds.reportLevel === 'UNIT';
  await meta();
  const pw = placeWords(ds); const lc = (w) => (w === 'LGA' || w === 'LGAs' ? w : w.toLowerCase());
  const national = state.me.ou.level === 1;
  const myState = ['state', 'lga'].includes(role()) ? (state.me.ou.path ? state.me.ou.path.split('/')[2] : state.me.ou.id) : '';
  const o = national ? await orgs() : null;
  const states = o ? o.states.filter((x) => x.active !== false) : [];
  // Where we are in the drill-down.
  let stateId = myState || (states.some((x) => x.id === pref('rstate')) ? pref('rstate') : '');
  if (national && states.length === 1) stateId = states[0].id;
  const lgaId = byUnit ? (role() === 'lga' ? '' : pref('rlga') || '') : '';
  const period = pref('pe:' + ds.id);
  const retry = (url, params) => get(url + qs(params)).catch((e) => {
    if (e.body && e.body.error && e.body.error.field === 'period') { pref('pe:' + ds.id, null); return get(url + qs({ ...params, period: undefined })); } throw e;
  });
  const goState = (id) => { pref('rstate', id); pref('rlga', ''); renderReview(); };
  const goLga = (id) => { pref('rlga', id); renderReview(); };
  // Which view: 'states' (country), 'lgas' (a state, unit report), 'list' (LGAs of a state, or units).
  const view = !stateId ? 'states' : byUnit && !lgaId && role() !== 'lga' ? 'lgas' : 'list';
  const st = view === 'list'
    ? await retry('/api/status', { dataset: ds.id, state: stateId, lga: lgaId, period })
    : await retry('/api/status/summary', { dataset: ds.id, state: view === 'lgas' ? stateId : undefined, period });
  await meta();
  const what = lc(pw.many);
  const stateName = st.state ? st.state.name : '';
  const lgaName = lgaId && st.lgaOptions ? (st.lgaOptions.find((l) => l.id === lgaId) || {}).name : '';
  // Breadcrumb.
  const crumbs = [];
  if (national && states.length > 1) crumbs.push(view === 'states' ? h('strong', {}, 'All states') : h('a', { href: '#/review', onclick: (e) => { e.preventDefault(); goState(''); } }, 'All states'));
  if (stateId) crumbs.push(view === 'lgas' || !byUnit ? h('strong', {}, stateName) : role() === 'lga' ? h('strong', {}, state.me.ou.name) : h('a', { href: '#/review', onclick: (e) => { e.preventDefault(); goLga(''); } }, stateName));
  if (lgaId) crumbs.push(h('strong', {}, lgaName || 'LGA'));
  const crumbBar = crumbs.length > 1 ? h('div', { class: 'crumbs' }, crumbs.flatMap((c, i) => (i ? [h('span', { class: 'muted' }, ' › '), c] : [c]))) : null;
  const bar = (pct) => { const fill = h('span', {}); fill.style.width = `${pct || 0}%`; return h('div', { class: 'pbar' }, fill); };
  const pctCell = (r) => h('td', { class: 'pcell' }, bar(r.percent), h('span', { class: 'n' }, r.percent == null ? '—' : `${r.percent}%`));
  const head = pageHead({
    title: role() === 'lga' ? `${pw.one} reports` : 'Who has sent',
    sub: `${view === 'states' ? 'All states' : role() === 'lga' ? state.me.ou.name : lgaName ? `${lgaName}, ${stateName}` : stateName} · ${st.dataset.name} · ${st.periodName} · due ${fmtDay(st.due)}`,
    text: `How many ${what} have sent this report. A report counts as soon as it is sent.`,
    how: [
      'Choose the report and the period at the top.',
      national ? 'Start with the states. Click a state to see its LGAs' + (byUnit ? `, then an LGA to see each ${lc(pw.one)}.` : '.') : byUnit && role() !== 'lga' ? `Click an LGA to see each ${lc(pw.one)}.` : 'Those not sent yet are at the top.',
      'In the full list, click one not sent yet to type it in on their behalf, or use Send reminders. To correct a sent report, a system administrator deletes it and it is typed in again.',
    ],
  });
  const filters = h('div', { class: 'bar' },
    field('Report', select(usable.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); pref('rlga', ''); renderReview(); } })),
    field(periodWord(ds.frequency), select(st.periods, st.period, { onchange: (e) => { pref('pe:' + ds.id, e.target.value); renderReview(); } })));

  if (view !== 'list') {
    // Summary table: states, or the LGAs of one state.
    const unitsWord = pw.many;
    const rows = st.rows;
    const note = h('div', { class: 'note ' + (st.sent < st.total ? 'warn' : 'ok') }, h('strong', {}, `${st.percent == null ? '—' : st.percent + '%'} reported: `),
      `${st.sent} of ${st.total} ${what} have sent${view === 'states' ? ` across ${rows.length} state${rows.length === 1 ? '' : 's'}` : ` in ${stateName}`}.`);
    const table = rows.length ? h('div', { class: 'scroll' }, h('table', { class: 'summary' },
      h('thead', {}, h('tr', {}, h('th', {}, view === 'states' ? 'State' : 'LGA'),
        view === 'states' && byUnit ? h('th', { class: 'n' }, 'LGAs with a report') : null,
        h('th', { class: 'n' }, unitsWord), h('th', { class: 'n' }, 'Sent'), h('th', { class: 'n' }, 'Not sent'), h('th', {}, '% reported'), h('th', {}, ''))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.total ? 'click' : '', onclick: r.total ? () => (view === 'states' ? goState(r.id) : goLga(r.id)) : null },
        h('td', {}, r.name),
        view === 'states' && byUnit ? h('td', { class: 'n' }, `${r.lgasSent} of ${r.lgas}`) : null,
        h('td', { class: 'n' }, r.total), h('td', { class: 'n' }, r.sent), h('td', { class: 'n' }, r.total - r.sent), pctCell(r),
        h('td', { class: 'n' }, r.total ? h('button', {}, 'Open ›') : h('span', { class: 'muted small' }, byUnit ? 'none listed' : '')))))))
      : h('div', { class: 'panel empty' }, view === 'states' ? 'No states are in use yet.' : 'No LGAs.');
    return mount(h('div', {}, head, filters, crumbBar, note, table));
  }

  // Full list: each LGA, or each org unit below the LGA.
  const open = (l) => {
    pref('ds', ds.id); pref('state', stateId); pref('pe:' + ds.id, st.period);
    if (byUnit) { pref('lga', l.lgaId); pref('unit', l.id); } else pref('lga', l.id);
    go('#/entry');
  };
  const order = { none: 0, draft: 1, returned: 2, submitted: 3, accepted: 3 };
  const list = [...st.lgas].sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  const sent = st.counts.accepted + st.counts.submitted;
  const pct = st.total ? Math.round((100 * sent) / st.total) : null;
  const summary = `${sent} sent · ${st.total - sent} not sent yet${st.counts.draft ? ` (${st.counts.draft} being typed in)` : ''}`;
  mount(h('div', {}, head, filters, crumbBar,
    h('div', { class: 'note ' + (sent < st.total ? 'warn' : 'ok') }, h('strong', {}, `${pct == null ? '—' : pct + '%'} reported · ${st.total} ${what}: `), summary),
    list.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, byUnit && !lgaId ? h('th', {}, 'LGA') : null, h('th', {}, pw.one), h('th', {}, 'Status'), h('th', {}, 'Sent on'), h('th', {}, ''))),
      h('tbody', {}, list.map((l) => h('tr', { class: 'click', onclick: () => open(l) },
        byUnit && !lgaId ? h('td', { class: 'small' }, l.lgaName) : null,
        h('td', {}, l.name, l.type ? h('span', { class: 'muted small' }, ` · ${l.type}`) : null), h('td', {}, pill(l.status, STATUS_PLAIN[l.status]), l.late ? h('span', { class: 'late' }, 'Late') : null),
        h('td', {}, fmtDate(l.submittedAt)),
        h('td', { class: 'n' }, ['submitted', 'accepted'].includes(l.status) ? h('button', {}, 'View') : h('button', { class: 'primary' }, 'Type it in')))))))
      : h('div', { class: 'panel empty' }, byUnit ? `No ${lc(pw.many)} are listed here yet. Add them under Set-up → Units below the LGA.` : 'No LGAs.'),
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
      sub: `${p.dataset.name} · ${byUnit ? `${p.total.unitsReporting} of ${p.total.expectedUnits} schools / facilities reporting` : `${p.total.reportingUnits} of ${p.total.totalUnits} LGAs reporting`} · ${'sent reports'}`,
      text: 'The indicators of one report for one period. The first row is the total for the whole area; then one row per place.',
      how: [
        'Choose the form, the area and the period.',
        'Totals add up the numbers of the places that reported, then recalculate each rate. They never average percentages.',
        'Point at a value to see the two numbers it is calculated from.',
        'Every report counts as soon as it is sent.',
      ],
      actions: [h('button', { onclick: () => window.print() }, 'Print')],
    }),
    h('div', { class: 'bar' },
      field('Report', select(sets.map((d) => ({ id: d.id, name: dsLabel(d) })), ds.id, { onchange: (e) => { pref('ds', e.target.value); renderPicture(); } })),
      ouOptions.length > 1 ? field('Area', select(ouOptions, ou, { onchange: (e) => {
        const v = e.target.value; pref('pou', v);
        if (topIds.includes(v)) pref('pstate', v === topIds[0] && state.me.ou.level === 1 ? '' : v);
        renderPicture();
      } })) : null,
      field('Period', select(choices, period, { onchange: (e) => { pref('ppe:' + ds.id, e.target.value); renderPicture(); } })),
      field('Sector', select([{ id: '', name: 'All sectors' }, ...sectors], sector, { onchange: (e) => { pref('sector', e.target.value); renderPicture(); } })),
      false && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: provisional, onchange: (e) => { pref('prov', e.target.checked); renderPicture(); } }), 'Include reports not yet accepted')),
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
      false && h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: prov, onchange: (e) => setP('prov', e.target.checked) }), 'Include reports not yet accepted')));
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
      h('span', { class: 'muted small' }, `${rowsList.length} rows × ${colsList.length} columns · ${'sent reports'} · hover a value for numerator / denominator`)),
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
      h('label', { class: 'check' }, withUnits, 'Also include the units below each LGA — wards, facilities, schools … (those of the chosen sector, or all)'), h('p'),
      metaBtn,
      h('h3', {}, 'Step 2 · The numbers (data values file)'),
      h('div', { class: 'bar' }, field('Period type', typeSel), field('From', from), field('To', to),
        h('div', { class: 'chips' }, h('span', { class: 'muted small' }, 'Levels:'), ['Country', 'State', 'LGA', 'Units below the LGA (one state)'].map((n, i) => h('label', { class: 'check' }, lv[i], n)))),
      false && h('label', { class: 'check' }, prov, 'Include reports not yet accepted'),
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

// The three steps of adding a sector (the current one marked).
function sectorSteps(current, ds) {
  const steps = [
    ['Name the sector and its schedule', 'How often it reports (monthly, quarterly, yearly) and who reports: each LGA, or each unit below the LGA (facility, school …).'],
    ['Add its indicators', 'For each: what is counted (numerator) and, for a rate, what it is divided by (denominator). These become the boxes people fill in.'],
    ['Give people access', 'On Users, create accounts or a registration QR code for this sector. Its people then see the report under “My reports”.'],
  ];
  return h('ol', { class: 'flow' }, steps.map(([t, d], i) => h('li', { class: i + 1 < current ? 'done' : i + 1 === current ? 'now' : '' },
    h('span', { class: 'flownum' }, i + 1 < current ? '✓' : String(i + 1)),
    h('div', {}, h('strong', {}, t), h('div', { class: 'small muted' }, d),
      i === 2 && current >= 2 && ds ? h('a', { class: 'btn small-btn', href: '#/accounts' }, 'Go to Users →') : null))));
}

// A sector's reporting schedule in plain words. (Underneath, each schedule is a DHIS2-style data set.)
// Who reports, in words: “each LGA”, “each ward”, “each health facility / primary school” (sector unit types).
function whoText(d) {
  if (d.reportLevel !== 'UNIT') return 'each LGA';
  const types = (state.meta && state.meta.unitTypes) || [];
  const names = (d.unitTypes || []).map((id) => (types.find((t) => t.id === id) || {}).name).filter(Boolean);
  return names.length ? 'each ' + names.map((n) => n.toLowerCase()).join(' / ') : 'each unit below the LGA';
}
const scheduleText = (d) => `${d.frequencyName} · ${whoText(d)} reports · due on day ${d.dueDay} of the next month`;
// What a report's places are called: "LGA(s)", or the configured child unit type ("Primary school(s)",
// "Health facilit(y/ies)", "Ward(s)"); "Org unit(s)" when a report is set up for several types.
const plural = (w) => (/[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|ch|sh)$/i.test(w) ? w + 'es' : w + 's');
function placeWords(d) {
  if (d.reportLevel !== 'UNIT') return { one: 'LGA', many: 'LGAs' };
  const types = (state.meta && state.meta.unitTypes) || [];
  const names = (d.unitTypes || []).map((id) => (types.find((t) => t.id === id) || {}).name).filter(Boolean);
  const one = names.length === 1 ? names[0] : 'Org unit';
  return { one, many: plural(one) };
}

// “Who reports” on a schedule: each LGA, each ward, or each unit of the sector's own types (health facilities,
// schools … set up under Units below the LGA). Returns the control and its value.
function whoReportsPicker(m, ds) {
  const custom = (m.unitTypes || []).filter((t) => !t.isWard);
  // Health facilities are a choice of their own (official DHIS2 facilities, loaded under Units below the LGA).
  const hf = custom.find((t) => t.id === 'ut_health_facility') || custom.find((t) => /^health facilit/i.test(t.name));
  const dsTypes = (ds && ds.unitTypes) || [];
  const cur = ds && ds.reportLevel === 'UNIT'
    ? (dsTypes.includes('ut_ward') ? 'WARD' : hf && dsTypes.length === 1 && dsTypes[0] === hf.id ? 'HF' : 'UNIT') : 'LGA';
  const level = select([
    { id: 'LGA', name: 'Each LGA (default)' },
    { id: 'WARD', name: 'Each ward' },
    { id: 'HF', name: 'Each health facility' },
    { id: 'UNIT', name: 'Other units: school … (types you choose)' },
  ], cur);
  const boxes = custom.map((t) => ({ t, box: h('input', { type: 'checkbox', checked: !!(ds && (ds.unitTypes || []).includes(t.id)) }) }));
  const newType = h('input', { placeholder: 'or a new type, e.g. Primary school', size: 28 });
  const typesArea = h('div', { class: 'whotypes' },
    h('div', { class: 'small muted' }, 'Which units report? Tick the unit types:'),
    custom.length ? h('div', { class: 'chips' }, boxes.map((x) => h('label', { class: 'check' }, x.box, x.t.name))) : h('div', { class: 'small' }, 'No unit types yet — type one below.'),
    h('div', { class: 'bar' }, newType, h('a', { class: 'small', href: '#/units' }, 'Units below the LGA →')));
  const paint = () => { typesArea.hidden = level.value !== 'UNIT'; };
  level.addEventListener('change', paint); paint();
  return {
    el: h('div', {}, level, typesArea),
    level,
    onChange: (fn) => { level.addEventListener('change', fn); boxes.forEach((x) => x.box.addEventListener('change', fn)); newType.addEventListener('input', fn); },
    // Names for the schedule's name, e.g. ", by ward" / ", by health facility".
    byText: () => (level.value === 'LGA' ? '' : level.value === 'WARD' ? ', by ward' : level.value === 'HF' ? ', by health facility'
      : ', by ' + [...boxes.filter((x) => x.box.checked).map((x) => x.t.name), newType.value.trim()].filter(Boolean).map((n) => n.toLowerCase()).join(' / ') || ', by unit'),
    async value() {
      if (level.value === 'LGA') return { reportLevel: 'LGA', unitTypes: [] };
      if (level.value === 'WARD') return { reportLevel: 'UNIT', unitTypes: ['ut_ward'] };
      if (level.value === 'HF') return { reportLevel: 'UNIT', unitTypes: [hf ? hf.id : (await api('POST', '/api/unit-types', { name: 'Health facility' })).data.id] };
      const ids = boxes.filter((x) => x.box.checked).map((x) => x.t.id);
      if (newType.value.trim()) {
        const found = (m.unitTypes || []).find((t) => t.name.toLowerCase() === newType.value.trim().toLowerCase());
        ids.push(found ? found.id : (await api('POST', '/api/unit-types', { name: newType.value.trim() })).data.id);
      }
      if (!ids.length) throw new Error('Tick at least one unit type that reports (or type a new one).');
      return { reportLevel: 'UNIT', unitTypes: [...new Set(ids)] };
    },
  };
}
const calcText = (i) => (i.denominator ? `${i.numerator} ÷ ${i.denominator}` : i.numerator);

// Sectors page: each sector with its indicators. Most sectors have one reporting schedule; a second one
// (e.g. yearly, or by school) only shows up when someone adds it.
async function renderSectors(m) {
  const defs = (await get('/api/dictionary').catch(() => ({ definitions: [] }))).definitions;
  const defById = new Map(defs.map((d) => [d.id, d]));
  for (const d of m.datasets) for (const i of d.indicators) {
    const def = defById.get(i.defId);
    i.code = def ? def.code : '';
    i.sharedWith = def ? [...new Set(def.uses.filter((u) => u.datasetId !== d.id).map((u) => u.sector || u.dataset))] : [];
  }
  const admin = is('sysadmin');
  const canEdit = is('sysadmin', 'setupadmin');
  const shared = m.datasets.find((d) => d.shared && !d.archived);
  const forms = m.datasets.filter((d) => !d.shared);
  const indTable = (d) => {
    const list = d.indicators.filter((i) => !i.archived);
    return list.length ? h('table', { class: 'todo indlist' }, h('tbody', {}, list.map((i) => h('tr', { class: canEdit ? 'click' : '', onclick: canEdit ? () => indicatorDialog(d, m, i) : null },
      h('td', {}, i.code ? h('span', { class: 'id' }, i.code) : null, i.code ? ' ' : null, h('strong', {}, i.name), i.sector && i.sector !== d.sector ? h('span', { class: 'muted small' }, ` · ${i.sector}`) : null,
        i.sharedWith && i.sharedWith.length ? h('div', { class: 'cov' }, 'Shared with ', i.sharedWith.join(', ')) : null),
      h('td', { class: 'small' }, calcText(i)),
      h('td', { class: 'small muted' }, i.source || ''),
      h('td', { class: 'n small muted' }, { percent: '%', per1000: 'per 1,000', number: 'number' }[i.showAs] || '')))))
      : h('p', { class: 'muted small' }, 'No indicators yet — nobody has anything to report on this schedule.');
  };
  const block = (d, several) => h('div', { class: 'schedule' + (d.archived ? ' archived' : '') },
    h('div', { class: 'schedhead' },
      h('div', {}, several ? h('strong', {}, d.name) : null, h('span', { class: 'muted small' }, (several ? ' · ' : '') + scheduleText(d) + (d.archived ? ' · archived' : ''))),
      h('div', { class: 'actions' },
        canEdit && !d.archived ? h('button', { class: 'primary', onclick: () => indicatorDialog(d, m, null) }, '+ Add indicator') : null,
        admin ? h('button', { class: 'link', onclick: () => datasetDialog(d, m) }, 'Schedule settings') : null,
        canEdit ? h('a', { class: 'small', href: '#/setup/' + d.id }, 'Edit as a table') : null)),
    indTable(d));
  const sectorIds = [...new Set([...m.sectors.map((s) => s.id), ...forms.map((d) => d.sectorId)])];
  const cards = sectorIds.map((sid) => {
    const known = m.sectors.find((s) => s.id === sid);
    const mine = forms.filter((d) => d.sectorId === sid).sort((a, b) => (a.archived ? 1 : 0) - (b.archived ? 1 : 0) || a.name.localeCompare(b.name));
    if (!known) {
      // Schedules whose sector is missing: say so and offer the ways out. Archived ones are not shown.
      const open = mine.filter((d) => !d.archived);
      if (!open.length) return null;
      return h('div', { class: 'panel sector-card' },
        h('div', { class: 'rc-head' }, h('h2', {}, 'Without a sector')),
        h('div', { class: 'note warn' }, 'These belong to no sector. Use Schedule settings to choose the sector — or, if it was only a test, Delete it there (possible while nothing was reported; otherwise Archive).'),
        open.map((d) => block(d, true)));
    }
    const sec = known;
    const active = mine.filter((d) => !d.archived);
    const archived = mine.filter((d) => d.archived);
    const unused = !mine.length && !sec.indicators;
    return h('div', { class: 'panel sector-card' },
      h('div', { class: 'rc-head' }, h('h2', {}, sec.name),
        h('div', { class: 'actions' },
          admin && sec.id ? h('button', { class: 'link', onclick: () => editSectorDialog(sec, active, m) }, 'Edit sector') : null,
          admin && sec.id && unused ? h('button', { class: 'link danger-link', onclick: () => removeSector(sec) }, 'Remove') : null)),
      active.length ? active.map((d) => block(d, active.length > 1))
        : h('div', { class: 'note info' }, `${sec.name} has no reporting schedule yet, so nobody can report for it.`,
          admin ? h('div', {}, h('button', { class: 'primary', style: 'margin-top:8px', onclick: () => datasetDialog(null, m, false, sec.name) }, 'Set its schedule')) : null),
      archived.length ? h('details', {}, h('summary', { class: 'small muted' }, `Archived (${archived.length})`), archived.map((d) => block(d, true))) : null,
      admin && active.length ? h('div', { class: 'actions' }, h('button', { class: 'link', onclick: () => datasetDialog(null, m, false, sec.name) }, `+ Add indicators with a different schedule (e.g. yearly, or by school)`)) : null);
  }).filter(Boolean);

  // Right after adding a sector: open the first indicator straight away.
  const openId = pref('openAddInd'); if (openId) pref('openAddInd', null);
  mount(h('div', {},
    pageHead({
      title: 'Sectors & indicators',
      text: 'Each sector (Health, Education, Agriculture, WASH …) has its indicators. The numerator and denominator of each indicator become the boxes people fill in when they report.',
      actions: [admin ? h('button', { class: 'primary big', onclick: () => sectorDialog(m) }, '+ Add a sector') : null, h('a', { class: 'small', href: '#/dictionary', title: 'Every indicator any sector uses: codes, definitions, Excel import' }, 'All indicators (dictionary) →')].filter(Boolean),
    }),
    h('div', { class: 'panel guide' }, h('h2', {}, 'Adding a sector takes three steps'), sectorSteps(admin ? 1 : 0),
      admin ? h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: () => sectorDialog(m) }, 'Start: + Add a sector')) : h('p', { class: 'muted small' }, 'Only system administrators can add a sector. You can add and change the indicators of your sectors.')),
    !shared ? h('div', { class: 'note info' }, 'Tip: indicators that divide by population (e.g. “Expected pregnancies”) need the ', h('a', { href: '#/population' }, 'Population figures'), ' set up first.') : null,
    h('h2', {}, cards.length ? `Your sectors (${cards.length})` : ''),
    cards.length ? cards : h('div', { class: 'panel empty' },
      h('h2', {}, 'No sectors yet'),
      h('p', {}, 'Start with one, for example Health, reported monthly by each LGA.')),
  ));
  const toOpen = openId && forms.find((d) => d.id === openId);
  if (toOpen) indicatorDialog(toOpen, m, null, true);
}

// Add or change one indicator.
// Every number any sector already counts or divides by (not population figures), with the sectors using it —
// suggested when typing a numerator, so the same thing gets the same name (and the same box) everywhere.
function numbersInUse(m) {
  const seen = new Map();
  for (const d of m.datasets.filter((x) => !x.shared && !x.archived)) {
    for (const i of (d.indicators || []).filter((x) => !x.archived)) {
      for (const n of [i.numerator, i.denominator]) {
        const k = String(n || '').trim().toLowerCase();
        if (!k) continue;
        if (!seen.has(k)) seen.set(k, { name: String(n).trim(), sectors: new Set() });
        seen.get(k).sectors.add(d.sector || d.name);
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ name: x.name, label: [...x.sectors].join(', ') }));
}

// Required on every indicator: name, numerator, source and how it is shown; a percentage or a rate per 1,000
// also needs its denominator. Returns what is missing, in words, or ''.
function indicatorMissing(x) {
  const miss = [];
  if (!String(x.name || '').trim()) miss.push('a name');
  if (!String(x.numerator || '').trim()) miss.push('a numerator');
  if (!String(x.source || '').trim()) miss.push('the source');
  if (!x.showAs) miss.push('how it is shown (percentage, per 1,000 or whole number)');
  else if ((x.showAs === 'percent' || x.showAs === 'per1000') && !String(x.denominator || '').trim()) miss.push('a denominator (a percentage or a rate per 1,000 divides by one)');
  return miss.length ? `Fill in ${miss.length > 1 ? miss.slice(0, -1).join('; ') + '; and ' + miss[miss.length - 1] : miss[0]}.` : '';
}

// Denominators people usually divide by. Total population is imported (NPC projections or WorldPop); the others
// are calculated from it as a share, using standard planning shares (WHO / NPHCDA) that each programme can change.
const COMMON_DENOMINATORS = [
  { name: 'Total population', prorate: false, share: null, hint: 'Imported: NPC projections (2006 census) or WorldPop' },
  { name: 'Expected pregnancies', prorate: true, share: 4.5, hint: 'Pregnancies in a year', on: true },
  { name: 'Expected live births', prorate: true, share: 4, hint: 'Births in a year', on: true },
  { name: 'Children under 1', prorate: false, share: 4, hint: '0–11 months', on: true },
  { name: 'Children 6–23 months', prorate: false, share: 6, hint: 'Complementary feeding age' },
  { name: 'Children 6–59 months', prorate: false, share: 18, hint: 'Vitamin A, MUAC screening' },
  { name: 'Children under 5', prorate: false, share: 20, hint: '0–59 months', on: true },
  { name: 'Women of reproductive age (15–49)', prorate: false, share: 22, hint: 'Women 15–49 years', on: true },
  { name: 'School-age children (6–11)', prorate: false, share: 16, hint: 'Primary school age' },
  { name: 'Adolescents (10–19)', prorate: false, share: 22, hint: '10–19 years' },
  { name: 'Households', prorate: false, share: 20, hint: 'Population ÷ 5 people per household' },
];

// Denominator drop-down: the population figures already set up, common ones not set up yet, numbers already used
// as denominators (or reported on this form), or a new one.
function denominatorPicker(m, ds, current) {
  const lc = (x) => String(x || '').trim().toLowerCase();
  const sharedDs = m.datasets.find((d) => d.shared && !d.archived);
  const pop = sharedDs ? sharedDs.dataElements.filter((f) => !f.archived) : [];
  const popNames = new Set(pop.map((f) => lc(f.name)));
  const common = COMMON_DENOMINATORS.filter((c) => !popNames.has(lc(c.name)));
  const used = new Map();
  const addUsed = (n) => { const k = lc(n); if (k && k !== '1' && !popNames.has(k) && !common.some((c) => lc(c.name) === k) && !used.has(k)) used.set(k, n.trim()); };
  for (const d of m.datasets.filter((x) => !x.shared)) for (const i of d.indicators || []) if (!i.archived) addUsed(i.denominator);
  for (const f of (ds.dataElements || []).filter((x) => !x.archived)) addUsed(f.name);
  addUsed(current);
  const opt = (value, label) => h('option', { value }, label);
  const sel = h('select', { style: 'width:100%;max-width:100%;box-sizing:border-box' },
    opt('', '— none: a plain count —'),
    pop.length ? h('optgroup', { label: 'Population figures (yearly, per LGA)' }, pop.map((f) => opt('pop:' + f.name, f.name))) : null,
    common.length ? h('optgroup', { label: 'Common population figures — set up when first used' }, common.map((c) => opt('common:' + c.name, c.share != null ? `${c.name} (${c.share}% of population)` : c.name))) : null,
    used.size ? h('optgroup', { label: 'Numbers already used or reported' }, [...used.values()].sort().map((n) => opt('used:' + n, n))) : null,
    h('optgroup', { label: 'Something else' }, opt('new', '+ Add a new denominator …')));
  const newName = h('input', { placeholder: 'Name, e.g. Children 6–59 months', style: 'width:100%;box-sizing:border-box;margin-bottom:6px' });
  const newKind = select([
    { id: 'pop', name: 'Yearly population figure' },
    { id: 'box', name: 'Reported each period' },
  ], 'pop', { style: 'width:100%;box-sizing:border-box;margin-bottom:6px' });
  const split = h('input', { type: 'checkbox' });
  const splitLbl = h('label', { class: 'check small' }, split, 'Yearly flow: split by months (e.g. expected births)');
  const newArea = h('div', { class: 'whotypes' }, newName, newKind, splitLbl);
  const hint = h('span', { class: 'hint' });
  const set = (n) => {
    const k = lc(n);
    if (!k) sel.value = '';
    else if (popNames.has(k)) sel.value = 'pop:' + pop.find((f) => lc(f.name) === k).name;
    else if (common.some((c) => lc(c.name) === k)) sel.value = 'common:' + common.find((c) => lc(c.name) === k).name;
    else { if (!used.has(k)) sel.append(opt('used:' + n.trim(), n.trim())); sel.value = 'used:' + (used.get(k) || n.trim()); }
    paint();
  };
  const paint = () => {
    const v = sel.value;
    newArea.hidden = v !== 'new';
    splitLbl.hidden = newKind.value !== 'pop';
    const isPop = v.startsWith('pop:') || v.startsWith('common:') || (v === 'new' && newKind.value === 'pop');
    hint.replaceChildren(isPop
      ? h('span', {}, 'A population figure: taken from the yearly figures for each LGA, not asked each time. Fill them on ', h('a', { href: '#/population' }, 'Population figures'), ' from GRID3 / WorldPop or the official NPC projections (2006 census) for the year.')
      : v ? 'A number people report each period, next to the numerator.' : 'Optional. Needed for a percentage or a rate per 1,000.');
  };
  sel.addEventListener('change', paint); newKind.addEventListener('change', paint); paint();
  set(current || '');
  const name = () => (sel.value === 'new' ? newName.value.trim() : sel.value.replace(/^(pop|common|used):/, ''));
  return {
    el: h('div', {}, sel, newArea),
    hint,
    name,
    set,
    disable: (b) => { sel.disabled = b; newName.disabled = b; newKind.disabled = b; },
    // The chosen name; a common or new population figure is added to the Population figures first.
    async value() {
      const n = name();
      if (!n) return '';
      const c = sel.value.startsWith('common:') ? common.find((x) => x.name === n) : null;
      const makePop = c || (sel.value === 'new' && newKind.value === 'pop' && !popNames.has(lc(n)));
      if (makePop) {
        let sid = sharedDs && sharedDs.id;
        if (!sid) sid = (await api('POST', '/api/datasets', { name: 'Population and denominators', shared: true })).data.id;
        try { await api('POST', `/api/datasets/${sid}/fields`, { name: n, prorate: c ? c.prorate : split.checked, ...(c && c.share != null ? { calcShare: c.share } : {}) }); }
        catch (e) { if (e.status !== 409) throw e; }
      }
      return n;
    },
  };
}

async function indicatorDialog(ds, m, i, first = false) {
  const defs = (await get('/api/dictionary').catch(() => ({ definitions: [] }))).definitions.filter((d) => !d.archived);
  const myDef = i && defs.find((d) => d.id === i.defId);
  const onSchedule = new Set(ds.indicators.filter((x) => !x.archived).map((x) => x.defId));
  const pickable = defs.filter((d) => !onSchedule.has(d.id));
  const pick = i ? null : select([{ id: '', name: pickable.length ? '— a new indicator —' : '— a new indicator —' },
    ...pickable.map((d) => ({ id: d.id, name: `${d.code ? d.code + ' · ' : ''}${d.name}${d.sector ? ' (' + d.sector + ')' : ''}` }))], '');
  const code = h('input', { placeholder: 'optional, e.g. NUT-01', size: 12, value: myDef ? myDef.code : '' });
  const sharedFields = m.datasets.filter((d) => d.shared && !d.archived).flatMap((d) => d.dataElements.filter((f) => !f.archived));
  const boxes = ds.dataElements.filter((d) => !d.archived);
  const listId = 'boxes-' + ds.id;
  const inUse = numbersInUse(m).filter((x) => !boxes.some((b) => b.name.toLowerCase() === x.name.toLowerCase()));
  const dl = h('datalist', { id: listId }, boxes.map((d) => h('option', { value: d.name, label: 'On this form' })), inUse.map((x) => h('option', { value: x.name, label: `Used by ${x.label}` })), sharedFields.map((f) => h('option', { value: f.name, label: 'Population figure' })));
  const name = h('input', { value: i ? i.name : '', placeholder: 'e.g. ANC 4+ coverage' });
  const num = h('input', { list: listId, value: i ? i.numerator : '', placeholder: 'e.g. Women with 4+ ANC visits' });
  const denPick = denominatorPicker(m, ds, i ? i.denominator : '');
  const source = h('input', { value: i ? i.source : '', placeholder: 'e.g. HMIS register, school census' });
  const showAs = select([{ id: '', name: '— choose —' }, ...m.showAs], i ? (i.showAs === 'number' && i.denominator ? 'number' : i.showAs) : '');
  const splitNow = (boxId) => { const f = ds.dataElements.find((d) => d.id === boxId); return f ? [f.breakdownId, f.breakdown2Id].filter(Boolean).join('|') : ''; };
  const curSplit = i ? splitNow(i.numeratorId) : '';
  const split = select(splitChoices(curSplit), curSplit);
  const sector = sectorSelect(m, i ? i.sector : ds.sector);
  const id = h('input', { class: 'mono', placeholder: 'made automatically', maxlength: 11 });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, i ? 'Save' : 'Add indicator');
  const again = i ? null : h('button', {}, 'Add and add another');
  const del = i ? h('button', { class: 'link danger-link' }, 'Remove indicator') : null;
  // Optional; a percentage or a rate per 1,000 needs one.
  const denWrap = fieldGroup('Denominator — divided by (optional)', denPick.el, denPick.hint);
  const fromDict = h('div', { class: 'note info', hidden: true });
  const paintPick = () => {
    const d = pick && defs.find((x) => x.id === pick.value);
    for (const el of [name, num, source, showAs, code]) el.disabled = !!d;
    denPick.disable(!!d);
    if (d) { name.value = d.name; num.value = d.numerator; denPick.set(d.denominator); source.value = d.source; showAs.value = d.showAs; code.value = d.code; }
    fromDict.hidden = !d;
    if (d) fromDict.replaceChildren(h('strong', {}, 'From the indicator dictionary. '), d.definition ? d.definition.replace(/[.\s]*$/, '. ') : '', d.uses.length ? `Also reported by: ${[...new Set(d.uses.map((u) => u.sector || u.dataset))].join(', ')}. ` : '', 'To change it, edit it in the Indicator dictionary — it changes for every sector.');
  };
  if (pick) pick.addEventListener('change', paintPick);
  const sharedWith = myDef ? myDef.uses.filter((u) => u.indicatorId !== i.id) : [];
  const dlg = h('dialog', {},
    first ? h('div', { class: 'area area-admin area-setup' }, 'Step 2 of 3') : null,
    h('h2', {}, i ? i.name : `New indicator — ${ds.sector || ds.name}`),
    h('p', { class: 'muted small' }, scheduleText(ds)), dl,
    pick ? h('div', { class: 'f' }, h('span', {}, 'Already used by a sector? Pick it'), pick, h('span', { class: 'hint' }, 'Every indicator any sector adds is listed here. Picking it keeps one definition, so the figures can be added up and compared.')) : null,
    fromDict,
    sharedWith.length ? h('div', { class: 'note warn' }, `Shared definition: also used by ${[...new Set(sharedWith.map((u) => u.sector || u.dataset))].join(', ')}. Changing the name or calculation here changes it there too.`) : null,
    h('div', { class: 'grid2' },
      field('Indicator name *', name, 'As people will see it.'),
      field('Code (optional)', code, 'Your indicator code, e.g. from the national results framework.'),
      field('Source *', source, 'Where the numbers come from.'),
      field('Numerator — what is counted *', num, 'Becomes a box people fill in. The same name means the same box.'),
      denWrap,
      field('Show as *', showAs, 'Percentage and per 1,000 need a denominator; a whole number is a plain count.'),
      field('Count the numerator separately by', split, h('span', {}, 'People type it per group; the total adds itself up. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); breakdownsDialog(m); } }, 'Lists…'))),
      field('Sector', sector, 'Usually this sector; another one if the indicator belongs elsewhere.')),
    i ? h('p', { class: 'muted small' }, 'ID ', idTag(i.id)) : h('details', {}, h('summary', { class: 'small' }, 'Advanced: existing DHIS2 ID'), field('DHIS2 ID (only if the indicator already exists in DHIS2)', id)),
    err, h('p'), h('div', { class: 'actions' }, save, again, h('button', { onclick: () => dlg.close() }, i ? 'Close' : 'Cancel'), del));
  dlg.addEventListener('close', () => { dlg.remove(); state.meta = null; route(); });
  let denName = '';
  const vals = () => ({ sector: sector.value, name: name.value.trim(), numerator: num.value.trim(), denominator: denName, source: source.value.trim(), showAs: showAs.value });
  // Sets the split on the numerator's box after saving (only when it changed).
  const applySplit = async (ind) => {
    const box = ind && ind.numeratorId;
    if (!box || split.value === splitNow(box)) return;
    if (splitNow(box) && !confirm('Change how this number is counted? Parts typed in before stay stored but are no longer shown; reports not yet sent will ask for the new parts.')) return;
    const [b1, b2] = split.value ? split.value.split('|') : [];
    await api('PATCH', '/api/fields/' + box, { breakdownId: b1 || null, breakdown2Id: b2 || null });
  };
  const chosen = () => (pick && pick.value ? pick.value : null);
  const submit = async (keepOpen) => {
    err.textContent = '';
    if (!chosen()) {
      const missing = indicatorMissing({ name: name.value, numerator: num.value, source: source.value, showAs: showAs.value, denominator: denPick.name() });
      if (missing) { err.textContent = missing; return; }
    }
    try {
      if (!chosen()) denName = await denPick.value();
      let ind;
      if (i) {
        ind = (await api('PATCH', '/api/indicators/' + i.id, vals())).data.indicator;
        if (myDef && code.value.trim() !== (myDef.code || '')) await api('PATCH', '/api/dictionary/' + myDef.id, { code: code.value.trim() });
      } else if (chosen()) ind = (await api('POST', `/api/datasets/${ds.id}/indicators`, { defId: chosen(), sector: sector.value || undefined })).data.indicator;
      else { const body = vals(); if (id.value.trim()) body.id = id.value.trim(); if (code.value.trim()) body.code = code.value.trim(); ind = (await api('POST', `/api/datasets/${ds.id}/indicators`, body)).data.indicator; }
      await applySplit(ind);
    } catch (e) {
      err.textContent = e.message;
      // Same name, another calculation: offer the dictionary's one.
      const d = e.body && e.body.error && e.body.error.definition;
      if (d && pick) { pick.value = d.id; paintPick(); err.textContent += ' It is selected above — press Add to use it.'; }
      return;
    }
    toast(i ? 'Saved' : `Added “${name.value.trim()}”`);
    if (keepOpen) { state.meta = null; const m2 = await meta(true); const ds2 = m2.datasets.find((d) => d.id === ds.id); dlg.remove(); route(); indicatorDialog(ds2, m2, null); return; }
    dlg.close();
  };
  save.addEventListener('click', busy(save, () => submit(false)));
  if (again) again.addEventListener('click', busy(again, () => submit(true)));
  if (del) del.addEventListener('click', busy(del, async () => {
    if (!confirm(`Remove “${i.name}”? Values already reported are kept.`)) return;
    await api('DELETE', '/api/indicators/' + i.id); toast('Removed'); dlg.close();
  }));
  document.body.append(dlg); dlg.showModal(); (i ? name : name).focus();
}

// ---------- indicator dictionary ----------
const SHOW_NAMES = { percent: 'Percentage', per1000: 'Per 1,000', number: 'Number' };
async function renderDictionary() {
  const m = await meta(true);
  const defs = (await get('/api/dictionary')).definitions;
  const q = (pref('dictQ') || '').toLowerCase();
  const sec = pref('dictSector') || '';
  const shown = defs.filter((d) => (!q || `${d.code} ${d.name} ${d.definition} ${d.framework} ${d.numerator} ${d.denominator}`.toLowerCase().includes(q))
    && (!sec || d.sectorId === sec || d.uses.some((u) => u.sector === (m.sectors.find((x) => x.id === sec) || {}).name)));
  const search = h('input', { type: 'search', placeholder: 'Code, name, framework …', value: pref('dictQ') || '' });
  search.addEventListener('change', () => { pref('dictQ', search.value.trim()); renderDictionary(); });
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv', hidden: true });
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) try { await dictionaryImport(f); } catch (e) { toast(e.message, true); } });
  const tpl = h('button', {}, 'Download Excel template');
  tpl.addEventListener('click', busy(tpl, async () => {
    const { writeWorkbook } = await import('./xlsx.js');
    const head = ['Code', 'Indicator', 'Definition', 'Numerator (what is counted)', 'Denominator (leave empty for a count)', 'Show as', 'Source', 'Framework / reference', 'Sector'];
    const rows = defs.filter((d) => !d.archived).map((d) => [d.code, d.name, d.definition, d.numerator, d.denominator, SHOW_NAMES[d.showAs], d.source, d.framework, d.sector]);
    const sectors = m.sectors.map((x) => x.name);
    saveBlob(writeWorkbook([
      { name: 'Indicators', rows: [head, ...rows], widths: [12, 40, 50, 36, 32, 14, 24, 24, 18],
        lists: [{ sqref: 'F2:F2000', formula: 'Lists!$A$2:$A$4' }, ...(sectors.length ? [{ sqref: 'I2:I2000', formula: `Lists!$B$2:$B$${sectors.length + 1}` }] : [])] },
      { name: 'How to fill', rows: [['How to fill'], ...[
        'One row per indicator. Rows already in the dictionary are listed: change them here or add new rows below.',
        'Code: your indicator code (e.g. from the national results framework). Rows are matched by code, otherwise by name.',
        'Numerator: what is counted, e.g. “Infants 0-5 months exclusively breastfed”. Denominator: what it is divided by; empty for a plain count.',
        'Use the same words for the same number across indicators — the same name is the same box people fill in.',
        'Show as: Percentage, Per 1,000 or Number. Sector: the sector that usually reports it (optional; others can use it too).',
        'Import it with “Import Excel” on the Indicator dictionary page; you see a check before anything is saved.',
      ].map((x) => [x])], widths: [120] },
      { name: 'Lists', hidden: true, rows: Array.from({ length: Math.max(4, sectors.length + 1) }, (_, r) => (r === 0 ? ['Show as', 'Sector'] : [['Percentage', 'Per 1,000', 'Number'][r - 1] || '', sectors[r - 1] || ''])) },
    ]), 'Indicator_dictionary.xlsx');
  }));
  mount(h('div', {},
    pageHead({
      back: ['#/setup', 'Sectors & indicators'],
      title: 'Indicator dictionary',
      text: 'One definition per indicator, shared by every sector that reports it: its code, what is counted, what it is divided by, how it is shown, the source and the framework it belongs to. The same name always means the same calculation, so sectors can be compared and the codes go with the export.',
      how: [
        'Load your indicator list: download the Excel template, fill one row per indicator (or paste your list), and press Import Excel.',
        'In Sectors & indicators, “+ Add indicator” lets each sector pick from this dictionary.',
        'Change a definition here and it changes for every sector that uses it. Entries in use cannot be removed.',
      ],
      actions: [h('button', { class: 'primary', onclick: () => definitionDialog(null, m) }, '+ Add to dictionary'), tpl, h('button', { onclick: () => fileIn.click() }, 'Import Excel'), fileIn],
    }),
    h('div', { class: 'bar' }, field('Search', search),
      field('Sector', select([{ id: '', name: 'All sectors' }, ...m.sectors], sec, { onchange: (e) => { pref('dictSector', e.target.value); renderDictionary(); } })),
      h('span', { class: 'muted small' }, `${shown.length} of ${defs.length} indicators`)),
    shown.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Indicator'), h('th', {}, 'Calculation'), h('th', {}, 'Show as'), h('th', {}, 'Source'), h('th', {}, 'Framework'), h('th', {}, 'Reported by'))),
      h('tbody', {}, shown.map((d) => h('tr', { class: 'click' + (d.archived ? ' archived' : ''), onclick: () => definitionDialog(d, m) },
        h('td', {}, d.code ? h('span', { class: 'id' }, d.code) : ''),
        h('td', {}, h('strong', {}, d.name), d.definition ? h('div', { class: 'cov' }, d.definition) : null),
        h('td', { class: 'small' }, d.numerator, d.denominator ? ' ÷ ' + d.denominator : ''),
        h('td', { class: 'small' }, SHOW_NAMES[d.showAs]), h('td', { class: 'small' }, d.source), h('td', { class: 'small' }, d.framework),
        h('td', { class: 'small' }, d.uses.length ? [...new Set(d.uses.map((u) => u.sector || u.dataset))].join(', ') : h('span', { class: 'muted' }, 'Not used yet'),
          d.uses.some((u) => u.differs) ? h('div', { class: 'bad-text' }, 'Some sectors count it differently — open to see') : null))))))
      : h('div', { class: 'panel empty' }, defs.length ? 'No indicator matches.' : 'The dictionary is empty. Download the Excel template, fill in your indicator list and import it — or add them one by one.'),
  ));
}

// ---------- breakdowns: sex, age groups … ----------
// The ways a counted number can be split: none, one list, or two lists crossed (Sex × Age).
function splitChoices(cur) {
  const bds = (state.meta && state.meta.breakdowns) || [];
  const combos = [{ id: '', name: 'No — one total' }, ...bds.map((x) => ({ id: x.id, name: x.name })),
    ...bds.flatMap((x, i) => bds.slice(i + 1).map((y) => ({ id: `${x.id}|${y.id}`, name: `${x.name} × ${y.name}` })))];
  if (cur && !combos.some((c) => c.id === cur)) combos.push({ id: cur, name: cur.split('|').map((x) => (bds.find((b) => b.id === x) || { name: x }).name).join(' × ') });
  return combos;
}
function breakdownsDialog(m) {
  const dlg = h('dialog', { class: 'wide' }, breakdownsPanel(m), h('div', { class: 'actions' }, h('button', { onclick: () => dlg.close() }, 'Close')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
function breakdownsPanel(m) {
  const list = m.breakdowns || [];
  return h('div', {},
    h('h2', {}, 'Lists for counting separately'),
    h('p', { class: 'muted small' }, 'A counted number can be asked per sex or age group (choose it on the indicator). Sex and Age (under 5) are built in; add your own list here, e.g. school age groups. Renaming an option keeps the values already typed in.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Breakdown'), h('th', {}, 'Options'), h('th', {}, 'ID'))),
      h('tbody', {}, list.map((b) => h('tr', { class: 'click', onclick: () => breakdownDialog(b) },
        h('td', {}, h('strong', {}, b.name), b.builtIn ? h('div', { class: 'cov' }, 'Built in') : null),
        h('td', {}, h('div', { class: 'bd-opts' }, b.options.map((o) => h('span', {}, o.name)))),
        h('td', {}, idTag(b.id))))))),
    h('p', {}, h('button', { onclick: () => breakdownDialog(null) }, '+ New breakdown')));
}

function breakdownDialog(b) {
  const name = h('input', { value: b ? b.name : '', placeholder: 'e.g. Age (school)' });
  const opts = h('textarea', { rows: 6, placeholder: 'One option per line, e.g.\n6-11 years\n12-17 years' }); opts.value = b ? b.options.map((o) => o.name).join('\n') : '';
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, b ? 'Save' : 'Add breakdown');
  const del = b && !b.builtIn ? h('button', { class: 'link danger-link' }, 'Delete') : null;
  const dlg = h('dialog', {}, h('h2', {}, b ? b.name : 'New breakdown'),
    field('Name', name), h('div', { class: 'f' }, h('span', {}, 'Options, one per line'), opts),
    h('p', { class: 'muted small' }, 'Keep options that do not overlap and together cover everyone counted, so the parts add up to the total.'),
    err, h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel'), del));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const body = { name: name.value.trim(), options: opts.value.split('\n').map((x) => x.trim()).filter(Boolean) };
    try { if (b) await api('PATCH', '/api/breakdowns/' + b.id, body); else await api('POST', '/api/breakdowns', body); }
    catch (e) { err.textContent = e.message; return; }
    dlg.close(); toast('Saved'); state.meta = null; route();
  }));
  if (del) del.addEventListener('click', busy(del, async () => {
    try { await api('DELETE', '/api/breakdowns/' + b.id); } catch (e) { err.textContent = e.message; return; }
    dlg.close(); toast('Deleted'); state.meta = null; route();
  }));
  document.body.append(dlg); dlg.showModal();
}

function definitionDialog(d, m) {
  const code = h('input', { value: d ? d.code : '', placeholder: 'e.g. NUT-01' });
  const name = h('input', { value: d ? d.name : '', placeholder: 'e.g. Exclusive breastfeeding rate' });
  const definition = h('textarea', { placeholder: 'What the indicator measures, in one or two sentences.' }); definition.value = d ? d.definition : '';
  const num = h('input', { value: d ? d.numerator : '', placeholder: 'e.g. Infants 0-5 months exclusively breastfed' });
  const denPick = denominatorPicker(m, { dataElements: [] }, d ? d.denominator : '');
  const showAs = select([{ id: '', name: '— choose —' }, ...m.showAs], d ? d.showAs : '');
  const source = h('input', { value: d ? d.source : '', placeholder: 'e.g. HMIS register' });
  const framework = h('input', { value: d ? d.framework : '', placeholder: 'e.g. national plan, output 1.2' });
  const sector = select([{ id: '', name: '— any —' }, ...m.sectors.map((x) => ({ id: x.name, name: x.name }))], d ? d.sector : '');
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, d ? 'Save' : 'Add to dictionary');
  const del = d && !d.uses.length ? h('button', { class: 'link danger-link' }, 'Remove from dictionary') : null;
  const dlg = h('dialog', { class: 'wide' }, h('h2', {}, d ? d.name : 'New indicator in the dictionary'),
    d && d.uses.length ? h('div', { class: 'note warn' }, `Reported by ${d.uses.length} schedule${d.uses.length === 1 ? '' : 's'}: ${d.uses.map((u) => u.dataset).join(', ')}. Changing the name or calculation changes it for all of them.`) : null,
    d && d.uses.some((u) => u.differs) ? h('div', { class: 'note bad' }, `These count it differently from this definition: ${d.uses.filter((u) => u.differs).map((u) => u.dataset).join(', ')}. Press Save to make them all use this definition.`) : null,
    h('div', { class: 'grid2' }, field('Code', code), field('Indicator name *', name), field('Numerator — what is counted *', num), fieldGroup('Denominator — divided by (optional)', denPick.el, denPick.hint),
      field('Show as *', showAs, 'Percentage and per 1,000 need a denominator; a whole number is a plain count.'), field('Source *', source), field('Framework / reference', framework), field('Sector that usually reports it', sector)),
    h('div', { class: 'f' }, h('span', {}, 'Definition'), definition),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel'), del));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const missing = indicatorMissing({ name: name.value, numerator: num.value, source: source.value, showAs: showAs.value, denominator: denPick.name() });
    if (missing) { err.textContent = missing; return; }
    let body;
    try {
      body = { code: code.value.trim(), name: name.value.trim(), definition: definition.value.trim(), numerator: num.value.trim(), denominator: await denPick.value(), showAs: showAs.value, source: source.value.trim(), framework: framework.value.trim(), sector: sector.value };
      if (d) { const r = (await api('PATCH', '/api/dictionary/' + d.id, body)).data; toast(r.indicatorsUpdated ? `Saved — updated in ${r.indicatorsUpdated} schedule${r.indicatorsUpdated === 1 ? '' : 's'}` : 'Saved'); }
      else { await api('POST', '/api/dictionary', body); toast('Added to the dictionary'); }
    } catch (e) { err.textContent = e.message; return; }
    dlg.close(); state.meta = null; renderDictionary();
  }));
  if (del) del.addEventListener('click', busy(del, async () => { await api('DELETE', '/api/dictionary/' + d.id); dlg.close(); toast('Removed'); renderDictionary(); }));
  document.body.append(dlg); dlg.showModal();
}

async function dictionaryImport(file) {
  const { readSheet } = await import('./xlsx.js');
  const rows = await readSheet(file);
  const hi = rows.findIndex((r) => r.some((c) => /^(indicator|name|indicator name)$/i.test(String(c).trim())));
  if (hi < 0) throw new Error('No “Indicator” column found. Use the Excel template.');
  const head = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (t) => head.findIndex(t);
  const ci = { code: col((c) => c === 'code' || c.startsWith('code ')), name: col((c) => /^(indicator|name|indicator name)$/.test(c)), definition: col((c) => c.startsWith('definition') || c === 'description'),
    numerator: col((c) => c.startsWith('numerator')), denominator: col((c) => c.startsWith('denominator')), showAs: col((c) => c.startsWith('show as') || c === 'type' || c === 'unit'),
    source: col((c) => c.startsWith('source')), framework: col((c) => c.startsWith('framework') || c.startsWith('reference')), sector: col((c) => c.startsWith('sector')) };
  if (ci.numerator < 0) throw new Error('No “Numerator” column found. Use the Excel template.');
  const data = rows.slice(hi + 1).map((r, i) => Object.fromEntries([['row', hi + i + 2], ...Object.entries(ci).map(([k, c]) => [k, c >= 0 ? String(r[c] ?? '').trim() : ''])]))
    .filter((r) => r.name || r.code || r.numerator);
  if (!data.length) throw new Error('The file has no indicator rows.');
  const { data: chk } = await api('POST', '/api/dictionary/import', { rows: data });
  const c = chk.counts; const errors = chk.results.filter((r) => r.status === 'error'); const notes = chk.results.filter((r) => r.note);
  const go = h('button', { class: 'primary', disabled: !!c.error || !(c.add + c.update) }, `Save ${c.add + c.update} indicator${c.add + c.update === 1 ? '' : 's'}`);
  const dlg = h('dialog', { class: 'wide' }, h('h2', {}, 'Import the indicator dictionary — check'),
    h('p', { class: 'muted small' }, `${file.name} · ${data.length} rows`),
    h('div', { class: 'counts' }, h('span', { class: 'pill s-accepted' }, `New: ${c.add}`), h('span', { class: 'pill s-draft' }, `Updated: ${c.update}`), h('span', { class: 'pill s-none' }, `Unchanged: ${c.same}`), h('span', { class: 'pill s-returned' }, `Problems: ${c.error}`)),
    notes.length ? h('div', { class: 'note warn' }, notes.map((n) => h('div', {}, `${n.code || ''} ${n.name}: ${n.note}`))) : null,
    errors.length ? h('div', {}, h('div', { class: 'note bad' }, 'Fix these rows and import again. Nothing has been saved.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Indicator'), h('th', {}, 'Problem'))),
        h('tbody', {}, errors.slice(0, 200).map((e) => h('tr', {}, h('td', {}, e.row), h('td', {}, e.name), h('td', {}, e.message)))))))
      : h('div', { class: 'note ok' }, 'All rows look good.'),
    h('p'), h('div', { class: 'actions' }, go, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  go.addEventListener('click', busy(go, async () => { await api('POST', '/api/dictionary/import', { rows: data, commit: true }); dlg.close(); toast(`Saved ${c.add + c.update} indicators`); state.meta = null; renderDictionary(); }));
  document.body.append(dlg); dlg.showModal();
}

// Population figures: their own page under Set-up.
async function renderPopulation() {
  const m = await meta(true);
  const ds = m.datasets.find((d) => d.shared && !d.archived);
  const admin = is('sysadmin');
  const head = pageHead({
    title: 'Population figures',
    text: 'The denominators indicators divide by — expected pregnancies, children under 5, women 15–49 … Bring in total population for each LGA once a year; the rest is calculated from it.',
    how: [
      'Step 1: bring in total population for each LGA — the official NPC projections from Excel, or the WorldPop estimates in one click.',
      'Step 2: tick the denominators you need. Each is a share of total population (e.g. expected pregnancies 4.5 %), set to standard planning values you can change.',
      'They are calculated for every LGA, and recalculated whenever total population changes. Indicators pick them from the denominator list.',
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

// Edit a sector in one place: its name, and how its main schedule reports (the same choices as “Add a sector”).
// Other schedules of the sector keep their own Schedule settings.
function editSectorDialog(sec, active, m) {
  const ds = active[0] || null;
  const name = h('input', { value: sec.name });
  const freq = ds ? select(m.frequencies, ds.frequency) : null;
  const who = ds ? whoReportsPicker(m, ds) : null;
  const due = ds ? h('input', { type: 'number', min: 1, max: 28, value: ds.dueDay }) : null;
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Save');
  const dlg = h('dialog', {}, h('h2', {}, `Edit sector — ${sec.name}`),
    ds ? h('p', { class: 'muted small' }, 'Once reports exist, how often and who reports can no longer change.') : null,
    h('div', { class: 'grid2' },
      field('Sector name', name, 'As people will see it.'),
      ds ? field('How often it reports', freq, 'Each report covers one month, quarter or year.') : null,
      ds ? fieldGroup('Who reports', who.el, 'Each LGA sends one report — or each ward, or each unit of the types you tick (health facility, school …). Values add up to the LGA.') : null,
      ds ? field('Due day', due, 'Day of the month after the period ends.') : null),
    active.length > 1 ? h('p', { class: 'muted small' }, `These settings are for “${ds.name}”. The sector’s other schedules (${active.slice(1).map((d) => d.name).join(', ')}) have their own Schedule settings.`) : null,
    !ds ? h('p', { class: 'muted small' }, 'This sector has no reporting schedule yet. Use “Set its schedule” on its card.') : null,
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const newName = name.value.trim();
    if (!newName) { err.textContent = 'Give the sector a name.'; return; }
    try {
      let body = null;
      if (ds) body = { frequency: freq.value, ...(await who.value()), dueDay: Number(due.value) };
      if (newName !== sec.name) await api('PATCH', '/api/sectors/' + sec.id, { name: newName });
      if (body) await api('PATCH', '/api/datasets/' + ds.id, body);
    } catch (e) { err.textContent = e.message; state.meta = null; return; }
    dlg.close(); toast('Sector saved'); state.meta = null; await loadMe(); route();
  }));
  document.body.append(dlg); dlg.showModal(); name.focus();
}

// One form: its indicators (editable grid) and the numbers people type in.
function renderForm(ds, m) {
  const sectorList = h('datalist', { id: 'sector-list' }, m.sectors.map((s) => h('option', { value: s.name })));
  const sharedFields = m.datasets.filter((d) => d.shared && !d.archived).flatMap((d) => d.dataElements.filter((f) => !f.archived));
  const fieldList = h('datalist', { id: 'field-list' },
    ds.dataElements.filter((d) => !d.archived).map((d) => h('option', { value: d.name })),
    ds.shared ? [] : numbersInUse(m).filter((x) => !ds.dataElements.some((d) => d.name.toLowerCase() === x.name.toLowerCase())).map((x) => h('option', { value: x.name, label: `Used by ${x.label}` })),
    ds.shared ? [] : sharedFields.map((f) => h('option', { value: f.name, label: 'Population figure (shared)' })));
  const head = pageHead({
    back: ['#/setup', 'All sectors'],
    title: ds.shared ? 'Population figures' : `${ds.sector || 'Indicators'} — all indicators as a table`,
    sub: ds.shared ? 'Shared by all sectors · entered once a year per LGA'
      : `${ds.name} · ${scheduleText(ds)}${ds.archived ? ' · ARCHIVED' : ''}`,
    text: ds.shared ? 'Add each yearly number here. Then import the official figures for every LGA from Excel.'
      : 'For quick edits of many indicators at once. One row per indicator; the last row adds a new one. The numerator and denominator become the boxes people fill in.',
    how: ds.shared ? null : [
      'Indicator: the name people will see, e.g. “ANC 4+ coverage”.',
      'Numerator: what is counted, e.g. “Women with 4+ ANC visits”. This becomes a box on the form.',
      'Denominator (optional): what it is divided by — pick it from the list (population figures, common ones, or numbers already used), or add a new one. Leave it on “none” for a plain count. Percentage and per 1,000 need one.',
      'Typing the same name twice uses the same box. Show as: percentage, per 1,000, or number.',
      'IDs are made automatically. Paste an existing DHIS2 ID only if the indicator already exists in DHIS2.',
    ],
    actions: [h('button', { onclick: () => datasetDialog(ds, m) }, 'Schedule settings')],
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
    rows.length ? null : h('div', { class: 'note info' }, 'No indicators yet. Fill in the row marked “Add a new indicator” and press Add.'),
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

// Name of a reporting schedule, e.g. “Health – monthly” or “Education – quarterly, by school / facility”; unique.
function scheduleName(m, sector, freqName, byText, skipId) {
  const base = `${sector} – ${freqName.toLowerCase()}${byText || ''}`;
  const taken = new Set(m.datasets.filter((d) => d.id !== skipId).map((d) => d.name.toLowerCase()));
  let n = base; let k = 2; while (taken.has(n.toLowerCase())) n = `${base} (${k++})`;
  return n;
}

// A new sector is created together with its reporting schedule.
function sectorDialog(m) {
  const forms = m.datasets.filter((d) => !d.shared);
  const sector = h('input', { placeholder: 'e.g. Agriculture' });
  const freq = select(m.frequencies, 'MONTHLY');
  const who = whoReportsPicker(m, null);
  const due = h('input', { type: 'number', min: 1, max: 28, value: 15 });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Add sector, then its indicators');
  const dlg = h('dialog', {}, h('div', { class: 'area area-admin area-setup' }, 'Step 1 of 3'), h('h2', {}, 'Add a sector'),
    h('p', { class: 'muted small' }, 'A sector is a ministry or department that reports its own indicators, e.g. Health, Education, Agriculture, WASH, Social Protection. Next you add its indicators.'),
    h('div', { class: 'grid2' },
      field('Sector name', sector, 'As people will see it.'),
      field('How often it reports', freq, 'Each report covers one month, quarter or year.'),
      fieldGroup('Who reports', who.el, 'Each LGA sends one report — or each ward, each health facility, or each of the sector’s own units (school …) sends its own. Values add up to the LGA.'),
      field('Due day', due, 'Day of the month after the period ends, e.g. 15.')),
    h('p', { class: 'muted small' }, 'Some indicators on another schedule (e.g. yearly, or by school)? Add them later with “+ Add indicators with a different schedule”.'),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    if (!sector.value.trim()) { err.textContent = 'Give the sector a name.'; return; }
    const existing = m.sectors.find((s) => s.name.toLowerCase() === sector.value.trim().toLowerCase());
    if (existing && forms.some((d) => d.sectorId === existing.id)) { err.textContent = `“${existing.name}” already exists. Add its indicators on its card instead.`; return; }
    const secName = existing ? existing.name : sector.value.trim();
    try {
      const w = await who.value();
      const { data } = await api('POST', '/api/datasets', { name: scheduleName(m, secName, freq.options[freq.selectedIndex].text, who.byText()), sector: secName, frequency: freq.value, ...w, dueDay: Number(due.value) });
      dlg.close(); state.meta = null; await loadMe(); toast(`Sector “${secName}” added. Now add its indicators.`); pref('openAddInd', data.id); go('#/setup');
    } catch (e) { err.textContent = e.message; }
  }));
  document.body.append(dlg); dlg.showModal(); sector.focus();
}

function indicatorRow(ds, i, m) {
  const isNew = !i;
  const sector = sectorSelect(m, i ? i.sector : ds.sector);
  const name = h('input', { value: i ? i.name : '', placeholder: isNew ? 'New indicator name' : '' });
  const num = h('input', { list: 'field-list', value: i ? i.numerator : '', placeholder: 'e.g. Women with 4+ ANC visits' });
  const denPick = denominatorPicker(m, ds, i ? i.denominator : '');
  const source = h('input', { value: i ? i.source : '', placeholder: 'e.g. HMIS register' });
  const showAs = select([{ id: '', name: '— show as —' }, ...m.showAs], i ? i.showAs : '');
  const id = h('input', { class: 'mono', placeholder: 'auto-generated', maxlength: 11, title: 'Leave empty to generate a DHIS2-style ID, or paste an existing DHIS2 indicator ID' });
  const btn = h('button', { class: isNew ? 'primary' : '' }, isNew ? 'Add' : 'Save');
  const del = isNew ? null : h('button', { class: 'link', title: 'Remove indicator' }, 'Remove');
  const vals = () => ({ sector: sector.value.trim(), name: name.value.trim(), numerator: num.value.trim(), denominator: denPick.name(), source: source.value.trim(), showAs: showAs.value });
  btn.addEventListener('click', busy(btn, async () => {
    const missing = indicatorMissing(vals()); if (missing) throw new Error(missing);
    await denPick.value();
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
  return h('tr', {}, h('td', {}, sector), h('td', {}, name), h('td', {}, num), h('td', {}, denPick.el), h('td', {}, source), h('td', {}, showAs),
    h('td', {}, isNew ? id : idTag(i.id), h('div', { class: 'actions' }, btn, del)));
}

function fieldsPanel(ds) {
  const list = ds.dataElements.filter((d) => !d.archived);
  if (!list.length) return null;
  return h('details', { class: 'panel' }, h('summary', {}, `Boxes people fill in (${list.length})`),
    h('p', { class: 'muted small' }, 'Made from the numerators and denominators above. Rename one here to fix a typo everywhere; numbers already reported are kept. “Whole numbers” refuses decimals; “Max” refuses anything larger. “Broken down by” asks for the number per sex, age group or both; the total adds itself up, so indicators keep working. The lists themselves: “Lists…” in the indicator form.'),
    h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Whole numbers'), h('th', {}, 'Max'), h('th', {}, 'Broken down by'), h('th', {}, 'ID'), h('th'))),
      h('tbody', {}, list.map((d) => {
        const name = h('input', { value: d.name, size: 28 });
        const whole = h('input', { type: 'checkbox', checked: d.valueType === 'INTEGER' });
        const max = h('input', { type: 'number', value: d.max ?? '', placeholder: 'none', size: 8 });
        const cur = [d.breakdownId, d.breakdown2Id].filter(Boolean).join('|');
        const bd = select(splitChoices(cur), cur);
        const b = h('button', {}, 'Save');
        b.addEventListener('click', busy(b, async () => {
          const [b1, b2] = bd.value ? bd.value.split('|') : [];
          if (bd.value !== cur && cur && !confirm('Change how this number is broken down? Parts typed in before stay stored but are no longer shown; reports not yet sent will ask for the new parts.')) return;
          await api('PATCH', '/api/fields/' + d.id, { name: name.value.trim(), valueType: whole.checked ? 'INTEGER' : 'NUMBER', max: max.value === '' ? null : Number(max.value), breakdownId: b1 || null, breakdown2Id: b2 || null });
          toast('Saved'); state.meta = null; route();
        }));
        return h('tr', {}, h('td', {}, name), h('td', {}, whole), h('td', {}, max), h('td', {}, bd), h('td', {}, idTag(d.id)), h('td', {}, b));
      })))));
}

function sharedPanel(ds) {
  const all_ = ds.dataElements.filter((d) => !d.archived);
  const lc = (x) => String(x || '').trim().toLowerCase();
  const total = all_.find((d) => lc(d.name) === 'total population');
  const imported = all_.filter((d) => !d.calcBase);
  // Standard denominators show in step 2 (even before they are switched to calculated), not here.
  const others = imported.filter((d) => d !== total && !COMMON_DENOMINATORS.some((c) => c.share != null && lc(c.name) === lc(d.name)));
  const admin = is('sysadmin');

  // Step 2: the denominators calculated from Total population (standard ones, plus any already set up).
  const rows = [];
  for (const c of COMMON_DENOMINATORS.filter((x) => x.share != null)) {
    const f = all_.find((d) => lc(d.name) === lc(c.name));
    const calc = !!(f && f.calcBase);
    rows.push({ name: c.name, hint: c.hint, f, share: calc ? f.calcShare : c.share, prorate: calc ? f.prorate : c.prorate, on: calc || !!c.on });
  }
  for (const f of all_.filter((d) => d.calcBase && !rows.some((r) => r.f === d))) rows.push({ name: f.name, hint: '', f, share: f.calcShare, prorate: f.prorate, on: true });
  const splitSel = (v) => select([{ id: '1', name: 'Split by months (÷12)' }, { id: '0', name: 'Yearly figure as is' }], v ? '1' : '0');
  const ui = rows.map((r) => ({ r, box: h('input', { type: 'checkbox', checked: r.on, disabled: !admin }), share: h('input', { type: 'number', step: '0.1', min: 0, max: 100, value: r.share, size: 5, disabled: !admin }), split: splitSel(r.prorate) }));
  const newName = h('input', { placeholder: 'Another one, e.g. Children 0–6 months', size: 30 });
  const newShare = h('input', { type: 'number', step: '0.1', min: 0, max: 100, size: 5, placeholder: '%' });
  const newSplit = splitSel(false);
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Save and calculate');
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    const todo = ui.map((u) => ({ ...u, pct: Number(u.share.value) }));
    const bad = todo.find((u) => u.box.checked && !(u.pct > 0 && u.pct <= 100));
    if (bad) { err.textContent = `Give “${bad.r.name}” a share between 0 and 100 %.`; return; }
    for (const u of todo) {
      const body = { calcShare: u.box.checked ? u.pct : null, prorate: u.split.value === '1' };
      if (u.r.f) { if (u.box.checked || u.r.f.calcBase) await api('PATCH', '/api/fields/' + u.r.f.id, body); }
      else if (u.box.checked) await api('POST', `/api/datasets/${ds.id}/fields`, { name: u.r.name, ...body });
    }
    if (newName.value.trim()) {
      const pct = Number(newShare.value);
      if (!(pct > 0 && pct <= 100)) { err.textContent = 'Give the new denominator a share between 0 and 100 %.'; return; }
      await api('POST', `/api/datasets/${ds.id}/fields`, { name: newName.value.trim(), calcShare: pct, prorate: newSplit.value === '1' });
    }
    toast('Saved — the figures are calculated for every LGA and year with a total population'); state.meta = null; route();
  }));

  // Step 3: other numbers that are imported or typed (households counted, schools …).
  const name = h('input', { placeholder: 'e.g. Number of schools' });
  const split = h('input', { type: 'checkbox' });
  const add = h('button', {}, 'Add number');
  add.addEventListener('click', busy(add, async () => {
    if (!name.value.trim()) return;
    await api('POST', `/api/datasets/${ds.id}/fields`, { name: name.value.trim(), prorate: split.checked });
    toast('Added'); state.meta = null; route();
  }));

  return h('div', {},
    h('h2', {}, '1 · Total population of each LGA (and ward)'),
    h('p', { class: 'muted small' }, 'The one number you bring in, once a year — for LGAs, and for wards if you have them (a file with State, LGA, LGA ID, Ward columns; wards are matched by name). Every denominator in step 2 is calculated from it, for LGAs and wards alike.'),
    total ? null : h('div', { class: 'note info' }, 'Total population is set up the first time you save step 2 or import a file with a “Total population” column.'),
    total ? worldpopPanel(ds, [total]) : null,
    populationImportPanel(ds, imported.length ? imported : []),

    h('h2', {}, '2 · Denominators calculated from it'),
    h('p', { class: 'muted small' }, 'Tick the ones your indicators divide by. Each is a share of total population — standard planning shares (WHO / NPHCDA), which you can change to match your programme. They are recalculated automatically whenever total population changes.'),
    h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Use'), h('th', {}, 'Denominator'), h('th', {}, '% of total population'), h('th', {}, 'For monthly / quarterly indicators'))),
      h('tbody', {}, ui.map((u) => h('tr', {},
        h('td', {}, u.box),
        h('td', {}, h('strong', {}, u.r.name), u.r.hint ? h('div', { class: 'muted small' }, u.r.hint) : null, u.r.f && !u.r.f.calcBase ? h('div', { class: 'muted small' }, 'Now imported — ticking it calculates it instead') : null),
        h('td', {}, u.share, ' %'),
        h('td', {}, u.split))),
      admin ? h('tr', {}, h('td'), h('td', {}, newName), h('td', {}, newShare, ' %'), h('td', {}, newSplit)) : null))),
    admin ? h('div', { class: 'actions' }, save) : null, err,
    h('p', { class: 'muted small' }, '“Split by months” suits yearly flows such as pregnancies and births: a monthly indicator divides by one twelfth. Head counts (children, women, households) use the yearly figure as is.'),

    // Other numbers (counts of schools …) only appear when there are some; an Excel file with extra columns adds them.
    !others.length ? null : h('details', { class: 'panel' }, h('summary', {}, `3 · Other numbers you import or type (${others.length})`),
      h('p', { class: 'muted small' }, 'For numbers that are not a share of the population — e.g. number of schools or health facilities. They are filled with the Excel import in step 1, or typed by each LGA once a year.'),
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Number'), h('th', {}, 'For monthly / quarterly indicators'), h('th', {}, 'ID'), h('th'))),
        h('tbody', {}, others.map((d) => {
          const n = h('input', { value: d.name, size: 32 });
          const sel = splitSel(d.prorate);
          const b = h('button', {}, 'Save');
          b.addEventListener('click', busy(b, async () => { await api('PATCH', '/api/fields/' + d.id, { name: n.value.trim(), prorate: sel.value === '1' }); toast('Saved'); state.meta = null; route(); }));
          return h('tr', {}, h('td', {}, n), h('td', {}, sel), h('td', {}, idTag(d.id)), h('td', {}, b));
        }), h('tr', {}, h('td', {}, name), h('td', {}, h('label', { class: 'check' }, split, 'Split by months')), h('td'), h('td', {}, add)))))));
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
      h('p', { class: 'muted small' }, 'Population for every LGA modelled by WorldPop (University of Southampton) for GRID3, e.g. “NGA population v3.0” = 2025 estimates. The system downloads the LGA table, matches each LGA by name and fills Total population (you check it before saving). An alternative to the NPC figures — use one source per year.'),
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
  const hi = rows.findIndex((r) => r.some((c) => ['lgaid', 'lga', 'wardid'].includes(norm(c))));
  if (hi < 0) throw new Error('No “LGA” or “LGA ID” column found. Use the template (Download template).');
  const head = rows[hi].map(norm);
  const ci = { state: head.indexOf('state'), lga: head.indexOf('lga'), lgaId: head.indexOf('lgaid'), ward: head.indexOf('ward'), wardId: head.indexOf('wardid'), wardAlt: head.indexOf('wardothernames') };
  // Columns that are not population figures yet: offer to add them (e.g. a ready-made file of projections).
  // Calculated figures (a share of Total population) are never imported: their columns are left out.
  const calcNames = new Set([...fields.filter((f) => f.calcBase).map((f) => norm(f.name)), ...COMMON_DENOMINATORS.filter((c) => c.share != null).map((c) => norm(c.name))]);
  const skipped = rows[hi].map((c) => String(c ?? '').trim()).filter((n) => n && calcNames.has(norm(n)));
  fields = fields.filter((f) => !f.calcBase);
  const extra = rows[hi].map((c, i) => ({ name: String(c ?? '').trim(), i }))
    .filter((x) => x.name && !['state', 'lga', 'lgaid', 'ward', 'wardid', 'wardothernames'].includes(norm(x.name)) && !calcNames.has(norm(x.name)) && !fields.some((f) => norm(f.name) === norm(x.name)));
  if (extra.length && is('sysadmin') && confirm(`This file has ${extra.length === 1 ? 'a number that is' : 'numbers that are'} not population figures yet:\n\n${extra.map((x) => '• ' + x.name).join('\n')}\n\nAdd ${extra.length === 1 ? 'it' : 'them'} to the Population figures and import ${extra.length === 1 ? 'it' : 'them'} too?`)) {
    for (const x of extra) {
      const c = COMMON_DENOMINATORS.find((d) => norm(d.name) === norm(x.name));
      try { await api('POST', `/api/datasets/${ds.id}/fields`, { name: x.name, prorate: c ? c.prorate : false }); } catch (e) { if (e.status !== 409) throw e; }
    }
    state.meta = null;
    const m2 = await meta(true);
    fields = (m2.datasets.find((d) => d.id === ds.id) || ds).dataElements.filter((f) => !f.archived && !f.calcBase);
  }
  const cols = fields.map((f) => ({ f, i: head.indexOf(norm(f.name)) })).filter((x) => x.i >= 0);
  if (!cols.length) throw new Error(fields.length ? 'None of the columns match a number in this data set (e.g. “' + fields[0].name + '”). Use the template.' : 'No population figures yet: add them first, or accept adding the file’s columns.');
  const missingCols = fields.filter((f) => !cols.some((c) => c.f.id === f.id)).map((f) => f.name);
  const data = rows.slice(hi + 1).map((r, i) => ({
    row: hi + i + 2,
    state: ci.state >= 0 ? String(r[ci.state] ?? '').trim() : '', lga: ci.lga >= 0 ? String(r[ci.lga] ?? '').trim() : '', lgaId: ci.lgaId >= 0 ? String(r[ci.lgaId] ?? '').trim() : '',
    ...(ci.wardId >= 0 && String(r[ci.wardId] ?? '').trim() ? { wardId: String(r[ci.wardId]).trim() }
      : ci.ward >= 0 && String(r[ci.ward] ?? '').trim() ? { ward: String(r[ci.ward]).trim(), wardAlt: ci.wardAlt >= 0 ? String(r[ci.wardAlt] ?? '').trim() : '' } : {}),
    values: Object.fromEntries(cols.map(({ f, i: c }) => [f.id, String(r[c] ?? '').trim()])),
  })).filter((r) => r.lga || r.lgaId || r.wardId);
  if (!data.length) throw new Error('The file has no LGA or ward rows.');
  // Checked in parts (a ward file has ~9,400 rows).
  const check = { counts: { lgas: 0, wards: 0, values: 0, changed: 0, error: 0, skipped: 0 }, results: [] };
  for (let i = 0; i < data.length; i += 800) {
    const { data: part } = await api('POST', `/api/datasets/${ds.id}/population`, { year, rows: data.slice(i, i + 800) });
    for (const k of Object.keys(check.counts)) check.counts[k] += part.counts[k] || 0;
    check.results.push(...part.results);
  }
  const c = check.counts;
  const errors = check.results.filter((r) => r.status === 'error');
  const places = [c.lgas ? `${c.lgas} LGA${c.lgas === 1 ? '' : 's'}` : '', c.wards ? `${c.wards} ward${c.wards === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ') || 'no places';
  const source = h('input', { placeholder: c.wards ? 'e.g. WorldPop v3.0 100 m grid summed by GRID3 ward' : `e.g. NPC ${year} projections`, size: 40 });
  const go = h('button', { class: 'primary', disabled: !!c.error || !(c.lgas + c.wards) }, `Save figures for ${places}`);
  const progress = h('span', { class: 'muted small' });
  const err = h('div', { class: 'err' });
  const dlg = h('dialog', {}, h('h2', {}, `Population figures ${year} — check`),
    h('p', { class: 'muted small' }, file.name, ` · ${data.length} rows · columns: ${cols.map((x) => x.f.name).join(', ')}`),
    skipped.length ? h('p', { class: 'muted small' }, `Left out (calculated from Total population): ${skipped.join(', ')}.`) : null,
    (() => {
      const sk = check.results.filter((r) => r.status === 'skipped');
      if (!sk.length) return null;
      const notLoaded = sk.filter((r) => /not loaded/.test(r.message)).length;
      return h('details', {}, h('summary', { class: 'small' }, `${sk.length} ward rows skipped${notLoaded ? ` — ${notLoaded} because their LGA’s wards are not loaded yet (Units below the LGA → Load wards & health facilities)` : ''}`),
        h('ul', { class: 'small' }, sk.filter((r) => !/not loaded/.test(r.message)).slice(0, 300).map((r) => h('li', {}, `${r.lga}: ${r.message}`))));
    })(),
    missingCols.length ? h('div', { class: 'note warn' }, `Not in the file (kept as they are): ${missingCols.join(', ')}.`) : null,
    h('div', { class: 'counts' }, c.lgas || !c.wards ? h('span', { class: 'pill s-accepted' }, `LGAs with figures: ${c.lgas}`) : null, c.wards ? h('span', { class: 'pill s-accepted' }, `Wards with figures: ${c.wards}`) : null,
      c.skipped ? h('span', { class: 'pill s-none' }, `Ward rows skipped: ${c.skipped}`) : null, h('span', { class: 'pill s-draft' }, `Values changing: ${c.changed}`), h('span', { class: 'pill s-returned' }, `Problems: ${c.error}`)),
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
    dlg.close(); toast(`Saved population figures for ${places}`); after();
  }));
  document.body.append(dlg); dlg.showModal();
}

// Edit a form's settings, add another form to a sector, or create the population figures.
// A sector's reporting schedule (how often, who reports, due day): its settings, a new one, or the population figures.
function datasetDialog(ds, m, makeShared = false, presetSector = '') {
  const shared = ds ? ds.shared : makeShared;
  const sector = sectorSelect(m, ds ? ds.sector : presetSector, { disabled: !!presetSector });
  const freq = select(m.frequencies, ds ? ds.frequency : presetSector && m.datasets.some((d) => d.sector === presetSector && d.frequency === 'MONTHLY') ? 'YEARLY' : 'MONTHLY');
  const who = whoReportsPicker(m, ds);
  const due = h('input', { type: 'number', min: 1, max: 28, value: ds ? ds.dueDay : 15 });
  const autoName = () => scheduleName(m, sector.value || presetSector || 'Sector', freq.options[freq.selectedIndex].text, who.byText(), ds && ds.id);
  const name = h('input', { value: ds ? ds.name : shared ? 'Population and denominators' : autoName() });
  let typed = !!ds;
  name.addEventListener('input', () => { typed = true; });
  for (const el of [sector, freq]) el.addEventListener('change', () => { if (!typed && !shared) name.value = autoName(); });
  who.onChange(() => { if (!typed && !shared) name.value = autoName(); });
  const id = h('input', { class: 'mono', placeholder: 'made automatically', maxlength: 11 });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, ds ? 'Save' : shared ? 'Create' : 'Create, then add its indicators');
  const title = ds ? (shared ? 'Population figures — settings' : 'Schedule settings') : shared ? 'Create population figures' : presetSector ? `${presetSector}: indicators on another schedule` : 'New reporting schedule';
  const dlg = h('dialog', {}, h('h2', {}, title),
    shared ? h('p', { class: 'muted small' }, 'One yearly list of numbers (population, under-5s, expected pregnancies …) that every sector’s indicators can divide by. It has no indicators of its own.')
      : !ds ? h('p', { class: 'muted small' }, 'Use this for indicators that are reported differently from the sector’s others — e.g. once a year instead of monthly, or by each unit below the LGA (facility, school …) instead of each LGA. People get a separate report for them.') : null,
    ds && !shared ? h('p', { class: 'muted small' }, 'Once reports exist, how often and who reports can no longer change.') : null,
    h('div', { class: 'grid2' },
      shared ? null : field('Sector', sector),
      shared ? null : field('How often it reports', freq),
      shared ? null : fieldGroup('Who reports', who.el),
      shared ? null : field('Due day', due, 'Day of the month after the period ends.'),
      field('Report name', name, shared ? null : 'What people see under “My reports”. Filled in for you.')),
    ds ? h('p', { class: 'muted small' }, 'ID ', idTag(ds.id)) : shared ? null : h('details', {}, h('summary', { class: 'small' }, 'Advanced: existing DHIS2 data set ID'), field('DHIS2 ID', id)),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel'),
      ds && is('sysadmin') ? h('button', { class: 'danger', title: 'Hidden from data entry; data is kept.', onclick: async () => { await api('PATCH', '/api/datasets/' + ds.id, { archived: !ds.archived }); dlg.close(); state.meta = null; route(); } }, ds.archived ? 'Restore' : 'Archive') : null,
      ds && !shared && is('sysadmin') ? h('button', { class: 'link danger-link', title: 'Only while nothing was reported on it', onclick: async () => {
        if (!confirm(`Delete “${ds.name}” and its indicators for good? This is only possible while nothing was reported on it.`)) return;
        try { await api('DELETE', '/api/datasets/' + ds.id); } catch (e) { err.textContent = e.message; return; }
        dlg.close(); state.meta = null; await loadMe(); toast(`“${ds.name}” deleted`); go('#/setup');
      } }, 'Delete') : null),
    ds && !shared ? h('p', { class: 'muted small' }, 'Archive: hidden from data entry, data kept. Delete: removed for good, only while nothing was reported.') : null);
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    err.textContent = '';
    if (!shared && !sector.value) { err.textContent = 'Choose the sector.'; return; }
    let w = {};
    if (!shared) { try { w = await who.value(); } catch (e) { err.textContent = e.message; return; } }
    const body = shared ? { name: name.value.trim() } : { name: name.value.trim() || autoName(), sector: sector.value, frequency: freq.value, ...w, dueDay: Number(due.value) };
    if (shared && !ds) body.shared = true;
    let newId = null;
    try {
      if (ds) await api('PATCH', '/api/datasets/' + ds.id, body);
      else { if (id.value.trim()) body.id = id.value.trim(); newId = (await api('POST', '/api/datasets', body)).data.id; }
    } catch (e) { err.textContent = e.message; return; }
    dlg.close(); state.meta = null; await loadMe();
    if (newId && !shared) { pref('openAddInd', newId); go('#/setup'); } else route();
  }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- sector org units (schools, facilities ...) ----------
const UNIT_HEADERS = ['State', 'LGA', 'LGA ID', 'Ward', 'Ward ID', 'Type', 'Name', 'Code', 'Latitude', 'Longitude', 'ID'];

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

// Excel template for units below the LGA: State, LGA and Type are drop-down lists (the LGA list follows the State),
// so people only type or paste the names. IDs are made by the system.
const cleanState = (n) => String(n).replace(/^[a-z]{2} /, '').replace(/ state$/i, '').trim();
const cleanLga = (n) => String(n).replace(/^[a-z]{2} /, '').replace(/ LGA$/i, '').trim();
const rangeName = (s) => 'S_' + s.replace(/[^A-Za-z0-9]+/g, '_');
function unitTemplate(lgas, types) {
  const states = [...new Set(lgas.map((l) => cleanState(l.state)))].sort();
  const byState = states.map((st) => lgas.filter((l) => cleanState(l.state) === st).map((l) => cleanLga(l.name)).sort());
  const typeNames = types.map((t) => t.name).filter((n) => n !== 'Ward');
  const col = (i) => { let x = ''; i++; while (i) { const m = (i - 1) % 26; x = String.fromCharCode(65 + m) + x; i = Math.floor((i - 1) / 26); } return x; };
  // Lists sheet: A = states, B = unit types, C… = the LGAs of each state.
  const height = Math.max(states.length, typeNames.length, ...byState.map((l) => l.length)) + 1;
  const lists = Array.from({ length: height }, (_, r) => (r === 0 ? ['State', 'Type', ...states] : [states[r - 1] ?? '', typeNames[r - 1] ?? '', ...byState.map((l) => l[r - 1] ?? '')]));
  const names = states.map((st, i) => ({ name: rangeName(st), ref: `Lists!$${col(i + 2)}$2:$${col(i + 2)}$${byState[i].length + 1}` }));
  const N = 3000;
  const lgaFormula = 'INDIRECT("S_"&SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE($A2," ","_"),"-","_"),"\'",""),"/","_"))';
  return [[
    { name: 'Units', rows: [['State', 'LGA', 'Ward (optional)', 'Type', 'Name', 'Code (optional)', 'Latitude (optional)', 'Longitude (optional)']], widths: [20, 26, 24, 22, 40, 18, 18, 18],
      lists: [{ sqref: `A2:A${N}`, formula: `Lists!$A$2:$A$${states.length + 1}` }, { sqref: `B2:B${N}`, formula: lgaFormula }, ...(typeNames.length ? [{ sqref: `D2:D${N}`, formula: `Lists!$B$2:$B$${typeNames.length + 1}` }] : [])] },
    { name: 'How to fill', rows: [['How to fill'], ...[
      'One row per unit below an LGA: a school, health facility, water point, market …',
      'State: choose from the list. LGA: choose from the list (it shows the LGAs of the state you chose).',
      'Type: choose from the list. A new type name is added automatically when you import.',
      'Name: type or paste the names — you can paste a whole column of names at once.',
      'Ward (optional): the ward the unit is in, if the wards are loaded.',
      'Code (optional): the code the sector’s own system uses for this unit (e.g. the school code). Units with the same code are matched, not duplicated.',
      'Latitude / Longitude (optional): decimal degrees, e.g. 10.3158 and 9.8442. Used to spot duplicates and for maps.',
      'Each unit gets its own ID automatically. Import the file with “Import Excel”; you see a check before anything is saved.',
    ].map((t) => [t])], widths: [110] },
    { name: 'Lists', rows: lists, hidden: true },
  ], { names }];
}

// Units below the LGA: the LGA's child org units (DHIS2 level 4, and level 5 under wards), by unit type.
async function renderUnits() {
  const o = await orgs();
  const states = state.me.ou.level === 1 ? o.states : null;
  const stateId = states ? (states.some((x) => x.id === pref('unitState')) ? pref('unitState') : (states[0] || {}).id) : state.me.ou.level === 2 ? state.me.ou.id : (state.me.ou.path || '').split('/')[2];
  const lgas = stateId ? await lgasOf(stateId) : [];
  const lgaFilter = lgas.some((l) => l.id === pref('unitLga')) ? pref('unitLga') : '';
  const typeFilter = pref('unitType') || '';
  const data = await get('/api/units' + qs({ type: typeFilter, state: lgaFilter ? undefined : stateId, lga: lgaFilter || undefined }));
  const types = data.types;
  const units = data.units;
  const admin = is('sysadmin', 'setupadmin');
  const typeName = (id) => (types.find((t) => t.id === id) || {}).name || '';

  // Unit types
  const newType = h('input', { placeholder: 'e.g. Health facility, Primary school, Water point', size: 34 });
  const addType = h('button', {}, '+ Add unit type');
  addType.addEventListener('click', busy(addType, async () => { await api('POST', '/api/unit-types', { name: newType.value.trim() }); toast('Unit type added'); state.meta = null; renderUnits(); }));
  const typesPanel = h('div', { class: 'panel' }, h('h2', {}, 'Unit types'),
    h('p', { class: 'muted small' }, 'The kinds of unit below the LGA. Each reporting schedule chooses which types report (Sectors & indicators → Schedule settings). Ward is built in: wards are loaded with their official IDs, and other units can sit under their ward.'),
    h('table', { class: 'todo' }, h('tbody', {}, types.map((t) => h('tr', {},
      h('td', {}, h('strong', {}, t.name), t.isWard ? h('span', { class: 'muted small' }, ' · directly under the LGA, official IDs') : null,
        t.codeLabel ? h('div', { class: 'cov' }, 'Own-system code: ', t.codeLabel) : null),
      h('td', { class: 'small' }, `${t.units} unit${t.units === 1 ? '' : 's'}`),
      h('td', { class: 'small muted' }, t.datasets.length ? 'Reports on: ' + t.datasets.map((d) => d.name).join(', ') : 'No schedule uses it yet'),
      h('td', { class: 'n' }, admin ? h('div', { class: 'actions' },
        h('button', { class: 'link', onclick: () => unitTypeDialog(t) }, 'Edit'),
        !t.isWard && !t.units && !t.datasets.length ? h('button', { class: 'link danger-link', onclick: async () => { try { await api('DELETE', '/api/unit-types/' + t.id); state.meta = null; renderUnits(); } catch (e) { toast(e.message, true); } } }, 'Remove') : null) : null))))),
    admin ? h('div', { class: 'bar' }, field('New unit type', newType), addType) : null);

  // Add one unit
  const addType_ = select(types.map((t) => ({ id: t.id, name: t.name })), typeFilter || (types.find((t) => !t.isWard) || types[0] || {}).id);
  const addLga = select(lgas, lgaFilter || (lgas[0] || {}).id);
  const addWard = h('select');
  const nName = h('input', { placeholder: 'Name' });
  const nCode = h('input', { placeholder: 'optional', size: 12 });
  const nLat = h('input', { placeholder: 'e.g. 10.3158', size: 9, inputmode: 'decimal' });
  const nLon = h('input', { placeholder: 'e.g. 9.8442', size: 9, inputmode: 'decimal' });
  const codeBox = field('Code', nCode);
  const nId = h('input', { class: 'mono', maxlength: 11, size: 13 });
  const wardBox = field('Ward (optional)', addWard);
  const idBox = field('Ward ID', nId);
  const fillWards = async () => {
    const isWard = addType_.value === 'ut_ward';
    wardBox.hidden = isWard;
    const tt = types.find((t) => t.id === addType_.value) || {};
    codeBox.firstChild.textContent = tt.codeLabel ? `${tt.codeLabel} (optional)` : 'Code (optional)';
    nId.placeholder = 'official ward ID';
    idBox.hidden = !isWard; // other units get their ID automatically
    const ws = addLga.value ? (await unitsOf(addLga.value)).filter((u) => u.typeId === 'ut_ward') : [];
    addWard.replaceChildren(h('option', { value: '' }, ws.length ? '— directly under the LGA —' : 'No wards loaded for this LGA'), ...ws.map((w) => h('option', { value: w.id }, w.name)));
  };
  addType_.addEventListener('change', fillWards); addLga.addEventListener('change', fillWards);
  await fillWards();
  const addBtn = h('button', { class: 'primary' }, 'Add');
  addBtn.addEventListener('click', busy(addBtn, async () => {
    const body = { typeId: addType_.value, lgaId: addLga.value, name: nName.value.trim(), code: nCode.value.trim() };
    if (addWard.value && addType_.value !== 'ut_ward') body.wardId = addWard.value;
    if (nId.value.trim()) body.id = nId.value.trim();
    const num = (x) => Number(String(x).trim().replace(',', '.'));
    if (nLat.value.trim() || nLon.value.trim()) { body.latitude = num(nLat.value); body.longitude = num(nLon.value); }
    try { await api('POST', '/api/units', body); } catch (e) {
      if (!(e.body && e.body.error && e.body.error.code === 'possible_duplicate') || !confirm(e.message)) throw e;
      await api('POST', '/api/units', { ...body, force: true });
    }
    toast('Added'); delete unitCache[addLga.value]; renderUnits();
  }));

  // Excel / DHIS2 file
  const fileIn = h('input', { type: 'file', accept: '.xlsx,.csv,.json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = '';
    if (f) try { await importDialog(f, typeFilter); } catch (e) { toast(e.message, true); }
  });
  const tplBtn = h('button', {}, 'Download Excel template');
  tplBtn.addEventListener('click', busy(tplBtn, async () => {
    const { lgas: all_ } = await get('/api/orgunits?lgas=all');
    const { writeWorkbook } = await import('./xlsx.js');
    saveBlob(writeWorkbook(...unitTemplate(all_, types)), 'Units_below_LGA_template.xlsx');
  }));
  const listBtn = h('button', {}, 'Download list');
  listBtn.addEventListener('click', busy(listBtn, async () => {
    const { writeWorkbook } = await import('./xlsx.js');
    const wardIdOf = (u) => u.wardId || '';
    saveBlob(writeWorkbook([{ name: 'Units', rows: [UNIT_HEADERS, ...units.map((u) => [u.stateName, u.lgaName, u.lgaId, u.isWard ? '' : u.ward, u.isWard ? '' : wardIdOf(u), u.type, u.name, u.code, u.latitude ?? '', u.longitude ?? '', u.id])], widths: [18, 24, 14, 22, 14, 20, 36, 14, 11, 11, 16] }]), 'Units_below_LGA.xlsx');
  }));

  mount(h('div', {},
    pageHead({
      title: 'Units below the LGA',
      sub: 'Child org units of each LGA: wards (DHIS2 level 4) and the facilities, schools … under them',
      text: 'Here you set up the units below each LGA that sectors report on — schools, health facilities, water points, markets … — and, if you use them, wards. Each unit gets its own ID automatically, so results can be exported. Each reporting schedule chooses which unit types report.',
      how: [
        'Add the unit types you need (Primary school, Water point …) under Unit types.',
        'Download the Excel template: choose the State, LGA and Type from the lists and paste the names. Then press Import Excel — you see a check before anything is saved. Or add units one by one.',
        'Optional: “Load wards & health facilities” brings in a state’s official wards and health facilities, with their official IDs.',
        'In Sectors & indicators → Schedule settings, set Who reports to “Each ward”, or to “Each facility, school …” and tick the unit types that report. Their values add up to the LGA.',
        'Click a unit to rename it, change its type or ward, or close it. Units are never deleted, so past data stays.',
      ],
      actions: [tplBtn, h('button', { class: 'primary', onclick: () => fileIn.click() }, 'Import Excel'), fileIn, h('button', { onclick: () => scorecardDialog(states, stateId, types) }, 'Load wards & health facilities')],
    }),
    typesPanel,
    h('h2', {}, 'Units'),
    h('div', { class: 'bar' },
      states ? field('State', select(states, stateId, { onchange: (e) => { pref('unitState', e.target.value); pref('unitLga', ''); renderUnits(); } })) : null,
      field('LGA', select([{ id: '', name: 'All LGAs' }, ...lgas], lgaFilter, { onchange: (e) => { pref('unitLga', e.target.value); renderUnits(); } })),
      field('Type', select([{ id: '', name: 'All types' }, ...types.map((t) => ({ id: t.id, name: t.name }))], typeFilter, { onchange: (e) => { pref('unitType', e.target.value); renderUnits(); } })),
      h('div', { class: 'muted small' }, `${units.length} unit${units.length === 1 ? '' : 's'}`), listBtn),
    h('div', { class: 'panel' }, h('h3', {}, 'Add one unit'),
      h('div', { class: 'bar' }, field('Type', addType_), field('LGA', addLga), wardBox, field('Name', nName), codeBox, field('Latitude (optional)', nLat), field('Longitude (optional)', nLon), idBox, addBtn)),
    units.length > 2000 ? h('p', { class: 'muted small' }, `Showing the first 2,000 of ${units.length}. Choose an LGA or a type, or use “Download list” for all.`) : null,
    units.length ? h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'LGA'), h('th', {}, 'Ward'), h('th', {}, 'Name'), h('th', {}, 'Type'), h('th', {}, 'Code'), h('th', {}, 'Location'), h('th', {}, 'ID'), h('th', {}, 'Status'))),
      h('tbody', {}, units.slice(0, 2000).map((u) => h('tr', { class: 'click', onclick: () => unitDialog(u, types) },
        h('td', {}, u.lgaName), h('td', { class: 'small' }, u.isWard ? '' : u.wardId ? u.ward : u.ward ? h('span', { class: 'muted', title: 'Ward not loaded yet: kept as a label' }, u.ward + ' (label)') : '—'),
        h('td', {}, u.isWard ? h('strong', {}, u.name) : u.name), h('td', {}, u.type), h('td', {}, u.code),
        h('td', { class: 'small muted' }, u.latitude !== null ? `${u.latitude}, ${u.longitude}` : '—'),
        h('td', {}, h('span', { class: 'id' }, u.id)), h('td', {}, u.closed ? pill('none', 'Closed') : pill('accepted', 'Open')))))))
      : h('div', { class: 'panel empty' }, 'No units here yet. Download the Excel template, paste the names and import it — or add one above.'),
  ));
}

function saveBlob(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function unitTypeDialog(t) {
  const name = h('input', { value: t.name, disabled: t.isWard });
  const codeLabel = h('input', { value: t.codeLabel || '', placeholder: 'e.g. EMIS school code, Facility code (NHFR)' });
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Save');
  const dlg = h('dialog', {}, h('h2', {}, t.name),
    h('div', { class: 'grid2' }, field('Name', name), field('Code used by the sector’s own system (optional)', codeLabel, 'Shown as the name of the Code column for this type, e.g. “EMIS school code”. Units with the same code are matched, not duplicated.')),
    err, h('p'), h('div', { class: 'actions' }, save, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  save.addEventListener('click', busy(save, async () => {
    try { await api('PATCH', '/api/unit-types/' + t.id, { name: name.value.trim(), codeLabel: codeLabel.value.trim() }); dlg.close(); state.meta = null; renderUnits(); } catch (e) { err.textContent = e.message; }
  }));
  document.body.append(dlg); dlg.showModal();
}

function unitDialog(u, types) {
  const name = h('input', { value: u.name }); const code = h('input', { value: u.code });
  const lat = h('input', { value: u.latitude ?? '', placeholder: 'e.g. 10.3158', inputmode: 'decimal' }); const lon = h('input', { value: u.longitude ?? '', placeholder: 'e.g. 9.8442', inputmode: 'decimal' });
  const tdef = types.find((t) => t.id === u.typeId) || {};
  const type = u.isWard ? null : select(types.filter((t) => !t.isWard).map((t) => ({ id: t.id, name: t.name })), u.typeId);
  const ward = h('select');
  (async () => {
    const ws = u.isWard ? [] : (await unitsOf(u.lgaId)).filter((x) => x.typeId === 'ut_ward');
    ward.replaceChildren(h('option', { value: '' }, '— directly under the LGA —'), ...ws.map((w) => h('option', { value: w.id, selected: w.id === u.wardId }, w.name)));
  })();
  const err = h('div', { class: 'err' });
  const save = h('button', { class: 'primary' }, 'Save');
  const close = h('button', { class: 'danger' }, u.closed ? 'Reopen' : 'Close unit');
  const dlg = h('dialog', {}, h('h2', {}, u.name), h('p', { class: 'muted small' }, `${u.type} · ${u.lgaName}, ${u.stateName} · DHIS2 ID `, idTag(u.id)),
    h('div', { class: 'grid2' }, field('Name', name), type ? field('Type', type) : null, u.isWard ? null : field('Ward', ward), field(tdef.codeLabel || 'Code', code),
      field('Latitude', lat), field('Longitude', lon)), err, h('p'),
    h('div', { class: 'actions' }, save, close, h('button', { onclick: () => dlg.close() }, 'Cancel')),
    h('p', { class: 'muted small' }, 'Closing keeps the unit and its ID but hides it from new reports. Units are never deleted, so past data stays traceable.'));
  dlg.addEventListener('close', () => dlg.remove());
  const send = (b, body) => busy(b, async () => {
    try { await api('PATCH', '/api/units/' + u.id, body()); delete unitCache[u.lgaId]; dlg.close(); toast('Saved'); renderUnits(); } catch (e) { err.textContent = e.message; }
  });
  const num = (x) => (String(x).trim() === '' ? null : Number(String(x).trim().replace(',', '.')));
  save.addEventListener('click', send(save, () => ({ name: name.value.trim(), code: code.value.trim(), latitude: num(lat.value), longitude: num(lon.value), ...(type ? { typeId: type.value } : {}), ...(u.isWard ? {} : { wardId: ward.value }) })));
  close.addEventListener('click', send(close, () => ({ closed: !u.closed })));
  document.body.append(dlg); dlg.showModal();
}

// Reads the file, maps its columns, asks the server to check every row, then imports on confirmation.
async function importDialog(file, defaultTypeId) {
  if (/\.json$/i.test(file.name)) return checkAndImport(await rowsFromDhis2Json(await file.text()), defaultTypeId, file.name);
  const { readSheet } = await import('./xlsx.js');
  const rows = await readSheet(file);
  const hi = rows.findIndex((r) => r.some((c) => /^name$/i.test(String(c).trim())));
  if (hi < 0) throw new Error('No “Name” column found. Use the Excel template (Download Excel template).');
  const head = rows[hi].map((c) => String(c).trim().toLowerCase());
  const col = (test) => head.findIndex(test);
  const ci = {
    state: col((c) => c === 'state'), lga: col((c) => c === 'lga' || c === 'lga name'), lgaId: col((c) => c === 'lga id' || c === 'lga uid'),
    ward: col((c) => c === 'ward' || c === 'ward (optional)' || c === 'ward name'), wardId: col((c) => c === 'ward id' || c === 'ward uid'),
    name: col((c) => c === 'name'), type: col((c) => c === 'type' || c === 'unit type'), code: col((c) => c === 'code' || c.startsWith('code (')),
    latitude: col((c) => c.startsWith('latitude') || c === 'lat'), longitude: col((c) => c.startsWith('longitude') || c === 'lon' || c === 'long' || c === 'lng'),
    id: col((c) => c.startsWith('dhis2 id') || c === 'id' || c === 'uid'),
  };
  if (ci.lga < 0 && ci.lgaId < 0) throw new Error('No “LGA” or “LGA ID” column found. Use the Excel template.');
  const data = rows.slice(hi + 1).map((r, i) => {
    const g = (k) => (ci[k] >= 0 ? String(r[ci[k]] ?? '').trim() : '');
    return { row: hi + i + 2, state: g('state'), lga: g('lga'), lgaId: g('lgaId'), ward: g('ward'), wardId: g('wardId'), name: g('name'), type: g('type'), code: g('code'), latitude: g('latitude'), longitude: g('longitude'), id: g('id') };
  }).filter((r) => r.name || r.lga || r.lgaId);
  if (!data.length) throw new Error('The file has no rows under the header.');
  return checkAndImport(data, defaultTypeId, file.name);
}

// DHIS2 / ALMA Export organisation units file: wards (children of LGAs that have units under them) keep their DHIS2
// IDs; units below them, or directly below an LGA, keep theirs too.
async function rowsFromDhis2Json(text) {
  let body; try { body = JSON.parse(text); } catch { throw new Error('This JSON file could not be read.'); }
  let list = body && !Array.isArray(body) ? body.organisationUnits : body;
  if (list && !Array.isArray(list)) list = list.organisationUnits;
  if (!Array.isArray(list)) throw new Error('No organisationUnits found in this file.');
  const { lgas } = await get('/api/orgunits?lgas=all');
  const lgaIds = new Set(lgas.map((l) => l.id));
  const byId = new Map(list.map((o) => [o.id, o]));
  const hasChildren = new Set(list.filter((o) => o.parent && o.parent.id).map((o) => o.parent.id));
  const wards = []; const units = [];
  for (const o of list) {
    const p = o.parent && o.parent.id;
    if (!p || lgaIds.has(o.id)) continue;
    if (lgaIds.has(p)) {
      if (hasChildren.has(o.id) || /\bward\b/i.test(o.name)) wards.push({ lgaId: p, name: o.name, type: 'Ward', id: o.id });
      else units.push({ lgaId: p, name: o.name, id: o.id });
    } else { const w = byId.get(p); const gp = w && w.parent && w.parent.id; if (gp && lgaIds.has(gp)) units.push({ lgaId: gp, wardId: w.id, name: o.name, id: o.id }); }
  }
  const rows = [...wards, ...units].map((r, i) => ({ row: i + 1, ...r }));
  if (!rows.length) throw new Error('No units below LGAs in your area were found in this file.');
  return rows;
}

// Wards and health facilities live from the scorecard platform (real DHIS2 IDs), one state at a time.
const SCORECARD = 'https://www.malariascorecard.org';
async function scorecardDialog(states, stateId, types) {
  const o = await orgs();
  const stList = states || o.states;
  const stSel = select(stList, stateId || stList[0].id);
  const wantWards = h('input', { type: 'checkbox', checked: true });
  const wantFac = h('input', { type: 'checkbox', checked: true });
  const facType = select(types.filter((t) => !t.isWard).map((t) => ({ id: t.name, name: t.name })).concat(types.some((t) => /health facilit/i.test(t.name)) ? [] : [{ id: 'Health facility', name: 'Health facility (new type)' }]),
    (types.find((t) => /health facilit/i.test(t.name)) || {}).name || 'Health facility');
  const status = h('p', { class: 'muted small' });
  const start = h('button', { class: 'primary' }, 'Load');
  const dlg = h('dialog', {}, h('h2', {}, 'Load wards & health facilities'),
    h('p', { class: 'muted small' }, 'Reads one state’s official wards and health facilities, with their official IDs (Nigeria’s health information system, via the scorecard platform). You see the usual check before anything is saved.'),
    h('div', { class: 'grid2' }, field('State', stSel), field('Type for the facilities', facType)),
    h('label', { class: 'check' }, wantWards, 'Wards'), h('label', { class: 'check' }, wantFac, 'Health facilities, under their wards'),
    status, h('div', { class: 'actions' }, start, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  start.addEventListener('click', busy(start, async () => {
    const j = async (path) => { const r = await fetch(SCORECARD + path); if (!r.ok) throw new Error(`Scorecard platform answered ${r.status}.`); return r.json(); };
    status.textContent = 'Finding the state…';
    try { await j('/api/regions?parentId=35469'); } catch (e) { status.textContent = ''; throw new Error('Could not reach the scorecard platform: ' + e.message); }
    const stateRegion = (await j('/api/regions?parentId=35469&depth=1')).find((x) => x.dhisRegionId === stSel.value);
    if (!stateRegion) throw new Error('This state was not found on the scorecard platform.');
    const lgaRegions = (await j(`/api/regions?parentId=${stateRegion.id}&depth=1`)).filter((x) => x.parentId === stateRegion.id && !/cold store/i.test(x.name));
    const wardRows = []; const facRows = []; let done = 0; let next = 0;
    const uid = (x) => /^[A-Za-z][A-Za-z0-9]{10}$/.test(x || '');
    async function worker() {
      while (next < lgaRegions.length) {
        const l = lgaRegions[next++];
        const items = await j(`/api/regions?parentId=${l.id}&depth=3`);
        const byId = new Map(items.map((x) => [x.id, x]));
        for (const x of items) {
          if (/cold store/i.test(x.name)) continue;
          if (x.parentId === l.id && uid(x.dhisRegionId) && wantWards.checked) wardRows.push({ lgaId: l.dhisRegionId, name: x.name.replace(/\s+/g, ' ').trim(), type: 'Ward', id: x.dhisRegionId });
          const w = byId.get(x.parentId);
          if (w && w.parentId === l.id && uid(x.dhisRegionId) && wantFac.checked) {
            facRows.push({ lgaId: l.dhisRegionId, ...(wantWards.checked && uid(w.dhisRegionId) ? { wardId: w.dhisRegionId } : { ward: w.name }), name: x.name.replace(/\s+/g, ' ').trim(), type: facType.value, id: x.dhisRegionId });
          }
        }
        status.textContent = `Reading LGAs… ${++done} of ${lgaRegions.length} (${wardRows.length} wards, ${facRows.length} facilities so far)`;
      }
    }
    await Promise.all([1, 2, 3, 4].map(worker));
    dlg.close();
    await checkAndImport([...wardRows, ...facRows].map((r, i) => ({ row: i + 1, ...r })), '', `Official wards and health facilities — ${stSel.options[stSel.selectedIndex].text}`);
  }));
  document.body.append(dlg); dlg.showModal();
}

async function checkAndImport(data, defaultTypeId, sourceName) {
  // Wards first, so the units under them find them.
  data = [...data.filter((r) => /^wards?$/i.test(r.type || '')), ...data.filter((r) => !/^wards?$/i.test(r.type || ''))];
  const parts = []; for (let i = 0; i < data.length; i += 4000) parts.push(data.slice(i, i + 4000));
  const c = { add: 0, update: 0, same: 0, error: 0, wards: 0, possibleDuplicates: 0 }; const results = []; const newTypes = new Set();
  for (const p of parts) {
    const { data: check } = await api('POST', '/api/units/import', { typeId: defaultTypeId || undefined, rows: p });
    for (const k of Object.keys(c)) c[k] += check.counts[k] || 0;
    results.push(...check.results); (check.newTypes || []).forEach((t) => newTypes.add(t));
  }
  const errors = results.filter((r) => r.status === 'error');
  const notes = results.filter((r) => r.note && r.status !== 'error');
  const go = h('button', { class: 'primary', disabled: !!c.error || !(c.add + c.update) }, `Import ${c.add + c.update} unit${c.add + c.update === 1 ? '' : 's'}`);
  const dlg = h('dialog', { class: 'wide' }, h('h2', {}, 'Import units below the LGA — check'),
    h('p', { class: 'muted small' }, sourceName, ` · ${data.length} rows`),
    h('div', { class: 'counts' }, h('span', { class: 'pill s-accepted' }, `New: ${c.add}${c.wards ? ` (${c.wards} wards)` : ''}`), h('span', { class: 'pill s-draft' }, `Updated: ${c.update}`),
      h('span', { class: 'pill s-none' }, `Unchanged: ${c.same}`), h('span', { class: 'pill s-returned' }, `Problems: ${c.error}`),
      c.possibleDuplicates ? h('span', { class: 'pill s-submitted' }, `Possible duplicates: ${c.possibleDuplicates} — see Notes`) : null),
    newTypes.size ? h('div', { class: 'note info' }, `New unit type${newTypes.size === 1 ? '' : 's'} will be added: ${[...newTypes].join(', ')}.`) : null,
    notes.length ? h('details', {}, h('summary', { class: 'small' }, `Notes (${notes.length})`), h('ul', { class: 'small' }, notes.slice(0, 200).map((n) => h('li', {}, `Row ${n.row} · ${n.name}: ${n.note}`)))) : null,
    errors.length ? h('div', {}, h('div', { class: 'note bad' }, 'Fix these rows in the file and import it again. Nothing has been saved.'),
      h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Row'), h('th', {}, 'Name'), h('th', {}, 'Problem'))),
        h('tbody', {}, errors.slice(0, 200).map((e) => h('tr', {}, h('td', {}, e.row), h('td', {}, e.name), h('td', {}, e.message)))))))
      : h('div', { class: 'note ok' }, 'All rows look good.'),
    h('p'), h('div', { class: 'actions' }, go, h('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  const progress = h('span', { class: 'muted small' });
  go.after(progress);
  go.addEventListener('click', busy(go, async () => {
    const status = new Map(results.map((x) => [x.row, x.status]));
    const todo = data.filter((r) => ['add', 'update'].includes(status.get(r.row)));
    const chunks = []; for (let i = 0; i < todo.length; i += 300) chunks.push(todo.slice(i, i + 300));
    let added = 0; let updated = 0;
    for (let i = 0; i < chunks.length; i++) {
      progress.textContent = `Saving part ${i + 1} of ${chunks.length}…`;
      const { data: done } = await api('POST', '/api/units/import', { typeId: defaultTypeId || undefined, rows: chunks[i], commit: true });
      added += done.counts.add; updated += done.counts.update;
    }
    for (const k of Object.keys(unitCache)) delete unitCache[k];
    state.meta = null;
    dlg.close(); toast(`Imported: ${added} new, ${updated} updated`); renderUnits();
  }));
  document.body.append(dlg); dlg.showModal();
}

// ---------- accounts ----------
async function renderAccounts() {
  const [{ users, roles }, m] = await Promise.all([get('/api/users'), meta()]);
  const [{ requests }, { links }] = await Promise.all([is('sysadmin') ? get('/api/account-requests') : { requests: [] }, get('/api/registration-links')]);
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
      choice('Let many people sign up', 'Make a QR code for an area and sector, and print or share it. People scan it and ask for an account; a system administrator approves them here.',
        h('div', {}, h('button', { onclick: (e) => quickQr(e.currentTarget) }, '+ Registration QR code'),
          h('div', {}, h('a', { href: '#', class: 'small', onclick: (e) => { e.preventDefault(); linkDialog(m); } }, 'Only for one state, LGA or sector…')))),
      is('sysadmin') ? choice('Add an administrator', 'A System administrator can do everything you can: set-up, users, states in use. An Administrator adds sectors and indicators and sees the results, but does not manage users.',
        h('button', { onclick: () => userDialog(null, roles, m, 'admin') }, '+ New administrator')) : null),
    linksPanel(links),
    h('details', { class: 'panel roles' }, h('summary', {}, 'What each role can do'),
      h('table', {}, h('tbody', {}, roles.filter((r) => r.id !== 'viewer').map((r) => h('tr', {}, h('td', {}, h('strong', {}, r.name)), h('td', { class: 'small' }, ROLE_HELP[r.id] || '')))))),
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
  const roleOpts = [{ id: '', name: 'Let them choose' }, { id: 'lga', name: 'Data entry — LGA' }, { id: 'unit', name: 'Data entry — school / facility' },
    ...(is('sysadmin', 'national') ? [{ id: 'state', name: 'Data entry — state' }] : [])];
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
    h('p', { class: 'muted small' }, 'Anyone with this QR code can ask for an account inside the area you choose. Nobody gets in until a system administrator approves them (Users page).'),
    h('div', { class: 'grid2' }, field('Name (optional)', name, 'Left empty, it is named after the area and sector.'), field('Area', area), field('Or one LGA', lgaPick), field('Sector', sectorPick), field('Suggested role', roleSel), field('Valid for (days)', days)),
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

// One click: a QR code for your whole area, any sector, valid 30 days. People who scan it fill in the rest.
async function quickQr(btn) {
  btn.disabled = true;
  try { const { data } = await api('POST', '/api/registration-links', { ouId: state.me.ou.id, days: 30 }); renderAccounts(); showQr(data.link); }
  catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
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
    g.font = 'bold 26px system-ui, sans-serif'; g.fillText('LGA Multi-Sectoral Nutrition Scorecard — request an account', W / 2, W + 40);
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
    // Units of the chosen sector: those its unit-reported schedules use (or, for older schedules, the sector's own).
    const sectorSets = info.datasets.filter((d) => d.sectorId === sectorSel.value && d.byUnit);
    const fits = (u) => !sectorSel.value || u.sectorId === sectorSel.value || sectorSets.some((d) => (d.unitTypes || []).includes(u.typeId));
    const list = lgaSel.value ? (await places(lgaSel.value, true)).filter(fits).map((u) => ({ ...u, name: u.ward && u.typeId !== 'ut_ward' ? `${u.name} — ${u.ward}` : u.name })) : [];
    unitSel.replaceChildren(...opt(list, !lgaSel.value ? '—' : list.length ? 'Choose your school / facility' : 'None listed for this sector yet'));
  }
  stateSel.addEventListener('change', fillLgas); lgaSel.addEventListener('change', fillUnits);
  function layout() {
    const l = lvl();
    where.replaceChildren(...[
      info.area.level === 1 && l !== 1 ? field('State', stateSel) : null,
      (l === 3 || l === 4 || l === null) && info.area.level <= 3 ? field(l === null ? 'LGA (optional)' : 'LGA', lgaSel) : null,
      l === 4 ? field('Unit (ward, facility, school …)', unitSel) : null].filter(Boolean));
  }
  roleSel.addEventListener('change', layout);
  await fillStates(); await fillLgas(); layout(); fillDatasets();
  const form = h('form', { class: 'panel card-narrow reg' },
    h('h1', {}, 'Request an account'),
    h('p', { class: 'muted small' }, `LGA Multi-Sectoral Nutrition Scorecard Data Reporting System · ${info.name} · ${info.area.name}`),
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
        h('p', {}, 'Thank you. A system administrator will check your request. Once it is approved you can sign in with your email and the password you chose.'),
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
  const allowedRoles = (is('sysadmin') ? roles : is('national') ? roles.filter((r) => ['state', 'lga', 'unit'].includes(r.id)) : roles.filter((r) => ['lga', 'unit'].includes(r.id)))
    .filter((r) => presetRole !== 'admin' || ['sysadmin', 'setupadmin'].includes(r.id));
  const name = h('input', { value: u ? u.name : '', autocomplete: 'off' });
  const email = h('input', { type: 'email', value: u ? u.email : '', autocomplete: 'off' });
  const roleSel = select(allowedRoles, u ? u.role : presetRole === 'admin' ? 'sysadmin' : (allowedRoles.find((r) => r.id === 'lga') || allowedRoles[0]).id);
  // Shown as three roles — System administrator, Administrator, Data entry (at a state, an LGA, or a school / facility).
  const ENTRY = ['national', 'state', 'lga', 'unit'];
  const has = (id) => allowedRoles.some((r) => r.id === id);
  const kinds = [
    has('sysadmin') ? { id: 'sysadmin', name: 'System administrator' } : null,
    has('setupadmin') ? { id: 'setupadmin', name: 'Administrator (adds sectors and indicators)' } : null,
    ENTRY.some(has) ? { id: 'entry', name: 'Data entry' } : null,
    has('viewer') && u && u.role === 'viewer' ? { id: 'viewer', name: 'Viewer (only looks at results)' } : null,
  ].filter(Boolean);
  const levelNames = { national: 'The whole country (any state)', state: 'A state (any of its LGAs)', lga: 'An LGA', unit: 'A school, facility or ward' };
  const kindSel = select(kinds, ENTRY.includes(roleSel.value) ? 'entry' : roleSel.value);
  const levelSel = select(ENTRY.filter(has).map((id) => ({ id, name: levelNames[id] })), ENTRY.includes(roleSel.value) ? roleSel.value : 'lga');
  const levelField = field('Enters data for', levelSel);
  const syncRole = () => {
    levelField.hidden = kindSel.value !== 'entry';
    roleSel.value = kindSel.value === 'entry' ? levelSel.value : kindSel.value;
    roleSel.dispatchEvent(new Event('change'));
  };
  kindSel.addEventListener('change', syncRole); levelSel.addEventListener('change', syncRole);
  levelField.hidden = kindSel.value !== 'entry';
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
    unitSel.replaceChildren(...(list.length ? list.map((x) => h('option', { value: x.id, selected: u && u.ou && x.id === u.ou.id }, `${x.name}${x.type ? ' — ' + x.type : ''}${x.ward && x.typeId !== 'ut_ward' ? ', ' + x.ward : ''}`))
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
      lvl === 4 ? field('Unit (ward, facility, school …)', unitSel) : null);
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
    h('div', { class: 'grid2' }, field('Full name', name), field('Email', email), field('Role', kindSel), levelField),
    where,
    h('p', { class: 'muted small role-help' }),
    h('h3', {}, 'Reports this person works on'),
    h('div', { class: 'chips' }, dsBoxes.map((x) => h('label', { class: 'check' }, x.box, dsLabel(x.d)))),
    h('p', { class: 'muted small' }, 'Nothing ticked = all reports.'),
    h('details', {}, h('summary', { class: 'small' }, 'Advanced: only some numbers of a report'),
      h('p', { class: 'muted small' }, 'Use this when two people share a report (e.g. a Health officer and an Education officer). Tick only the numbers this person types in. Nothing ticked = every number.'),
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
