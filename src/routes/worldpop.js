// GRID3 / WorldPop modelled population estimates for Nigeria (e.g. "NGA population v3.0", 2025).
// The release's table package (NGA_population_v3_0_table.zip) holds lga_pop_total_scaled.csv. This module
// downloads it (or reads an uploaded copy), works out its columns, matches each row to our LGAs, and lets the
// app map its columns onto the Population figures. It also checks WorldPop for newer versions.
import { HttpError, json, readJson, now } from '../lib/util.js';
import { all, getSetting, setSetting, audit } from '../lib/db.js';
import { inScope } from '../lib/auth.js';
import { unzip } from '../../public/js/unzip.js';

export const WORLDPOP_BASE = 'https://data.worldpop.org/repo/wopr/NGA/population/';
// Year each release represents (from its release notes); later versions default to their release year.
const REFERENCE_YEAR = { '3.0': 2025, '2.0': 2020, '1.2': 2016 };
const MAX_CSV = 5_000_000;

const vKey = (v) => v.split('.').map(Number);
const newer = (a, b) => { const x = vKey(a); const y = vKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const tableUrl = (v) => `${WORLDPOP_BASE}v${v}/NGA_population_v${v.replace('.', '_')}_table.zip`;

function requireAdmin(ctx) {
  if (!['sysadmin', 'setupadmin'].includes(ctx.role) || ctx.apiToken) throw new HttpError(403, 'forbidden', 'Only administrators can import population figures.');
}

// ---------- names ----------
// "ba Bauchi State" → "bauchi", "ab Obi Nwga LGA" → "obinwga", "Federal Capital Territory" / "FCT" / "Abuja" → "fct".
export function placeKey(s) {
  let x = String(s || '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  x = x.replace(/^[a-z]{2} (?=\S{3,})/, '');
  x = x.replace(/ (state|lga|l\.g\.a\.?|local government area|local government|area council)$/, '');
  x = x.replace(/[^a-z0-9]/g, '');
  if (['federalcapitalterritory', 'fct', 'abuja', 'fctabuja'].includes(x)) return 'fct';
  return x;
}
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

// ---------- CSV ----------
export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Which columns are the state, the LGA, and which hold numbers.
export function detectColumns(header, body) {
  const h = header.map((x) => x.trim());
  const low = h.map((x) => x.toLowerCase());
  const find = (tests) => { for (const t of tests) { const i = low.findIndex(t); if (i >= 0) return i; } return -1; };
  const state = find([(x) => /^(state|statename|state_name|admin1name|admin1|adm1_en|adm1_name)$/.test(x), (x) => x.includes('state') && !/code|id|pcode/.test(x)]);
  const lga = find([(x) => /^(lga|lganame|lga_name|admin2name|admin2|adm2_en|adm2_name)$/.test(x), (x) => x.includes('lga') && !/code|id|pcode/.test(x), (x) => /^(name|admin_name)$/.test(x)]);
  const numeric = h.map((name, i) => ({ name, i })).filter(({ i }) => i !== state && i !== lga && !/code|id$|pcode|^fid$|^objectid$|year/i.test(low[i]))
    .filter(({ i }) => { const vals = body.slice(0, 50).map((r) => r[i]).filter((v) => v !== undefined && String(v).trim() !== ''); return vals.length && vals.every((v) => Number.isFinite(Number(String(v).replace(/,/g, '')))); })
    .map(({ name }) => name);
  return { state: state >= 0 ? h[state] : null, lga: lga >= 0 ? h[lga] : null, numeric };
}

// Match file rows to our LGAs (active states, in the caller's area).
async function matchRows(db, ctx, rows, cols) {
  const lgas = (await all(db, `SELECT l.id, l.name, l.path, s.id AS state_id, s.name AS state_name FROM org_units l JOIN org_units s ON s.id = l.parent_id
    WHERE l.level = 3 AND l.closed_at IS NULL AND s.inactive = 0`)).filter((l) => inScope(ctx, l));
  const byState = new Map();
  for (const l of lgas) { const k = placeKey(l.state_name); if (!byState.has(k)) byState.set(k, []); byState.get(k).push({ ...l, key: placeKey(l.name) }); }
  const out = []; const unmatched = []; const used = new Map(); let otherStates = 0;
  for (const r of rows) {
    const st = placeKey(r.state); const name = placeKey(r.lga);
    const cands = byState.get(st);
    if (!cands) { otherStates++; continue; } // a state not in use (or not in your area)
    let hit = cands.find((c) => c.key === name);
    let fuzzy = false;
    if (!hit && name.length >= 4) {
      const scored = cands.map((c) => ({ c, d: distance(c.key, name) })).filter((x) => x.d <= (name.length > 8 ? 2 : 1)).sort((a, b) => a.d - b.d);
      if (scored.length && (scored.length === 1 || scored[0].d < scored[1].d)) { hit = scored[0].c; fuzzy = true; }
      else { const pre = cands.filter((c) => c.key.startsWith(name) || name.startsWith(c.key)); if (pre.length === 1) { hit = pre[0]; fuzzy = true; } }
    }
    if (!hit) { unmatched.push({ state: r.state, lga: r.lga }); continue; }
    if (used.has(hit.id)) { unmatched.push({ state: r.state, lga: r.lga, note: `matches ${hit.name}, already matched to “${used.get(hit.id)}”` }); continue; }
    used.set(hit.id, r.lga);
    out.push({ lgaId: hit.id, lgaName: hit.name, state: hit.state_name, fileName: r.lga, fuzzy, values: r.values });
  }
  const missing = lgas.filter((l) => !used.has(l.id)).map((l) => ({ id: l.id, name: l.name, state: l.state_name }));
  return { rows: out, unmatched, missing, otherStates, lgasInUse: lgas.length };
}

async function tableFromCsv(db, ctx, text, fileName) {
  const grid = parseCsv(text);
  if (grid.length < 2) throw new HttpError(422, 'invalid', 'The file has no rows.');
  const [header, ...body] = grid;
  const cols = detectColumns(header, body);
  if (!cols.lga) throw new HttpError(422, 'invalid', `No LGA column found in ${fileName}. Columns: ${header.join(', ')}.`);
  if (!cols.numeric.length) throw new HttpError(422, 'invalid', `No number columns found in ${fileName}.`);
  const idx = Object.fromEntries(header.map((x, i) => [x.trim(), i]));
  const rows = body.map((r) => ({
    state: cols.state ? r[idx[cols.state]] : '', lga: r[idx[cols.lga]],
    values: Object.fromEntries(cols.numeric.map((c) => [c, Number(String(r[idx[c]] ?? '').replace(/,/g, ''))]).filter(([, v]) => Number.isFinite(v))),
  })).filter((r) => r.lga);
  const m = await matchRows(db, ctx, rows, cols);
  return { file: fileName, columns: cols, fileRows: rows.length, ...m };
}

async function pickCsv(files) {
  const csvs = files.filter((f) => /\.csv$/i.test(f.name));
  const f = csvs.find((x) => /lga/i.test(x.name.split('/').pop())) || csvs.find((x) => /admin2|adm2/i.test(x.name));
  if (!f) throw new HttpError(422, 'invalid', `No LGA table found in the package (files: ${files.map((x) => x.name).join(', ')}).`);
  return f;
}

// ---------- versions ----------
async function listVersions() {
  const r = await fetch(WORLDPOP_BASE, { headers: { 'user-agent': 'lganutritiondata.org population import' } });
  if (!r.ok) throw new Error(`WorldPop answered ${r.status}.`);
  const html = await r.text();
  return [...new Set([...html.matchAll(/href="v(\d+(?:\.\d+)+)\/?"/g)].map((m) => m[1]))].sort((a, b) => (newer(a, b) ? 1 : -1));
}

// Checks WorldPop and remembers the result (also run by the daily scheduled job).
export async function checkWorldPop(env) {
  const versions = await listVersions();
  const latest = versions[versions.length - 1] || null;
  const info = { versions, latest, checkedAt: now() };
  await setSetting(env.DB, 'worldpop:check', JSON.stringify(info));
  return info;
}

async function status(env) {
  const check = JSON.parse((await getSetting(env.DB, 'worldpop:check')) || 'null');
  const imported = JSON.parse((await getSetting(env.DB, 'worldpop:imported')) || 'null');
  const latest = check && check.latest;
  return {
    source: WORLDPOP_BASE, check, imported,
    newerAvailable: !!(latest && (!imported || newer(latest, imported.version))),
    referenceYear: latest ? REFERENCE_YEAR[latest] || null : null,
  };
}

// GET /api/worldpop            — what was imported, and the last check
// GET /api/worldpop?check=1    — check WorldPop now
export async function worldpopStatus(request, env, ctx) {
  requireAdmin(ctx);
  if (new URL(request.url).searchParams.get('check')) {
    try { await checkWorldPop(env); } catch (e) { throw new HttpError(502, 'unreachable', 'Could not reach WorldPop: ' + e.message + ' Try again later, or download the table yourself and upload it.'); }
  }
  return json(await status(env));
}

// GET /api/worldpop/table?version=3.0  — download the release's table and match it to our LGAs (nothing saved).
// POST /api/worldpop/table { name, csv } — the same from an uploaded file (the app unzips .zip uploads).
export async function worldpopTable(request, env, ctx) {
  requireAdmin(ctx);
  if (request.method === 'POST') {
    const body = await readJson(request, MAX_CSV + 10000);
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw new HttpError(422, 'invalid', 'The file is empty.');
    const version = typeof body.version === 'string' && /^\d+(\.\d+)+$/.test(body.version) ? body.version : null;
    return json({ version, referenceYear: version ? REFERENCE_YEAR[version] || null : null, url: null, ...(await tableFromCsv(env.DB, ctx, body.csv, String(body.name || 'uploaded file').slice(0, 200))) });
  }
  const version = new URL(request.url).searchParams.get('version') || '';
  if (!/^\d+(\.\d+)+$/.test(version)) throw new HttpError(422, 'invalid', 'Choose a version, e.g. 3.0.');
  const url = tableUrl(version);
  let res;
  try { res = await fetch(url, { headers: { 'user-agent': 'lganutritiondata.org population import' } }); } catch (e) { throw new HttpError(502, 'unreachable', 'Could not reach WorldPop. Download the table yourself and upload it.'); }
  if (!res.ok) throw new HttpError(502, 'unreachable', `WorldPop has no table package at ${url} (answer ${res.status}). Download the table from the release page and upload it.`);
  const files = await unzip(await res.arrayBuffer());
  const f = await pickCsv(files);
  const text = await f.text();
  if (text.length > MAX_CSV) throw new HttpError(422, 'too_big', 'The LGA table is unexpectedly large.');
  return json({ version, referenceYear: REFERENCE_YEAR[version] || null, url, ...(await tableFromCsv(env.DB, ctx, text, f.name)) });
}

// POST /api/worldpop/imported { version, year, columns } — remember what was imported (after the figures are saved).
export async function worldpopImported(request, env, ctx) {
  requireAdmin(ctx);
  const b = await readJson(request);
  const version = typeof b.version === 'string' && /^\d+(\.\d+)+$/.test(b.version) ? b.version : null;
  if (!version) throw new HttpError(422, 'invalid', 'Which version was imported?');
  const rec = { version, year: String(b.year || ''), by: ctx.user.name, at: now(), mapping: Array.isArray(b.mapping) ? b.mapping.slice(0, 20) : [] };
  await setSetting(env.DB, 'worldpop:imported', JSON.stringify(rec));
  await audit(env.DB, ctx, 'worldpop_imported', 'setting', 'worldpop', { version, year: rec.year });
  return json(await status(env));
}
