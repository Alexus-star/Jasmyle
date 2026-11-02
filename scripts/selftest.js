'use strict';
// Proves Jasmyle Properties works on THIS computer: boots the real server on a temporary database, loads every page file,
// creates an administrator, signs in. Run:  node --disable-warning=ExperimentalWarning scripts/selftest.js
const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nh-selftest-'));
process.env.NH_DATA_DIR = tmp; process.env.NH_TEST_NO_RATELIMIT = '1';
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m + (!c && extra ? '  -> ' + extra : '')); if (!c) fails++; };
console.log(`Node ${process.version} on ${process.platform} ${os.release()} (${process.arch})`);
console.log('Program folder: ' + root);
(async () => {
  for (const f of ['server/data/rules-default.json', 'public/index.html', 'public/css/app.css', 'public/js/core.js', 'public/js/qr.js', 'public/js/main.js', 'server/app.js', 'supervisor.js']) ok(fs.existsSync(path.join(root, f)), 'file present: ' + f);
  let srv; let S;
  try {
    S = require('../server/store'); const sec = require('../server/sec'); S.open(); sec.master();
    ok(true, 'database opens (built-in SQLite) and the encryption key can be created');
    const { createServer } = require('../server/app'); srv = createServer();
    await new Promise((r, j) => { srv.once('error', j); srv.listen(0, '127.0.0.1', r); });
  } catch (e) { ok(false, 'server starts', e && e.stack || e); console.log(`\nRESULT: ${fails} problem(s)`); process.exit(1); }
  const base = 'http://127.0.0.1:' + srv.address().port;
  const get = async (u, o) => { const r = await fetch(base + u, o); return { status: r.status, text: await r.text(), headers: r.headers }; };
  let r = await get('/'); ok(r.status === 200 && r.text.includes('Jasmyle Properties'), 'home page loads');
  const assets = [...r.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg|webmanifest))"/g)].map((m) => m[1]);
  for (const a of assets) { const x = await get(a); ok(x.status === 200, 'page file loads: ' + a, 'HTTP ' + x.status); }
  r = await get('/api/public/health'); ok(r.status === 200, 'health check');
  r = await get('/api/public/info'); ok(r.status === 200 && JSON.parse(r.text).app === 'Jasmyle Properties', 'server identifies itself');
  r = await get('/api/public/setup-status'); ok(r.status === 200 && JSON.parse(r.text).needsSetup === true, 'fresh system asks for first-time setup');
  const post = async (u, b) => { const x = await fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return { status: x.status, data: await x.json() }; };
  let p = await post('/api/public/first-admin', { name: 'Self Test', email: 'selftest@example.com', password: 'Zq7!hunter-Mango42' }); ok(p.status === 200, 'administrator can be created', JSON.stringify(p.data));
  p = await post('/api/auth/login', { identifier: 'selftest@example.com', password: 'Zq7!hunter-Mango42' }); ok(p.status === 200 && p.data.role === 'national_admin', 'administrator can sign in (password hashing works)', JSON.stringify(p.data));
  srv.close(); S.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log(fails ? `\nRESULT: ${fails} problem(s) found - send the diagnostic file to your support person` : '\nRESULT: ALL GOOD - Jasmyle Properties works on this computer');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('  FAIL  unexpected error: ' + (e && e.stack || e)); process.exit(1); });
