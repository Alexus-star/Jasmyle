'use strict';
// Builds the HTTP(S) server with every route registered (does not start listening).
const http = require('http');
const https = require('https');
const fs = require('fs');
const cfg = require('./config');
const H = require('./http');

require('./routes/auth');
require('./routes/admin');
require('./routes/core');
require('./routes/money');
require('./routes/ops');
require('./routes/reports');
require('./routes/billing');
require('./routes/tax');
require('./routes/market');
require('./routes/utilities');
require('./routes/import');
require('./routes/ecosystem');
require('./routes/privacy');
require('./routes/insight');

const P = require('./platform');
// Maintenance mode: everything except National Administration (and public pages/callbacks) answers 503.
H.setGuard((ctx, r) => {
  if (r.opts.public || !ctx.user || ctx.user.role === 'national_admin') return;
  const c = P.config();
  if (c.maintenanceMode) throw Object.assign(new (require('./util').HttpError)(503, c.maintenanceNote || 'Maintenance in progress', 'maintenance'), {});
});
H.route('GET', '/api/public/health', { public: true }, async () => ({ ok: true, time: Date.now() }));
// Readiness: proves the database answers (use for load balancers / uptime monitors). No private data.
H.route('GET', '/api/public/ready', { public: true, rate: [120, 60000] }, async (ctx) => {
  try { require('./store').raw().prepare('SELECT 1').get(); } catch { return ctx.json({ ok: false, db: false }, 503); }
  return { ok: true, db: true, uptimeSec: Math.round(process.uptime()), version: require('../package.json').version };
});

function createServer() {
  const useTls = cfg.tlsCert && cfg.tlsKey && fs.existsSync(cfg.tlsCert) && fs.existsSync(cfg.tlsKey);
  const srv = useTls ? https.createServer({ cert: fs.readFileSync(cfg.tlsCert), key: fs.readFileSync(cfg.tlsKey), minVersion: 'TLSv1.2' }, H.handle) : http.createServer(H.handle);
  srv.headersTimeout = 20000;
  srv.requestTimeout = 120000; // large video uploads on slow mobile data
  srv.keepAliveTimeout = 5000;
  srv.maxHeadersCount = 60;
  srv.maxRequestsPerSocket = 500;
  srv.maxConnections = cfg.maxConnections; // protects a small server from connection floods
  srv.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ } });
  srv.tls = !!useTls;
  return srv;
}
module.exports = { createServer };
