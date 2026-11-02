'use strict';
// Keeps Jasmyle Properties alive: starts the server, restarts it after a crash, and restarts it if it stops answering.
// The operating system (Windows Task Scheduler / Linux systemd) starts THIS file when the laptop switches on.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const cfg = require('./server/config');

fs.mkdirSync(cfg.paths.logs, { recursive: true });
const LOG = path.join(cfg.paths.logs, 'server.log');
const MAX = 5 * 1024 * 1024;

function rotate() {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > MAX) {
      for (let i = 4; i >= 1; i--) if (fs.existsSync(`${LOG}.${i}`)) fs.renameSync(`${LOG}.${i}`, `${LOG}.${i + 1}`);
      fs.renameSync(LOG, LOG + '.1');
    }
  } catch { /* ignore */ }
}
function write(line) {
  rotate();
  try { fs.appendFileSync(LOG, line.endsWith('\n') ? line : line + '\n'); } catch { /* ignore */ }
  process.stdout.write(line.endsWith('\n') ? line : line + '\n');
}
const note = (m) => write(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: '[supervisor] ' + m }));

let child = null; let stopping = false; let delay = 1000; let startedAt = 0; let fails = 0;
const pidFile = path.join(cfg.paths.data, 'supervisor.pid');

function start() {
  startedAt = Date.now(); fails = 0;
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, 'server.js')], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], env: process.env, windowsHide: true });
  note(`server started (pid ${child.pid})`);
  child.stdout.on('data', (d) => write(String(d).trimEnd()));
  child.stderr.on('data', (d) => write(String(d).trimEnd()));
  child.on('exit', (code, sig) => {
    child = null;
    if (stopping) return process.exit(0);
    const up = Date.now() - startedAt;
    if (up > 60000) delay = 1000; else delay = Math.min(delay * 2, 30000);
    note(`server stopped (code ${code}, ${sig || 'no signal'}) after ${Math.round(up / 1000)}s - restarting in ${Math.round(delay / 1000)}s`);
    setTimeout(start, delay);
  });
}

// watchdog: if the server is running but not answering, restart it
setInterval(() => {
  if (!child || Date.now() - startedAt < 20000) return;
  const req = http.get({ host: '127.0.0.1', port: cfg.port, path: '/api/public/health', timeout: 10000 }, (res) => { res.resume(); fails = res.statusCode === 200 ? 0 : fails + 1; check(); });
  req.on('timeout', () => { req.destroy(); });
  req.on('error', () => { fails++; check(); });
}, 30000).unref();
function check() { if (fails >= 3 && child) { note('server is not responding - restarting it'); fails = 0; child.kill('SIGKILL'); } }

function stop(sig) {
  if (stopping) return;
  stopping = true; note(`stopping (${sig})`);
  try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  if (child) { child.kill('SIGTERM'); setTimeout(() => { try { child && child.kill('SIGKILL'); } catch { /* ignore */ } process.exit(0); }, 8000).unref(); } else process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT')); process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGBREAK', () => stop('SIGBREAK'));

fs.mkdirSync(cfg.paths.data, { recursive: true });
fs.writeFileSync(pidFile, String(process.pid));
note('Jasmyle Properties supervisor online');
start();
