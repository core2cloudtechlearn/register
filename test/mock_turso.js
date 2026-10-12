// Stand-in for a Turso database's HTTP API (/v2/pipeline), backed by in-memory SQLite.
// Lets the Turso driver in store.js be tested without an account.
//   node test/mock_turso.js   (listens on 3300, token "mock-token")
const http = require('node:http');
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
const TOKEN = 'mock-token';
const arg = a => a.type === 'null' ? null : a.type === 'integer' ? Number(a.value) : a.type === 'float' ? a.value : a.value;
const cell = v => v === null ? { type: 'null' } : typeof v === 'number' ? (Number.isInteger(v) ? { type: 'integer', value: String(v) } : { type: 'float', value: v }) : { type: 'text', value: String(v) };

http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url !== '/v2/pipeline' || req.method !== 'POST') return send(404, {});
    if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, { error: 'unauthorized' });
    const results = JSON.parse(body).requests.map(r => {
      if (r.type === 'close') return { type: 'ok', response: { type: 'close' } };
      try {
        const st = db.prepare(r.stmt.sql);
        const args = (r.stmt.args || []).map(arg);
        if (/^\s*(select|pragma)/i.test(r.stmt.sql)) {
          const rows = st.all(...args);
          const cols = rows.length ? Object.keys(rows[0]) : st.columns().map(c => c.name);
          return { type: 'ok', response: { type: 'execute', result: { cols: cols.map(name => ({ name })), rows: rows.map(x => cols.map(c => cell(x[c]))), affected_row_count: 0 } } };
        }
        const out = st.run(...args);
        return { type: 'ok', response: { type: 'execute', result: { cols: [], rows: [], affected_row_count: Number(out.changes) } } };
      } catch (e) { return { type: 'error', error: { message: e.message } }; }
    });
    send(200, { results });
  });
}).listen(3300, () => console.log('mock Turso on :3300'));
