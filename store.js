// Storage layer with one async API and two drivers:
//   - Turso (hosted SQLite over HTTPS, free plan): set TURSO_URL + TURSO_AUTH_TOKEN. Used on Render's free plan,
//     which has no disk.
//   - Local SQLite file (node:sqlite): used otherwise (your PC, or a host with a persistent disk).
// No npm packages needed.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

function localDriver(file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  return {
    kind: 'local file ' + file,
    async exec(sql) { db.exec(sql); },
    async all(sql, args = []) { return db.prepare(sql).all(...args); },
    async run(sql, args = []) { const r = db.prepare(sql).run(...args); return { changes: Number(r.changes) }; },
  };
}

function tursoDriver(url, token) {
  const base = url.replace(/^libsql:\/\//, 'https://').replace(/\/$/, '');
  const enc = v => v === null || v === undefined ? { type: 'null' }
    : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v })
    : { type: 'text', value: String(v) };
  const dec = c => !c || c.type === 'null' ? null : c.type === 'integer' ? Number(c.value) : c.type === 'float' ? Number(c.value) : c.value;

  async function pipeline(stmts) {
    const requests = stmts.map(s => ({ type: 'execute', stmt: { sql: s.sql, args: (s.args || []).map(enc) } }));
    requests.push({ type: 'close' });
    const r = await fetch(base + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`Turso HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const out = (await r.json()).results;
    return out.slice(0, stmts.length).map(x => {
      if (x.type === 'error') throw new Error(x.error && x.error.message || 'Turso error');
      return x.response.result;
    });
  }
  return {
    kind: 'Turso ' + base.replace(/^https:\/\//, ''),
    async exec(sql) { for (const s of sql.split(';').map(x => x.trim()).filter(Boolean)) await pipeline([{ sql: s }]); },
    async all(sql, args = []) {
      const [res] = await pipeline([{ sql, args }]);
      const names = res.cols.map(c => c.name);
      return res.rows.map(row => Object.fromEntries(row.map((c, i) => [names[i], dec(c)])));
    },
    async run(sql, args = []) { const [res] = await pipeline([{ sql, args }]); return { changes: Number(res.affected_row_count || 0) }; },
  };
}

function open({ tursoUrl, tursoToken, dbPath }) {
  const d = tursoUrl ? tursoDriver(tursoUrl, tursoToken || '') : localDriver(dbPath);
  return { ...d, async get(sql, args) { return (await d.all(sql, args))[0]; } };
}

module.exports = { open };
