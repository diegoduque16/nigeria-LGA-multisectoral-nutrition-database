// Thin helpers over the D1 binding.
import { HttpError, uid, now } from './util.js';

export async function one(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).first()) || null;
}
export async function all(db, sql, ...args) {
  const r = await db.prepare(sql).bind(...args).all();
  return r.results || [];
}
export async function run(db, sql, ...args) {
  return db.prepare(sql).bind(...args).run();
}

export async function audit(db, ctx, action, refType = null, refId = null, detail = null) {
  await run(db, 'INSERT INTO audit (id, user_id, action, ref_type, ref_id, detail, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
    uid('au_'), ctx && ctx.user ? ctx.user.id : null, action, refType, refId,
    detail ? JSON.stringify(detail).slice(0, 4000) : null, ctx && ctx.ip ? ctx.ip : null, now());
}

// Fixed-window rate limiter stored in D1.
export async function rateLimit(db, key, limit, windowSec) {
  const t = now();
  const win = Math.floor(t / (windowSec * 1000)) * windowSec * 1000;
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING count`).bind(key, win).first();
  if (row && row.count > limit) {
    const retry = Math.ceil((win + windowSec * 1000 - t) / 1000);
    throw new HttpError(429, 'rate_limited', `Too many attempts. Please try again in ${retry} seconds.`, { retryAfter: retry });
  }
}

export async function getSetting(db, key) {
  const r = await one(db, 'SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : null;
}
export async function setSetting(db, key, value) {
  await run(db, `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, now());
}
