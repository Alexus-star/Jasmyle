'use strict';
// Jasmyle Properties server entry point. Normally started by supervisor.js (which restarts it if it ever stops).
const os = require('os');
const cfg = require('./server/config');
const S = require('./server/store');
const sec = require('./server/sec');
const { log } = require('./server/util');

S.open();
sec.master();
S.meta.set('boot:count', (S.meta.get('boot:count', 0) || 0) + 1);
S.meta.set('boot:last', Date.now());

const { createServer } = require('./server/app');
const jobs = require('./server/jobs');
const srv = createServer();

function onListening() {
  const proto = srv.tls ? 'https' : 'http';
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `${proto}://${i.address}:${cfg.port}`);
  log('info', `${cfg.appName} is running`, { local: `${proto}://localhost:${cfg.port}`, network: lan, publicUrl: S.meta.get('publicUrl') || cfg.publicUrl || null, adminIpAllowlist: cfg.adminIpAllowlist.length || 'off', needsSetup: !S.db.users.where('role', 'national_admin').length });
  jobs.start();
}
let triedFallback = false;
srv.on('error', (e) => {
  // No IPv6 on this computer: fall back to plain IPv4 (all addresses)
  if (!cfg.host && !triedFallback && (e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL' || e.code === 'EINVAL')) { triedFallback = true; srv.listen(cfg.port, '0.0.0.0', onListening); return; }
  if (e.code === 'EADDRINUSE') log('error', `Port ${cfg.port} is already in use. Is Jasmyle Properties already running? Change the port in data/config.json.`);
  else log('error', 'Server error: ' + e.message);
  process.exit(1);
});
if (cfg.host) srv.listen(cfg.port, cfg.host, onListening); else srv.listen(cfg.port, onListening);

let closing = false;
function shutdown(sig) {
  if (closing) return;
  closing = true;
  log('info', `Stopping (${sig})...`);
  jobs.stop();
  const done = () => { try { S.raw().exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ } S.close(); process.exit(0); };
  srv.close(done);
  setTimeout(done, 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGBREAK', () => shutdown('SIGBREAK'));
process.on('uncaughtException', (e) => { log('error', 'Uncaught exception: ' + (e && e.stack || e)); process.exit(1); });
process.on('unhandledRejection', (e) => { log('error', 'Unhandled rejection: ' + (e && e.stack || e)); process.exit(1); });
