// Local server: runs the real Worker code in Node with a SQLite-backed D1 shim and serves public/ like Workers Assets.
// Usage: node scripts/dev-server.js [port] [dbfile]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { D1Shim } from '../test/harness.js';
import { handle } from '../src/index.js';

const port = Number(process.argv[2] || 8788);
const file = process.argv[3] || ':memory:';
const DB = new D1Shim(file);
try { DB.migrate(); } catch (e) { if (!/already exists/.test(e.message)) throw e; }
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
const ASSETS = {
  async fetch(req) {
    let p = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    try { return new Response(await readFile(join(root, p)), { headers: { 'content-type': types[extname(p)] || 'application/octet-stream' } }); }
    catch { return new Response(await readFile(join(root, 'index.html')), { headers: { 'content-type': types['.html'] } }); }
  },
};
const env = { DB, ASSETS, SETUP_KEY: process.env.SETUP_KEY || 'local-setup-key' };

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await handle(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log(`LGA reporting on http://localhost:${port}`));
