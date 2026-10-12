// Tiny stand-in for api.razorpay.com so the payment flow can be tested without keys or money.
// Run:  node test/mock_razorpay.js        (listens on 3200)
// Then start the server with RAZORPAY_API_BASE=http://localhost:3200 and any fake RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
const http = require('node:http');
const KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_mockkey';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'mocksecret';
let n = 0;
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const auth = 'Basic ' + Buffer.from(KEY_ID + ':' + KEY_SECRET).toString('base64');
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && req.url === '/v1/orders') {
      if (req.headers.authorization !== auth) return send(401, { error: { description: 'Authentication failed' } });
      const b = JSON.parse(body);
      if (!Number.isInteger(b.amount) || b.amount < 100) return send(400, { error: { description: 'Invalid amount' } });
      return send(200, { id: 'order_MOCK' + String(++n).padStart(4, '0'), entity: 'order', amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created' });
    }
    send(404, { error: { description: 'not found' } });
  });
}).listen(3200, () => console.log('mock Razorpay on :3200'));
