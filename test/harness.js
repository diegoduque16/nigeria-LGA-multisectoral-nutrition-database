// Test harness: runs the real Worker code in Node against a SQLite database that mimics Cloudflare D1.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { handle } from '../src/index.js';

const norm = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, norm(args)); }
  async first(col) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    const plain = { ...row };
    return col ? plain[col] : plain;
  }
  async all() {
    const rows = this.db.prepare(this.sql).all(...this.args).map((r) => ({ ...r }));
    return { results: rows, success: true, meta: {} };
  }
  async run() {
    if (/\bRETURNING\b/i.test(this.sql)) {
      const rows = this.db.prepare(this.sql).all(...this.args);
      return { success: true, meta: { changes: rows.length }, results: rows };
    }
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class D1Shim {
  constructor(file = ':memory:') {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON;');
  }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { return Promise.all(stmts.map((s) => s.run())); }
  async exec(sql) { this.db.exec(sql); }
  migrate() {
    const dir = new URL('../migrations/', import.meta.url);
    for (const f of readdirSync(dir).sort()) this.db.exec(readFileSync(new URL(f, dir), 'utf8'));
    return this;
  }
}

export function makeEnv(overrides = {}) {
  const DB = overrides.DB || new D1Shim(overrides.file).migrate();
  return { DB, SETUP_KEY: 'test-setup-key-123', ...overrides, DB };
}

// A fake fetch router for third-party APIs. routes: [[matcher(url, init) => bool, handler(url, init) => Response]]
export function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    for (const [match, h] of routes) if (match(u, init)) return h(u, init);
    throw new Error(`Unexpected fetch ${u}`);
  };
  f.calls = calls;
  return f;
}

export function client(env, origin = 'https://lga.test') {
  let cookie = '';
  async function call(method, path, body, extraHeaders = {}) {
    const headers = { 'x-lga': '1', ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof Uint8Array) { payload = body; headers['content-type'] = 'audio/webm'; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await handle(new Request(origin + path, { method, headers, body: payload }), env);
    const set = res.headers.get('set-cookie');
    if (set) {
      const v = set.split(';')[0];
      cookie = v.endsWith('=') ? '' : v;
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b ?? {}, h),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p, b) => call('DELETE', p, b),
    get cookie() { return cookie; },
  };
}


export const PW = 'Correct horse battery 9';

// Creates the first system administrator and returns their client.
export async function setupAdmin(env) {
  const c = client(env);
  const r = await c.post('/api/setup', { setupKey: env.SETUP_KEY, name: 'Ada Admin', email: 'admin@gov.ng', password: PW });
  if (r.status !== 201) throw new Error('setup failed ' + JSON.stringify(r.data));
  return c;
}

// Admin creates a user; the user opens the link and sets a password. Returns the user's client.
export async function addUser(env, admin, body) {
  const r = await admin.post('/api/users', body);
  if (r.status !== 201) throw new Error('create user failed ' + JSON.stringify(r.data));
  const token = r.data.link.split('/set-password/')[1];
  const c = client(env);
  const s = await c.post('/api/password-links/' + token, { password: PW });
  if (s.status !== 200) throw new Error('set password failed ' + JSON.stringify(s.data));
  return { c, user: r.data.user, link: r.data.link };
}
